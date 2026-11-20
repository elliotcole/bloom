// The picture waits for the sound. A note is handed to its output at the
// moment it should sound, but what comes out of the speakers comes later:
// the audio device's buffer for the built-in piano (measured), a synth's or
// DAW's buffer for MIDI (set by hand in ⚙ → midi, as "picture waits").

let _midiLagMs = 0;
let _pianoLag: () => number = () => 0;
let _isPiano: (out: unknown) => boolean = () => false;

/** ⚙ → midi: how long a MIDI note takes to be heard, in ms (0–500) */
export function setMidiLag(ms: number): void { _midiLagMs = Math.max(0, Math.min(500, ms || 0)); }
export function midiLag(): number { return _midiLagMs; }

/** The built-in piano says how late its sound comes out, and which output it is */
export function setPianoLag(isPiano: (out: unknown) => boolean, lagMs: () => number): void {
  _isPiano = isPiano; _pianoLag = lagMs;
}

/** How long after its note is due the picture should light it, for this output */
export function pictureLag(out: unknown): number {
  return out && _isPiano(out) ? _pianoLag() : _midiLagMs;
}
