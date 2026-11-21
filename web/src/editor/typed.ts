// What's typed at the editor's prompts, read; and what a stretch has now,
// written the same way to begin the prompt with.

import { spellOctave } from '../lib/numbers';
import type { Perf } from './perf';

/** Onsets a prompt starts with as they are, at most */
export const PREFILL_MAX = 16;

/** Numbers typed with spaces or commas between; null if any isn't one */
export function numbers(text: string): number[] | null {
  const xs = text.split(/[\s,]+/).filter(Boolean).map(Number);
  return xs.length && xs.every(Number.isFinite) ? xs : null;
}

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A pitch typed: a MIDI number (60), or a name and octave as the readout writes them (C4 is 60, Eb4, F#3, Bb-1); null if it's neither */
export function pitchOf(text: string): number | null {
  if (/^\d+(\.\d+)?$/.test(text)) { const n = Math.round(Number(text)); return n <= 127 ? n : null; }
  const m = text.match(/^([A-Ga-g])([#♯b♭]*)(-?\d+)$/);
  if (!m) return null;
  const acc = [...m[2]].reduce((a, c) => a + (c === '#' || c === '♯' ? 1 : -1), 0);
  const n = (Number(m[3]) + 1) * 12 + LETTERS[m[1].toUpperCase()] + acc;
  return n >= 0 && n <= 127 ? n : null;
}

/** Pitches typed with spaces or commas between; null if any isn't one */
export function pitchesOf(text: string): number[] | null {
  const xs = text.split(/[\s,]+/).filter(Boolean).map(pitchOf);
  return xs.length && xs.every(x => x !== null) ? xs as number[] : null;
}

/** Onsets as they are now (indices into p.notes, from onsetsIn), for a prompt: each one's lowest pitch, loudest velocity, gap to the next (s) */
export function nowOf(p: Perf, os: number[][], to: number): { pitches: string; vels: string; gaps: string } {
  const at = os.map(o => p.notes[o[0]].at);
  return {
    pitches: os.map(o => spellOctave(Math.min(...o.map(i => p.notes[i].pitch)))).join(' '),
    vels: os.map(o => Math.max(...o.map(i => p.notes[i].vel))).join(' '),
    gaps: at.map((t, k) => String(Math.round((k + 1 < at.length ? at[k + 1] : to) - t) / 1000)).join(' '),
  };
}
