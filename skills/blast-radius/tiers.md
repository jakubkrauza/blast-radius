# tiers

The question behind every tier is: **if this is wrong, what does it cost to
undo, and how many things break before someone notices?** Size of the diff
doesn't enter into it. A one-line change to a DB config can be tier 3. A
500-line copy rewrite is tier 0.

## tier 0: paint

Someone can glance at it. Reverting costs nothing and nobody downstream cares.

- CSS, colors, spacing, class names on leaf components
- copy, labels, translations, error message wording
- docs, comments, README
- formatting, import order, renames of local variables
- static assets (images, icons, fonts)

Not paint, even though it looks like it:

- a renamed CSS class or test id that other code or tests select on
- an error message string that callers parse or match on
- a translation key (not value) change
- a doc file that is also config (OpenAPI spec, `.md` read by a build step)

## tier 1: furniture

Logic, but contained. Moving it around doesn't touch the walls.

- a change inside one function or component whose signature stays the same
- fan-in of 0 to 4
- no new I/O, no new writes, no new network calls
- a refactor that keeps behavior (check this, don't trust the commit message)
- new tests, or test changes that add assertions

## tier 2: load-bearing walls

Other code leans on this. Breaking it breaks things far away, but a revert
still fixes it.

- changed exported function signatures, return shapes, thrown errors
- shared types, validation schemas (Zod, Pydantic, JSON Schema)
- API routes: new ones, changed request or response shape, status codes
- config and env vars: added, renamed, removed, new defaults
- new or upgraded dependencies
- files with fan-in of 5 or more
- hotspots: churn of 10+ commits in 90 days. People keep touching it, so
  bugs here have company
- code that runs for every request or every job (middleware-like paths)
- test changes that remove or weaken assertions, or skip tests

## tier 3: foundation

One-way doors. A revert doesn't undo the damage, or a bug here exposes or
corrupts everything else.

- DB schema, migrations, indexes, ORM model definitions
- new or changed writes, updates, upserts, deletes to the DB
- writes to external systems (CRM, payments, email, Slack, webhooks out),
  because the data has already left
- auth, sessions, permissions, tenancy checks, webhook signature checks
- money: pricing, billing, checkout
- secrets handling, CORS, CSP, rate limits
- infra and deploy: CI workflows, Dockerfiles, IaC, platform config
- deleting data or code paths that old data still depends on

## hard floors from signals.sh

These set the minimum. You can only go up.

| signal | floor |
|---|---|
| path matches the script's foundation pattern (migrations, schema, auth, db client, infra, CI, payments, `.env`) | 3 |
| path matches the contract pattern (manifests, api/routes, types, schemas, config, shared libs) | 2 |
| fan-in 5 or more | 2 |
| churn 10 or more | 2 |
| new line in a dependency manifest | 2 |
| added line flagged as a write/delete/upsert or SQL DDL | 3 |
| added line flagged as network call, exec, env or secret access | 2 |
| added line flagged as skipped test, `@ts-ignore`, `any`, empty catch | 2 |
| file in your foundation map from step 2 | 3 |

The flagged-line floors apply to the unit that contains the line, not the
whole file.

The path patterns are guesses based on common names. If the script floors a
file wrongly (say `src/auth-illustration.svg` got tier 3), keep the floor but
say in one line why it's a false alarm. Don't silently drop it.

## reversibility questions

Ask these for every tier 2 and 3 unit:

1. If I `git revert` this an hour after deploy, is everything back to how it
   was? Including data, external systems and users who already saw it?
2. Is there a flag, a kill switch, or a staged rollout?
3. For schema changes: is it expand then contract (add column, backfill,
   switch reads, then drop later) or a rename/drop in one step?
4. For external writes: is it idempotent? What happens on retry? On partial
   failure halfway through?
