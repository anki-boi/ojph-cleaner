#!/bin/sh
# One-command check gate: JS syntax, node tests, package integrity, repo hygiene,
# and a no-personal-paths check. Refused by the pre-push hook (.githooks).
# Wired once per clone: git config core.hooksPath .githooks
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then
  echo "gate: FAIL - node not found" >&2
  exit 1
fi

for f in $(git ls-files '*.js'); do node --check "$f"; done

# spec.md §4.2: no source file over 300 lines — the analogue of the suite's
# 250-line route-module cap. Split when one grows past it.
for f in $(git ls-files '*.js' '*.css' '*.html'); do
  n=$(wc -l < "$f")
  if [ "$n" -gt 300 ]; then
    echo "gate: FAIL - $f is $n lines (max 300)" >&2
    exit 1
  fi
done

npm test --silent

# Public repo: no source file may carry a personal machine path, or the
# extension breaks for anyone who clones it. Docs are exempt.
if git grep -nF -e 'C:\Users\' -e 'C:/Users/' -- '*.js' '*.json' '*.html' '*.css' ':!test-*.js'; then
  echo "gate: FAIL - personal machine path in tracked source" >&2
  exit 1
fi

echo "gate: PASS"
