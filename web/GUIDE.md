# Bloom — a guide to the keyboard

`?` shows the keys on screen at any time, and there's a two-page
[printable cheat sheet](https://bloom.ecc.xyz/cheatsheet.pdf) (US letter). This page explains how the pieces fit
together. The keyboard was reorganised in October 2026. The version from before
that is still playable at [bloom.ecc.xyz/legacy](https://bloom.ecc.xyz/legacy/).

---

## The bloom

A bloom is a set of parallel lists:

| list | what it holds |
|---|---|
| **notes** | pitches; a sub-list is a chord |
| **time** | the time from each note to the next, in beats |
| **velocities** | 1–127; 0 is a rest |
| **channels** | which MIDI channel (instrument) plays each note |
| **intervals** | notes added at playback above or below each note; 0 adds nothing (intervals mode: `5`) |

The lists don't have to be the same length. Each one cycles at its own length,
so a 5-note bloom with 4 velocities drifts in and out of phase as it loops.
That holds in the loop (`,`) and the pulsar (`/`); a single play (space)
always starts every list at its beginning.

## Four levels of control

You can work at four levels. In the order you'll probably use them:

1. **Gestures**: one key nudges the whole bloom: pitch, rhythm, dynamics and channels together.
2. **Whole notes**: reorder or repeat notes. Each note keeps its own rhythm, dynamic and instrument.
3. **Pitch**: most home keys change only the pitches.
4. **One list**: `p`, `t`, `v` or `c` enters a mode where the keys act on pitch, time, velocity or channels alone.

Levels 1–3 live at **home**. Level 4 is a **list mode**. Pitch has both: the common pitch moves are bare keys at home, and `p` gives the full set of list verbs for pitch.

---

## Gestures (home)

| key | gesture | what it does in one press |
|---|---|---|
| `-` | **calm** | merges a note into its neighbour, softens and flattens the accents, pulls the outermost pitches a scale step inward, maybe moves a stray channel to the most-used one |
| `=` | **intensify** | splits a note in two, louder with sharper accents, pushes the outermost pitches a scale step outward, brings back one rest, maybe moves one channel |
| `'` | **vary** | about 1 in 5 pitches move a scale step, sometimes a merge is traded for a split elsewhere, small velocity changes, a few channel swaps within the ones in use |
| `{` | **merge** | one note absorbs the next one's time |
| `}` | **split** | one note becomes two repeats of half its length |

Each press is small; press again to go further, and **cmd-Z** to step back. The step sizes are in `GESTURE` near the top of
`src/core/Bloom.ts`.

**Rhythm only changes by splitting and merging**, so the total duration stays
the same and durations stay among halves and doubles of what's already there.
Merges prefer pairs that add up to a duration you already use (½ + ½ → 1); splits
prefer notes whose half you already use.

## Whole notes (home)

These move each note together with its time, velocity, channel and interval.

| key | | key | |
|---|---|---|---|
| `s` | scramble | `S` | perfect shuffle |
| `R` | mirror | `9` `0` | rotate ← → |
| `u` | stutter | `U` | sputter |
| `d` | braid | `D` | pyramid |
| `r` | ratchet | `Y` | spray |
| `h` | thin | `H` | thicken |
| `g` | gap (rests) | `G` | unGap |
| `z` | drop last | `a` / `A` | add one (in scale / any) |

If the lists were phasing, a whole-note move first lines them all up to the
number of notes. It keeps what one play-through sounds like, but the drift stops.

**Breeze**: `#` `$` move only some notes a scale step, not the whole bloom in
lockstep. The **share** is the average fraction moved per press (30%, always at
least one). The notes are scattered, and chord tones move independently.

On repeated presses the breeze leans toward notes it moved recently, so it
tends to carry a few voices somewhere. Any note can still be picked. A note
moved on the last press is about 2.5× as likely to move again (roughly 54%
versus 20% for the others), and the lean fades over a few presses. Any
other edit to the pitches starts the breeze fresh.

The settings are in `GESTURE` (`breeze`, `breezePull`, `breezeMemory`). In the
list modes, `#` `$` do the same with a palette step, with the same memory.

**Pitches only**: hold **opt** with `s S R u U d D` to move only the pitches.
Rhythm, dynamics and channels stay where they are. To rotate the pitches
alone, use pitch mode: `p` then `9` `0` (opt + digits already change the view).

## Pitch (home)

| key | | key | |
|---|---|---|---|
| `m` | mutate (scale steps) | `M` | mutate (chromatic) |
| `1` `2` | ∓ semitone | `!` `@` | ∓ octave |
| `3` `4` | ∓ scale step | `#` `$` | **breeze**: some notes ∓ a scale step |
| `e` / `E` | shear (a third of the notes an octave outward, same pitch class) / centre range |
| `b` / `B` | tilt down / up (each press a scale step steeper) | | | `[` / `]` | step flatward / sharpward |
| `i` / `I` | invert / around the mean | `o` / `O` | sort up / down |
| `(` / `)` | pivot (highest / loudest) | `w` / `W` | draw curves / remove doubles |
| `;` / `:` | clump / flatten chords | `k K j J` | scales: choose, slant, lift, reduce |

## Other home keys

- **Saving into the garden:** `↓` saves the bloom into the selected slot, replacing what was there; opt-`↓` inserts it before that slot instead.
- **Blending with the selected garden slot:** `x` interlace, `X` blend, `f` lift shape, `C` cast.
- **Intervals:** `5` enters intervals mode; at home `6` `^` widen / narrow, `7` `&` add / drop a step, `8` reset, `%` semitones ↔ scale steps, `*` bake into notes.
- **Merge and split the garden:** `|` and opt-`|`.
- **New:** `n` a new bloom in the same scale, `N` a new bloom on any of the twelve pitches (`t n` and `v n` give new times or dynamics for the same pitches). Lowercase stays in the key; shift opens up to all twelve, wherever that applies. For new pitches on the same rhythm, use pitch mode: `p n` (in scale) or `p N` (any).
- **Undo:** cmd-Z steps back one change, cmd-shift-Z forward again. Every
  change is remembered (the last 300).
- **Save points:** opt-`p` pushes the bloom onto a stack, opt-shift-`p` pops
  back to it.

---

## List modes: `p` `t` `v` `c` `5`

`p` pitch · `t` time · `v` velocity · `c` channels · `5` intervals. The badge in the header shows the mode.
The mode's own key or `esc` takes you home, and pressing another mode key
switches straight across. Playback, garden, undo, `F` and every opt key work
as usual. Any
key with no meaning in the mode does nothing and shows a hint, so home-mode
habits can't change the pitches by accident.

**One key means the same thing in all three modes.**

### Order and length
These only move values around, so they mean exactly the same in every list.

| key | verb |
|---|---|
| `s` / `S` | scramble / shuffle |
| `R` | mirror |
| `9` `0` | rotate ← → |
| `u` / `U` | stutter / sputter |
| `d` / `D` | braid / pyramid |
| `o` / `O` | sort up / down (for velocity: crescendo / decrescendo) |
| `z` / `a` / `A` | drop last / add one from the palette / add one at random |

Changing one list's length makes it phase against the notes. That's often the
point: stutter only the velocities and the accent pattern drifts.

### Values

| key | verb | time | velocity | channels |
|---|---|---|---|---|
| `1` `2` | down / up | faster / slower (×1.2) | softer / louder | shift ∓1 |
| `!` `@` | big down / up | double / half time | much softer / louder | — |
| `3` `4` | one palette step | next shorter / longer duration you use | next level you use | next channel in use |
| `#` `$` | breeze | as `3` `4`, for some notes only | | |
| `-` `=` | converge / diverge | evener / more uneven | flatter / wider dynamics | toward / away from the most-used channel |
| `y` | unify | all the commonest duration | all the average level | all the most-used channel |
| `i` / `I` | invert / around the middle | longest ↔ shortest | loud ↔ quiet | across the range / around the most-used |
| `b` / `B` | tilt down / up, a step steeper each press | accelerando / ritardando | decrescendo / crescendo | drift down / up |
| `w` | curve | rubato contour | hairpins | smooth path through channels |

**In pitch mode the palette is the scale.** `3 4` move a scale step, `1 2` a
semitone, `! @` an octave. `- =` narrow or widen the range a scale step,
`y` puts every note on the commonest pitch, `i` mirrors high and low, `b` `B`
tilt the line down or up (each press a step steeper, the first note staying put), `e` sends some notes an octave outward, `w` draws a contour. `a` adds a note in the scale, `A`
any note, as at home. `h H` take away or add one
**pitch class**: `h` removes the least-used class (its notes move to the
nearest class still in use); `H` brings in an unused note of the scale or,
once the scale is all used, the chromatic note that makes a named scale. The
scale follows along, and the notice shows the count and the scale's name,
e.g. "pitch classes 6 → 5 · scale A Minor Pentatonic". `q` snaps to the
scale. Chords keep their shape. `(` `)` pivot (invert, keeping the highest
or the loudest note where it is). Every pitch key from home works in pitch
mode and means the same thing there, including `k K j J`, `E`, `[ ]` and the
interval keys `6`–`8` `%` `*`.

To travel further, `]` steps **sharpward** and `[` **flatward** round the
circle of fifths: one pitch class of the scale moves a semitone and the notes
on it move with it, so C major becomes G major (F → F#), then D major, and so
on. It works on any scale type, preferring a move that keeps the scale's
shape, then one that makes a named scale. Keep pressing to modulate steadily;
the notice names each step ("sharpward: F → F# · scale G Major"). Slant
(`K`, at home) now looks on every root and avoids the last few scales it
visited, so repeated slants wander outward instead of circling.

**Intervals mode (`5`) treats the intervals as a list like the others.** Each
step adds notes above (+) or below (−) its note; a step of 0 adds nothing
and, like a rest, is left alone. The palette is the steps in use. `1 2`
move every interval a semitone (or scale step), `3 4` narrow / widen each one
to the next size in use, `- =` narrow / widen (a stack's spacing opens too),
`! @` an octave (so +7 becomes −5: the same note on the other side), `i`
flips above ↔ below, `I` swaps wide ↔ close, `y` makes every step the
commonest, `h H` one kind of step fewer / more, `n` new intervals, `a A`
add a step (one in use / a fresh one). The order keys work as on any list,
and `6 ^ 7 & 8 * %` mean what they mean at home. `F 5` freezes the steps in
use. The intervals list cycles at its own length, so it phases against the
notes in the loop and the pulsar.

### Vocabulary ("palette")
A list's **palette** is the set of distinct values it uses: the bloom's
own rhythmic vocabulary, dynamic levels, instruments.

| key | verb |
|---|---|
| `m` / `M` | mutate gently (from the palette) / wildly |
| `h` / `H` | fewer / more distinct values |
| `q` / `Q` | quantize / choose the setting: the grid for time, the most levels for velocity and channels |
| `n` | new random list (for time: drawn from the palette; for pitch: in the scale) |
| `N` | pitch mode only: new pitches on any of the twelve (elsewhere the same as `n`) |
| `x` / `f` | lace with / copy from the selected garden slot |

**Time verbs stay in your vocabulary wherever they can.** `3 4 - = y i e w`
move along the durations you already use, and past either end they halve or
double. A groove made of 1, ½ and ¼ stays made of halves and doubles. `1 2`
(×1.2) and `I` are the continuous exceptions.

---

## Freezing: `F`

A freeze locks part of the bloom so transformations can't take it outside a
set of values. Press **`F`**, then:

| key | freezes | locked to |
|---|---|---|
| `p` | pitch | the current scale |
| `t` (or `r`) | rhythm | the durations in use right now |
| `v` | dynamics | the velocity levels in use right now |
| `c` | channels | the channels in use right now |
| `5` | intervals | the interval steps in use right now (steps of 0 stay 0) |
| `d` | duration | the total length (amount set in ⚙ settings). Each press cycles: **trim** to the duration (notes past it are cut) → **stretch** to the duration (all times scaled to fit) → off |
| `g` | grid | a time grid (size set in ⚙ settings) |

The menu is sticky, like the list modes: each key toggles one freeze (`d` cycles through three states) and the menu stays open, so you can set several or step `d` round. `F` or `esc` closes it. Playback, garden and view keys work while it's open. The header shows
what's frozen, e.g. `❄ p t d:trim`; while the menu is open it reads `F ❄ …`. The same switches are in ⚙ settings under
**freeze** and **palette**, and the two always agree.

- **Palette freezes capture the palette when you switch them on.** To take a
  new snapshot, unfreeze and freeze again.
- **Anything outside the palette snaps to the nearest value in it.** Durations
  snap by ratio, so 3/8 goes to whichever of ¼ or ½ is proportionally closer.
- **When freezes apply:** on every play (space), and while a loop (`,`) or the
  pulsar (`/`) is running, after every change. The loop never plays an
  unfrozen bloom.
- **A frozen rhythm follows tempo moves.** `t 1` / `t 2` / `t !` / `t @` scale
  the frozen durations too, so speeding up isn't snapped back.
- **Freezing rewrites the bloom.** Snapped values stay snapped after you
  unfreeze.
- **Freezes belong to the working bloom.** They stay on when you lift a garden
  slot (that bloom gets snapped). They aren't saved in `.bloom` files and don't
  apply to the garden loop and pulse (opt-`,`, opt-`/`).

### Pinning events: click a node

Click a node to **pin** its event; click again to unpin. A pinned event keeps
its pitch, time, velocity, channel and interval whatever you press next, and a
dashed ring marks it. The header shows how many, e.g. `❄ e2`; `F e` unpins them
all. Works in every view except tonal and set, which draw pitch classes rather
than events.

- **Reorderings flow around pins.** Sorting, inverting or rotating rearranges
  the other events in the spaces between the pinned ones.
- **Pins are by position.** Event 3 stays event 3. If a list is shorter than
  the notes, a pin holds the slot that event wraps to, and every event sharing
  that slot with it.
- **A new bloom keeps the pinned events** (`n`, `N`): regenerate everything
  around a note you like. Lifting a garden slot or loading a file clears pins.
- **Undo and hand edits aren't blocked** by pins.

---

## Seeing it

- **Lanes: `L`.** A strip under the view showing the five lists (pitch, time,
  velocity, channels, intervals), each at its own length (×n). The time lane is drawn to
  scale. While playing, each lane has its own cursor, which cycles at that
  list's length, so you can watch lists of different lengths drift against
  each other. The lane for the
  current list mode is lit amber, a frozen list shows ❄, recently breezed
  values glow, and whatever the last key changed is boxed for a moment. The
  setting is remembered.
- **Clean view: opt-`c`.** Only the picture: no header, garden, console, lanes
  or cursor. Made for recording video. Keys still work. `esc` or opt-`c`
  leaves. For a whole-screen picture, also make the browser full screen
  (ctrl-cmd-F).
- **Views:** opt-`1`…`9`. Note labels: `l`. Console: `\`.

## Command palette: cmd-K

Type command names joined with dots, e.g. `calm.calm.varyT`. Every operation
above has a name:

- **gestures:** `calm`, `intensify`, `vary`, `split`, `merge`
- **breeze:** `breeze+` / `breeze-` (scale step), `breezeup1` / `breezedown1`
  (semitone), `breezeup12` / `breezedown12` (octave); `breezeUpT`, `breezeDownV`, …
- **whole notes:** `scramble`, `shuffle`, `mirror`, `rotate`, `stutter`, …
- **one list:** verb + list letter (**P** pitches, **T** time, **V**
  velocities, **C** channels), e.g. `scrambleP`, `stutterV`, `invertT`,
  `curveV`, `unifyC`, `stepUpT`, `fewerV`

## Notices

After each key, a small notice at the top left of the view says what you did
and what changed: "slant scale · scale Hungarian Minor", "[t] stutter ·
times 3 → 6", "3 of 8 pitches moved · range C3–G5". It fades after five
seconds and stays out of the way while the console (`\`) is open, since
the console says the same, and in clean view.

**Demo keys** (⚙ settings → display) adds the key you pressed, large, above
the notice and centres it: for screen recordings.

## Saving

- **Save the garden:** cmd-S, or **save** at the top right. Writes a `.bloom` file.
- **Load a garden:** cmd-O, or **load** at the top right.
- **Autosave:** the working state is saved in the browser after every change.
  When you come back, Bloom asks whether to **restore** it (↵) or **start
  new** (n).
