# bloom-mts

An [MTS-ESP](https://github.com/ODDSound/MTS-ESP) master that takes its tuning
from Bloom. Bloom runs in the browser, which can't load ODDSound's `libMTS`;
this small program can. It opens a virtual MIDI input called **Bloom Tuning**,
reads the MIDI Tuning Standard messages Bloom sends there, and passes each
tuning to every MTS-ESP client plugin, in Ableton Live or any other host.

## Setup (macOS)

1. Install MTS-ESP: the free **MTS-ESP Mini** installer from
   [oddsound.com](https://oddsound.com) puts `libMTS.dylib` in
   `/Library/Application Support/MTS-ESP`. You don't need to load the Mini
   plugin itself, and you mustn't while bloom-mts runs: only one master can be
   connected at a time.
2. Get it, either way:
   - Download the ready-built one (Intel and Apple Silicon) in Terminal:
     `curl -fLo ~/bloom-mts https://bloom.ecc.xyz/bloom-mts && chmod +x ~/bloom-mts`
     (Bloom's ⚙ → tunings → **copy helper command** copies this line).
     Use curl rather than the browser: macOS won't open an unsigned program a
     browser downloaded. If you did use the browser, run
     `xattr -d com.apple.quarantine bloom-mts` on it first.
   - Or build it: `make` (needs the Xcode command line tools). `make universal`
     rebuilds the downloadable copy in `web/public/`.
3. Run: `~/bloom-mts` (or `./bloom-mts` where you built it). It prints each
   tuning it receives, as cents from 12-TET for the twelve notes from middle C, and how many clients are connected.
4. In Bloom, load `.scl` files in ⚙ → tunings and pick one in bloom ▾ → tuning (or `T`, then `]`). The
   browser asks once to allow SysEx; allow it. ⚙ → tunings shows
   `helper: connected`.
5. In Ableton, use synths that are MTS-ESP clients (Surge XT, Vital, Pigments,
   u-he synths, and many more). They follow each tuning as Bloom sends it.

`./bloom-mts --dry` runs without libMTS and just prints what arrives. If a
crash left a master registered, `./bloom-mts --reinit` clears it.

## What it understands

- `F0 7F dd 08 02 …` real-time single note tuning change (what Bloom sends:
  two messages of 64 notes, after the tuning's name)
- `F0 7E dd 08 01 …` bulk tuning dump
- `F0 7D 62 6C 6D <name> F7` the tuning's name (Bloom's own message)
- `F0 7D 62 6C 63 [pitch velocity]… F7` a tuning cue to play out (Bloom's own)
- notes: a tuning cue played back into it, from a DAW

## Tuning cues

DAWs don't record SysEx, so each tuning Bloom sends also comes out of a second
virtual port, **Bloom Tuning Cues**, as a chord of notes that holds it. Record
that port on a MIDI track with the take; play the track back into **Bloom
Tuning** and the helper retunes where the take did, without Bloom. The format
is in Bloom's GUIDE.md (Tunings) and `web/src/lib/tuning.ts`. While a cue has
just gone out, cues coming in are ignored for two seconds, so a track that
monitors its input straight back can't undo a newer tuning.

`./bloom-mts --decode < cue.txt` reads `pitch velocity` lines as one cue and
prints its name and the 128 frequencies it makes.
