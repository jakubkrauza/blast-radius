// blast-radius video player.
//
// make.mjs writes run/timeline.json (the scenes from video.json plus timing
// from the voiceover) and serves it next to this page. the page plays it as
// one timeline: `t` is ms since start, every scene and every animation is a
// pure function of `t`, so the renderer can step through it frame by frame.
//
// the scene types and their fields are documented in ../video.md.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { CodeBlock } from "@/components/agents/code-block";
import { FileDiff, type FileDiffLine } from "@/components/agents/file-diff";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/motion/file-tree";
import { useAgentCodeTokens, type AgentCodeLanguage } from "@/components/agents/agent-code";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";

// ---- data shapes ------------------------------------------------------------

type Cued = { cue?: string };
type SceneBase = { type: string; say: string; eyebrow?: string; start: number; length: number; voiceAt: number; charMs: number[]; chars: string };
type Scene = SceneBase & Record<string, any>;
type Timeline = {
  total: number;
  title: string;
  tierNames: string[];
  tree: string[];
  scenes: Scene[];
};

const TIER_COLORS = ["#8e8e93", "#64a0ff", "#ffb340", "#ff5f57"];
const RED = TIER_COLORS[3];
const GREEN = "#30d158";
const ease = { duration: 0.7, ease: EASE_OUT };

// ---- timing helpers ---------------------------------------------------------

// absolute ms when `phrase` is spoken in scene `s`, ignoring case. no phrase = scene's voice start.
function cue(s: Scene, phrase?: string) {
  if (!phrase) return s.voiceAt;
  const i = s.chars.toLowerCase().indexOf(phrase.toLowerCase());
  return i < 0 ? s.voiceAt : s.start + s.charMs[i];
}

// 0..1 progress of t between a and b
const p = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

// loads the timeline, then runs the clock. with ?render the clock only starts
// on window.__start(), and render.mjs controls time from outside.
function usePlayer() {
  const [data, setData] = useState<Timeline | null>(null);
  const [t, setT] = useState(-1);
  useEffect(() => {
    fetch("/run/timeline.json").then((r) => r.json()).then(setData);
  }, []);
  useEffect(() => {
    if (!data) return;
    const rendering = new URLSearchParams(location.search).has("render");
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      const elapsed = now - t0;
      setT(elapsed);
      if (elapsed >= data.total) (window as any).__done = true;
      else raf = requestAnimationFrame(tick);
    };
    const start = () => {
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    };
    (window as any).__start = start;
    if (rendering) return () => cancelAnimationFrame(raf);
    // in a normal browser: play the voice too
    const voices = data.scenes.map((s, i) => Object.assign(new Audio(`/run/audio/${i}.mp3`), { at: s.voiceAt }));
    const timers = voices.map((a) => setTimeout(() => a.play().catch(() => {}), a.at));
    start();
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [data]);
  return { data, t };
}

// ---- building blocks --------------------------------------------------------

// fades and un-blurs in when `on` turns true
function Reveal({ on, children, className, y = 12, delay = 0 }: { on: boolean; children: ReactNode; className?: string; y?: number; delay?: number }) {
  return (
    <motion.div
      initial={false}
      animate={on ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y, filter: "blur(8px)" }}
      transition={{ ...ease, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// wrapper for every scene: blur crossfade
function SceneBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)", scale: 0.985 }}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      exit={{ opacity: 0, filter: "blur(10px)", scale: 1.01 }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className={`flex h-full flex-col justify-center ${className}`}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children, color = "#8e8e93" }: { children: ReactNode; color?: string }) {
  if (!children) return null;
  return <div className="mb-4 text-[11px] font-medium tracking-[0.18em] uppercase" style={{ color }}>{children}</div>;
}

function Points({ s, t, points, mark }: { s: Scene; t: number; points: (Cued & { text: string })[]; mark: (i: number) => ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {points.map((x, i) => (
        <Reveal key={x.text} on={t > cue(s, x.cue)} y={6} className="flex items-center gap-3 text-[15px] text-white/85">
          {mark(i)}
          {x.text}
        </Reveal>
      ))}
    </div>
  );
}

// ---- scenes -----------------------------------------------------------------

type SceneProps = { s: Scene; t: number; data: Timeline };

function Intro({ s, t }: SceneProps) {
  return (
    <SceneBox className="items-center text-center">
      <Reveal on className="mb-6 text-[11px] font-medium tracking-[0.3em] text-white/40 uppercase">{s.eyebrow ?? "blast radius"}</Reveal>
      <Reveal on delay={0.15} y={20}>
        <h1 className="text-[56px] font-semibold tracking-[-0.03em] text-white">{s.title}</h1>
      </Reveal>
      <Reveal on={t > cue(s, s.subtitleCue)} className="mt-5 max-w-xl text-lg text-white/55">{s.subtitle}</Reveal>
    </SceneBox>
  );
}

function Tldr({ s, t }: SceneProps) {
  return (
    <SceneBox>
      <Eyebrow>{s.eyebrow ?? "tl;dr"}</Eyebrow>
      <div className="flex flex-col">
        {s.rows.map((r: any) => (
          <Reveal key={r.label} on={t > cue(s, r.cue)} className="flex items-baseline gap-8 border-t border-white/[0.08] py-5">
            <span className="w-36 shrink-0 text-sm text-white/40">{r.label}</span>
            <span className="text-[28px] leading-tight font-medium tracking-[-0.02em]" style={{ color: r.risk ? RED : "#fff" }}>{r.value}</span>
          </Reveal>
        ))}
      </div>
    </SceneBox>
  );
}

// one box in the architecture diagram
function Node({ label, sub, kind, width }: { label: string; sub?: string; kind?: string; width: number }) {
  const marked = kind === "new" || kind === "external";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={SPRING_LAYOUT}
      className="shrink-0 rounded-xl px-3 py-3"
      style={{
        width,
        border: `1px ${kind === "external" ? "dashed" : "solid"} ${marked ? RED : "rgba(255,255,255,0.14)"}`,
        background: marked ? "rgba(255,95,87,0.06)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="truncate font-mono text-[12px] text-white">{label}</div>
      {sub && <div className="mt-1 truncate text-[11px]" style={{ color: marked ? "#ff8a84" : "rgba(255,255,255,0.4)" }}>{sub}</div>}
    </motion.div>
  );
}

function Arrow({ id }: { id: string }) {
  return (
    <motion.svg key={id} layout transition={SPRING_LAYOUT} width="22" height="10" viewBox="0 0 22 10" className="shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <path d="M0 5h19M15 1l4 4-4 4" stroke="rgba(255,255,255,0.35)" fill="none" strokeWidth="1.2" />
    </motion.svg>
  );
}

function Arch({ s, t }: SceneProps) {
  const after = t > cue(s, s.afterCue);
  const boundary = s.boundaryCue && t > cue(s, s.boundaryCue);
  // before: the old flow. after: the new flow, each new node popping in on its cue
  const nodes: any[] = after ? s.after.filter((n: any) => !n.cue || t > cue(s, n.cue)) : s.before;
  const count = Math.max(s.before.length, s.after.length);
  const width = Math.min(150, Math.floor((830 - (count - 1) * 38) / count));
  return (
    <SceneBox>
      <Eyebrow>{s.eyebrow}</Eyebrow>
      <div className="mb-12 flex items-baseline gap-3 text-[30px] font-medium tracking-[-0.02em]">
        <AnimatePresence mode="wait">
          <motion.span key={after ? "a" : "b"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={ease}>
            {after ? s.titleAfter : s.titleBefore}
          </motion.span>
        </AnimatePresence>
        {s.context && <span className="text-base text-white/35">{s.context}</span>}
      </div>
      <motion.div layout className="flex items-center gap-2">
        <AnimatePresence initial={false}>
          {nodes.flatMap((n, i) => [
            i > 0 && <Arrow key={`arrow-${n.label}`} id={`arrow-${n.label}`} />,
            <motion.div key={n.label} layout transition={SPRING_LAYOUT} className="relative">
              {n.kind === "external" && (
                <motion.div
                  initial={false}
                  animate={{ opacity: boundary ? 1 : 0, scale: boundary ? 1 : 0.9 }}
                  transition={ease}
                  className="pointer-events-none absolute -inset-x-3 -inset-y-8 rounded-2xl"
                  style={{ background: "rgba(255,95,87,0.07)" }}
                >
                  <div className="absolute top-2 w-full text-center text-[10px] tracking-wide" style={{ color: RED }}>{s.boundaryLabel}</div>
                </motion.div>
              )}
              <Node label={n.label} sub={n.sub} kind={after ? n.kind : undefined} width={width} />
            </motion.div>,
          ])}
        </AnimatePresence>
      </motion.div>
      {s.note && <Reveal on={t > cue(s, s.noteCue ?? s.boundaryCue)} className="mt-14 max-w-2xl text-lg text-white/55">{s.note}</Reveal>}
    </SceneBox>
  );
}

function Tiers({ s, t, data }: SceneProps) {
  return (
    <SceneBox>
      <Eyebrow>{s.eyebrow}</Eyebrow>
      {data.tierNames.map((name, tier) => {
        const files = s.files.filter((f: any) => f.tier === tier);
        const on = files.length > 0 && t > Math.min(...files.map((f: any) => cue(s, f.cue)));
        return (
          <motion.div key={name} initial={false} animate={{ opacity: on ? 1 : 0.35 }} transition={ease} className="flex items-center gap-5 border-t border-white/[0.08] py-4">
            <span className="w-4 font-mono text-xs text-white/35">{tier}</span>
            <span className="size-2.5 rounded-full" style={{ background: TIER_COLORS[tier] }} />
            <span className="w-52 text-[22px] font-medium tracking-[-0.01em]">{name}</span>
            <Reveal on={on} className="truncate font-mono text-[13px] text-white/50">
              {files.map((f: any) => f.label ?? f.path.split("/").at(-1)).join(", ")}
            </Reveal>
          </motion.div>
        );
      })}
    </SceneBox>
  );
}

function ReadCount({ s, t, data }: SceneProps) {
  const grow = p(t, s.voiceAt, s.voiceAt + 1600);
  const at = cue(s, s.cue);
  const count = p(t, at - 300, at + 500);
  const from = Math.round(s.linesToRead * 0.4);
  const tiers = s.byTier.map((n: number, i: number) => ({ n, i })).filter((x: any) => x.n > 0);
  return (
    <SceneBox>
      <Eyebrow>{s.eyebrow}</Eyebrow>
      <div className="flex items-baseline gap-4">
        <span className="text-[120px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{Math.round(from + (s.linesToRead - from) * count)}</span>
        <span className="text-4xl text-white/30">/ {s.linesTotal} {s.unit ?? "lines"}</span>
      </div>
      <div className="mt-10 flex h-2 w-full gap-1 overflow-hidden">
        {tiers.map(({ n, i }: any, k: number) => (
          <motion.div key={i} className="h-full rounded-full" style={{ background: TIER_COLORS[i], flexGrow: n * Math.min(1, Math.max(0, grow * 1.6 - k * 0.25)) }} />
        ))}
      </div>
      <div className="mt-4 flex gap-6 text-[12px] text-white/45">
        {tiers.map(({ n, i }: any) => (
          <span key={i}><span style={{ color: TIER_COLORS[i] }}>●</span> {data.tierNames[i]} {n}</span>
        ))}
      </div>
    </SceneBox>
  );
}

function Diff({ s, t }: SceneProps) {
  const lines: FileDiffLine[] = s.lines.map((l: any, i: number) => ({ id: String(i), ...l }));
  // stream the diff in over the first part of the voice
  const streamEnd = s.voiceAt + Math.min(3200, Math.max(900, (s.length - (s.voiceAt - s.start)) * 0.45));
  const shown = Math.ceil(p(t, s.voiceAt, streamEnd) * lines.length);
  const done = t > streamEnd + 200;
  return (
    <SceneBox>
      <Eyebrow color={TIER_COLORS[s.tier]}>{s.eyebrow}</Eyebrow>
      {s.title && <div className="mb-6 text-[30px] font-medium tracking-[-0.02em]">{s.title}</div>}
      <FileDiff file={s.file} lines={lines.slice(0, Math.max(1, shown))} status={done ? "complete" : "streaming"} collapseOnComplete={false} language={(s.language ?? "typescript") as AgentCodeLanguage} maxHeight={250} />
      {s.tags?.length > 0 && (
        <div className="mt-5 ml-6 flex flex-wrap gap-2">
          {s.tags.map((tag: any) => (
            <Reveal key={tag.text} on={t > cue(s, tag.cue)} y={6}>
              <span className="rounded-full px-3 py-1 text-[12px]" style={{ color: s.tier >= 3 ? "#ff8a84" : "#ffd08a", background: s.tier >= 3 ? "rgba(255,95,87,0.1)" : "rgba(255,179,64,0.1)" }}>{tag.text}</span>
            </Reveal>
          ))}
        </div>
      )}
    </SceneBox>
  );
}

// "line": 5 or [5, 7] -> [5, 6, 7]
const lineRange = (line: number | number[] | undefined) =>
  line === undefined ? [] : Array.isArray(line) ? Array.from({ length: line[1] - line[0] + 1 }, (_, k) => line[0] + k) : [line];

// code on screen, explained by the voice.
// mode "explain" (a walkthrough): the highlight follows the line being talked about.
// mode "problem" (default): each problem line lights up red and stays lit.
function Code({ s, t }: SceneProps) {
  const explain = s.mode === "explain";
  const reached = s.points.filter((x: any) => t > cue(s, x.cue));
  const lit = explain ? lineRange(reached.at(-1)?.line) : reached.flatMap((x: any) => lineRange(x.line));
  const verdict = s.verdict && t > cue(s, s.verdict.cue);
  const tone = s.verdict?.text === "ok" ? GREEN : s.verdict?.text === "check" ? TIER_COLORS[2] : RED;
  const mark = explain ? "#64a0ff" : RED;
  return (
    <SceneBox>
      <Eyebrow color={TIER_COLORS[s.tier ?? 3]}>{s.eyebrow}</Eyebrow>
      {s.title && <div className="mb-5 text-[26px] font-medium tracking-[-0.02em]">{s.title}</div>}
      <div className={`${explain ? "explain-code" : "problem-code"} relative`}>
        <CodeBlock
          filename={s.file}
          language={(s.language ?? "typescript") as AgentCodeLanguage}
          code={s.code}
          status="complete"
          highlightLines={lit}
          maxHeight={270}
          copyable={false}
        />
        <AnimatePresence>
          {verdict && (
            <motion.div
              initial={{ opacity: 0, scale: 1.8, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: -6 }}
              transition={{ type: "spring", stiffness: 300, damping: 15 }}
              className="absolute -right-2 -bottom-5 rounded-md px-3 py-1 text-sm font-semibold tracking-[0.2em] uppercase"
              style={{ color: tone, border: `1.5px solid ${tone}`, background: "#000" }}
            >
              {s.verdict.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Points s={s} t={t} points={s.points} mark={(i) => <span className="w-4 font-mono text-xs" style={{ color: mark }}>{i + 1}</span>} />
    </SceneBox>
  );
}

function Fix({ s, t }: SceneProps) {
  const lines = s.code.split("\n");
  const lastCue = Math.max(...s.points.map((x: any) => cue(s, x.cue)));
  const shown = Math.ceil(p(t, s.voiceAt + 300, Math.max(s.voiceAt + 1500, lastCue + 600)) * lines.length);
  return (
    <SceneBox>
      <Eyebrow color={GREEN}>{s.eyebrow}</Eyebrow>
      <CodeBlock
        filename={s.file}
        language={(s.language ?? "typescript") as AgentCodeLanguage}
        code={lines.slice(0, Math.max(1, shown)).join("\n")}
        status={shown < lines.length ? "streaming" : "complete"}
        maxHeight={220}
        copyable={false}
      />
      <Points s={s} t={t} points={s.points} mark={() => <span style={{ color: GREEN }}>✓</span>} />
    </SceneBox>
  );
}

// the decision: verdict in big type, then what to do next
function Outro({ s, t }: SceneProps) {
  const tone = s.verdict?.text === "ok" ? GREEN : s.verdict?.text === "check" ? TIER_COLORS[2] : RED;
  const items: { text: string; cue?: string }[] = s.items ?? (s.ranges ?? []).map((r: string) => ({ text: r, cue: s.cue }));
  return (
    <SceneBox>
      <Eyebrow>{s.eyebrow}</Eyebrow>
      {s.verdict && (
        <Reveal on={t > cue(s, s.verdict.cue)} y={16} className="mb-8 flex items-baseline gap-5">
          <span className="text-[64px] leading-none font-semibold tracking-[-0.04em]" style={{ color: tone }}>{s.verdict.label ?? s.verdict.text}</span>
          {s.verdict.note && <span className="text-lg text-white/50">{s.verdict.note}</span>}
        </Reveal>
      )}
      <div className="flex flex-col">
        {items.map((x, i) => (
          <Reveal key={x.text} on={t > cue(s, x.cue) + (x.cue ? 0 : i * 350)} className="flex items-center gap-4 border-t border-white/[0.08] py-4 text-[20px] tracking-[-0.01em]">
            <span className="font-mono text-sm text-white/35">{i + 1}</span>
            {x.text}
          </Reveal>
        ))}
      </div>
      <Reveal on={t > s.start + s.length - 1800} className="mt-12 text-[12px] tracking-wide text-white/35">
        {s.footer ?? "blast-radius · github.com/jakubkrauza/blast-radius"}
      </Reveal>
    </SceneBox>
  );
}

const VIEWS: Record<string, (props: SceneProps) => ReactNode> = {
  intro: Intro, tldr: Tldr, arch: Arch, tiers: Tiers, read: ReadCount,
  diff: Diff, code: Code, fix: Fix, outro: Outro,
};

// scenes that show the file tree on the left
const TREE_SCENES = ["tiers", "diff"];

// ---- file tree ----------------------------------------------------------------

type TreeNode = { name: string; path: string; children: TreeNode[] };

// "a/b/c.ts" paths into nested folders
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const path of [...paths].sort()) {
    let node = root;
    path.split("/").forEach((name, i, parts) => {
      const sub = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.path === sub);
      if (!child) node.children.push((child = { name, path: sub, children: [] }));
      node = child;
    });
  }
  // folders first, like an editor
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(!a.children.length) - Number(!b.children.length) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function Tree({ data, t, scene }: { data: Timeline; t: number; scene: Scene }) {
  const tiersScene = data.scenes.find((x) => x.type === "tiers");
  const tierOf = new Map<string, { tier: number; at: number }>(
    (tiersScene?.files ?? []).map((f: any) => [f.path, { tier: f.tier, at: cue(tiersScene!, f.cue) }]),
  );
  const nodes = buildTree(data.tree);
  const folders: string[] = [];
  const walk = (list: TreeNode[]) => list.forEach((n) => n.children.length && (folders.push(n.path), walk(n.children)));
  walk(nodes);
  const openFrom = tiersScene?.start ?? scene.start;
  const expanded = folders.filter((_, i) => t > openFrom + 300 + i * 160);

  // selection: the file on screen, or the last file lit up in the tiers scene
  const lit = [...tierOf.entries()].filter(([, v]) => t > v.at).sort((a, b) => a[1].at - b[1].at);
  const value = scene.type === "diff" ? scene.file : lit.at(-1)?.[0] ?? null;

  const render = (list: TreeNode[]): ReactNode[] =>
    list.map((n) => {
      if (n.children.length) return <FileTreeFolder key={n.path} value={n.path} name={n.name}>{render(n.children)}</FileTreeFolder>;
      const info = tierOf.get(n.path);
      const on = info && t > info.at;
      const icon = info ? (
        <span className="grid size-4 place-items-center">
          <motion.span className="inline-block size-2 rounded-full" style={{ background: TIER_COLORS[info.tier] }} initial={false} animate={{ scale: on ? 1 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} />
        </span>
      ) : undefined;
      return <FileTreeFile key={n.path} value={n.path} name={n.name} icon={icon} />;
    });

  return (
    <FileTree value={value} expandedIds={expanded} ariaLabel="changed files" indent={14}>
      {render(nodes)}
    </FileTree>
  );
}

// ---- captions & app -----------------------------------------------------------

// subtitle: the sentence being spoken right now
function Caption({ data, t }: { data: Timeline; t: number }) {
  const s = data.scenes.find((x) => t >= x.start && t < x.start + x.length);
  let sentence = "";
  if (s) {
    const local = t - s.start;
    // sentences end at . ? ! : followed by a space, so "users.ts" stays whole
    const parts = [...s.say.matchAll(/.+?(?:[.?!:](?=\s|$)|$)/g)].map((m) => {
      const lead = m[0].length - m[0].trimStart().length;
      return { text: m[0].trim(), at: s.charMs[(m.index ?? 0) + lead] ?? 0 };
    });
    const current = parts.filter((x) => x.text && x.at - 150 <= local).at(-1);
    if (current && local < (s.charMs.at(-1) ?? 0) + 700) sentence = current.text;
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-16">
      <AnimatePresence mode="wait">
        {sentence && (
          <motion.div key={sentence} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="text-center text-[14px] text-white/70">
            {sentence}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// warms up the syntax highlighter, so the first diff isn't plain text
function Preload({ data }: { data: Timeline }) {
  const langs = [...new Set(data.scenes.map((s) => s.language).filter(Boolean)), "typescript"] as AgentCodeLanguage[];
  const a = useAgentCodeTokens("const a = 1;", langs[0]);
  useEffect(() => {
    if (a) (window as any).__ready = true;
  }, [a]);
  return null;
}

export default function App() {
  const { data, t } = usePlayer();
  if (!data) return <div className="h-screen bg-black" />;
  const index = data.scenes.findIndex((x) => t >= x.start && t < x.start + x.length);
  const scene = data.scenes[index === -1 ? data.scenes.length - 1 : index];
  const View = VIEWS[scene.type];
  const showTree = t >= 0 && TREE_SCENES.includes(scene.type);

  return (
    <div className="dark relative h-screen w-screen overflow-hidden bg-black text-white antialiased" style={{ fontFamily: '-apple-system, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif' }}>
      <Preload data={data} />
      {t >= 0 && (
        <div className="relative flex h-full gap-10 px-16 pt-10 pb-16">
          <AnimatePresence>
            {showTree && (
              <motion.aside
                key="tree"
                initial={{ opacity: 0, width: 0, filter: "blur(8px)" }}
                animate={{ opacity: 1, width: 200, filter: "blur(0px)" }}
                exit={{ opacity: 0, width: 0, filter: "blur(8px)" }}
                transition={SPRING_LAYOUT}
                className="flex shrink-0 flex-col justify-center overflow-hidden"
              >
                <Tree data={data} t={t} scene={scene} />
              </motion.aside>
            )}
          </AnimatePresence>
          <motion.main layout transition={SPRING_LAYOUT} className="relative min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div key={index} className="h-full">
                <View s={scene} t={t} data={data} />
              </motion.div>
            </AnimatePresence>
          </motion.main>
        </div>
      )}
      <Caption data={data} t={t} />
    </div>
  );
}
