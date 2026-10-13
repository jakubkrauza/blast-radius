<!-- real output (only the "html written to" line removed) of `/blast-radius --html` on a toy repo with planted bugs:
     a button color change, a User type made stricter, a new date-fns-tz dep that duplicates an
     existing helper, dedupe by loading all users, and a welcome email sent before the insert
     inside an empty catch. -->

## blast radius: feat/welcome (main...HEAD)

**read 12 of 17 changed lines (71%).** 5 change units, 2 one-way doors, 5 slop flags.

```
paint       ██████                      2
furniture                               0
walls       █████████████████           6
foundation  ██████████████████████████  9
```

Working tree is clean, so everything on `feat/welcome` is reviewed. The branch adds a welcome email and email dedupe to the signup path, tightens the `User` type, and adds `date-fns-tz`. The biggest risk: the welcome email is sent *before* the user row is written and its failure is swallowed, so a failed insert still mails a user who does not exist.

### 0 · paint (skim)
- sign-up button color blue to green, `src/components/button.tsx:1` — unrelated to the stated intent (scope creep)

### 1 · furniture (skim)
nothing here

### 2 · load-bearing walls (read the diff)

#### `User` goes from `name?` optional to `name` + `plan` required, call site still passes `any` · blocks
- what and why: `src/lib/users.ts:3` changes `name?: string` to `name: string` and adds `plan: string`. The commit message mentions only the welcome email and dedupe, so the tightening is undeclared.
- reach: 4 importers. The only real call site is `src/app/api/signup/route.ts:4`; `src/components/a.tsx:1`, `b.tsx:1` and `c.tsx:1` import `createUser` and never call it.
- reversibility: a revert fixes the code, but rows already written with a missing `plan` stay in the DB.
- scale: no change.
- safety: `src/app/api/signup/route.ts:3` does `const body = await req.json()` (type `any`) and passes it straight into `createUser`, so TypeScript checks nothing at the boundary. `zod` 3.23.0 is in `package.json:1` and imported nowhere.
- slop: no validation added for the two new required fields.
- missing: no schema or validation change anywhere in the diff; the repo has no tests at all.
- failure: `POST /api/signup` with `{"email":"a@b.com"}` compiles and runs — `db.users.insert` gets a row with `name` and `plan` undefined, and the email body gets `to: undefined` if `email` is absent.
- **read:** `src/lib/users.ts:3`, `src/app/api/signup/route.ts:3-4`

#### new `date-fns-tz` dependency plus a `formatDate` that duplicates an existing helper · check
- what and why: `package.json:1` adds `date-fns-tz` 3.1.3; `src/lib/users.ts:2` imports `formatInTimeZone` and `src/lib/users.ts:12` exports `formatDate` for the email body.
- reach: the manifest change affects every install. `formatDate` has exactly one caller, `src/lib/users.ts:8`, in the same file.
- reversibility: a revert fixes it.
- scale: no change.
- safety: package is real — npm `time.created` 2018-11-12, repo `github.com/marnusw/date-fns-tz`, version 3.1.3 exists, peer `date-fns ^3.0.0` satisfied by the installed 3.6.0. Not slopsquatting.
- slop: `src/lib/dates.ts:2` already has `formatDay(d) = format(d, "yyyy-MM-dd")` on the already-installed `date-fns`. The new helper differs only by forcing UTC, which `dates.ts` could do without a new package. `formatDate` is also exported with no external importer (dead export).
- missing: no lockfile in the repo, so the added dependency is not pinned.
- **read:** `package.json:1`, `src/lib/users.ts:2`, `src/lib/users.ts:12`

### 3 · foundation (read every line)

#### dedupe by loading every user and scanning in memory · blocks
- what and why: `src/lib/users.ts:5-6` calls `db.users.findMany()` with no filter, then loops to find a matching email and returns the existing row. Matches the commit's dedupe intent.
- reach: every POST through `src/app/api/signup/route.ts:4`, the only HTTP entry point in the repo.
- reversibility: a revert restores the code; duplicate rows already inserted stay.
- scale: unbounded read of the whole users table on every signup, then an O(n) scan in the request path. No filter, no pagination, no index use. Cost grows with every user ever created.
- safety: check-then-insert race. Two concurrent signups with the same email both see no match at `src/lib/users.ts:6` and both reach the insert at `src/lib/users.ts:10`. The diff adds no unique constraint on email, and the repo has no schema or migrations folder.
- slop: dedupe belongs in a filtered query or a unique index, not an in-process loop.
- missing: no unique index, no `where` filter, no test.
- failure: with 100k users, each signup loads 100k rows. Two simultaneous requests for the same email create two rows regardless.
- **read:** `src/lib/users.ts:4-6`, `src/lib/users.ts:10`

#### welcome email sent before the user row is written, failure swallowed · blocks
- what and why: `src/lib/users.ts:7-9` POSTs to `https://api.mailer.example/send`, then `src/lib/users.ts:10` inserts the user. Email first, write second.
- reach: every new signup through `src/app/api/signup/route.ts:4`.
- reversibility: no. The email has left the building. `git revert` does not unsend it, and there is no flag or kill switch around the call.
- scale: an outbound HTTP call now sits in the signup request path, after a full-table read. Signup latency is now mailer latency.
- safety: if `db.users.insert` at `src/lib/users.ts:10` throws, the welcome email was already sent to a user that does not exist. The request is also not idempotent — a client retry after a mailer timeout re-sends the email, because the dedupe row was never written.
- slop: `src/lib/users.ts:9` is `catch (e) {}` with an empty body — no log, no metric, no rethrow. A dead mailer is invisible, and the empty catch is what makes the ordering bug silent.
- missing: no retry, no queue, no idempotency key, no log line, no test.
- failure: the mailer times out, the catch eats it, signup returns `"ok"` at `src/app/api/signup/route.ts:5`, and nobody learns the welcome email never arrived.
- **read:** `src/lib/users.ts:7-9`

### not checked
- No tests exist anywhere in the repo, so no behavior here is verified by running it.
- `src/lib/db.ts:2` is an in-memory stub (`findMany` returns `[]`). Whether the real database has a unique index on `users.email` could not be checked — there is no schema or migrations folder.
- `api.mailer.example` is not a real endpoint, so the mailer's retry, idempotency and partial-failure behavior are unknown.
- No lockfile in the repo, so the actually installed `date-fns-tz` tree was not inspected (registry metadata only).
- `src/components/a.tsx`, `b.tsx` and `c.tsx` import `createUser` but never call it; whether that is intentional was not determined.

<details><summary>foundation map and raw signals</summary>

- `src/lib/db.ts:2`: the db client, stubbed; its own comment says every query goes through here
- `src/lib/users.ts`: the only user write path, and now the only outbound network call
- `src/app/api/signup/route.ts`: the only HTTP entry point, `POST /api/signup`
- `src/lib/dates.ts:2`: existing date helper on `date-fns` (`formatDay`)
- `src/components/{a,b,c,button}.tsx`: leaf UI, no logic
- `package.json`: dependency manifest, no lockfile committed
- absent: any auth or permission layer, any schema or migrations, any test

```
# signals
- range: `main...HEAD` (1 commits)
- size: 3 files, +13 -4 lines
- spread: 3 directories, top-level areas: (root) src

| file | status | +/- | floor | fan-in | churn | authors | test |
|---|---|---|---|---|---|---|---|
| `package.json` | M | +1 -1 | 2 | - | 1 | 1 | - |
| `src/components/button.tsx` | M | +1 -1 | - | 0 | 1 | 1 | - |
| `src/lib/users.ts` | M | +11 -2 | 2 | 4 | 1 | 1 | - |

## usually changes together, missing from this diff
none

## dependency manifest lines added
{"name":"demo","dependencies":{"date-fns":"3.6.0","date-fns-tz":"3.1.3","zod":"3.23.0"}}

## added lines that touch the outside world
- `src/lib/users.ts:8`     await fetch("https://api.mailer.example/send", ...)
- `src/lib/users.ts:9`   } catch (e) {}
- `src/lib/users.ts:10`   return db.users.insert(u);
```

Floors applied: `package.json` 2 (manifest + added dependency line), `src/lib/users.ts` 2 from path and fan-in 4, raised to 3 for the units containing the write-flagged line (`src/lib/users.ts:10`) and the network-flagged line (`src/lib/users.ts:8`). `src/lib/users.ts` is also foundation in the map above. No floor was overridden downward; no false-alarm floors found.

</details>
