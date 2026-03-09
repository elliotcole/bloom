# Bloom Web — Unported Features

Comparison of `bloom.sc` + `bloom keystroke controller.scd` against
`src/core/Bloom.ts` + `src/ui/keys.ts`.

Excludes SC-specific infrastructure that the web architecture already supersedes
(Pbind/clock playback, SimpleMIDIFile parsing, Task scheduling, etc.).

---

## Part 1 — Missing Bloom.ts Methods

Functions present in `bloom.sc` but not yet in `Bloom.ts`.

---

### Priority 1 — High Value, Straightforward to Port

#### `intervals()`
Returns all pairwise intervals between notes as `[interval_mod12, [i, j]]` for every
pair where `j > i`. Used internally by `resolve()`.

```sc
intervals {
    var intervalList = [];
    notes.do({|source, i|
        notes.do({|target, j|
            if (j > i, {
                var interval = (target - source).abs % 12;
                intervalList = intervalList.add([interval, [i,j]]);
            });
        })
    });
    ^intervalList
}
```

**Port notes:** Straightforward nested loop. Prerequisite for `resolve()`.

---

#### `trimLastTime()`
Removes the last time interval, snaps the total duration to the nearest beat, then
appends a corrective final interval so the sum equals exactly that snapped value.

```sc
trimLastTime {
    timeIntervals.pop;
    var quantLength = timeIntervals.sum.snap(1,1,1); // SC snap = Math.round
    var diff = quantLength - timeIntervals.sum;
    if (diff <= 0, { diff = diff + 1 });
    timeIntervals.add(diff);
}
```

**Port notes:** `.snap(1,1,1)` rounds to nearest integer → use `Math.round(sum)`.

---

#### `wrapToLongest()`
Inverse of `wrapToNotes()`. Expands all four arrays to the length of the *longest*
one by wrapping shorter arrays.

```sc
wrapToLongest {
    var longest = [notes.size, timeIntervals.size, velocities.size, chans.size].maxItem;
    notes         = longest.collect {|i| notes.wrapAt(i)};
    velocities    = longest.collect {|i| velocities.wrapAt(i)};
    timeIntervals = longest.collect {|i| timeIntervals.wrapAt(i)};
    chans         = longest.collect {|i| chans.wrapAt(i)};
}
```

**Port notes:** Direct; use the `wrapAt` helper already in the codebase.

---

#### ~~`oneRandChan()`~~ ✅ ported
Replaces one randomly-chosen slot in `chans` with a new random channel value.

---

#### ~~`incrementSomeChans(prob = 0.2)`~~ ✅ ported
Probabilistically increments each channel value by 1, wrapping at `maxChan`.

---

#### ~~`saveTimeIntervals()` / `restoreTimeIntervals()`~~ ✅ already existed (private methods)

---

#### `absTime()` / `setRelTime(absTimes)`
Convert between relative (interval-based) and absolute time representations.
`absTime()` returns cumulative onset times; `setRelTime()` converts back to intervals.

```sc
absTime {
    var totalTime = 0;
    ^timeIntervals.collect({|ti, i|
        if (i == 0, { 0 }, { totalTime = timeIntervals[i-1] + totalTime; totalTime; })
    })
}
setRelTime {|absTimes|
    timeIntervals.do({|ti, i|
        if (i < (timeIntervals.size - 1), { timeIntervals[i] = absTimes[i+1] - absTimes[i]; })
    })
}
```

**Port notes:** Useful building block for quantization, alignment, and time-domain
operations that need to reason about absolute onsets. `absTime` is a plain prefix-sum;
`setRelTime` is its inverse (skips the last slot whose end is unknown).

---

### Priority 2 — Medium Value, Moderate Complexity

#### `resolve(percentToResolve = 0.2)`
Applies classical counterpoint resolution rules to a random subset of note pairs.
Identifies dissonances via `intervals()` and nudges one voice by a semitone:

| Interval | Resolution |
|---|---|
| m2 (1) | hi note → unison |
| M2 (2) | lo note → m3 below |
| P4 (5) | hi note → M3 |
| tritone (6) | voices diverge |
| m6 (8) | hi note → P5 |
| m7 (10) | hi note → M6 |
| M7 (11) | hi note → M6 |

**Port notes:** Depends on `intervals()`. Operates on flat note list; uses `saveNest`/
`restoreNest` around chord structures. Also called by `trans()`.

---

#### `harmonize(chordTones = [1,3,5], probability = 1)`
Turns each melody note into a chord by randomly selecting a harmonization (from scale
chord tones) that contains the note. `probability` controls what fraction of notes get
harmonized; the default is 1 (all notes).

In the SC controller, `5` maps to `harmonize([1,3,5], 0.22)` ("some") and
`%` maps to `harmonize([1,3,5])` ("all"). **Both keys are missing from `keys.ts`.**

**Port notes:** Requires a `harmonies(scale, chordTones, root)` helper per note.
SC rejects diminished triads from the candidate set before picking randomly.

---

#### `harmonizeEfficiently(chordTones = [1,3,5])`
Like `harmonize` but selects chord voicings that minimize total semitone movement
from the previous chord (Tymoczko voice-leading efficiency).

**Port notes:** Requires a `melodyToEfficientProgression` helper that builds the chord
sequence greedily, minimizing motion at each step.

---

#### `trans()`
Picks one transformation randomly from a palette of ~80 operations covering pitch,
scale, time, pattern, and dynamics. Useful as a "surprise me" key.

Representative palette items (abbreviated):
- **pitch:** `mutateNotesD`, `shear`, `compress`, `invertMean`, `invert`, `transpose(±2/7/12)`,
  `dTranspose(±1..4)`, `pivot(1..4)`, `pivotBass`, `pivotLoudest`, `flatten(1..5)`, `resolve`
- **scale:** `chooseScale`, `slantScale`, `reduceScale`, `applyScale(Dorian/Ionian/…)`
- **time:** `newShape`, `mutateShape`, `wrapTime(0.25)`, `slower`, `faster`, `quantize`
- **pattern:** `scramble`, `deepScramble`, `sputter`, `spray`, `mirror`, `pyramid`, `slide`
- **density:** `thicken`, `thickenLengthen`, `thin`, `thinShorten`, `trimTo`, `rotate`
- **dynamics:** `softer`, `louder`, `fan`, `avgTime`, `chordsRand`, `chords`, `chordsShorten`

**Port notes:** Pure dispatch — no new logic required. Skip unported methods from the
list; add them as they land.

---

#### `checkForScaleMatch()`
Analyzes current notes, builds a normalized scale representation, and matches it against
the named-scale library. Returns `[matchedScale, root]` or `null`.

```sc
checkForScaleMatch {
    var scale = this.scale;
    var root = scale.degrees[0];
    var normalizedScale = Scale.new(scale.degrees - root);
    var match = Scale.match(normalizedScale);
    if (match == [], { ^nil }, { ^[match, root] })
}
```

**Port notes:** Useful for the Display console to auto-report scale names. Depends on
a `Scale.match()` lookup against the existing `SCALES` dictionary.

---

### Priority 3 — Chord Architecture Extensions

Require `extractChords()` + `replaceChords()` (both already ported as helpers).

#### `chordsByInterval(interval = 3)`
Groups notes into chords by stacking them at a given diatonic interval (default: thirds).
Scale-aware — when `appliedScale` is set, the interval is interpreted diatonically.

**Algorithm:**
1. Sort notes flat
2. For each starting note, walk up by the interval, collecting notes with that pitch class
3. Remove collected notes from the pool (each note belongs to at most one chord)
4. Re-nest result into chord arrays

---

#### `pivotChords()`
Applies `pivot()` to each extracted chord individually and replaces them in place.

```sc
pivotChords {
    var chords = this.extractChords;
    var newChords = chords.collect {|chord| Bloom.new(chord).pivot.notes};
    this.replaceChords(newChords);
}
```

---

#### `spaceChords()`
Applies open voicing to each extracted chord — redistributes chord tones across octaves
to maximize spacing.

```sc
spaceChords {
    var chords = this.extractChords;
    chords = chords.collect {|chord| chord.spacedVoicing};
    this.replaceChords(chords);
}
```

---

#### `efficientChordVoicings()`
Rearranges extracted chord voicings so each chord moves with minimal total semitone
distance from the previous chord.

```sc
efficientChordVoicings {
    var chords = this.extractChords;
    var newChords = [chords[0]];
    chords.drop(1).do {|chord|
        newChords = newChords.add(chord.efficientMotionFrom(newChords.last))
    };
    this.replaceChords(newChords);
}
```

**Port notes:** Requires `efficientMotionFrom(previousChord)` — permutes note octaves
to minimize total voice-leading distance. Core of the Tymoczko geometry-of-music approach.

---

### Priority 4 — Internal / Low Urgency

#### `curvesDownward(newSize = 10)`
Complement of `drawCurves` — fills downward leaps, leaves upward motion as leaps.
**Body is empty in the SC source** (TODO stub). Low priority.

---

#### `checkScale()`
Defensive call (intended before playback): clears `appliedScale` if notes have
drifted from it.

```sc
checkScale {
    if (appliedScale.notNil, {
        if (difference(this.asScale.degrees, appliedScale.degrees) != [], {
            appliedScale = nil; keyRoot = 0;
        })
    })
}
```

**Port notes:** Could be called inside `resolveFixed()` or `toEvents()`.

---

#### Log system — `log(index)` / `logAsArray(index)` / `fromLog(index)` / `clearLog()`
A multi-slot snapshot dictionary, separate from the `save/restore` stack.
In SC, `l` stores a snapshot; `L` lifts one back. **Both keys are missing from `keys.ts`.**

---

#### `generateDmitriSet()`
Generates all `notes.size × scale.size` variants of the bloom by applying every
combination of inversion depth and diatonic transposition. Returns a flat array of
report strings (Tymoczko voice-leading orbit).

**Port notes:** Interesting for a future multi-bloom exploration UI; low priority for
the single-bloom live-coding workflow.

---

---

## Part 2 — Missing Keystroke Controller Features

Gaps identified from `bloom keystroke controller.scd` relative to `src/ui/keys.ts`.

---

### Missing Key Bindings

These are SC controller bindings with **no equivalent in `keys.ts`** (the feature either
has no key at all, or is missing the underlying Bloom method as well):

| Key | SC action | Status |
|---|---|---|
| `l` | `b.log` — save bloom snapshot to log slot | ❌ Method + key missing |
| `L` | `b.fromLog` — import bloom from log slot | ❌ Method + key missing |
| `5` | `b.harmonize([1,3,5], 0.22)` — harmonize some | ❌ Method + key missing |
| `%` | `b.harmonize([1,3,5])` — harmonize all | ❌ Method + key missing |
| ~~`opt-,`~~ | ~~Loop garden — play all slots in sequence~~ | ✅ Ported (`Alt+,`) |
| ~~`opt-/`~~ | ~~Pulse garden — play each slot at pulsar rate~~ | ✅ Ported (`Alt+/`) |
| ~~`` ` ``~~ | ~~Toggle MIDI record / stop~~ | ✅ Ported |
| ~~`\`~~ | ~~Sustain pedal~~ | ✅ Ported as `~` (tilde) |

---

### ~~Garden Looper / Garden Pulsar~~ ✅ Ported

`Alt+,` → garden looper (timeout chain, each slot plays for its own duration).
`Alt+/` → garden pulsar (setInterval at pulsar rate, advances through slots).
Both in `scheduler.ts` (`startGardenLooper`, `startGardenPulsar`) and wired in `keys.ts`.
`.` stops both.

---

### ~~Fixed Constraints UI~~ ✅ Ported

Settings bar (⚙ button in header) exposes fixedDur + amount + mode, fixedGrid + size,
fixedScale checkbox. Also contains BPM, tap tempo, legato, sustain, compass range + presets,
and maxChan. MIDI clock sync (0xF8) auto-updates BPM with a "clk: sync" indicator.

### ~~Compass Range Presets~~ ✅ Ported

bloom / drums / full preset buttons in settings bar. Lo/Hi number inputs also available.

### ~~Legato / Sustain Settings~~ ✅ Ported

Settings bar legato input (float, multiplier of timeInterval).
Sustain checkbox + value input (fixed gate in beats, null = off). Both update `BloomDefaults`
so new blooms inherit the setting.

### ~~Max Channels~~ ✅ Ported

`maxChan` number input in settings bar updates `Bloom.maxChan` static.

### ~~MIDI Recording~~ ✅ Ported

`` ` `` toggles recording. Implemented in `src/audio/recorder.ts`. Captures note-on
timestamps; timeIntervals derived from consecutive gaps. Red pulsing dot in header while
recording.

### ~~Sustain Pedal~~ ✅ Ported (key: `~`)

Sends CC 64 on channels 0..Bloom.maxChan. State tracked in `keyState.pedalDown`.

### Fixed Constraints UI (legacy note — now ported)

The Bloom model already had `fixedDur`, `fixedDurMode`, `fixedGrid`, and `fixedScale`
properties in `Bloom.ts`, and `resolveFixed()` is called before each play. These now have
UI in the settings bar.

The SC controller provides a full settings panel with:

| Control | SC widget | Web equivalent needed |
|---|---|---|
| Fixed duration on/off | Checkbox | Toggle key or settings panel |
| Fixed duration amount | Slider (0.5–8 beats, step 0.5) | Number input or key pair |
| Fixed duration mode | Popup: `scale` \| `trim` | Toggle |
| Fixed grid on/off | Checkbox | Toggle key |
| Fixed grid size | Number box (2–12) | Number input or key pair |
| Fixed scale on/off | Checkbox (locks current scale) | Toggle key |

**Port notes:** The simplest web implementation would be a settings panel (similar to
the existing MIDI/viz controls at the top), or a set of key bindings to cycle through
constraint options. Fixed duration and fixed scale are the most immediately useful — a
player often wants to lock the phrase length or the key.

---

### Compass Range Presets

The SC controller has a range slider (`Bloom.defaultLowestPossibleNote` ↔
`Bloom.defaultHighestPossibleNote`) and three preset buttons:

| Preset | Low | High | Use |
|---|---|---|---|
| bloom | 40 | 108 | General melodic |
| drums | 36 | 51 | GM drum range |
| full | 0 | 127 | Unrestricted |

`E` in `keys.ts` calls `compass(48, 72)` (one hardcoded range). There is no way to
interactively set the low/high range or switch to the drum preset without editing code.

**Port notes:** A small "Compass" section in a settings panel, or `Shift-E` cycling
through the three presets, would cover most use cases.

---

### Legato / Sustain Settings

The SC controller sets `b.sustain = 2` and `looper.legato = 2` globally. `Bloom.ts`
has `legato` and `sustain` instance fields (and `BloomDefaults.legato/sustain`), but:

- There is no keyboard shortcut to adjust legato or sustain
- The looper always uses whatever `bloom.legato`/`bloom.sustain` are at creation time
- No UI to change the default

**Port notes:** Low urgency; the defaults work. Worth a settings input when the panel is
built.

---

### Max Channels

The SC controller sets `Bloom.maxChan = 10` globally. The TS version has
`Bloom.maxChan` as a static, but it defaults to `0` (single-channel) and there is no UI
to change it. Channel operations like `randChans`, `cycleChans`, `addChan` silently stay
on channel 0 unless `maxChan` is raised.

**Port notes:** A small number input in the settings panel (or a `Bloom.maxChan` export
for the MIDI setup section) would unlock proper multi-channel routing.

---

### MIDI Recording

The SC controller binds `` ` `` to `b.record()` / `b.rstop()`, which captures incoming
MIDI into a Bloom in real time.

For the web, this would use the Web MIDI API's `MIDIInput.onmidimessage` to collect
note-on/note-off events and assemble them into a Bloom's note/velocity/time arrays.
This is a meaningful feature for live performance but a significant implementation effort
and architecturally distinct from the existing scheduler.

---

### Ableton Link / Clock Sync

The SC controller optionally uses `LinkClock` for Ableton Link sync. The web app has no
clock sync; all timing is derived from `beatsToMs()` which uses a fixed internal BPM.
A [Web MIDI Clock](https://www.midi.org/specifications/midi1-specifications/midi-1-0-core-specifications/)
listener or the [Web Audio API clock](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/currentTime)
would be the closest web equivalents.

---

---

## Part 3 — Not Applicable (SC Infrastructure)

These depend on SuperCollider's server, clock, or environment and are superseded by
the web architecture:

| SC Feature | Reason N/A |
|---|---|
| `play()` / `playWait()` | SC Pbind → replaced by `toEvents()` + scheduler |
| `synthPlay()` | SC Synth (stub in SC too) |
| `setLegato()` / `setSustain()` | SC note-duration model; web uses raw values |
| `loop()` / `pulse()` | SC Task → web scheduler |
| `record()` / `rstop()` | SC MIDI recording; web would use Web MIDI API separately |
| `fromMIDI()` | SC SimpleMIDIFile; no direct web equivalent |
| `asPbind()` | SC pattern system |
| `BloomPulsar` class | SC Task wrapper |
| `Pedal` class | SC MIDI CC 64; web could use `MIDIOutput.send([0xB0+ch, 64, 127])` |
| `LinkClock` | Ableton Link — no web support yet |
| `rp()` | `report()` alias for SC post window |
| `reportNotes/Velocities/Times/Chans/Scale()` | SC columnar console formatting |
| `generateStringLengths()` | SC console column-width helper |
| `asPChist()` / `asMIDIhist()` | SC histogram analysis |
| SC GUI widgets | `Window`, `CheckBox`, `EZSlider`, etc. → web HTML/CSS |

---

*Generated 2026-03-08 from:*
*— `bloom.sc` (2690 lines) vs `src/core/Bloom.ts` (1435 lines)*
*— `bloom keystroke controller.scd` (610 lines) vs `src/ui/keys.ts` (699 lines)*
