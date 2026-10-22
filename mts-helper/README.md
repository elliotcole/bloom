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
2. Build: `make` (needs the Xcode command line tools).
3. Run: `./bloom-mts`. It prints each tuning it receives, as cents from 12-TET
   for the twelve notes from middle C, and how many clients are connected.
4. In Bloom, load `.scl` files in ⚙ settings → tuning and press `b`. The
   browser asks once to allow SysEx; allow it. The settings menu shows
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
