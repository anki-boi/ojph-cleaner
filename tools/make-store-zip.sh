#!/bin/sh
# Builds the Chrome Web Store upload: dist/ojph-cleaner-<version>.zip
#
# The store build differs from the unpacked one in exactly one way: the resume-fit bridge
# (dashboard-fit.js, the onlinejobs.ph-suite on 127.0.0.1) ships OFF. A stranger has no suite
# on their machine, so the localhost host permissions would only add an install warning and a
# request nobody answers. Users who run the suite can still type its URL into settings.
set -e
cd "$(dirname "$0")/.."

sh tools/gate.sh

version=$(node -p "require('./manifest.json').version")
out="dist/ojph-cleaner-$version.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# Everything the manifest loads, and nothing else: no tests, tools, docs or spec.
files=$(node -e "
  const m = require('./manifest.json'), cs = m.content_scripts[0];
  const f = new Set(['manifest.json', m.options_page, ...cs.js, ...cs.css,
    ...m.web_accessible_resources.flatMap(r => r.resources), ...Object.values(m.icons)]);
  console.log([...f].join('\n'));")
for f in $files; do mkdir -p "$stage/$(dirname "$f")"; cp "$f" "$stage/$f"; done
# Pages the manifest names load their own scripts.
for page in jobs.html options.html; do
  for s in $(grep -o 'src="[^"]*\.js"' "$page" | sed 's/src="//;s/"//'); do cp "$s" "$stage/$s"; done
done

# Bridge off: drop the localhost hosts, blank the default URL. Each edit must hit exactly once.
node -e "
  const fs = require('fs'), p = '$stage/manifest.json', m = JSON.parse(fs.readFileSync(p));
  m.host_permissions = m.host_permissions.filter(h => !h.startsWith('http://127.0.0.1'));
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');"
for f in content.js options.js dashboard-fit.js; do
  n=$(grep -c "'http://127.0.0.1:8371'" "$stage/$f" || true)
  [ "$n" = 1 ] || { echo "store-zip: FAIL - expected one default URL in $f, found $n" >&2; exit 1; }
  sed -i.bak "s#'http://127.0.0.1:8371'#''#" "$stage/$f" && rm "$stage/$f.bak"
done
if grep -rn "127.0.0.1" "$stage"/*.json; then echo "store-zip: FAIL - localhost left in manifest" >&2; exit 1; fi

mkdir -p dist
rm -f "$out"
(cd "$stage" && zip -qrX - .) > "$out"
echo "store-zip: $out ($(unzip -l "$out" | tail -1 | awk '{print $2}') files)"
