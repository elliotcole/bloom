# Catching up: what to try

Everything here was built on 12 Nov 2026 and passes its tests, but none of it
has been tried in a browser or with sound. This is a tour of what's new, in an
order that makes music along the way. About 25 minutes. `npm run dev` in
`web/`, a synth or the built-in piano.

When something is wrong or just feels wrong, note the keys and what happened.
The longer list of regression checks from the cleanup is in
[CHECK-BY-HAND.md](CHECK-BY-HAND.md); do that one second.

## 1. Select mode: `r` (10 min)

The idea you sketched. The selection is a list of its own, and the keys are
the list verbs. Nothing in select mode changes a note; a list-mode key takes
you straight across with the selection kept.

Start with a bloom of 8 or more notes, looping (`,`).

1. **A breeze by hand.** `r`, then `=` twice: a few notes light up. `p` (pitch mode), then `3` a few times: only those go down a scale step, and the same ones keep going. `esc` home; `esc` again clears the selection.
2. **The motif routine you described.** `r` `=` `=`, then `cmd-c` `cmd-v` (each copy lands straight after the note it came from and becomes the selection; pasted into another bloom the copies keep their spacing, counted from the first selected note there), `p`, `3`. Repeat it three or four times. Does it start to sound motivic?
3. **Variations.** `r` `=`, `p`, `n`: new pitches for just those.
4. **Loudest.** `r` `l`: every note at the top level. `l` again: the next level too. `v`, `!`: only the accents drop. Try `L` (softest), `h` `H` (highest, lowest), `d` `D` (longest, shortest).
5. **Every Nth.** `r` `e`, answer 3: every third note. `0` moves it along one. `v` `@`: an accent pattern in threes. With a bloom that isn't a multiple of 3 long, that's a phase.
6. **Selection to pins and back.** `r` `l` `x`: the loudest notes are pinned, the selection is empty and ready. `esc`, `s` a few times: the accents stay where they are while the rest scrambles. `r` `X` brings the pins back as the selection.
7. **A box, then pins.** Drag a box, `r` `x`.
8. The rest: `9` `0` rotate, `s` or `n` the same number in new places, `i` invert, `R` mirror, `a` `z` all / none.

What I'd like to know:
- Is `x` / `X` right for pins? (`p` had to stay pitch mode, as you said.)  
- 
- YES THIS IS RIGHT FOR PINS

- Is an eighth of the notes the right step for `=` and `-`?
- Do you miss acting on the selection from inside select mode, or is `p` first fine?
- **Breeze and spray are still there.** Say when they can go.

## 2. Lifting one list: `opt-↑` in a list mode (3 min)

Save two different blooms into the garden. With one looping and the cursor on
the other slot:

1. `v`, then `opt-↑`: only the velocities come in; everything else plays on.
2. `t` `opt-↑` for the rhythm, `c` `opt-↑` for the channels, `p` `opt-↑` for the notes (the same as `opt-↑` at home).
3. `f` in a list mode is gone; it should just show a hint. `opt-f` (copy from the other voice) is still there.

## 3. Rhythm: duration palettes and cells, `t k` (5 min)

1. A bloom with messy times (`t` `n` a few times). `k`: a picker. Choose **ternary**: every time snaps to thirds of the pulse (the pulse is your commonest duration). `K` steps to the next palette without the picker; go round them and listen: swing, aksak, fibonacci, primes.
2. Once in a palette, `3` `4` (step along the durations in use) and `m` stay inside it.
3. `k` again, choose a **cell**: tresillo (3 3 2). The time list is now three long against your notes, so the rhythm phases. The header shows it (`p5 t3 ↻15`).
4. `k`, type `5/8` and `↵`: five spread over eight. Type `2 2 3` for a bar of seven.
5. With the rhythm frozen (`F t`), `k` says so and does nothing.

What I'd like to know: are these the right palettes, and is "the pulse is the
commonest duration" the right unit, or should it ask?

YES I THINK SO, WILL KEEP EXPLORING


## 4. Note lengths as a list (an experiment, 3 min)

`t`, `↵`, then `tab` to the **lengths** field. Type `0.2 1 1` and `↵`. Each
note's length is multiplied in turn, cycling at its own length: short, long,
long, moving round against the notes. Try `0.2 0.2 3`. `1` alone is how it
was. Your sustain setting (bloom ▾ → sound) is what it multiplies.

Rough edges, on purpose: it isn't in the lanes or the views, and cmd-z doesn't
take it back. If it's worth keeping it becomes a proper list with its own mode.

## 5. Come round in N: `opt-shift-z` (2 min)

Make a bloom with lists of awkward lengths (`v` `z`, `c` `a` `a`), so the
header shows something like `p5 t5 v4 c7 ↻140`. Home, `opt-shift-z`, answer
`20`: every list but the notes is cut or looped to the nearest length that
divides 20. The status says when it all comes round.

You weren't sure this is useful. Neither am I. Tell me after trying it.

## 6. Smaller things from earlier the same day (2 min)

- **Garden undo.** `↓` over a slot, `cmd-z`: the slot is back.
- **The lengths badge** in the header whenever lists differ.
- **`esc`** closes the help before it leaves a mode; the cue line says what it will do.
- **`?`** opens with Playback.
- `o` / `O` do nothing at home; `cmd-k` `wheels` is wheels within wheels.

## 7. Added 15 Nov, from your notes at the keyboard (10 min)

- **Paste keeps its shape.** `r` `=` `=` `cmd-c` `cmd-v`: each copy lands straight after its own note. In another bloom, select one note and `cmd-v`: the copies keep their spacing from there. Adjacent selected notes stay together as a phrase.
- **Paste as a figure, `cmd-shift-v`.** Copy three or four notes, select another note (or several), `cmd-shift-v`: that note becomes the figure's first and the rest follow, moved by scale steps (semitones with no scale attached). `opt-V` was taken (it saves the weave as an image).
- **Selection and pins off / on, `opt-r`**, in any mode. Again brings them back.
- **A sublist for the selected notes.** Select a note, `5`, `↵`: you see only its interval. Type `(+P5 -3rd)`: those sound with it (`.` takes it off). With several selected, what you type goes onto them in order, read round. The same in `p t v c b`.
- **The rhythm palette is a lock.** `t` `k`, choose swing: the header shows `♩ swing · 0.25` (the palette and its basis). Now try `3 4`, `m`, `n`, `l`, `i`, and at home `-` `=`: the times stay in the palette. `1` `2` and `!` `@` move the basis. `K` is the next palette on the same basis. `F t` lets go, and so does typing times (`t` `↵`) that don't fit. Does it feel like a key?
- **Scale names.** Marva on C reads `♮ Marva · key C`. A frozen scale shows `❄` in the badge. With notes pinned, slant now renames the scale (the pinned notes stay where they are, perhaps outside it).
- **Channel mode:** `;` every channel one up, `'` one channel changed at random.
- **Spray is gone.** `Y` is free.
- **Light skins:** ⚙ skin → paper, daylight. Only the picture and garden go light; header and footer stay dark. I haven't seen these: say what looks wrong.

## Not built

- **The comma lane.** A note returning a comma away against its ringing copy
  needs two tunings of the same key sounding at once. The tuning goes out as
  one table for all 128 keys (MTS and the piano alike), so this means sending
  the altered note on a spare key retuned for it: a change to the path that
  carries every note to the synth and to the helper, and nothing I can check
  without hearing it. I'd rather build it with you at the keyboard than blind.
- **The GUIDE.** Kept in step (it has a Select mode section now) but not
  redesigned.

## Decisions still open

1. `.` after a take ends also cuts the notes still ringing. Keep?
2. `oneRandChan` and `cycleChans`: palette commands, keys, or neither?

KEYS IN CHANNEL MODE -- semicolon and apostraphe

3. Spray (`Y`) and curves (`w`) leave lists out of step. With select mode, does spray go?

CUT SPRAY

4. Skins: should ember, arctic and solar recolour the page too?

YES WE SHOULD HAVE SOME SKINS WITH LIGHT BACKGROUNDS

5. Nothing is pushed. Say "push" when you want it.
