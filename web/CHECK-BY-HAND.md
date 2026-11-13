# Check by hand

The cleanup of 12 Nov 2026 (commits `3589f9b` and the one after it) passes its
tests but none of it has been tried in a browser. This is the list for a
sitting at the keyboard: `npm run dev` in `web/`, a synth or DAW on the MIDI
output for part 2. Tick things off; anything that's wrong, note the key you
pressed and what happened.

About 30 minutes. Parts 1 and 2 matter most.

## 1. Keys and overlays (10 min)

- [ ] **Pickers.** Open each: the scale picker, the tuning menu (`T` then `l`), the pattern palette (`d`). In each, click on its title or hint text, then type: the typing should still land in the filter. `esc` closes it and the home keys work again.
- [ ] **Clean view.** `opt-c`, then `d`: the palette shows. `esc`, then try `t`, `F`, `?` in clean view: nothing gets stuck.
- [ ] **Typing line.** `b` `↵`, type some figures, press `tab` round all the fields and back: what you typed is still there.
- [ ] **Command palette.** `cmd-k`, type a few letters, `↓` then `↵`: the highlighted suggestion runs. Then type `scramble.pivto`: it should say what's wrong and not half-run.
- [ ] **List modes.** In each of `p t v c 5 b`, a few keys, and especially `q`, `;`, `{`, `Z`, `opt-z`, `↵`, `x`. `space` plays and the page doesn't scroll.
- [ ] **Tuning mode.** `T` in, `esc` out; `T` in, `T` out. With slices selected, `esc` lets go of them first.
- [ ] **Freeze menu.** `F`, then `p t v c d 5 g`, each toggles; `F` or `esc` closes. With caps lock on, the same.
- [ ] **Tab from a mode.** With two voices (`opt-tab`), `tab` reaches the other voice from the freeze menu and from tuning mode, as it does from a list mode.
- [ ] **Pulse rate.** `<` is slower, `>` faster (they were swapped). They work while the pulsar is stopped, and the garden pulsar follows.
- [ ] **Demo mode** (⚙): the notice names keys properly: `opt-t`, `shift-↑`, `opt-|`, `opt-tab`.

## 2. Stuck notes and timing (10 min, with sound)

- [ ] **Take, stop.** Record a short take, play it back, press `.` in the middle of a busy passage: nothing keeps sounding.
- [ ] **Take, seek.** Play it again and skip with `←` `→`: no hung notes.
- [ ] **Take, to the end.** Let it finish: nothing left ringing that shouldn't be.
- [ ] **Take playing: view keys only.** `opt-1 … 9`, `opt-0`, `opt-o`, `opt-v`, `opt-c`, `\`, `|`, `opt-\`, `?`, `esc` work; any other key shows the hint.
- [ ] **Panic across outputs.** Start a loop, change the MIDI output in ⚙, press `.`: the old output goes quiet too.
- [ ] **Behind another window.** Loop, put Bloom behind another window for a minute, come back: it carried on in time, no burst of notes.
- [ ] **MIDI clock.** If you're slaved to a DAW's clock: stop and start the DAW quickly. The loop should pick up at once, not wait ten seconds.
- [ ] **Built-in piano.** Very short notes (a fast figure) release cleanly instead of ringing whole.

## 3. Freezes, undo, save (5 min)

- [ ] **Undo.** `F p`, change something, `cmd-z`: the ❄ badge and the settings boxes show what's now true.
- [ ] **Two voices.** Freeze something in voice A, `tab` to B: boxes and badge show B's freezes; `tab` back, A's.
- [ ] **Save and load.** Turn on a freeze, a fixed duration and the grid, save the garden (`cmd-s`), reload the page, load it: all three come back.
- [ ] **Transpose while pitch-frozen.** `F p`, then `2` a few times: the bloom moves and stays moved (it used to snap back to a mix).
- [ ] **Fixed duration with chords.** A bloom with intervals or figures on some notes, `F d` (trim) to a shorter length: the chords stay on the notes they were on.
- [ ] **Add a note.** Same bloom, `a` a few times: the new notes get a chord or figure from the ones in use, and the others don't shift.
- [ ] **A bad file.** Load something that isn't a garden file: the bloom on screen is untouched.

## 4. Drawing (5 min)

- [ ] **Idle.** Nothing playing: the picture holds still and the fan stays quiet (Activity Monitor, if you're curious: the tab should be near 0%).
- [ ] **Everything still moves that should.** Play, loop, drift in deep and spiral, orbit turning, the road, the weave, the lanes' cursors, the two-voice meeting flare.
- [ ] **Garden strip.** Updates when you save, lift, move `←` `→` (the slide), delete; the mark on the playing slot breathes while it loops; the zoom slider works.
- [ ] **Resize.** Resize the window and drag it to another display: sharp, not stretched.
- [ ] **List strip.** In each list mode the chits along the bottom look as before, values fit inside them.
- [ ] **Skins.** In each skin, the lanes and labels are readable (their colours now come from the skin).
- [ ] **Second voice.** Its view honours the axis setting and doesn't drift in orbit.
- [ ] **Cheat sheet.** Glance at `public/cheatsheet.pdf`: Garden and View sections on page 1, the `x / f` row on page 2 were reworded to fit six missing keys.

## 5. Added later on 12 Nov

- [ ] **Garden undo.** `↓` over a slot you care about, then `cmd-z`: the slot is back (the status says "the garden too"). `opt-del`, `cmd-z`: the slot returns where it was. `cmd-shift-z` redoes it. Moving `←` `→` is not an undo step.
- [ ] **Lengths badge.** `v`, then `z` to drop a velocity: the header shows something like `p5 t5 v4 ↻20`. `Z` at home fits the lists and the badge goes.
- [ ] **esc, one rule.** With the help open in a list mode, tuning mode or the freeze menu, `esc` closes the help first and a second `esc` leaves the mode. The cue line says what `esc` will do.
- [ ] **Help order.** `?`: Playback is now top left; check no column runs off the bottom.
- [ ] **Sort and wheels.** `o` / `O` do nothing at home (still sort in a list mode). `cmd-k`, `wheels`: one accent, then quiet.

## Decisions

The open decisions are at the end of [CATCH-UP.md](CATCH-UP.md), with the tour of what's new. Do that one first.
