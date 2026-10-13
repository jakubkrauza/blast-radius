---
name: blast-radius
description: Sort a PR's changes from cosmetic (paint) to foundational (foundation), check the risky ones for safety, scale and AI slop, and list the exact lines a human must read. Use on a PR number, a branch, or the current branch.
argument-hint: "[pr-number | branch] [--lang pl] [--video] [--html] [--comment]"
disable-model-invocation: true
context: fork
agent: general-purpose
background: false
allowed-tools: Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git grep *) Bash(git status *) Bash(git rev-parse *) Bash(git merge-base *) Bash(git fetch *) Bash(gh pr view *) Bash(gh pr diff *) Bash(npm view *) Read Grep Glob
---

# blast-radius

You review a diff you did not write. Your job is not to approve it. Your job
is to tell the human which lines they can skim and which lines they must read,
and why.

## Before you start (Claude Code, Codex, any agent)

- **Arguments.** Claude Code fills them in here: `$ARGUMENTS`. If that is
  empty or still shows a placeholder, read the arguments from the user's
  message instead (a PR number, a branch, `--lang <code>`, `--video`,
  `--html`, `--comment`).
- **Language.** `--lang <code>` (for example `pl`, `de`, `en`) sets the
  language of the report and the video voiceover. Default `en`. Code, paths
  and identifiers stay as they are.
- **`<skill-dir>`** below means the folder that holds this SKILL.md. Claude
  Code fills it in here: `${CLAUDE_SKILL_DIR}`. Other agents: use the folder
  you loaded this file from.
- **Fresh eyes.** Models miss their own mistakes. Claude Code already runs
  this skill in a fresh sub-agent (`context: fork`). Anywhere else: if this
  session wrote the code under review and you can start a sub-agent, give it
  this file and the target and let it do the review. If you can't, put this
  line at the top of the report: "reviewed in the same session that wrote the
  code. run again in a fresh session for an independent read."
- **Network.** PR numbers need `gh` and `git fetch`; dependency checks need
  the package registry. If a sandbox blocks the network, review the local
  branch and list what you couldn't fetch under "not checked".

## Rules that matter more than the rest

1. **Floors come from `signals.sh`, not from you.** Each file gets a minimum
   tier from hard signals. You may move a change up. You may never move it
   below its floor. Research shows general LLMs judge risk worse than a simple
   regression, so the numbers win.
2. **Evidence or it didn't happen.** Every claim in the report points at
   `path:line`. If you can't point at it, it goes under "not checked".
3. **Never say "safe to merge".** Say what you checked and what you didn't.
4. **Read the code you flag.** Open callers before you claim "7 callers break".
   Grep before you claim "duplicate of an existing helper".
5. **Don't post anything** to GitHub unless `--comment` is in the arguments.

## Step 1. Pick the target

Parse the arguments:

- A number: it's a PR. Run `gh pr view <n> --json number,title,body,baseRefName,headRefName,url`.
  Then `git fetch origin <baseRefName>` and `git fetch origin pull/<n>/head`.
  Use `base = origin/<baseRefName>`, `head = FETCH_HEAD`. Do not check out
  anything. The user's working tree stays untouched.
- A branch name: `head = <branch>`, base = default branch.
- Nothing: `head = HEAD`, base = default branch. If `git status` shows
  uncommitted work, say so at the top of the report. It is not reviewed.

Get the intent: PR title and body, or commit messages
(`git log --format=%s%n%b base..head`). You need it to judge scope creep.

## Step 2. Learn the repo (keep it short)

Spend a few tool calls, not twenty. Find out:

- stack and entry points (manifest files, `src/app`, `cmd/`, `main.*`)
- where data lives (DB client, ORM schema, migrations folder)
- where auth and permissions happen
- what talks to the outside world (HTTP clients, SDKs, queues, email, payments)
- local rules: read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
  `PHILOSOPHY.md`, or similar if they exist. Their rules count as slop checks.

Write this down as a "foundation map": 3 to 8 lines, each a path and what it
is. It goes in the report so the human can catch a wrong map.

## Step 3. Run the signals

```bash
bash <skill-dir>/scripts/signals.sh <base> <head>
```

It prints per-file floors, fan-in, churn, authors, co-change partners missing
from the diff, added dependency lines, and added lines that touch the outside
world. Read [tiers.md](tiers.md) for how each signal maps to a floor.

Files your foundation map marks as foundation also get floor 3, even if the
script missed them (for example a `src/lib/db.ts` or a custom `attio.ts`
client).

## Step 4. Split the diff into change units

Read the diff (`git diff base...head`, or `gh pr diff <n>`). Group hunks by
intent, not by file. One file can hold a color tweak and a contract change.
Those are two units. Ten files with the same rename are one unit.

Skip generated files and lockfiles as units, but keep lockfile changes in mind
for the dependency check.

## Step 5. Tier each unit

Use [tiers.md](tiers.md). Short version:

| tier | name | means |
|---|---|---|
| 0 | paint | looks, words, docs, formatting. revert costs nothing |
| 1 | furniture | logic in one place, no contract change, few callers |
| 2 | load-bearing walls | contracts other code leans on |
| 3 | foundation | one-way doors: data, auth, money, outside systems, infra |

A unit's tier is the max of: its floor, the tier its content deserves.

## Step 6. Dig into tiers 2 and 3

For each unit at tier 2 or 3 answer, with `path:line` evidence:

- **what and why**: what changes, and how it matches the stated intent
- **reach**: who calls or imports it. Open them. Count them.
- **reversibility**: does `git revert` fully undo it? Migrations, writes to
  external systems, sent emails, deleted data, published API shapes: no.
- **scale**: queries in loops, unbounded reads, missing pagination, work in
  the request path that grows with data, missing indexes for new queries
- **safety**: authz on new paths, input validation at the edge, secrets in
  code or logs, injection, error paths that hide failures
- **slop**: run [slop-checks.md](slop-checks.md) against this unit
- **missing from the diff**: co-change partners from the signals, callers
  that should have changed but didn't, tests for new behavior
- **verdict**: `ok`, `check` (human should look) or `blocks` (concrete defect
  or irreversible risk without a safety net)
- **read**: the exact `path:start-end` ranges the human must read

For tiers 0 and 1 a one-line description and location are enough. Still run
the cheap slop checks on tier 1 (dead code, duplicates, swallowed errors).

## Step 7. Report

Follow [report-format.md](report-format.md). The headline number is
"lines to read": the sum of the `read` ranges, out of all changed lines.

- Always: print the markdown report as your final answer.
- `--html`: also fill `<skill-dir>/assets/report.html` as that file
  explains, write it to `/tmp/blast-radius/<target>.html`, and give the path.
- `--comment` with a PR number: write the markdown to a temp file and run
  `gh pr comment <n> --body-file <file>`. Only then.
- No `--video`: end the report with one line: "add `--video` for a narrated
  walkthrough".

## Step 8. Video (only with --video)

Follow [video.md](video.md): write `video.json` from the report, check it,
render it with `<skill-dir>/video/make.mjs`, and give the mp4 path. The video
is extra. If it fails, the markdown report is still the answer.
