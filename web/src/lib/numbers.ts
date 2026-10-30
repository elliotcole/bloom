// Number utility functions — ported from SuperCollider's SimpleNumber extensions in Bloom.sc

import { nearestInList, wrapAt } from './arrays';

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const OCTAVE_OFFSET = -1; // SC: note 0 = C-1

export function spell(note: number): string {
  return wrapAt(NOTE_NAMES, Math.round(note));
}

export function spellOctave(note: number): string {
  const n = Math.round(note);
  const octave = Math.floor(n / 12) + OCTAVE_OFFSET;
  return NOTE_NAMES[((n % 12) + 12) % 12] + octave;
}

export function spellToPC(name: string): number {
  const names = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
    'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  ];
  const idx = names.indexOf(name);
  return idx === -1 ? 0 : idx % 12;
}

export function asPC(note: number): number {
  return ((Math.round(note) % 12) + 12) % 12;
}

export function allOctaves(note: number): number[] {
  const pc = asPC(note);
  return Array.from({ length: 11 }, (_, i) => pc + 12 * i);
}

export function nearestOctaveTo(note: number, target: number): number {
  return nearestInList(target, allOctaves(note));
}

export function justBelow(note: number, target: number): number {
  const nearest = nearestOctaveTo(note, target);
  return nearest > target ? nearest - 12 : nearest;
}

export function justAbove(note: number, target: number): number {
  const nearest = nearestOctaveTo(note, target);
  return nearest < target ? nearest + 12 : nearest;
}

export function snap(value: number, resolution: number = 1, margin: number = 0.05, strength: number = 1): number {
  const rounded = Math.round(value / resolution) * resolution;
  const diff = rounded - value;
  return Math.abs(diff) < margin ? value + strength * diff : value;
}

export function softRound(value: number, resolution: number = 1, margin: number = 0.05, strength: number = 1): number {
  const rounded = Math.round(value / resolution) * resolution;
  const diff = rounded - value;
  return Math.abs(diff) > margin ? value + strength * diff : value;
}

export function linlin(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

// ─── Scale degree conversions ─────────────────────────────────────────────────
// One way of reading a pitch against a scale, used by every snap and step: the
// scale's degrees wrap round the octave, so the note above the top degree is
// as near to the next octave's first as to the top.

/** The degrees with the top one repeated below and the bottom one above, so neighbours across the octave line count */
function aroundOctave(scaleDegrees: number[], stepsPerOctave: number): number[] {
  const n = scaleDegrees.length;
  return [scaleDegrees[n - 1] - stepsPerOctave, ...scaleDegrees, scaleDegrees[0] + stepsPerOctave];
}

/**
 * MIDI note to scale degree, fractional between degrees: in C major 60 → 35,
 * 61 → 35.5, 71 → 41; in C pentatonic 71 (B) → 29.67, nearer the C above.
 */
export function keyToDegree(note: number, scaleDegrees: number[], stepsPerOctave: number = 12): number {
  const size = scaleDegrees.length;
  if (size === 0) return note;
  const octave = Math.floor(note / stepsPerOctave);
  const k = note - octave * stepsPerOctave;
  const ext = aroundOctave(scaleDegrees, stepsPerOctave);   // ext[i] is degree i - 1
  let i = 0;
  while (i < ext.length - 2 && ext[i + 1] <= k) i++;
  const a = ext[i], b = ext[i + 1];
  const frac = b === a ? 0 : (k - a) / (b - a);
  return octave * size + (i - 1) + frac;
}

/** Scale degree to MIDI note. A fractional degree is read as SuperCollider does: .1 is a semitone sharp */
export function degreeToKey(degree: number, scaleDegrees: number[], stepsPerOctave: number = 12): number {
  const size = scaleDegrees.length;
  if (size === 0) return degree;
  const scaleDeg = Math.round(degree);
  const accidental = Math.round((degree - scaleDeg) * 10 * 1e6) / 1e6;
  const octaveShift = Math.floor(scaleDeg / size) * stepsPerOctave;
  const idx = ((scaleDeg % size) + size) % size;
  const base = scaleDegrees[idx];
  return octaveShift + base + (accidental !== 0 ? accidental * (stepsPerOctave / 12) : 0);
}

/** The nearest note of the scale (a tie goes up), across the octave line: B in C pentatonic → the C above */
export function nearestInScale(note: number, scaleDegrees: number[], stepsPerOctave: number = 12): number {
  if (scaleDegrees.length === 0) return note;
  return degreeToKey(Math.round(keyToDegree(note, scaleDegrees, stepsPerOctave)), scaleDegrees, stepsPerOctave);
}

/** `k` steps of the scale from the note (snapped to the scale first), carrying across octaves */
export function stepInScale(note: number, scaleDegrees: number[], k: number, stepsPerOctave: number = 12): number {
  if (scaleDegrees.length === 0) return note + k;
  const degree = Math.round(keyToDegree(note, scaleDegrees, stepsPerOctave)) + k;
  return degreeToKey(degree, scaleDegrees, stepsPerOctave);
}

// ─── Harmony ──────────────────────────────────────────────────────────────────

/**
 * Negative harmony transformation.
 * Maps notes through an axis of symmetry around the tonic.
 */
export function negHarmony(note: number, tonic: number = 0): number {
  const pc = asPC(note);
  const ruler: number[][] = [
    [10, 11, 0, 1, 2, 3].map(n => (n + tonic) % 12),
    [4, 5, 6, 7, 8, 9].map(n => (n + tonic) % 12),
  ];
  let neg: number;
  const idx0 = ruler[0].indexOf(pc);
  if (idx0 !== -1) {
    neg = ruler[1].reverse()[idx0];
    ruler[1].reverse(); // restore
  } else {
    const idx1 = ruler[1].indexOf(pc);
    neg = ruler[0].reverse()[idx1];
    ruler[0].reverse();
  }
  return nearestOctaveTo(neg, note);
}

// ─── Chord operations ─────────────────────────────────────────────────────────

/** Invert a chord: diatonically transpose each note by n steps using the chord's own scale */
export function invertChord(notes: number[], n: number = 1): number[] {
  const pcs = notes.map(note => asPC(note)).sort((a, b) => a - b);
  const uniquePCs = [...new Set(pcs)].sort((a, b) => a - b);
  const scale = uniquePCs.length < 2 ? [0, 2, 4, 5, 7, 9, 11] : uniquePCs;
  return notes.map(note => degreeToKey(keyToDegree(note, scale) + n, scale));
}

/** Invert around the mean pitch */
export function invertMean(notes: number[]): number[] {
  const avg = Math.round(notes.reduce((a, b) => a + b, 0) / notes.length);
  return notes.map(note => avg - (note - avg));
}

export function efficientMotionFrom(notes: number[], previousChord: number[]): number[] {
  const original = [...notes];
  const prev = [...previousChord];
  const result: number[] = [];
  while (original.length > 0) {
    let bestMove: { note: number; transposed: number; distance: number } | null = null;
    for (const prevNote of prev) {
      for (const note of original) {
        const transposed = nearestOctaveTo(note, prevNote);
        const distance = Math.abs(prevNote - transposed);
        if (!bestMove || distance < bestMove.distance) {
          bestMove = { note, transposed, distance };
        }
      }
    }
    if (!bestMove) break;
    result.push(bestMove.transposed);
    original.splice(original.indexOf(bestMove.note), 1);
    const prevIdx = prev.indexOf(bestMove.note);
    if (prevIdx !== -1) prev.splice(prevIdx, 1);
    else if (prev.length > 0) prev.shift();
  }
  return result;
}
