// Built-in piano synth via Tone.js Sampler + Salamander Grand Piano samples
// Implements the MidiOutput interface so it slots into the existing scheduler unchanged.

import * as Tone from 'tone';
import type { MidiOutput } from './midi';

// Salamander Grand Piano — reduced sample set (~3 MB), Tone.js interpolates the rest
const SAMPLE_URLS: Record<string, string> = {
  A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
  A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3',
  C8: 'C8.mp3',
};

const BASE_URL = 'https://tonejs.github.io/audio/salamander/';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

let _sampler: Tone.Sampler | null = null;
let _reverb: Tone.Reverb | null = null;
let _dry: Tone.Gain | null = null;
let _wet: Tone.Gain | null = null;
let _loaded = false;
let _loading = false;

// Velocity scaling: map MIDI 0-127 to a narrower amplitude range
const VEL_SCALE = 100 / 127;

/** Resolves when the sampler is loaded and ready to play. */
export function loadSynth(): Promise<void> {
  if (_loaded && _sampler) return Promise.resolve();
  if (_loading) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (_loaded) { clearInterval(check); resolve(); }
      }, 100);
    });
  }
  _loading = true;

  // Signal chain: sampler → dry gain → destination
  //                       → reverb → wet gain → destination
  _dry = new Tone.Gain(0.6).toDestination();
  _wet = new Tone.Gain(0.4).toDestination();
  _reverb = new Tone.Reverb({ decay: 4, preDelay: 0.01 });

  return new Promise((resolve) => {
    _reverb!.generate().then(() => {
      _sampler = new Tone.Sampler({
        urls: SAMPLE_URLS,
        baseUrl: BASE_URL,
        release: 4,
        onload: () => {
          _loaded = true;
          _loading = false;
          resolve();
        },
      });
      _sampler.connect(_dry!);
      _sampler.connect(_reverb!);
      _reverb!.connect(_wet!);
    });
  });
}

export function isLoaded(): boolean {
  return _loaded;
}

// ─── Reverb controls ─────────────────────────────────────────────────────────

/** Set dry/wet mix. 0 = fully dry, 1 = fully wet. */
export function setReverbMix(wet: number): void {
  const w = Math.max(0, Math.min(1, wet));
  _dry?.gain.rampTo(1 - w, 0.05);
  _wet?.gain.rampTo(w, 0.05);
}

/** Set reverb decay time in seconds. Regenerates the impulse response. */
export function setReverbDecay(seconds: number): void {
  if (!_reverb) return;
  _reverb.decay = Math.max(0.1, seconds);
  _reverb.generate();
}

// ─── MidiOutput adapter ──────────────────────────────────────────────────────

/** Ensure the AudioContext is running (browsers require a user gesture). */
async function ensureContext(): Promise<void> {
  if (Tone.getContext().state !== 'running') {
    await Tone.start();
  }
}

/**
 * A virtual MidiOutput that plays notes through the built-in piano sampler.
 * Parses raw MIDI bytes just like a hardware output would receive them.
 */
export const pianoOutput: MidiOutput = {
  name: 'Built-in Piano',

  send(data: number[]) {
    if (!_sampler || !_loaded) return;

    const status = data[0] & 0xf0;
    const note = data[1];
    const vel = data[2] ?? 0;

    if (status === 0x90 && vel > 0) {
      // Note on — scale velocity to tame the Salamander samples
      ensureContext().then(() => {
        const name = midiToNoteName(note);
        const amp = (vel / 127) * VEL_SCALE;
        _sampler!.triggerAttack(name, Tone.now(), amp);
      });
    } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
      // Note off
      const name = midiToNoteName(note);
      _sampler?.triggerRelease(name, Tone.now());
    } else if (status === 0xb0) {
      const cc = data[1];
      if (cc === 123) {
        // All notes off
        _sampler?.releaseAll(Tone.now());
      }
    }
  },
};
