# Unused Key Bindings

Keys not bound at **home** in the Bloom web keyboard handler (October 2026
layout, see [GUIDE.md](GUIDE.md)). Inside the `p t v c` list modes most letters
are taken by the shared verbs.
Scope: bare keys, shift keys, and option (alt) keys on a standard US keyboard.
Ctrl and Cmd keys are excluded (reserved for browser/OS shortcuts).

---

## Bare keys (no modifier)

- `b`  `q`  `y`  *(`q` `y` quantize and unify in the list modes)*

## Shift keys

- `B`  `P`  `Q`  `V`  `Z`  *(`T` / opt-`T` step through tunings; `L` is tilt up)*
- `"`  `_`  *(`#` `$` are breeze)*

## Option (alt) keys

**Letters**
- `opt-a`  `opt-b`  `opt-f`  `opt-g`  `opt-h`  `opt-i`
- `opt-j`  `opt-k`  `opt-l`  `opt-m`  `opt-n`  `opt-o`
- `opt-q`  `opt-v`  `opt-x`  `opt-y`  `opt-z`

**Numbers**
- `opt-0` (opt-1 … opt-9 choose the view)

**Symbol keys**
- `` opt-` ``  `opt--`  `opt-=`  `opt-[`  `opt-]`
- `opt-|`  *(curdle moved to a settings button)*
- `opt-;`  `opt-'`  `opt-.`

---

## Taken option keys

- `opt-s` `opt-r` `opt-u` `opt-d` and their shifts: pitch-only patterns
- `opt-e` editor · `opt-w` wheels within wheels · `opt-c` clean view · `opt-t` tuning view · `opt-p` / `opt-P` push / pop
- `opt-,` loop garden · `opt-/` pulse garden
- `opt-\` lanes (`\` console, `|` labels: the display toggles share the key)

On macOS, option keys produce Unicode characters (e.g. opt+e = ´), but bindings
use `e.code` so they work regardless.
