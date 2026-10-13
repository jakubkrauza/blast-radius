#!/usr/bin/env bash
# signals.sh: hard numbers about a diff, pulled from git.
#
# the skill runs this before the model reads any code. the model can't
# argue with these numbers, it can only add to them. works in any repo
# and any language because it only uses git and grep.
#
# usage:
#   signals.sh [base] [head]
#
#   base  ref to compare against. default: merge-base of head and the
#         remote default branch (origin/main, origin/master, ...)
#   head  ref with the changes. default: HEAD
#
# output: markdown on stdout.
#
# needs bash 3.2+ (stock macOS is fine), git, awk, grep.

set -uo pipefail

# how many files get the per-file deep stats. big PRs get truncated.
MAX_FILES=80
# how far back to look for churn and co-change.
CHURN_DAYS=90
COCHANGE_COMMITS=20

head_ref="${2:-HEAD}"

# find the default branch, so we know what "main" is in this repo.
default_branch() {
  local ref
  ref=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) && { echo "$ref"; return; }
  for b in origin/main origin/master main master; do
    git rev-parse --verify --quiet "$b" >/dev/null && { echo "$b"; return; }
  done
}

if [ -n "${1:-}" ]; then
  base_ref="$1"
else
  main=$(default_branch)
  [ -z "$main" ] && { echo "signals.sh: can't find a default branch, pass a base ref" >&2; exit 1; }
  base_ref=$(git merge-base "$head_ref" "$main")
fi

# three dots: only what head added since it split from base.
range="$base_ref...$head_ref"

changed=$(git diff --name-only "$range")
if [ -z "$changed" ]; then
  echo "no changes between $base_ref and $head_ref"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "$changed" > "$tmp/changed"

# path patterns that set a minimum tier. case-insensitive.
# tier 3 = things a revert can't undo, or things that guard everything else.
T3='(^|/)(migrations?|migrate|alembic|flyway|liquibase)/|schema\.(prisma|sql|rb)$|\.sql$|(^|/|-|_)(auth|authn|authz|permissions?|rbac|acl|sessions?|security)(/|\.|_|-)|(^|/)(db|database|drizzle|prisma)(/|\.)|middleware\.|(^|/)\.github/workflows/|dockerfile|docker-compose|(^|/)(infra|terraform|k8s|helm|deploy|ops)/|\.tf$|vercel\.json$|netlify\.toml$|fly\.toml$|serverless\.|(^|/)(payments?|billing|stripe|checkout)(/|\.|_)|\.env'
# tier 2 = contracts other code leans on.
T2='package\.json$|pyproject\.toml$|requirements[^/]*\.txt$|go\.mod$|cargo\.toml$|gemfile$|composer\.json$|pom\.xml$|build\.gradle|(^|/)(api|routes?|handlers?|controllers?|graphql|rpc)/|\.proto$|openapi|swagger|(^|/)(types?|schemas?|models?|contracts?|interfaces?)(/|\.)|config\.|settings\.|(^|/)(lib|shared|common|core|utils?)/'
TESTS='(^|/)(tests?|__tests__|spec|e2e)/|\.(test|spec)\.|_test\.(go|py)$|test_[^/]*\.py$'

floor_for() {
  if echo "$1" | grep -Eiq "$T3"; then echo 3
  elif echo "$1" | grep -Eiq "$T2"; then echo 2
  else echo "-"
  fi
}

# rough fan-in: how many tracked files mention this module's path.
# takes the last two path parts without extension, so lib/attio/companies.ts
# looks for "attio/companies" or "attio.companies". index files use the folder.
fan_in() {
  local file="$1" noext parts pat
  noext="${file%.*}"
  case "$(basename "$noext")" in
    index|__init__|mod|main) noext=$(dirname "$noext") ;;
  esac
  # files in the repo root (configs, readme) give noise, skip them.
  case "$noext" in */*) ;; *) echo "-"; return ;; esac
  parts=$(echo "$noext" | awk -F/ '{ if (NF>=2) print $(NF-1)"/"$NF; else print $NF }')
  # escape regex chars, then let / match / or . (python, java style imports)
  pat=$(echo "$parts" | sed -e 's/[][\.*^$+?(){}|]/\\&/g' -e 's#/#[/.]#g')
  git grep -l -E "(^|[^A-Za-z0-9_])${pat}([^A-Za-z0-9_]|$)" "$head_ref" -- . 2>/dev/null \
    | sed "s#^[^:]*:##" | grep -vxF "$file" | wc -l | tr -d ' '
}

# files that usually change together with this one, but are not in the diff.
# "usually" = in at least half of the file's recent commits, and 3+ times.
missing_partners() {
  local file="$1"
  git log -n "$COCHANGE_COMMITS" --full-diff --name-only --format='tformat:@@' "$base_ref" -- "$file" 2>/dev/null \
    | awk -v self="$file" -v changed="$tmp/changed" '
        BEGIN { while ((getline l < changed) > 0) inpr[l]=1 }
        /^@@$/ { commits++; next }
        NF && $0 != self { seen[$0]++ }
        END {
          for (f in seen)
            if (seen[f] >= 3 && seen[f]*2 >= commits && !(f in inpr))
              printf "%s\t%d/%d\n", f, seen[f], commits
        }' \
    | while IFS="$(printf '\t')" read -r partner count; do
        # skip partners that were deleted since, they can't be "missing".
        git cat-file -e "$head_ref:$partner" 2>/dev/null && printf '%s (%s) ' "$partner" "$count"
      done
}

# ---- overview -------------------------------------------------------------

files_n=$(wc -l < "$tmp/changed" | tr -d ' ')
dirs_n=$(xargs -n1 dirname < "$tmp/changed" | sort -u | wc -l | tr -d ' ')
areas=$(awk -F/ '{ print (NF>1 ? $1 : "(root)") }' "$tmp/changed" | sort -u | tr '\n' ' ')
totals=$(git diff --numstat "$range" | awk '$1 != "-" { a+=$1; d+=$2 } END { printf "+%d -%d", a, d }')
commits_n=$(git rev-list --count "$base_ref..$head_ref")

echo "# signals"
echo
echo "- range: \`$range\` ($commits_n commits)"
echo "- size: $files_n files, $totals lines"
echo "- spread: $dirs_n directories, top-level areas: $areas"
if [ "$head_ref" = "HEAD" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "- warning: uncommitted changes exist and are NOT included"
fi
echo

# ---- per file ---------------------------------------------------------------

echo "## files"
echo
echo "floor = minimum tier from the path. fan-in is approximate (text search)."
echo "churn = commits touching the file in the last $CHURN_DAYS days, before this change."
echo
echo "| file | status | +/- | floor | fan-in | churn | authors | test |"
echo "|---|---|---|---|---|---|---|---|"

# numstat -z writes renames as "add<TAB>del<TAB>" then old and new path on
# their own lines. flatten that to "add<TAB>del<TAB>newpath".
git diff --numstat -z "$range" | tr '\0' '\n' | awk -F'\t' '
  NF == 3 && $3 == "" { a = $1; d = $2; getline; getline; print a"\t"d"\t"$0; next }
  { print }' > "$tmp/numstat"
git diff --name-status "$range" > "$tmp/status"

n=0
while IFS= read -r file; do
  n=$((n+1))
  st=$(awk -F'\t' -v f="$file" '$NF==f { print substr($1,1,1); exit }' "$tmp/status")
  # renamed files have their history under the old path.
  old=$(awk -F'\t' -v f="$file" '$NF==f && NF==3 { print $2; exit }' "$tmp/status")
  hist="${old:-$file}"
  pm=$(awk -F'\t' -v f="$file" '$3==f { print "+"$1" -"$2; exit }' "$tmp/numstat")
  floor=$(floor_for "$file")
  test="-"; echo "$file" | grep -Eiq "$TESTS" && test="yes"
  if [ "$n" -le "$MAX_FILES" ] && [ "$st" != "D" ]; then
    fi_n=$(fan_in "$file")
    churn=$(git log --since="$CHURN_DAYS.days" --format=%H "$base_ref" -- "$hist" 2>/dev/null | wc -l | tr -d ' ')
    authors=$(git log --since="$CHURN_DAYS.days" --format=%ae "$base_ref" -- "$hist" 2>/dev/null | sort -u | wc -l | tr -d ' ')
  else
    fi_n="-"; churn="-"; authors="-"
  fi
  echo "| \`$file\` | $st | $pm | $floor | $fi_n | $churn | $authors | $test |"
done < "$tmp/changed"

[ "$files_n" -gt "$MAX_FILES" ] && echo && echo "only the first $MAX_FILES files got fan-in and churn."
echo

# ---- co-change ------------------------------------------------------------

echo "## usually changes together, missing from this diff"
echo
found=0
n=0
while IFS= read -r file; do
  n=$((n+1)); [ "$n" -gt "$MAX_FILES" ] && break
  partners=$(missing_partners "$file")
  if [ -n "$partners" ]; then
    echo "- \`$file\`: $partners"
    found=1
  fi
done < "$tmp/changed"
[ "$found" -eq 0 ] && echo "none"
echo

# ---- dependencies ---------------------------------------------------------

echo "## dependency manifest lines added"
echo
deps=$(git diff "$range" -- '*package.json' '*pyproject.toml' '*requirements*.txt' '*go.mod' '*Cargo.toml' '*Gemfile' '*composer.json' 2>/dev/null \
  | grep -E '^\+[^+]' | sed 's/^+//')
if [ -n "$deps" ]; then
  echo '```'
  echo "$deps"
  echo '```'
else
  echo "none"
fi
echo

# ---- side effects in added lines -------------------------------------------

# not proof of anything. just lines worth a look: writes, deletes,
# network calls, raw sql, shell exec, secrets, swallowed errors, skipped tests.
echo "## added lines that touch the outside world"
echo
git diff -U0 "$range" | awk '
  /^\+\+\+ / { file=substr($0,7); next }
  /^@@/ { split($3,h,","); line=substr(h[1],2); next }
  /^\+/ {
    l=substr($0,2)
    if (l ~ /(\.(insert|update|upsert|delete|destroy|create|save|remove|drop|truncate)(Many|One|All)?\(|DELETE FROM|INSERT INTO|UPDATE [A-Za-z_]+ SET|ALTER TABLE|DROP (TABLE|COLUMN)|fetch\(|axios|requests\.(get|post|put|patch|delete)|http\.(Get|Post)|exec\(|spawn\(|subprocess|child_process|process\.env|os\.environ|getenv|secret|token|password|catch *\([^)]*\) *\{ *\}|except *:|except Exception|\.skip\(|xit\(|@pytest\.mark\.skip|eslint-disable|@ts-ignore|@ts-expect-error| as any|: any)/)
      printf "- `%s:%d` %s\n", file, line, substr(l,1,140)
    line++
  }' | head -n 120
echo
