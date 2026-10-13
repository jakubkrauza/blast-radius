# report format

Markdown, so it reads fine in a terminal and pastes into a PR comment as is.
Order is paint first, foundation last. The reader's attention should grow as
they scroll down.

Keep tier 0 and 1 to one line per unit. Spend the words on tiers 2 and 3.

## template

```markdown
## blast radius: <target> (<base>...<head>)

**read 74 of 812 changed lines (9%).** 11 change units, 1 one-way door, 3 slop flags.

    paint       ██████████████████████████  520
    furniture   ███████████                 218
    walls       ███                          52
    foundation  █                            22

<one or two sentences: what this PR does and the single biggest risk>

### 0 · paint (skim)
- button color and padding on submit, `app/inbound/page.tsx:41-58`
- form header copy, `app/inbound/copy.ts:3-9`

### 1 · furniture (skim)
- field validation order in the form, same rules, `app/inbound/form.tsx:70-112`

### 2 · load-bearing walls (read the diff)

#### `source` field goes from optional to required in the flow schema · check
- what and why: ...
- reach: 7 importers, incl. `app/api/inbound/route.ts:44`, 2 cron jobs
- reversibility: a revert fixes it
- scale: no change
- safety: old payloads without `source` now get a 400
- slop: none
- missing: ...
- **read:** `lib/flow/schema.ts:12-30`, `app/api/inbound/route.ts:44-52`

### 3 · foundation (read every line)

#### ... · blocks
(same fields)

### not checked
- things you couldn't verify and why (no tests, needs runtime data, external system)

<details><summary>foundation map and raw signals</summary>

- `src/lib/db.ts`: drizzle client, all DB access
- ...

(paste the signals.sh tables here)
</details>
```

## rules

- Bar chart: 26 blocks for the largest tier, scale the rest, at least one
  block for any non-zero tier. Numbers are changed lines (added + removed).
- "Lines to read" is the total size of all `read` ranges, counted once even if
  two units point at the same lines.
- Verdicts are only `ok`, `check`, `blocks`. Put the verdict at the end of
  the unit heading.
- Empty tier: keep the heading, write "nothing here".
- Every bullet under tiers 2 and 3 needs a `path:line` or the words
  "not checked".

## html (only with --html)

`assets/report.html` is a template. It renders a `DATA` object and does
nothing else. To fill it:

1. Read the template.
2. Replace the line `const DATA = null; // @@DATA@@` with
   `const DATA = { ... };` using the shape documented in the template.
3. Write the result to `/tmp/blast-radius/<target>.html` (`pr-123.html`,
   `branch-name.html`). Make the folder if needed.

Don't change anything else in the template. Strings go in as plain text, the
template escapes them. One exception: write `</` inside any string as `<\/`,
or a `</script>` in a code snippet ends the script early.
