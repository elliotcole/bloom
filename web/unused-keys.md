# Unused Key Bindings

Keys not bound at **home** in the Bloom web keyboard handler (October 2026
layout, see [GUIDE.md](GUIDE.md)). Inside the `t v c` list modes most letters
are taken by the shared verbs.
Scope: bare keys, shift keys, and option (alt) keys on a standard US keyboard.
Ctrl and Cmd keys are excluded (reserved for browser/OS shortcuts).

---

## Bare keys (no modifier)

- `q`  `y`  *(quantize and unify in the list modes)*

## Shift keys

- `L`  `Q`  `T`  `V`  `Z`
- `"`  `_`  *(`#` `$` are breeze)*

## Option (alt) keys

**Letters**
- `opt-a`  `opt-b`  `opt-c`  `opt-f`  `opt-g`  `opt-h`  `opt-i`
- `opt-j`  `opt-k`  `opt-l`  `opt-m`  `opt-n`  `opt-o`  `opt-p`
- `opt-q`  `opt-t`  `opt-v`  `opt-x`  `opt-y`  `opt-z`

**Numbers**
- `opt-0` (opt-1 … opt-9 choose the view)

**Symbol keys**
- `` opt-` ``  `opt--`  `opt-=`  `opt-[`  `opt-]`
- `opt-\`  *(opt-shift-\ = curdle is taken)*
- `opt-;`  `opt-'`  `opt-.`

---

## Taken option keys

- `opt-s` `opt-r` `opt-u` `opt-d` and their shifts: pitch-only patterns
- `opt-e` editor · `opt-w` wheels within wheels
- `opt-,` loop garden · `opt-/` pulse garden · `opt-shift-\` curdle

On macOS, option keys produce Unicode characters (e.g. opt+e = ´), but bindings
use `e.code` so they work regardless.
