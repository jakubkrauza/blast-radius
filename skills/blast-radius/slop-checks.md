# slop checks

"Is this slop?" is a useless question to ask a model. These are specific
checks, each with a way to verify it. Report a flag only with a `path:line`
and the evidence (the grep result, the caller, the existing helper).

## 1. reinvented helper

The diff adds a function that already exists in the repo, under another name.
AI tools copy-paste instead of reusing: GitClear saw duplicated blocks go up
about 8x in 2024 while moved/refactored code dropped.

How to check: for each new function, grep the repo for 2 or 3 distinctive
words from its name and body. Look in `lib/`, `utils/`, `helpers/`, `shared/`.
Also check the dependencies: a new `formatDate` when `date-fns` is installed.

## 2. dead code

New exports nobody imports. New params nobody passes. New fields nobody reads.
Branches that can't run. This is the most common smell in LLM-written code in
the studies.

How to check: `git grep -n <name>` at head for each new export, param and
field. One hit (the definition) means dead.

## 3. swallowed errors

`catch {}`, `catch (e) { console.log(e) }` then carrying on, `except: pass`,
returning `null` or `200` on failure. The bug doesn't go away, it just stops
making noise.

How to check: read every new catch/except. Ask what the caller sees when it
fires. For a webhook or job: does the sender retry, or is the event lost?

## 4. defensive noise

Null checks for values that can't be null, try/catch around code that can't
throw, fallbacks for cases that can't happen. Each one is small. Together they
hide the real contract and make the reader wonder what they missed.

How to check: trace the value back one step. If the type or the line above
already guarantees it, flag it.

## 5. abstraction with one caller

A new class, factory, wrapper, registry, or generic helper used once. Fine
when it removes complexity from existing code, slop when it adds a layer.

How to check: count call sites of the new thing. Read whether the caller got
simpler or just longer.

## 6. weakened tests

Assertions removed or loosened, `.skip`, `xit`, `@pytest.mark.skip`,
snapshots regenerated wholesale, `expect(true)`, mocks that return exactly
what the test checks. The classic move when a model can't make a test pass.

How to check: diff the test files. Any removed `expect`/`assert` line needs a
reason in the PR.

## 7. type escapes

`any`, `as any`, `as unknown as X`, `@ts-ignore`, `@ts-expect-error`,
`# type: ignore`, `// eslint-disable`. Each one switches off a check someone
set up on purpose.

How to check: the signals list catches most. Ask whether the escape hides a
real type mismatch.

## 8. made-up or sketchy dependency

LLMs invent package names, and attackers register them ("slopsquatting"). In
one study open models hallucinated a package in about 1 of 5 samples.

How to check: for each new dependency run `npm view <name> time.created
repository.url` (or check PyPI, crates.io, pkg.go.dev). Flag if it doesn't
exist, was created recently, has no repo, or the name is one letter off a
popular package.

## 9. scope creep

Changes that have nothing to do with the stated intent: drive-by reformatting,
renamed files, "while I was here" refactors. They hide the real change and
widen the blast radius for no reason.

How to check: compare each unit with the PR title, body and commits.

## 10. comments that narrate

`// changed X to Y`, `// now uses the new helper`, `// fixed bug`, or
comments that repeat the line below. They describe the diff, not the code,
and rot the moment it's merged.

## 11. local rules

Whatever the repo's own `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` or
`PHILOSOPHY.md` asks for. Quote the rule and the line that breaks it.
