#!/usr/bin/env node
// make.mjs: turns a video.json (written by the blast-radius skill) into an mp4.
//
//   node make.mjs <video.json> [--out file.mp4] [--quality draft|hd|4k] [--check]
//
// steps:
//   1. installs deps and builds the player the first time (npm, ~300 MB with chrome)
//   2. checks video.json: known scene types, every cue phrase appears in `say`
//   3. voiceover with ElevenLabs if ELEVENLABS_API_KEY is set, cached per line.
//      no key: a silent video, timed at normal speaking speed
//   4. renders frame by frame with a virtual clock, so no frame is ever
//      dropped, then adds the voice with ffmpeg
//
// --check stops after step 2. it costs nothing and catches cue typos.
//
// env (or ~/.config/blast-radius/env, KEY=value lines):
//   ELEVENLABS_API_KEY   optional. without it the video has captions only
//   ELEVENLABS_VOICE_ID  optional. default: a premade voice
//   ELEVENLABS_MODEL     optional. default: eleven_v4

import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input) {
  console.error("usage: node make.mjs <video.json> [--out file.mp4] [--quality draft|hd|4k] [--check]");
  process.exit(1);
}
const out = path.resolve(flag("--out", input.replace(/\.json$/, "") + ".mp4"));
const QUALITY = {
  draft: { scale: 1, fps: 30, crf: 23 }, // 960x540, fast preview
  hd: { scale: 2, fps: 60, crf: 16 }, // 1920x1080
  "4k": { scale: 4, fps: 60, crf: 14 }, // 3840x2160
}[flag("--quality", "hd")];
if (!QUALITY) throw new Error("--quality must be draft, hd or 4k");

const log = (msg) => console.log(`blast-radius video: ${msg}`);

// scene timing around the voice
const LEAD_IN = 500;
const TAIL = 900;
const CHARS_PER_SEC = 15; // speaking speed used when there is no voiceover

// ---- env ------------------------------------------------------------------

const envFile = path.join(os.homedir(), ".config/blast-radius/env");
const fileEnv = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]))
  : {};
const env = (k) => process.env[k] || fileEnv[k];

// ---- 1. check video.json ----------------------------------------------------

const video = JSON.parse(fs.readFileSync(input, "utf8"));
const TYPES = ["intro", "tldr", "arch", "tiers", "read", "diff", "code", "fix", "outro"];

// every phrase a scene waits for, so we can check they are actually said
function cuesOf(s) {
  const list = [s.cue, s.subtitleCue, s.afterCue, s.boundaryCue, s.noteCue, s.verdict?.cue];
  for (const key of ["rows", "after", "files", "tags", "points", "items"]) for (const x of s[key] ?? []) list.push(x.cue);
  return list.filter(Boolean);
}

const problems = [];
if (!Array.isArray(video.scenes) || !video.scenes.length) problems.push("scenes: missing or empty");
(video.scenes ?? []).forEach((s, i) => {
  const where = `scenes[${i}] (${s.type})`;
  if (!TYPES.includes(s.type)) problems.push(`${where}: unknown type, use one of ${TYPES.join(", ")}`);
  if (!s.say?.trim()) problems.push(`${where}: "say" is empty`);
  // case doesn't matter: "kolor" matches "Kolor" at the start of a sentence
  for (const c of cuesOf(s)) if (!s.say?.toLowerCase().includes(c.toLowerCase())) problems.push(`${where}: cue "${c}" is not in "say"`);
});
if (problems.length) {
  console.error(problems.map((p) => `  - ${p}`).join("\n"));
  console.error("blast-radius video: fix video.json and run again");
  process.exit(1);
}
log(`video.json ok (${video.scenes.length} scenes, ${video.scenes.reduce((n, s) => n + s.say.length, 0)} chars of voiceover)`);
if (args.includes("--check")) process.exit(0);

// ---- 2. setup ---------------------------------------------------------------

if (!fs.existsSync(path.join(here, "node_modules"))) {
  log("first run: installing the player (npm install, downloads chrome once)");
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: here, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const newest = (dir) => Math.max(...fs.readdirSync(dir, { recursive: true }).map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
const dist = path.join(here, "dist");
if (!fs.existsSync(dist) || newest(path.join(here, "src")) > fs.statSync(path.join(dist, "index.html")).mtimeMs) {
  log("building the player");
  execFileSync("npx", ["vite", "build"], { cwd: here, stdio: "inherit" });
}
// imported here, after npm install, not at the top of the file
const { default: puppeteer } = await import("puppeteer");
const { default: ffmpeg } = await import("ffmpeg-static");

// ---- 3. voiceover -----------------------------------------------------------

const key = env("ELEVENLABS_API_KEY");
const voice = env("ELEVENLABS_VOICE_ID") || "iP95p4xoKVk53GoZ742B"; // "Chris", premade, works on free plans
const model = env("ELEVENLABS_MODEL") || "eleven_v4";
const lang = video.lang ?? "en";
const cache = path.join(os.homedir(), ".cache/blast-radius/tts");
fs.mkdirSync(cache, { recursive: true });

function durationMs(file) {
  const r = spawnSync(ffmpeg, ["-i", file], { encoding: "utf8" });
  const [, h, m, s] = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return Math.round((+h * 3600 + +m * 60 + +s) * 1000);
}

// one line of voiceover: { mp3, charMs } with charMs relative to the voice start
async function speak(text) {
  const id = crypto.createHash("sha1").update(`${model}|${voice}|${lang}|${text}`).digest("hex").slice(0, 16);
  const mp3 = path.join(cache, `${id}.mp3`);
  const meta = path.join(cache, `${id}.json`);
  if (!fs.existsSync(meta)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: model, language_code: lang, voice_settings: { stability: 0.4, similarity_boost: 0.8 } }),
    });
    const body = await res.json();
    if (!body.audio_base64) throw new Error(`elevenlabs: ${JSON.stringify(body).slice(0, 300)}`);
    fs.writeFileSync(mp3, Buffer.from(body.audio_base64, "base64"));
    fs.writeFileSync(meta, JSON.stringify(body.alignment));
    log(`voiced ${text.length} chars`);
  }
  const alignment = JSON.parse(fs.readFileSync(meta, "utf8"));
  return { mp3, ms: durationMs(mp3), charMs: alignment.character_start_times_seconds.map((s) => Math.round(s * 1000)), chars: alignment.characters.join("") };
}

if (!key) log("no ELEVENLABS_API_KEY, making a silent video with captions");

const run = fs.mkdtempSync(path.join(os.tmpdir(), "blast-radius-video-"));
fs.mkdirSync(path.join(run, "audio"));
let start = 0;
const scenes = [];
const voiceTracks = [];
for (const [i, s] of video.scenes.entries()) {
  let voiceMs, charMs, chars;
  if (key) {
    const v = await speak(s.say);
    fs.copyFileSync(v.mp3, path.join(run, "audio", `${i}.mp3`));
    voiceTracks.push({ file: v.mp3, at: start + LEAD_IN });
    ({ charMs, chars } = v);
    voiceMs = v.ms;
  } else {
    charMs = [...s.say].map((_, k) => Math.round((k * 1000) / CHARS_PER_SEC));
    chars = s.say;
    voiceMs = charMs.at(-1) + 400;
  }
  const length = LEAD_IN + voiceMs + TAIL;
  scenes.push({ ...s, start, length, voiceAt: start + LEAD_IN, charMs: charMs.map((ms) => ms + LEAD_IN), chars });
  start += length;
}

// files for the tree: everything the scenes mention, unless video.json lists them
const tree = video.tree ?? [...new Set(scenes.flatMap((s) => [...(s.files ?? []).map((f) => f.path), s.type === "diff" ? s.file : null]).filter(Boolean))];
const timeline = { total: start, title: video.title, tierNames: video.tierNames ?? ["paint", "furniture", "load-bearing walls", "foundation"], tree, scenes };
fs.writeFileSync(path.join(run, "timeline.json"), JSON.stringify(timeline));
log(`${(start / 1000).toFixed(1)}s long, rendering ${QUALITY.fps}fps at ${960 * QUALITY.scale}x${540 * QUALITY.scale}`);

// ---- 4. render ----------------------------------------------------------------

// static server: the built player, plus /run/* from the temp folder
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = url.startsWith("/run/") ? path.join(run, url.slice(5)) : path.join(dist, url === "/" ? "index.html" : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".mp3": "audio/mpeg" }[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// virtual clock. replaces time in the page, so every frame is computed at
// exactly frame * 1000/fps ms, however long it takes to draw it.
const VIRTUAL_TIME = `(() => {
  let now = 0;
  const epoch = Date.now();
  const realTimeout = window.setTimeout.bind(window);
  const rafs = new Map();
  const timers = [];
  let id = 0;
  performance.now = () => now;
  Date.now = () => epoch + now;
  window.requestAnimationFrame = (cb) => (rafs.set(++id, cb), id);
  window.cancelAnimationFrame = (i) => rafs.delete(i);
  window.setTimeout = (cb, ms = 0, ...a) => (timers.push({ i: ++id, at: now + ms, cb: () => cb(...a) }), id);
  window.clearTimeout = (i) => { const k = timers.findIndex((t) => t.i === i); if (k >= 0) timers.splice(k, 1); };
  window.__tick = async (dt) => {
    now += dt;
    timers.sort((a, b) => a.at - b.at);
    while (timers.length && timers[0].at <= now) timers.shift().cb();
    const cbs = [...rafs.values()];
    rafs.clear();
    for (const cb of cbs) cb(now);
    // let react and motion commit what the callbacks scheduled
    await new Promise((r) => realTimeout(r, 0));
    await new Promise((r) => realTimeout(r, 0));
    // css transitions and web animations (motion uses them) follow the same clock
    for (const a of document.getAnimations()) {
      if (a.__born === undefined) { a.__born = now - dt; a.pause(); }
      const end = a.effect?.getComputedTiming().endTime;
      const at = now - a.__born;
      if (Number.isFinite(end) && at >= end) { try { a.finish(); } catch {} }
      else a.currentTime = at;
    }
  };
})();`;

const browser = await puppeteer.launch({ headless: true, args: ["--hide-scrollbars", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540, deviceScaleFactor: QUALITY.scale });
await page.evaluateOnNewDocument(VIRTUAL_TIME);
await page.goto(`http://localhost:${port}/?render`, { waitUntil: "networkidle0" });
// warm up: the highlighter loads with real promises, step the clock until ready
for (let i = 0; i < 600 && !(await page.evaluate(() => window.__ready === true)); i++) await page.evaluate(() => window.__tick(16));
await page.evaluate(() => window.__start());

const frameMs = 1000 / QUALITY.fps;
const frames = Math.ceil(start / frameMs);
const silent = path.join(run, "video.mp4");
const encoder = startEncoder(ffmpeg, [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(QUALITY.fps), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", String(QUALITY.crf), "-pix_fmt", "yuv420p", "-tune", "animation",
  silent,
]);
const began = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((dt) => window.__tick(dt), frameMs);
  // page.screenshot keeps the device scale factor, a raw CDP session doesn't
  const jpeg = await page.screenshot({ type: "jpeg", quality: 96, optimizeForSpeed: true });
  if (f === 0) assertSize(jpeg, 960 * QUALITY.scale, 540 * QUALITY.scale);
  await encoder.write(jpeg);
  if (f % (QUALITY.fps * 5) === 0) {
    const eta = ((Date.now() - began) / (f + 1)) * (frames - f) / 1000;
    process.stdout.write(`\rblast-radius video: frame ${f}/${frames}, ~${Math.round(eta)}s left   `);
  }
}
process.stdout.write("\n");
await encoder.end();
await browser.close();
server.close();

// ---- 5. voice --------------------------------------------------------------

fs.mkdirSync(path.dirname(out), { recursive: true });
if (voiceTracks.length) {
  const inputs = voiceTracks.flatMap((v) => ["-i", v.file]);
  const delays = voiceTracks.map((v, i) => `[${i + 1}:a]adelay=${v.at}|${v.at}[a${i}]`).join(";");
  const mix = voiceTracks.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voiceTracks.length}:normalize=0[aout]`;
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error", "-i", silent, ...inputs,
    "-filter_complex", `${delays};${mix}`,
    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
    out,
  ]);
} else {
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", silent, "-c", "copy", "-movflags", "+faststart", out]);
}
fs.rmSync(run, { recursive: true, force: true });
log(`saved ${out}`);

// ---- helpers ------------------------------------------------------------------

// stops early if chrome hands back frames at the wrong resolution
function assertSize(jpeg, width, height) {
  for (let i = 2; i < jpeg.length; ) {
    const marker = jpeg[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) {
      const h = jpeg.readUInt16BE(i + 5);
      const w = jpeg.readUInt16BE(i + 7);
      if (w !== width || h !== height) throw new Error(`frames are ${w}x${h}, expected ${width}x${height}`);
      return;
    }
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
}

// ffmpeg with a writable stdin that respects backpressure
function startEncoder(bin, argv) {
  const proc = spawn(bin, argv, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => proc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
  return {
    write: (buf) => new Promise((res) => (proc.stdin.write(buf) ? res() : proc.stdin.once("drain", res))),
    end: () => (proc.stdin.end(), done),
  };
}
