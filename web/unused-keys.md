# Unused Key Bindings

Keys not bound at **home** in the Bloom web keyboard handler (October 2026
layout, checked against `src/ui/homeKeys.ts` November 2026; see [GUIDE.md](GUIDE.md)).
Inside the `p t v c 5 b` list modes most letters
are taken by the shared verbs.
Scope: bare keys, shift keys, and option (alt) keys on a standard US keyboard.
Ctrl and Cmd keys are excluded (reserved for browser/OS shortcuts).

---

## Bare keys (no modifier)

- `q`  `y`  `o`  *(`q` `y` `o` quantize, unify and sort in the list modes; `b` `B` are figures; `r` is select mode)*

## Shift keys

- `P`  `Q`  `V`  `O`  *(`T` is tuning mode; `L` is tilt up; `Z` trims, `"` repeats)*
- `_`  `%`  *(`#` `$` are breeze; `%` was semitones ↔ scale steps, now each interval names its own kind)*

## Option (alt) keys

**Letters**
- `opt-a`  `opt-b`  `opt-d`  `opt-g`  `opt-h`  `opt-i`  `opt-j`
- `opt-l`  `opt-m`  `opt-q`  `opt-r`  `opt-s`  `opt-u`  `opt-w`  `opt-y`
- `opt-f` at home *(in a list mode, with two voices, opt-f / opt-x take the list from the other voice)*

**Numbers**
- none (opt-1 … opt-9 and opt-0 choose the view)

**Symbol keys**
- `` opt-` ``  `opt--`  `opt-=`  `opt-[`  `opt-]`
- `opt-|`  *(curdle moved to a settings button)*
- `opt-;`  `opt-'`  `opt-.`

---

## Taken option keys

- `opt-e` editor · `opt-c` clean view · `opt-t` tuning hold · `opt-p` / `opt-P` push / pop
- `opt-n` name and colour · `opt-k` key centre · `opt-z` fit the lists to a length · `opt-x` copy into the other voice · `opt-tab` two voices
- `opt-0` orrery · `opt-o` road · `opt-v` weave (with opt-1 … opt-9, the views)
- `opt-↑` `opt-↓` `opt-del` garden slots
- `opt-,` loop garden · `opt-/` pulse garden
- `opt-\` lanes (`\` console, `|` labels: the display toggles share the key)

On macOS, option keys produce Unicode characters (e.g. opt+e = ´), but bindings
use `e.code` so they work regardless.
