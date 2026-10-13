## blast radius: PR #142 (main...feat/inbound-dedup)

**read 74 of 812 changed lines (9%).** 11 change units, 1 one-way door, 3 slop flags.

    paint       ██████████████████████████  520
    furniture   ███████████                 218
    walls       ███                          52
    foundation  █                            22

Dedups companies coming in through the inbound form by matching on email
domain. The biggest risk is the Attio upsert: free-mail domains merge
unrelated companies into one record, and a revert won't split them again.

### 0 · paint (skim)
- submit button color and padding, `app/inbound/page.tsx:41-58`
- form header copy, `app/inbound/copy.ts:3-9`
- file header comments in 4 files

### 1 · furniture (skim)
- field validation order in the form, same rules, `app/inbound/form.tsx:70-112`
- company mapper simplified, same output for the 3 sample payloads, `lib/inbound/map.ts:20-61`

### 2 · load-bearing walls (read the diff)

#### `source` goes from optional to required in the flow schema · check
- what and why: makes every flow carry where the lead came from (PR body, point 2)
- reach: 7 importers. `app/api/inbound/route.ts:44`, `app/api/cron/flows/route.ts:18`, `app/api/cron/retry/route.ts:31`, plus 4 UI files that only read it
- reversibility: a revert fixes it
- scale: no change
- safety: senders that don't send `source` now get a 400. the PQL sender doesn't send it (`lib/pql/send.ts:52`)
- slop: none
- missing: nothing
- **read:** `lib/flow/schema.ts:12-30`, `app/api/inbound/route.ts:44-52`

#### new dependency `date-fns-tz` · check
- what and why: format the submission time in the rep's timezone
- reach: 1 file, `lib/inbound/notify.ts:8`
- reversibility: a revert fixes it
- registry: exists on npm, first published 2018, has a repo
- slop: the repo already has `formatInTimeZone` in `lib/dates.ts:14`, which does the same thing. reinvented helper
- **read:** `lib/inbound/notify.ts:8-25`

### 3 · foundation (read every line)

#### Attio upsert matches companies on domain instead of record ID · blocks
- what and why: dedup companies from the inbound form (PR title)
- reach: every inbound submission, writes to the CRM
- reversibility: no. fields overwritten in Attio don't come back on revert, and merged companies stay merged
- scale: 1 request per submission, same as before
- safety: two people from `gmail.com` end up on one company record. `lib/attio/companies.ts:41` uses the raw email domain with no free-mail check
- slop: `catch` at `app/api/inbound/route.ts:77` logs and returns 200, so the sender never retries and failed submissions vanish
- missing: `lib/attio/people.ts` changed together with this file in 6 of the last 7 commits and isn't in this PR. people records still link by the old company ID
- **read:** `lib/attio/companies.ts:30-74`, `app/api/inbound/route.ts:60-81`

### not checked
- no tests cover the webhook, so behavior on real payloads is unverified
- couldn't check how many existing Attio companies share a free-mail domain

<details><summary>foundation map and raw signals</summary>

- `src/lib/db.ts`: drizzle client, all DB access goes through it
- `src/lib/schema.ts`: DB tables
- `lib/attio/*`: every write to the CRM
- `src/lib/webhook-auth.ts`: bearer secret check for inbound webhooks
- `app/api/cron/*`: scheduled jobs, run without a user

(signals.sh output goes here)
</details>
