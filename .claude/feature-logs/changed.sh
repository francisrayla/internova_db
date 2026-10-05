#!/usr/bin/env bash
# Usage: bash .claude/feature-logs/changed.sh <slug> [<slug> ...]
# For each feature log, lists the Map files that changed since its last_commit
# (committed or uncommitted), so you know exactly what to re-read.
cd "$(git rev-parse --show-toplevel)" || exit 1
echo "HEAD: $(git rev-parse --short HEAD)"
for slug in "$@"; do
  log=".claude/feature-logs/$slug.md"
  [ -f "$log" ] || { echo "== $slug: no log yet (first run: explore, then create it)"; continue; }
  last=$(sed -n 's/^last_commit: *\([0-9a-f]*\).*/\1/p' "$log" | head -1)
  names=$(sed -n '/^## Map/,/^## How/p' "$log" | grep -oE '[A-Za-z0-9_.-]+\.(php|jsx|js|mjs|ts|tsx|sql|json)' | sort -u)
  changed=$( { git diff --name-only "$last"..HEAD; git status --porcelain | cut -c4-; } | sort -u |
    while read -r f; do grep -qxF "$(basename "$f")" <<<"$names" && echo "$f"; done)
  if [ -z "$changed" ]; then
    echo "== $slug: unchanged since $last, trust the log"
  else
    echo "== $slug: changed since $last (read these diffs only):"
    git diff --stat "$last"..HEAD -- $changed
    git status --short -- $changed
  fi
done
