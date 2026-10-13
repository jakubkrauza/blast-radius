# video (only with --video)

Turn the finished review into a short narrated video: a friend who read the
PR walks you through it. Black background, big type, the real code on screen,
animations timed to the voice.

You write one file, `video.json`. `video/make.mjs` does the rest: voiceover,
timing, rendering, mp4.

## Steps

1. Finish the markdown report first. The video retells it, it doesn't
   replace it.
2. Write `/tmp/blast-radius/<target>.video.json` using the shape below.
3. Check it, free and instant:
   `node <skill-dir>/video/make.mjs <file> --check`
   Fix every problem it lists, then check again.
4. Render:
   `node <skill-dir>/video/make.mjs <file> --out /tmp/blast-radius/<target>.mp4`
   The first run installs the player (npm, about 300 MB including Chrome)
   and takes a few minutes. A 90 second video renders in about 3 to 6 minutes
   at the default `hd` quality. Use `--quality draft` for a fast preview and
   `--quality 4k` for the best result (slow).
   Give the command a long timeout (15 minutes) or run it in the background
   and wait for it; most shell tools stop commands after 2 minutes.
5. Give the user the mp4 path. Say whether it has a voice: without
   `ELEVENLABS_API_KEY` it is a silent video with captions.

If `node` or `npm` is missing, or the render fails, say so in one line and
keep the markdown report as the result. Never retry a failing render more
than once.

## How it should sound

- A colleague explaining over coffee, not a narrator. Short sentences,
  everyday words, first person is fine ("I'd do it like this").
- Language: the `--lang` value, `en` if none. Write `say` lines natively in
  that language, don't translate word for word. Code, paths and identifiers
  stay as they are.
- 60 to 120 seconds total. Roughly 15 characters per second, so 900 to 1800
  characters of `say` across all scenes. Every character costs voice credits.
- Lead with the TL;DR. If anything is tier 3 or changes how parts of the
  system talk to each other, explain the architecture change in plain words:
  what talked to what before, what talks to what now, and why that matters.
- Spend the time on tiers 2 and 3. Paint gets one sentence.
- End with what to read.

## Scenes

`video.json`:

```json
{
  "lang": "en",
  "title": "feat/welcome",
  "tierNames": ["paint", "furniture", "load-bearing walls", "foundation"],
  "tree": ["src/lib/users.ts", "package.json"],
  "scenes": [ ... ]
}
```

- `tierNames`: the four tier names in the video's language.
- `tree`: optional. Paths for the file tree on the left. Default: every path
  used in `tiers` and `diff` scenes. Add one or two unchanged neighbours if
  that makes the structure clearer, no more.

Every scene has `type` and `say` (what the voice says during it). Most
visual elements have a `cue`: an exact phrase from that scene's `say`. The
element appears when the voice reaches that phrase. A cue must appear
in `say` word for word, with the same accents (ą, é, ...). Case doesn't
matter. `--check` enforces it.
No cue means it appears when the voice starts.

Pick the scenes that fit the PR. A typical order:
intro, tldr, arch (if the architecture changed), tiers, read, one diff per
important unit, code (the main problem), fix (if you have a concrete
suggestion), outro. Leave out what you don't need. Keep it under 12 scenes.

| type | fields |
|---|---|
| `intro` | `title`, `subtitle`, `subtitleCue`, `eyebrow` |
| `tldr` | `eyebrow`, `rows: [{ label, value, cue, risk }]`. 2 to 4 rows. `risk: true` paints the value red |
| `arch` | `eyebrow`, `titleBefore`, `titleAfter`, `context`, `afterCue`, `before: [{ label, sub }]`, `after: [{ label, sub, kind, cue }]`, `boundaryLabel`, `boundaryCue`, `note`, `noteCue` |
| `tiers` | `eyebrow`, `files: [{ path, tier, cue, label }]` |
| `read` | `eyebrow`, `linesToRead`, `linesTotal`, `unit`, `byTier: [n0, n1, n2, n3]`, `cue` |
| `diff` | `tier`, `eyebrow`, `title`, `file`, `language`, `lines: [{ type, oldLine, newLine, content }]`, `tags: [{ text, cue }]` |
| `code` | `tier`, `eyebrow`, `file`, `language`, `code`, `points: [{ text, line, cue }]`, `verdict: { text, cue }` |
| `fix` | `eyebrow`, `file`, `language`, `code`, `points: [{ text, cue }]` |
| `outro` | `eyebrow`, `ranges: [path:lines]`, `cue`, `footer` |

Details:

- `arch`: a left-to-right flow of 2 to 6 boxes. `before` is the old flow,
  `after` the new one. Boxes keep their place by `label`, so reuse the same
  label for the same box. `kind: "new"` marks an added step, `kind:
  "external"` something outside the system (an API, a queue, another
  service); it gets a "outside" zone that appears on `boundaryCue`.
  `afterCue` is where the voice starts describing the new flow.
- `tiers`: one entry per changed file worth naming. `label` overrides the
  text shown next to the tier (default: file name).
- `diff`: `type` is `added`, `removed` or `context`. Show the 4 to 14 lines
  that matter, not the whole file. `language`: `typescript`, `tsx`, `json`,
  `bash`, `diff` or `text`.
- `code`: the current code with the problem. `line` (1-based, in `code`)
  lights up that line on the cue. `verdict.text` is `ok`, `check` or
  `blocks`, the same verdict as the report.
- `fix`: the code as you'd write it, streamed in while you explain. Only
  when you have a concrete fix. 4 to 12 lines.
- Keep every on-screen text short: rows and points under 50 characters.

A full example: [video/example.pl.json](video/example.pl.json).

## Voice

Set once, in the shell or in `~/.config/blast-radius/env`:

```
ELEVENLABS_API_KEY=...        # no key: silent video with captions
ELEVENLABS_VOICE_ID=...       # optional, default "Chris" (premade)
ELEVENLABS_MODEL=eleven_v4    # optional
```

Never write the key into `video.json`, the report or any file in the repo.
Voice lines are cached in `~/.cache/blast-radius/tts`, so re-rendering the
same script costs nothing.
