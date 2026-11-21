// Note mode's ground: a voice's onsets (notes within ONSET_MS of an onset's
// first are one, a chord), found round a moment without going through the
// whole take. An onset is named by the index of its first note in p.notes.

import { ONSET_MS } from './ops';
import { noteFrom, passAt } from './perf';
import type { Perf, Voice } from './perf';

/** The voice's note before index `i` (-1 none) */
function prevOf(p: Perf, v: Voice, i: number): number {
  for (let j = i - 1; j >= 0; j--) if (p.notes[j].voice === v) return j;
  return -1;
}

/** The voice's note at or after index `i` (-1 none) */
function nextOf(p: Perf, v: Voice, i: number): number {
  for (let j = i; j < p.notes.length; j++) if (p.notes[j].voice === v) return j;
  return -1;
}

/**
 * The onset a note of the voice is in: back to a note that can only begin one
 * (more than ONSET_MS after the note before it), then onsets counted on from
 * there as onsetsOf counts them
 */
export function onsetOf(p: Perf, v: Voice, k: number): number {
  let s = k;
  for (let b = prevOf(p, v, s); b >= 0 && p.notes[s].at - p.notes[b].at <= ONSET_MS; b = prevOf(p, v, s)) s = b;
  let start = s;
  for (let j = nextOf(p, v, s + 1); j >= 0 && j <= k; j = nextOf(p, v, j + 1)) {
    if (p.notes[j].at - p.notes[start].at > ONSET_MS) start = j;
  }
  return start;
}

/** The notes of the onset starting at `i` */
export function onsetMembers(p: Perf, v: Voice, i: number): number[] {
  const out = [i], t = p.notes[i].at;
  for (let j = i + 1; j < p.notes.length && p.notes[j].at - t <= ONSET_MS; j++) if (p.notes[j].voice === v) out.push(j);
  return out;
}

/** The onset after the one starting at `i` (-1 none) */
export function nextOnset(p: Perf, v: Voice, i: number): number {
  const t = p.notes[i].at;
  for (let j = i + 1; j < p.notes.length; j++) if (p.notes[j].voice === v && p.notes[j].at - t > ONSET_MS) return j;
  return -1;
}

/** The onset before the one starting at `i` (-1 none) */
export function prevOnset(p: Perf, v: Voice, i: number): number {
  const b = prevOf(p, v, i);
  return b < 0 ? -1 : onsetOf(p, v, b);
}

/** The first onset starting at or after `ms` (-1 none) */
export function onsetFrom(p: Perf, v: Voice, ms: number): number {
  const k = nextOf(p, v, noteFrom(p.notes, ms - 0.5));
  if (k < 0) return -1;
  const s = onsetOf(p, v, k);
  return p.notes[s].at >= ms - 0.5 ? s : nextOnset(p, v, s);
}

/** The last onset starting before `ms` (-1 none) */
export function onsetBefore(p: Perf, v: Voice, ms: number): number {
  const b = prevOf(p, v, noteFrom(p.notes, ms));
  return b < 0 ? -1 : onsetOf(p, v, b);
}

/** Where an onset stands in its pass: which, of how many; and the pass (an index into the voice's passes) */
export function placeInPass(p: Perf, v: Voice, i: number): { nth: number; of: number; pass: number } {
  const pass = passAt(p.passes[v], p.notes[i].at), s = p.passes[v][pass];
  let nth = 0, of = 0;
  for (let j = onsetFrom(p, v, s.at); j >= 0 && p.notes[j].at < s.end; j = nextOnset(p, v, j)) {
    of++;
    if (j <= i) nth = of;
  }
  return { nth, of, pass };
}
