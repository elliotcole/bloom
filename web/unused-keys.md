# Unused Key Bindings

Keys not currently bound in the Bloom web keyboard handler.
Scope: bare keys, shift keys, and option (alt) keys on a standard US keyboard.
Ctrl and Cmd keys are excluded (reserved for browser/OS shortcuts).

---

## Bare keys (no modifier)

**Letters**
- `o`

**Numbers**
- `5`  `6`  `7`  `8`

---

## Shift keys

**Letters**
- `L`  `O`  `Z`

**Symbol keys**
- `#` (shift+3)
- `$` (shift+4)
- `%` (shift+5)
- `^` (shift+6)
- `&` (shift+7)
- `*` (shift+8)

---

## Option (alt) keys

**Letters**
- `opt-a`  `opt-b`  `opt-c`  `opt-d`
- `opt-f`  `opt-g`  `opt-h`  `opt-i`
- `opt-j`  `opt-k`  `opt-l`  `opt-m`
- `opt-n`  `opt-o`  `opt-p`  `opt-q`
- `opt-r`  `opt-s`
- `opt-u`  `opt-v`
- `opt-x`  `opt-y`  `opt-z`

**Numbers**
- `opt-1`  `opt-2`  `opt-3`  `opt-4`
- `opt-5`  `opt-6`  `opt-7`  `opt-8`
- `opt-9`  `opt-0`

**Symbol keys**
- `` opt-` ``  `opt--`  `opt-=`
- `opt-[`  `opt-]`
- `opt-\`  *(bare backslash; opt-shift-\ = curdle is taken)*
- `opt-;`  `opt-'`
- `opt-.`

---

## Notes

- All 26 bare letters except `o` are bound.
- All bare symbol keys (`` ` - = [ ] \ ; ' , . / ``), tilde (`~`), and the number keys `1 2 3 4 9 0` are bound.
- `opt-,` (loop garden) and `opt-/` (pulse garden) and `opt-e` (editor) and `opt-t` (sort time) and `opt-w` (wheels) are taken.
- On macOS, option keys produce Unicode characters (e.g. opt+e = ´), but bindings use `e.code` so they work regardless.
