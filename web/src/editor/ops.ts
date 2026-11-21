// The operations that reshape a stretch rather than take it out: its loudness
// and pace as shapes, its accents and timing as patterns that run on through
// the seams between passes, its notes silenced or moved in pitch, and passes
// put in from elsewhere. Each acts on one voice, or (no voice) on every voice
// and the clock with them, as a cut does.

import type { BloomJSON } from '../io/garden-io';
import type { Ctl, Flag, Note, Pass, Perf, Voice } from './perf';

/** Notes this close (ms) are one onset */
export const ONSET_MS = 8;

/**
 * Passes as they were copied: times from the start of the stretch, which lasts
 * `length`. A pass's bloom is the take's (or one the edit added), or with
 * `blooms`, -2 and below names one the clip brings: -2 its first, -3 the next
 */
export interface Clip {
  length: number;
  notes: Omit<Note, 'id' | 'voice'>[];
  passes: Omit<Pass, 'voice'>[];
  blooms?: BloomJSON[];
}

/** A clip's own bloom k as its passes name it; and, given that, k */
export const clipBloom = (k: number) => -2 - k;

export type ShapeOp =
  /** Loudness (percent of as played) across the stretch, the values spread evenly over it and joined by straight lines */
  | { op: 'loud'; from: number; to: number; values: number[]; voice?: Voice }
  /** Speed (percent of as played), spread the same way; what follows moves by the change in length */
  | { op: 'pace'; from: number; to: number; values: number[]; voice?: Voice }
  /** The velocities of the stretch's onsets in turn, the values over and over */
  | { op: 'vels'; from: number; to: number; values: number[]; voice?: Voice }
  /** The gap (ms) from each of the stretch's onsets to the next, the values over and over; the last to its end */
  | { op: 'gaps'; from: number; to: number; values: number[]; voice?: Voice }
  /** A clip put in at `at`, what follows later by its length; with `to`, in place of what was up to there */
  | { op: 'insert'; at: number; to?: number; clip: Clip; voice?: Voice }
  /** Silence: the notes that start in the stretch taken out, the time left as it was */
  | { op: 'drop'; from: number; to: number; voice?: Voice }
  /** The stretch's pitches moved by `by` semitones */
  | { op: 'transpose'; from: number; to: number; by: number; voice?: Voice }
  /** The pitches of the stretch's onsets in turn, the values over and over; a chord moves whole, its lowest note to the value */
  | { op: 'pitches'; from: number; to: number; values: number[]; voice?: Voice };

const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));
const clampPitch = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** Whether an op on `voice` is on every voice and the clock */
const isAll = (p: Perf, voice?: Voice) => voice === undefined || p.voices === 1;

/** The first in a time-ordered list at or after `ms` */
function firstFrom(list: { at: number }[], ms: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at < ms) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Two time-ordered lists as one, `a` first among equals */
function merge(a: Note[], b: Note[]): Note[] {
  const out: Note[] = new Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = b[j].at < a[i].at ? b[j++] : a[i++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

/** The values as a line over [from, to]: evenly spaced, straight between; one value is flat */
export function shapeAt(values: number[], from: number, to: number, t: number): number {
  if (values.length === 1 || !(to > from)) return values[0];
  const x = Math.max(0, Math.min(1, (t - from) / (to - from))) * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(x));
  return values[i] + (values[i + 1] - values[i]) * (x - i);
}

/** A time-ordered list's onsets: the indices of its members, those within ONSET_MS of an onset's first together */
export function onsetsOf<T extends { at: number }>(list: T[], keep: (x: T, i: number) => boolean = () => true): number[][] {
  const out: number[][] = [];
  let start = -Infinity;
  list.forEach((x, i) => {
    if (!keep(x, i)) return;
    if (x.at - start > ONSET_MS || !out.length) { out.push([i]); start = x.at; } else out[out.length - 1].push(i);
  });
  return out;
}

/** The notes of a voice (or all) from `from` up to `to`, as onsets: indices into p.notes */
export function onsetsIn(p: Perf, from: number, to: number, voice?: Voice): number[][] {
  const all = isAll(p, voice), lo = firstFrom(p.notes, from), hi = firstFrom(p.notes, to);
  return onsetsOf(p.notes.slice(lo, hi), n => all || n.voice === voice).map(o => o.map(i => i + lo));
}

// ─── Loudness and accents ───────────────────────────────────────────────────

export function loud(p: Perf, from: number, to: number, values: number[], voice?: Voice): Perf {
  if (!(to > from) || !values.length) return p;
  const all = isAll(p, voice), lo = firstFrom(p.notes, from), hi = firstFrom(p.notes, to);
  const notes = p.notes.slice();
  for (let i = lo; i < hi; i++) {
    const n = notes[i];
    if (all || n.voice === voice) notes[i] = { ...n, vel: clampVel((n.vel * shapeAt(values, from, to, n.at)) / 100) };
  }
  return { ...p, notes };
}

export function vels(p: Perf, from: number, to: number, values: number[], voice?: Voice): Perf {
  if (!(to > from) || !values.length) return p;
  const notes = p.notes.slice();
  onsetsIn(p, from, to, voice).forEach((o, k) => {
    // the loudest takes the value; the rest keep their proportion to it
    const v = values[k % values.length], top = Math.max(...o.map(i => notes[i].vel), 1);
    for (const i of o) notes[i] = { ...notes[i], vel: clampVel((v * notes[i].vel) / top) };
  });
  return { ...p, notes };
}

// ─── Silence and pitch ──────────────────────────────────────────────────────

export function drop(p: Perf, from: number, to: number, voice?: Voice): Perf {
  if (!(to > from)) return p;
  const all = isAll(p, voice), lo = firstFrom(p.notes, from), hi = firstFrom(p.notes, to);
  const kept = p.notes.slice(lo, hi).filter(n => !(all || n.voice === voice));
  if (kept.length === hi - lo) return p;
  return { ...p, notes: [...p.notes.slice(0, lo), ...kept, ...p.notes.slice(hi)] };
}

export function transpose(p: Perf, from: number, to: number, by: number, voice?: Voice): Perf {
  if (!(to > from) || !by) return p;
  const all = isAll(p, voice), lo = firstFrom(p.notes, from), hi = firstFrom(p.notes, to);
  const notes = p.notes.slice();
  for (let i = lo; i < hi; i++) {
    const n = notes[i];
    if (all || n.voice === voice) notes[i] = { ...n, pitch: clampPitch(n.pitch + by) };
  }
  return { ...p, notes };
}

export function pitches(p: Perf, from: number, to: number, values: number[], voice?: Voice): Perf {
  if (!(to > from) || !values.length) return p;
  const notes = p.notes.slice();
  onsetsIn(p, from, to, voice).forEach((o, k) => {
    const by = values[k % values.length] - Math.min(...o.map(i => notes[i].pitch));
    for (const i of o) notes[i] = { ...notes[i], pitch: clampPitch(notes[i].pitch + by) };
  });
  return { ...p, notes };
}

// ─── Moving time ────────────────────────────────────────────────────────────

/**
 * The stretch [from, to] of a voice (or all) to new times by `map` (rising, from
 * `from` to `end`), what follows on by the change; each moved note's length
 * times `stretch` at its old time. Every voice: the flags, the controllers and
 * the clock too.
 */
export function retime(p: Perf, from: number, to: number, end: number, map: (t: number) => number, voice?: Voice, stretch?: (t: number) => number): Perf {
  if (!(to > from)) return p;
  const all = isAll(p, voice), shift = end - to;
  const move = (t: number) => (t < from ? t : t >= to ? t + shift : map(t));

  const still: Note[] = [], moved: Note[] = [];
  for (const n of p.notes) {
    if (!(all || n.voice === voice) || n.at < from) { (all ? moved : still).push(n); continue; }
    const at = move(n.at), dur = n.at < to && stretch ? n.dur * stretch(n.at) : n.dur;
    moved.push({ ...n, at, dur });
  }
  const notes = all ? moved : merge(still, moved);

  const passes = p.passes.map((mine, v) => {
    if (!(all || v === voice)) return mine;
    return mine.map(s => (s.end <= from ? s : { ...s, at: move(s.at), end: move(s.end) }));
  }) as [Pass[], Pass[]];

  if (!all) {
    const last = passes[voice!][passes[voice!].length - 1];
    return { ...p, notes, passes, length: Math.max(p.length, last ? last.end : 0) };
  }
  const flags: Flag[] = p.flags.map(f => (f.at < from ? f : { ...f, at: move(f.at) }));
  const ctl: Ctl[] = p.ctl.map(c => (c.at < from ? c : { ...c, at: move(c.at) }));
  return { ...p, notes, passes, flags, ctl, length: p.length + shift };
}

/** Speed as a shape: time t goes to from + ∫ du / s(u), s straight between the values */
export function pace(p: Perf, from: number, to: number, values: number[], voice?: Voice): Perf {
  if (!(to > from) || !values.length || values.some(v => !(v > 0))) return p;
  const speeds = values.length === 1 ? [values[0], values[0]] : values;
  const k = speeds.length - 1, seg = (to - from) / k;
  const s = speeds.map(v => v / 100);
  // where each knot lands
  const land = [from];
  for (let i = 0; i < k; i++) land.push(land[i] + span(s[i], s[i + 1], seg, seg));
  const map = (t: number) => {
    const i = Math.min(k - 1, Math.max(0, Math.floor((t - from) / seg)));
    return land[i] + span(s[i], s[i + 1], seg, t - (from + i * seg));
  };
  const stretch = (t: number) => 100 / shapeAt(speeds, from, to, t);
  return retime(p, from, to, land[k], map, voice, stretch);
}

/** ∫ over [0, x] of du / s(u), s going straight from a to b over a segment of length L */
function span(a: number, b: number, L: number, x: number): number {
  if (Math.abs(b - a) < 1e-9) return x / a;
  const k = (b - a) / L;
  return Math.log((a + k * x) / a) / k;
}

/** The timing as a pattern: each onset's gap to the next from the values, the first onset where it was */
export function gaps(p: Perf, from: number, to: number, values: number[], voice?: Voice): Perf {
  if (!(to > from) || !values.length || values.some(v => !(v > 0))) return p;
  const os = onsetsIn(p, from, to, voice);
  if (!os.length) return p;
  // old → new at each onset, and the stretch's end after the last
  const olds = [from], news = [from];
  let t = p.notes[os[0][0]].at;
  os.forEach((o, k) => {
    const at = p.notes[o[0]].at;
    if (at > olds[olds.length - 1]) { olds.push(at); news.push(t); }
    t += values[k % values.length];
  });
  olds.push(to); news.push(t);
  const map = (x: number) => {
    let lo = 0, hi = olds.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (olds[mid] <= x) lo = mid; else hi = mid; }
    const d = olds[hi] - olds[lo];
    return d > 0 ? news[lo] + ((x - olds[lo]) / d) * (news[hi] - news[lo]) : news[lo];
  };
  return retime(p, from, to, t, map, voice);
}

// ─── Putting passes in ──────────────────────────────────────────────────────

/**
 * The clip in at `at`, into a voice (absent: the first, and every voice and the
 * clock make room). What was at `at` goes to `land`: the clip's end, unless
 * given (a clip in place of a stretch as long as itself lands what follows
 * exactly where it was, with no rounding of one sum against another).
 */
export function insert(p: Perf, at: number, clip: Clip, voice?: Voice, land = at + clip.length): Perf {
  const L = clip.length;
  if (!(L > 0)) return p;
  const all = isAll(p, voice), into: Voice = voice ?? 0;
  const later = (t: number) => (t >= at ? land + (t - at) : t);

  let next = 0;
  for (const n of p.notes) if (n.id >= next) next = n.id + 1;
  const added: Note[] = clip.notes.map(n => ({ ...n, id: next++, voice: into, at: at + n.at }));
  const [blooms, named] = bringBlooms(p, clip);

  const before: Note[] = [], after: Note[] = [];
  for (const n of p.notes) {
    if (n.at < at) before.push(n);
    else if (all || n.voice === voice) after.push({ ...n, at: later(n.at) });
    else before.push(n);   // the other voice, which stays where it was
  }
  const moved = [...added, ...after];
  const notes = all ? [...before, ...moved] : merge(before, moved);

  const passes = p.passes.map((mine, v) => {
    if (!(all || v === voice)) return mine;
    const out: Pass[] = [];
    for (const s of mine) {
      if (s.end <= at) out.push(s);
      else if (s.at >= at) out.push({ ...s, at: later(s.at), end: later(s.end) });
      else out.push({ ...s, end: at }, { ...s, at: land, end: later(s.end) });   // cut into: either side of what comes in
    }
    if (v !== into) return out;
    const i = firstFrom(out, at);
    // the clip's last pass ends where what follows begins
    const coming = clip.passes.map(s => ({ ...s, bloom: named(s.bloom), voice: into, at: at + s.at, end: s.end >= L ? land : at + s.end }));
    return [...out.slice(0, i), ...coming, ...out.slice(i)];
  }) as [Pass[], Pass[]];

  if (!all) {
    const last = passes[into][passes[into].length - 1];
    return { ...p, notes, passes, blooms, length: Math.max(p.length, last ? last.end : 0) };
  }
  return {
    ...p, notes, passes, blooms,
    flags: p.flags.map(f => ({ ...f, at: later(f.at) })),
    ctl: p.ctl.map(c => ({ ...c, at: later(c.at) })),
    length: p.length + (land - at),
  };
}

/** A bloom's text, made once: blooms are compared by it */
const texts = new WeakMap<BloomJSON, string>();
function textOf(b: BloomJSON): string {
  let s = texts.get(b);
  if (s === undefined) { s = JSON.stringify(b); texts.set(b, s); }
  return s;
}

/**
 * The blooms a clip brings, among those the edit has added (one already there
 * is used again), and how its passes' blooms are named in the performance
 */
function bringBlooms(p: Perf, clip: Clip): [BloomJSON[], (ix: number) => number] {
  if (!clip.blooms?.length) return [p.blooms, ix => ix];
  const blooms = p.blooms.slice();
  const at = clip.blooms.map(b => {
    const s = textOf(b), j = blooms.findIndex(x => textOf(x) === s);
    return j >= 0 ? j : blooms.push(b) - 1;
  });
  return [blooms, ix => (ix <= -2 && at[clipBloom(ix)] !== undefined ? p.bloomBase + at[clipBloom(ix)] : ix)];
}

/** A stretch of a voice as a clip: its notes and passes, from its start, and any blooms the edit added that they name */
export function clipOf(p: Perf, from: number, to: number, voice: Voice): Clip {
  const notes: Clip['notes'] = [];
  for (let i = firstFrom(p.notes, from); i < p.notes.length && p.notes[i].at < to; i++) {
    const { id: _id, voice: v, ...n } = p.notes[i];
    if (v === voice) notes.push({ ...n, at: n.at - from });
  }
  const blooms: BloomJSON[] = [], mine = new Map<number, number>();
  const own = (ix: number) => {
    if (ix < p.bloomBase || !p.blooms[ix - p.bloomBase]) return ix;
    if (!mine.has(ix)) mine.set(ix, blooms.push(p.blooms[ix - p.bloomBase]) - 1);
    return clipBloom(mine.get(ix)!);
  };
  const passes = p.passes[voice]
    .filter(s => s.end > from && s.at < to)
    .map(({ voice: _v, ...s }) => ({ ...s, bloom: own(s.bloom), at: Math.max(s.at, from) - from, end: Math.min(s.end, to) - from }));
  return { length: to - from, notes, passes, ...(blooms.length ? { blooms } : {}) };
}

/** A clip's onsets: the loudest velocity of each, and the gap from each to the next (the last to the clip's end) */
export function clipPattern(c: Clip): { vels: number[]; gaps: number[] } {
  const os = onsetsOf(c.notes);
  const at = os.map(o => c.notes[o[0]].at);
  return {
    vels: os.map(o => Math.max(...o.map(i => c.notes[i].vel))),
    gaps: at.map((t, i) => (i + 1 < at.length ? at[i + 1] : c.length) - t),
  };
}
