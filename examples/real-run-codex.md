<!-- real output of `$blast-radius --html` in codex cli 0.160, same toy repo as real-run-claude.md. unedited. -->

## blast radius: feat/welcome (`main...HEAD`)

**Read 16 of 17 changed lines, 94%.** 5 change units, 1 one-way door, 3 slop flags.

```text
paint       ██████                      2
furniture                               0
walls       █████████████████           6
foundation  ██████████████████████████  9
```

Dedupe never matches the current DB stub. Mail failures disappear behind a successful signup response. `src/lib/db.ts:2`, `src/lib/users.ts:5-10`, `src/app/api/signup/route.ts:5`.

Clean working tree. Reviewed `b954658...3b722d1`. Read count includes caller/DB context; overlapping ranges count once.

[HTML report](/tmp/blast-radius/feat-welcome.html) · [Markdown report](/tmp/blast-radius/feat-welcome.md)

### 0 · paint (skim)

- Button changes blue to green. Unrelated to stated mail/dedupe intent; scope flag. `src/components/button.tsx:1`.

### 1 · furniture (skim)

Nothing here.

### 2 · load-bearing walls (read the diff)

#### User now requires name and plan · check

- what and why: Makes `name` required and adds required `plan`; neither appears in stated intent. `src/lib/users.ts:3`.
- reach: Four `createUser` importers, one actual call. `src/app/api/signup/route.ts:4`; import-only files `src/components/a.tsx:1`, `src/components/b.tsx:1`, `src/components/c.tsx:1`. No demonstrated caller type break.
- reversibility: Revert restores the TypeScript shape. `src/lib/users.ts:3`.
- scale: Type-only change adds no runtime work. `src/lib/users.ts:3`.
- safety: Existing JSON boundary bypasses runtime validation, so required fields remain unenforced. `src/app/api/signup/route.ts:3-4`.
- slop: Scope flag for unexplained required fields. `src/lib/users.ts:3`.
- missing: Boundary validation remains absent. `src/app/api/signup/route.ts:3-4`. Intended payload contract and tests: not checked.
- **read:** `src/lib/users.ts:3`, `src/app/api/signup/route.ts:3-5`.

#### UTC date helper and date-fns-tz dependency · check

- what and why: Adds UTC day formatting to welcome mail. `package.json:1`, `src/lib/users.ts:2,8,12`.
- reach: One helper call. `src/lib/users.ts:8`.
- reversibility: Revert removes helper/dependency; sent dates remain. `package.json:1`, `src/lib/users.ts:8,12`.
- scale: Formats one date per new signup. `src/lib/users.ts:8,12`.
- safety: Registry confirms version `3.1.3`, creation in 2018, source repository, and peer compatibility with `date-fns@3.6.0`. `package.json:1`. Package security audit: not checked.
- slop: Existing formatter uses host-local dates; duplicate semantics are not established. New helper has a caller. `src/lib/dates.ts:1-2`, `src/lib/users.ts:8,12`.
- missing: Reason for UTC rather than existing convention: not checked. `src/lib/users.ts:12`, `src/lib/dates.ts:2`.
- **read:** `package.json:1`, `src/lib/users.ts:2`, `src/lib/users.ts:12`.

### 3 · foundation (read every line)

#### Read all users before inserting to dedupe · blocks

- what and why: Returns an existing email match before insertion, matching dedupe intent. `src/lib/users.ts:4-6,10`.
- reach: Signup POST calls it; three component files only import it. `src/app/api/signup/route.ts:4`, `src/components/a.tsx:1`, `src/components/b.tsx:1`, `src/components/c.tsx:1`.
- reversibility: Current adapter stores nothing. Real inserted rows would survive a code revert. `src/lib/db.ts:2`, `src/lib/users.ts:10`.
- scale: Stub returns zero rows. A real all-user read makes each signup O(users) in reads, memory, and comparisons. `src/lib/db.ts:2`, `src/lib/users.ts:5-6`.
- safety: **Dedupe cannot match:** `findMany()` always returns `[]`. Separate reads/inserts would also permit races with a real adapter unless atomic uniqueness exists. `src/lib/db.ts:2`, `src/lib/users.ts:5-6,10`.
- slop: Mock adapter defeats the new matching branch. `src/lib/db.ts:2`, `src/lib/users.ts:6`.
- missing: Persistent adapter and atomic email uniqueness are absent from the shown interface. `src/lib/db.ts:2`. Production constraints and integration tests: not checked.
- **read:** `src/lib/users.ts:4-6`, `src/lib/users.ts:10-11`, `src/lib/db.ts:2`.

#### Send welcome mail before insertion; hide failures · blocks

- what and why: Sends email/date before creating the user. `src/lib/users.ts:7-10`.
- reach: Signup forwards parsed JSON and returns `"ok"` afterward. `src/app/api/signup/route.ts:3-5`.
- reversibility: Revert cannot recall delivered mail. An insert failure after delivery cannot undo it. `src/lib/users.ts:8-10`.
- scale: Network wait runs inside signup with no explicit timeout. `src/lib/users.ts:8`, `src/app/api/signup/route.ts:4`.
- safety: Response status is unchecked. Rejected requests are swallowed; insertion and `"ok"` continue. New outbound work receives unvalidated input. `src/lib/users.ts:8-10`, `src/app/api/signup/route.ts:3-5`.
- slop: Empty catch hides delivery failure. `src/lib/users.ts:9`.
- missing: No durable retry, response check, or delivery error reaches this caller. `src/lib/users.ts:8-10`, `src/app/api/signup/route.ts:4-5`. Live endpoint/auth configuration and failure tests: not checked.
- **read:** `src/lib/users.ts:7-9`, `src/app/api/signup/route.ts:3-5`.

### not checked

- Build, runtime tests, and live mail delivery. `package.json:1` supplies no test/build scripts.
- Production persistence, indexes, volumes, and deployment safeguards. Reviewed DB is a stub. `src/lib/db.ts:2`.
- Useful historical co-change patterns; base history contains only the initial commit.

<details>
<summary>foundation map and raw signals</summary>

- `package.json:1`: npm manifest with date libraries and Zod.
- `src/app/api/signup/route.ts:2-5`: HTTP boundary; forwards JSON without validation.
- `src/lib/users.ts:3-12`: shared contract, signup helper, DB/mail side effects.
- `src/lib/db.ts:2`: foundation DB interface; unchanged empty-read/echo-write stub.
- `src/lib/dates.ts:1-2`: existing host-local date formatter.

Path floors remain tier 2 for package/users. DB-write and mail units rise to tier 3.

#### Signals

- Range: `main...HEAD`, 1 commit.
- Size: 3 files, +13 −4 lines.
- Spread: 3 directories; root and `src`.

| File | Status | +/− | Floor | Fan-in | Churn | Authors | Test |
|---|---|---|---|---|---|---|---|
| `package.json` | M | +1 −1 | 2 | — | 1 | 1 | — |
| `src/components/button.tsx` | M | +1 −1 | — | 0 | 1 | 1 | — |
| `src/lib/users.ts` | M | +11 −2 | 2 | 4 | 1 | 1 | — |

Missing co-change partners: none.

Dependency manifest line added:

```json
{"name":"demo","dependencies":{"date-fns":"3.6.0","date-fns-tz":"3.1.3","zod":"3.23.0"}}
```

Flagged added lines:

```text
src/lib/users.ts:8  await fetch("https://api.mailer.example/send", { method: "POST", body: JSON.stringify({ to: u.email, day: formatDate(new Date()) }) });
src/lib/users.ts:9  } catch (e) {}
src/lib/users.ts:10 return db.users.insert(u);
```

</details>
