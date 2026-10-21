#!/bin/sh
# Rebuild public/cheatsheet.pdf (US letter, two pages) from public/cheatsheet.html.
# Run after changing keys: npm run cheatsheet
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$PWD/public/cheatsheet.pdf" "file://$PWD/public/cheatsheet.html" 2>/dev/null
pages=$(python3 -c "import re,sys;print(len(re.findall(rb'/Type\\s*/Page[^s]',open(sys.argv[1],'rb').read())))" public/cheatsheet.pdf)
echo "public/cheatsheet.pdf: $pages page(s)"
[ "$pages" = 2 ] || { echo "expected 2 pages — something overflowed" >&2; exit 1; }
