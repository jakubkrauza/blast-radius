# video (only with --video)

Turn the finished review into a short narrated video that **replaces reading
the diff**. A colleague who read every line walks the viewer through what
changed, how it works, what it does to the architecture, what's wrong with
it, and what to do. After watching, the viewer should be able to decide on
the PR without opening the code.

Never tell the viewer to go read something. If a part matters, explain it on
screen. If it doesn't matter, say so in one sentence and move on.

You write one file, `video.json`. `video/make.mjs` does the rest: voiceover,
timing, rendering, mp4.

## Steps

1. Finish the markdown report first. The video is built from it.
2. Write `/tmp/blast-radius/<target>.video.json` using the shape below.
3. Check it, free and instant:
   `node <skill-dir>/video/make.mjs <file> --check`
   Fix every problem it lists, then check again.
4. Render:
   `node <skill-dir>/video/make.mjs <file> --out /tmp/blast-radius/<target>.mp4`
   The first run installs the player (npm, about 300 MB including Chrome)
   and takes a few minutes. A 2 minute video renders in about 4 to 8 minutes
   at the default `hd` quality. Use `--quality draft` for a fast preview and
   `--quality 4k` for the best result (slow).
   Give the command a long timeout (15 minutes) or run it in the background
   and wait for it; most shell tools stop commands after 2 minutes.
5. Give the user the mp4 path. Say whether it has a voice: without
   `ELEVENLABS_API_KEY` it is a silent video with captions.

If `node` or `npm` is missing, or the render fails, say so in one line and
keep the markdown report as the result. Never retry a failing render more
than once.

## What the video has to cover

Plan it like this, in this order:

1. **TL;DR** (`tldr`): what the PR does, how big it is, the one thing that
   matters most.
2. **Architecture** (`arch`), whenever a change is tier 3 or changes how
   parts of the system talk to each other: what talked to what before, what
   talks to what now, and why that matters. Skip it for purely local changes.
3. **Sorting** (`tiers`): every changed file and its tier, one sentence for
   the paint and furniture. They get no more time than that.
4. **Walkthrough**, for every tier 2 and tier 3 unit from the report. This is
   the main part of the video:
   - a `code` scene with `"mode": "explain"` showing the new code. Go through
     it in order: what each part does and why it's there, in plain words.
     Each point lights up the lines it talks about. The viewer should
     understand the code without reading it.
   - if the report found a problem: a `code` scene in the default problem
     mode on the same code. What goes wrong, when, and what it costs.
   - a `fix` scene when the report has a concrete fix.
   A short `diff` scene before the walkthrough helps when the change is a
   small edit to existing code (what was removed, what was added).
5. **Decision** (`outro`): the verdict (`ok`, `check` or `blocks`) and the
   concrete next steps as actions ("save the user before sending the email"),
   never as files to read.

Leave out what doesn't apply. A tiny safe PR can be intro, tldr, tiers and
outro.

## How it should sound

- A colleague explaining over coffee, not a narrator. Short sentences,
  everyday words, first person is fine ("I'd do it like this").
- Language: the `--lang` value, `en` if none. Write `say` lines natively in
  that language, don't translate word for word. Code, paths and identifiers
  stay as they are.
- Explain mechanisms, not labels. Not "this is risky" but "if the insert
  fails after the email went out, someone gets a welcome email for an
  account that doesn't exist".
- Length follows the risk: 60 seconds for a small PR, up to 3 minutes for a
  big one. About 15 characters per second, so 900 to 2700 characters of
  `say` in total. Every character costs voice credits.

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
visual elements have a `cue`: a phrase from that scene's `say`. The element
appears when the voice reaches that phrase. A cue must appear in `say` word
for word, with the same accents (ą, é, ...). Case doesn't matter.
`--check` enforces it. No cue means it appears when the voice starts.

| type | fields |
|---|---|
| `intro` | `title`, `subtitle`, `subtitleCue`, `eyebrow` |
| `tldr` | `eyebrow`, `rows: [{ label, value, cue, risk }]`. 2 to 4 rows. `risk: true` paints the value red |
| `arch` | `eyebrow`, `titleBefore`, `titleAfter`, `context`, `afterCue`, `before: [{ label, sub }]`, `after: [{ label, sub, kind, cue }]`, `boundaryLabel`, `boundaryCue`, `note`, `noteCue` |
| `tiers` | `eyebrow`, `files: [{ path, tier, cue, label }]` |
| `read` | `eyebrow`, `linesToRead`, `linesTotal`, `unit`, `byTier: [n0, n1, n2, n3]`, `cue` |
| `diff` | `tier`, `eyebrow`, `title`, `file`, `language`, `lines: [{ type, oldLine, newLine, content }]`, `tags: [{ text, cue }]` |
| `code` | `mode`, `tier`, `eyebrow`, `title`, `file`, `language`, `code`, `points: [{ text, line, cue }]`, `verdict: { text, cue }` |
| `fix` | `eyebrow`, `file`, `language`, `code`, `points: [{ text, cue }]` |
| `outro` | `eyebrow`, `verdict: { text, label, note, cue }`, `items: [{ text, cue }]`, `footer` |

Details:

- `arch`: a left-to-right flow of 2 to 6 boxes. `before` is the old flow,
  `after` the new one. Boxes keep their place by `label`, so reuse the same
  label for the same box. `kind: "new"` marks an added step, `kind:
  "external"` something outside the system (an API, a queue, another
  service); it gets an "outside" zone that appears on `boundaryCue`.
  `afterCue` is where the voice starts describing the new flow.
- `tiers`: one entry per changed file worth naming. `label` overrides the
  text shown next to the tier (default: file name).
- `read`: optional. If you use it, frame it as "this is the part that
  matters, let's go through it", not as homework.
- `diff`: `type` is `added`, `removed` or `context`. Show the 4 to 14 lines
  that matter, not the whole file. `language`: `typescript`, `tsx`, `json`,
  `bash`, `diff` or `text`.
- `code`: at most 12 lines per scene; split longer code into several scenes.
  `line` is a 1-based line in `code`, or a range `[from, to]`.
  - `"mode": "explain"`: a walkthrough. The highlight moves to the lines of
    the point being spoken, blue. Points are short captions of what those
    lines do ("reads every user into memory").
  - default mode: problems. Each point's lines turn red and stay red.
    `verdict.text` is `ok`, `check` or `blocks`, the same verdict as the
    report.
- `fix`: the code as you'd write it, streamed in while you explain. Only
  when you have a concrete fix. 4 to 12 lines.
- `outro`: `verdict.text` is `ok`, `check` or `blocks` and sets the color.
  `verdict.label` is the big word on screen in the video's language
  ("nie merguj jeszcze", "good to go"), `verdict.note` a short line next to
  it. `items` are the next steps, 1 to 4, each one an action.
- Keep every on-screen text short: rows, points and items under 50
  characters.

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
