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
| `r` | ratchet: a long note repeats 2 or 3 times in its own time | `Y` | spray |
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
| `l` / `L` | tilt down / up (each press a scale step steeper) | | | `[` / `]` | step flatward / sharpward |
| `i` / `I` | invert / around the mean | `o` / `O` | sort up / down |
| `(` / `)` | pivot (highest / loudest) | `w` / `W` | draw curves / remove doubles |
| `;` / `:` | clump / flatten chords | `k K j J` | scales: choose, slant, lift, reduce |

## Other home keys

- **Saving into the garden:** `↓` saves the bloom into the selected slot, replacing what was there; opt-`↓` inserts it before that slot instead.
- **Blending with the selected garden slot:** `x` interlace, `X` blend, `f` lift shape, `C` cast.
- **Intervals:** `5` enters intervals mode; at home `6` `^` widen / narrow, `7` `&` add / drop a step, `8` reset, `%` semitones ↔ scale steps, `*` bake into notes (with a raga attached, it also writes the notes as they sound).
- **Merge and split the garden:** buttons in ⚙ settings → garden. **merge** joins every slot into the bloom; **curdle** splits the bloom into pieces inserted after the current slot.
- **New:** `n` a new bloom in the same scale, `N` a new bloom on any of the twelve pitches (`t n` and `v n` give new times or dynamics for the same pitches). Lowercase stays in the key; shift opens up to all twelve, wherever that applies. For new pitches on the same rhythm, use pitch mode: `p n` (in scale) or `p N` (any).
- **Undo:** cmd-Z steps back one change, cmd-shift-Z forward again. Every
  change is remembered (the last 300).
- **Save points:** opt-`p` pushes the bloom onto a stack, opt-shift-`p` pops
  back to it.

## Tunings: `T` (tuning mode), opt-`t` (hold)

Load Scala (`.scl`) files in ⚙ settings → **tuning**: pick several at once.
Scales of twelve notes to the period are taken; others are listed as skipped,
with the reason. The library stays in this browser.

- **Each bloom has its own tuning.** In tuning mode (`T`), `]` steps to the
  next loaded tuning and `[` to the one before; 12-TET comes first. The
  settings menu picks one too. A bloom keeps its tuning in the garden and in
  saved files, and the garden loop retunes as each bloom comes round. `n` keeps
  the tuning, as it keeps the scale; `N` starts from 12-TET.
- **Hold: opt-`t`** (anywhere). The tuning that's sounding then plays over
  every bloom: moving through the garden, the loop, loading and undo all keep
  it, so you can try tunings against one bloom after another without each
  resetting it. While held, `]` / `[`, the settings menu and the tuning view
  change the held tuning, not the blooms; new blooms (`n`, `N`) take it as
  their own. The blooms keep their own tunings, and opt-`t` again gives them
  back. The header shows `◊ held: ji-5 @ D`. In the tuning view, **held root**
  chooses whether its root follows each bloom's key or stays where it is, and
  **keep in this bloom** makes it this bloom's own. A hold never outlasts the
  session.
- **The root follows the key.** A bloom has a key only when a scale is
  attached (`k` and the other scale keys attach one); degree 0 of the file
  then sits on that key, as a key signature names it: the major scale holding
  all the scale's notes, or all but one. C major, A minor and C pentatonic all
  put it on C, A harmonic minor too, F harmonic minor on A♭, and `]` (one more
  sharp) moves it to G. A bloom with no scale attached is twelve-note
  chromatic, and puts the root on C; so does a scale no key signature fits
  (whole tone, diminished). A raga's key is its Sa. The root keeps its 12-TET
  pitch; the other notes are tuned from it.
- **The scale badge** in the header shows the attached scale and its key,
  `♮ Aeolian · key E♭`, `♮ Yaman · Sa G`, or `no key`; it's hidden while none
  is attached. Click it for the scale picker.
- **The scale picker** (⚙ settings → **choose scale…**, or a click on the
  scale badge) lists every scale and raga by name, grouped by size, ragas
  first, each with its notes on the root you choose (the bloom's key to start
  with). Type to filter, ↑↓ to move, ↵ or a click attaches it, esc closes. The
  scale keys (`k K j J`) choose by ear; the picker is for when you know which.
- **What you see:** the header shows `◊ ji-5 @ D` (`*` once edited), and the
  console's `tuning:` line gives each pitch class's distance from 12-TET in
  cents.
- **Tuning mode: `T`** opens the tuning view (or click the ◊ badge, or ⚙
  settings → tuning → **edit tuning**); the header shows TUNING. The main area shows the tuning as a pie, C at the top as
  in the set view. Each note's slice reaches halfway to its neighbours, so its
  width shows how much room the tuning gives it; the dot on the rim is the
  note's true place, 12-TET's places are faint ticks outside, the root is
  ringed, and each slice shows its ratio inside and its cents from 12-TET
  outside. Slices light up as their notes play. The controls sit either
  side: the selected note on the left, the whole tuning on the right.
  In tuning mode `]` `[` step through the tunings (a new base: the
  alterations stay), the alteration keys below work, and playback, garden,
  display and view keys work as at home; other keys only show a hint. `p` `t`
  `v` `c` `5` switch straight to that list mode, as between list modes (and
  `T` from a list mode switches here). `T` or `esc` leaves, as does choosing
  another view.
  - **Alterations.** A tuning is a base (12-TET, a .scl, a pasted scale)
    and twelve alterations, one list item per note from the root: how many
    of each comma the note is raised or lowered by. The commas are HEJI's
    up to the 11-limit, and the Pythagorean comma: `s` syntonic (81/80), `z`
    septimal (64/63), `u` undecimal quartertone (33/32), `p` Pythagorean
    (531441/524288). Moves by the same comma cancel; different ones stay side
    by side (`+p−s`), so you can watch the drift. The pie writes each note's
    name with its HEJI accidental (arrows for syntonic commas, the septimal
    and undecimal signs; HEJI has no sign for the Pythagorean comma, so it's
    `+p`); the left panel and the console's `alter:` line list them.
  - **The alterations palette** at the top chooses the comma. Then, on the
    selected slices or (none selected) every note:

    | key | does |
    |---|---|
    | `9` `0` | rotate the alterations a semitone down / up (as `9` `0` rotate every list) |
    | `3` `4` | each note a comma down / up |
    | `#` `$` | breeze: a few notes a comma down / up |
    | `2` | clear: back to the base |
    | `1` | switch all the alterations off (the base sounds; they're kept) and on again; any change to them switches them on |

    `esc` first lets go of the selected slices, then leaves tuning mode.
  - **Click a slice** to select and hear its note: its exact ratio when it
    has one (from the file, kept exact through every alteration), cents, and
    its alterations. **− / +** move it by the palette's comma. **set** puts
    it at a ratio (`7/4`) or cents (`968.8`): a new base for that note,
    unaltered.
  - **Shift-click a second slice** to see the interval between them, and set
    it to a ratio or cents (the second note moves, unaltered). **= Eb +s**
    makes the second note the first raised by the palette's comma: click Eb,
    shift-click E, and E becomes Eb's pitch with its alterations, plus one
    syntonic comma.
  - **switch off / clear** in the left panel do what `1` and `2` do.
  - **Root:** follows the key, or one chosen by hand.
  - **Paste a scale:** 11 ratios or cents (1/1 implied), 12, 12 and the
    period, or a whole .scl file. It becomes the base, unaltered.
  - Edits change this bloom's own copy, saved with it; cmd-Z undoes them.
    **save to library** keeps it, alterations and all, under a name for `]` / `[`; **export .scl**
    downloads it; **revert** goes back to the library's copy.
- **What you hear:** the Built-in Piano plays in the tuning. For synths in
  Ableton (or any host), run the **bloom-mts** helper (macOS; ⚙ settings →
  tuning → **copy helper command** copies a Terminal line that downloads and
  starts it; source in `mts-helper/`): it is an MTS-ESP master that takes its tuning from Bloom, so
  every MTS-ESP client plugin follows it. The browser asks once for permission
  to send it SysEx; the settings menu says whether the helper is connected.
- **Recording the tunings with a take:** DAWs don't record SysEx, so the
  helper also plays each tuning Bloom sends out of a second port, **Bloom
  Tuning Cues**, as a short chord of notes that holds the whole tuning. It
  sends one at every change, and again every 30 seconds while the same tuning
  plays on, so a recording that starts late still learns what it's in.
  - **To record:** in Ableton, turn on Track for the Bloom Tuning Cues input
    and the Bloom Tuning output (Settings → Link, Tempo & MIDI). Make a MIDI
    track with no instrument, input **Bloom Tuning Cues**, output **No
    Output**, and arm it with the rest of the take.
  - **To play the tunings back:** run the helper and set that track's output
    to **Bloom Tuning**. Bloom needn't be open. As the track plays, the helper
    reads each cue and retunes every MTS-ESP synth where the take did; it
    prints `from a cue` for each one. Leave the track's notes, velocities and
    groove alone (quantizing moves them, which is fine).
  - **Without the helper:** each cue holds the exact tuning, so a script can
    read it back for any other instrument. A cue is notes on one tick (any
    channel, any order); the pitch says what a note holds, its velocity the
    value:

    | pitch | holds |
    |---|---|
    | 0 | the format: velocity 1 |
    | 1 | the root's pitch class + 1 (C = 1) |
    | 2–4 | the period: cents − 1200 |
    | 5 + 3d … 7 + 3d | degree d (0–11): its cents above the root − 100·d |
    | 64–95 | the name, one ASCII character per note (as many as it has) |

    A value in cents is three notes, most significant first: n = round(value
    × 1000) + 1 000 000, written in base 127, each velocity being its digit +
    1; so value = ((v₁−1)·16129 + (v₂−1)·127 + (v₃−1) − 1 000 000) / 1000.
    MIDI key m then sounds at f(60 + root) · 2^((o·period + cents[d]) / 1200),
    where m − (60 + root) = 12·o + d (d in 0–11) and f(k) = 440 · 2^((k − 69)/12):
    the root keeps its equal-tempered pitch from middle C up.

---

## Ragas

The 25 ragas of the Kirana archive are scales too, each with its arohana
(rising form) and avarohana (falling form). Attach one with the scale picker
(below): its Sa goes on the root you choose, the bloom's key to start with,
and the notes move into the raga. `k` and `K` find ragas as well as scales, when they fit the
notes best. The badge shows `♮ Yaman · Sa C`; its tooltip lists both forms.

**Each note sounds in the form of the step it takes next.** A note followed
by a higher one must be in the arohana, one followed by a lower one in the
avarohana. So Yaman can rise to Pa, but not rise from it: E F♯ G A plays E F♯
F♯ A, while F♯ G E plays as written. A repeated note looks on to the next
different one; the last note, and one with only rests after it, is free.
Chords are left as they are. A note outside its form moves to the nearest note
of the form, the way the line is going.

This happens as the bloom plays: the bloom keeps the raga's full set (both
forms together), so every key works on it as on any scale, and a Pa that
can't sound in this order comes back when the line is reversed. The views
draw the notes as they sound, with a dashed ring where the written note
differs. `*` bakes them: the notes become what you hear (and any intervals
are baked as usual); the raga stays attached.

Two ragas have a turn the rule can't follow: Bageshri's descent climbs m P D
and Shudh Sarang's M P, and neither P nor M is in its arohana, so those notes
move. The ragas' written paths (`web/src/lib/ragas.ts`) keep the turns for a
later, fuller model. A raga whose two forms are the same (Bhairav, Bhupali …)
behaves like any scale.

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
| `l` / `L` | tilt down / up, a step steeper each press | accelerando / ritardando | decrescendo / crescendo | drift down / up |
| `w` | curve | rubato contour | hairpins | smooth path through channels |

**Ratchet, in time mode only: `r`** (as `r` at home). A few of the longest
durations (at least half the longest, the longer the likelier, about a fifth
of them) each split into two or three equal parts. Short durations are never
split, so a run of presses works down from the long end. The time list grows
longer than the notes, so it phases against them.

**In pitch mode the palette is the scale.** `3 4` move a scale step, `1 2` a
semitone, `! @` an octave. `- =` narrow or widen the range a scale step,
`y` puts every note on the commonest pitch, `i` mirrors high and low, `l` `L`
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
dashed ring marks it. The header shows how many, e.g. `❄ e2`. **`esc`**
unpins them all (so does `F e`); **shift-`esc`** inverts them, pinning every
free event and freeing every pinned one. Works in every view except tonal and
set, which draw pitch classes rather than events.

- **Pinned means exempt from transformations, not fixed in sound.** When the
  bloom plays, a pinned note is assembled like any other: it takes the next
  value from each list, and lists of other lengths phase across it as usual.
- **Every key works around them.** A key that changes the bloom acts on the
  free events only, as if the pinned ones weren't there: sorting, mirroring,
  braiding or stuttering rearranges the free events in the spaces between the
  pins, and never copies a pinned one. Pinned events keep their values and
  their order; when a key adds events before one, it moves along with them.
- **With a box selection,** keys act on the free events inside the box.
- **A new bloom keeps the pinned events** (`n`, `N`): regenerate everything
  around a note you like. Lifting a garden slot or loading a file clears pins.
- **Undo puts pins back** with the bloom. Hand edits (opt-`e`) and the command
  palette change values, and pins put their values back, but don't steer
  reorderings the way keys do.

### Selecting events: drag a box

Drag a box round some nodes to **select** their events, in any view. (Deep
and spiral turn with a two-finger scroll or a mouse wheel, or an opt-drag, so
a plain drag is always a box.) Until you clear it, every key that
changes the bloom works on the selection alone, as if it were the whole bloom:
sort sorts just those events, tilt ramps across them, `a` adds a note among
them, `n` regenerates only that stretch. The rest stay as they were. Selected
nodes sit on a soft disc and the header shows `▣ 4`.

- **`esc` or a click on empty space clears** the selection; **shift-`esc`
  inverts** it. With a selection, esc and shift-esc act on it; without one,
  on the pins. (Esc first leaves a list mode, clean view or the help.)
- **Playing, the garden, views and modes** still see the whole bloom.
- **Pins still hold** inside a selection.
- The command palette and the editor work on the whole bloom.
- Lifting a garden slot or loading a file clears the selection.

---

## Seeing it

- **The cue line,** under the header, names the few keys that belong to where
  you are: a mode's own keys (tuning mode, the freeze menu, a list mode), or
  at home the situations that open keys up, two at most — a selection, pins, a
  raga changing notes (`* bake what you hear`), intervals, a held tuning, a
  running pulsar or loop, a loaded garden slot. With nothing special going on
  it shows `space play · n new · ? all keys`, and every half minute a
  lesser-known key instead. `?` in tuning mode or the freeze menu shows just
  that section of the help. ⚙ settings → display → **cues** turns it off; it's
  hidden in clean view and while the console is open.
- **Lanes: opt-`\`.** A strip under the view showing the five lists (pitch, time,
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
- **Performance (for video): ⚙ settings → performance.** Set once; they're
  remembered. While the settings panel is open, the frame and size show on
  the picture as you set them (unless lanes are on); **clean view** there
  enters clean view with them.
  - **Frame:** 16:9, 1:1, 4:5 or 9:16. In clean view the picture fits that
    frame, centred, with the outside shaded; the status says its size in
    pixels, for setting up a screen recording's crop.
  - **Size:** the picture's overall size in clean view.
  - **Drift:** while notes play, deep and spiral sweep slowly through broad
    arcs (about ±60° round, ±20° up and down, never quite repeating), easing
    to a stop when the music stops. Scrolling still turns the view on top;
    reset view also resets the drift.
- **Turning deep and spiral:** two-finger scroll (sideways turns, up and down
  tilts) or opt-drag. A plain drag selects.
- **Views:** opt-`1`…`9`. The `\` key holds the display toggles: `\`
  console, `|` note labels, opt-`\` lanes.

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
