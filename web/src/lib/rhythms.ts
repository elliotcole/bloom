// Rhythm with constraints. Two kinds of thing to choose in time mode (k):
//
// A duration palette is to time what a scale is to pitch: a small set of
// durations, as ratios of the pulse, that the times snap to. Random verbs
// then move within it (3 4 step along the durations in use), so a bloom can
// live in a ternary world, or an additive one, instead of everywhere.
//
// A rhythm cell replaces the time list with a short pattern at its own
// length, which then phases against the notes: 3 3 2 under five pitches.
//
// The pulse is the bloom's commonest duration: 1 in a palette or a cell.

export interface DurationPalette { name: string; ratios: number[]; says: string }
export interface RhythmCell { name: string; cell: number[]; says: string }

export const DURATION_PALETTES: DurationPalette[] = [
  { name: 'even', ratios: [1], says: 'every note the pulse' },
  { name: 'binary', ratios: [1 / 4, 1 / 2, 1, 2, 4], says: 'halves and doubles' },
  { name: 'long short', ratios: [1, 2], says: 'the pulse and its double' },
  { name: 'dotted', ratios: [1 / 2, 3 / 4, 1, 3 / 2, 2, 3], says: 'halves, doubles and their dotted values' },
  { name: 'ternary', ratios: [1 / 3, 2 / 3, 1, 4 / 3, 2], says: 'thirds of the pulse: triplets, swing' },
  { name: 'swing', ratios: [2 / 3, 4 / 3], says: 'long and short, two to one' },
  { name: 'aksak', ratios: [1, 3 / 2], says: 'twos and threes: limping metres' },
  { name: 'quintuple', ratios: [2 / 5, 3 / 5, 1, 7 / 5], says: 'fifths of the pulse' },
  { name: 'fibonacci', ratios: [1 / 2, 1, 3 / 2, 5 / 2, 4], says: '1 2 3 5 8: each the sum of the two before' },
  { name: 'primes', ratios: [1, 3 / 2, 5 / 2, 7 / 2], says: '2 3 5 7: nothing divides evenly' },
  { name: 'harmonic', ratios: [1 / 5, 1 / 4, 1 / 3, 1 / 2, 1], says: 'the pulse cut in 2, 3, 4, 5' },
];

/** k onsets spread as evenly as they go over n steps (Bjorklund): the gaps between them. 3 in 8 is 3 3 2 */
export function euclid(k: number, n: number): number[] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 1 || n < k) return [];
  const onsets = Array.from({ length: k }, (_, i) => Math.ceil((i * n) / k));   // the long gaps first: 3 3 2, not 2 3 3
  return onsets.map((o, i) => (i + 1 < k ? onsets[i + 1] : n) - o);
}

/** A ratio of the pulse as it's written: 1, 2/3, 1 1/2 */
export function ratioText(r: number): string {
  for (const d of [1, 2, 3, 4, 5, 8]) {
    const n = r * d;
    if (Math.abs(n - Math.round(n)) < 1e-6) {
      const whole = Math.floor(Math.round(n) / d), rest = Math.round(n) % d;
      return rest === 0 ? String(whole) : whole ? `${whole} ${rest}/${d}` : `${rest}/${d}`;
    }
  }
  return String(Math.round(r * 100) / 100);
}

export const RHYTHM_CELLS: RhythmCell[] = [
  { name: 'tresillo', cell: [3, 3, 2], says: '3 in 8' },
  { name: 'cinquillo', cell: [2, 1, 2, 1, 2], says: '5 in 8' },
  { name: 'bossa', cell: [3, 3, 4, 3, 3], says: '5 in 16' },
  { name: 'seven in sixteen', cell: euclid(7, 16), says: 'a samba timeline' },
  { name: 'five in twelve', cell: euclid(5, 12), says: 'a West African bell' },
  { name: 'seven in twelve', cell: [2, 2, 1, 2, 2, 2, 1], says: 'the standard bell: the major scale as rhythm' },
  { name: 'two three', cell: [2, 3], says: 'a bar of 5' },
  { name: 'two two three', cell: [2, 2, 3], says: 'a bar of 7' },
  { name: 'three two two', cell: [3, 2, 2], says: 'a bar of 7, the long first' },
  { name: 'two two two three', cell: [2, 2, 2, 3], says: 'a bar of 9' },
  { name: 'growing', cell: [1, 2, 3, 4], says: 'each a pulse longer' },
  { name: 'cell and augmentation', cell: [1, 1, 2, 2, 2, 4], says: 'short short long, then the same twice as slow' },
];

const round = (t: number) => Math.round(t * 1e6) / 1e6;

/** The commonest duration (of two as common, the shorter); 0.25 with no times */
export function pulseOf(times: number[]): number {
  const count = new Map<number, number>();
  for (const t of times) if (t > 0) count.set(round(t), (count.get(round(t)) ?? 0) + 1);
  let best = 0.25, most = 0;
  for (const [t, c] of [...count].sort((a, b) => a[0] - b[0])) if (c > most) { best = t; most = c; }
  return best;
}

/** Each time to the nearest of the palette's durations on this pulse (nearest by ratio: ½ is as far below 1 as 2 is above) */
export function snapToPalette(times: number[], ratios: number[], pulse = pulseOf(times)): number[] {
  const durs = ratios.map(r => round(r * pulse));
  return times.map(t => (t > 0 ? durs.reduce((a, d) => (Math.abs(Math.log(d / t)) < Math.abs(Math.log(a / t)) ? d : a)) : t));
}

/** A cell as durations on this pulse */
export function cellTimes(cell: number[], pulse: number): number[] {
  return cell.map(c => round(c * pulse));
}

/** What's typed as a cell: "5/8" five spread over eight, "3 3 2" the gaps themselves; null when it's neither */
export function parseCell(text: string): RhythmCell | null {
  const t = text.trim();
  const e = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (e) {
    const cell = euclid(Number(e[1]), Number(e[2]));
    return cell.length ? { name: `${e[1]} in ${e[2]}`, cell, says: 'spread as evenly as they go' } : null;
  }
  const nums = t.split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 2 || nums.length > 64 || nums.some(n => !Number.isFinite(n) || n <= 0 || n > 64)) return null;
  return { name: nums.join(' '), cell: nums, says: 'as typed, in pulses' };
}
