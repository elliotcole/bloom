// A performance, as the editor holds it: a take lifted into its notes, with the
// passes of each voice drawn over them. The notes are the ground: a pass is a
// span of the clock that names the bloom it played, nothing more, so a cut can
// fall anywhere. Each voice has its own passes and can be cut on its own.
//
// An edit is a list of operations on that (a cut, a flag, the shapes in
// ops.ts), applied in order.
// The take itself is never changed; undo is the list one shorter.

import type { TakeEvent, TakeFile } from '../audio/take';
import type { BloomJSON } from '../io/garden-io';
import { cueMessage, nameMessage } from '../lib/tuning';
import { drop, gaps, insert, loud, pace, pitches, transpose, vels } from './ops';
import type { ShapeOp } from './ops';

/** A light and its note are this close (ms) */
const LIT_MS = 40;

export type Voice = 0 | 1;

export interface Note {
  id: number;
  voice: Voice;
  at: number;      // ms, when it sounds
  dur: number;     // ms, to its note-off
  pitch: number;
  vel: number;
  chan: number;
  ix: number;      // its place in the bloom (the light it lit), -1 if none
  pass: number;    // the id of the pass it was played in
}

/** A pass of a voice: from `at` up to `end`, the bloom it played (index in bloomList, -1 none) */
export interface Pass {
  id: number;      // its number in the take as recorded, from 0
  voice: Voice;
  at: number;
  end: number;
  bloom: number;
}

/** Whatever else goes out: controllers, the tuning (to the helper and the piano) */
export interface Ctl { at: number; e: TakeEvent; tag?: 'name' | 'cue' }

export interface Flag { at: number; name: string }

export interface Perf {
  notes: Note[];              // in time order
  passes: [Pass[], Pass[]];   // each voice's, in time order
  ctl: Ctl[];
  flags: Flag[];
  length: number;             // ms
  voices: 1 | 2;
  bloomBase: number;          // how many blooms the take has: a pass's bloom from here on is one of `blooms`
  blooms: BloomJSON[];        // the blooms the edit has added (passes reworked by Bloom's verbs)
}

export type Op =
  /** Take out from `from` up to `to` and close the gap: one voice, or (no voice) every voice and the clock with them */
  | { op: 'cut'; from: number; to: number; voice?: Voice }
  | { op: 'flag'; at: number; name: string }
  | { op: 'unflag'; at: number }
  /** Several done as one step (Bloom's verbs on a run of passes), in order */
  | { op: 'group'; ops: Op[]; label: string }
  | ShapeOp;

// ─── Lifting a take ─────────────────────────────────────────────────────────

const NAME_TAG = nameMessage('x').slice(0, 5).join(',');
const CUE_TAG = cueMessage(null, 0).slice(0, 5).join(',');

interface Lit { at: number; voice: Voice; ix: number; pass: Pass; bloom: number }

const isOn = (m: number[]) => (m[0] & 0xf0) === 0x90 && m[2] > 0;
const isOff = (m: number[]) => (m[0] & 0xf0) === 0x80 || ((m[0] & 0xf0) === 0x90 && m[2] === 0);

/** The take as notes and passes */
export function liftTake(t: TakeFile): Perf {
  const events = t.events;
  const passes: [Pass[], Pass[]] = [[], []];
  const lits: Lit[] = [];
  const ctl: Ctl[] = [];
  const raw: { at: number; dur: number; pitch: number; vel: number; chan: number }[] = [];
  const open = new Map<number, number>();   // channel and pitch → the note sounding
  // the session's own bloom is the first voice's; a take with none marked so uses whatever was shown
  const anyMain = events.some(e => e[1] === 'b' && e[4] === 1);
  const shown = [-1, -1];
  let partial = false;

  for (const e of events) {
    switch (e[1]) {
      case 'b': if (e[4] === 1 || !anyMain) shown[0] = e[2]; break;
      case 'v': shown[1] = e[2]; break;
      case 'n': case 'w': {
        const voice: Voice = e[1] === 'n' ? 0 : 1, mine = passes[voice];
        if (!mine.length && e[2] !== 0) partial = partial || voice === 0;   // the take began inside a pass
        if (e[2] === 0 || !mine.length) mine.push({ id: 0, voice, at: e[0], end: e[0], bloom: shown[voice] });
        lits.push({ at: e[0], voice, ix: e[2], pass: mine[mine.length - 1], bloom: shown[voice] });
        break;
      }
      case 'm': {
        const m = e[2], at = e[0] + e[3], key = (m[0] & 0x0f) * 128 + m[1];
        if (isOn(m)) {
          open.set(key, raw.length);
          raw.push({ at, dur: -1, pitch: m[1], vel: m[2], chan: m[0] & 0x0f });
        } else if (isOff(m)) {
          const i = open.get(key);
          if (i !== undefined) { raw[i].dur = Math.max(0, at - raw[i].at); open.delete(key); }
        } else ctl.push({ at: e[0], e });
        break;
      }
      case 'p': ctl.push({ at: e[0], e }); break;
      case 'h': {
        const tag = (t.sysex[e[2]] ?? []).slice(0, 5).join(',');
        ctl.push({ at: e[0], e, ...(tag === NAME_TAG ? { tag: 'name' as const } : tag === CUE_TAG ? { tag: 'cue' as const } : {}) });
        break;
      }
    }
  }
  raw.sort((a, b) => a.at - b.at);
  for (const n of raw) if (n.dur < 0) n.dur = Math.max(0, t.length - n.at);

  // each note to the light it lit: the nearest, one whose bloom has that pitch there first
  const found: (Lit | null)[] = [];
  let l = 0;
  for (const n of raw) {
    while (l < lits.length && lits[l].at < n.at - LIT_MS) l++;
    let best: Lit | null = null, bestScore = Infinity;
    for (let j = l; j < lits.length && lits[j].at <= n.at + LIT_MS; j++) {
      const c = lits[j], notes = t.blooms[c.bloom]?.notes;
      const right = Array.isArray(notes) && notes[c.ix] === n.pitch;
      const score = Math.abs(c.at - n.at) + (right ? 0 : 1000);
      if (score < bestScore) { best = c; bestScore = score; }
    }
    found.push(best);
    if (best && n.at < best.pass.at) best.pass.at = n.at;   // a pass starts with its first note
  }
  // notes before a voice's first pass (a take starts on a note: its light came before) get one of their own
  const first = raw.findIndex((_, i) => !found[i]);
  if (first >= 0 && partial && raw[first].at < passes[0][0].at) passes[0][0].at = raw[first].at;
  else if (first >= 0 && (!passes[0].length || raw[first].at < passes[0][0].at)) {
    passes[0].unshift({ id: 0, voice: 0, at: raw[first].at, end: 0, bloom: bloomAt(t, raw[first].at) });
  }
  for (const mine of passes) {
    mine.forEach((p, i) => { p.id = i; if (i && p.at < mine[i - 1].at) p.at = mine[i - 1].at; });
    mine.forEach((p, i) => { p.end = i + 1 < mine.length ? mine[i + 1].at : Math.max(p.at, t.length); });
  }

  const notes: Note[] = raw.map((n, id) => {
    const lit = found[id];
    const pass = lit ? lit.pass : passes[0][passAt(passes[0], n.at)];
    return { id, voice: lit ? lit.voice : 0, at: n.at, dur: n.dur, pitch: n.pitch, vel: n.vel, chan: n.chan, ix: lit ? lit.ix : -1, pass: pass ? pass.id : -1 };
  });
  return { notes, passes, ctl, flags: [], length: t.length, voices: passes[1].length ? 2 : 1, bloomBase: t.blooms.length, blooms: [] };
}

/** The session's bloom in view at `ms` (the last shown up to then), -1 none */
function bloomAt(t: TakeFile, ms: number): number {
  let ix = -1;
  for (const e of t.events) {
    if (e[0] > ms + LIT_MS) break;
    if (e[1] === 'b') ix = e[2];
  }
  return ix;
}

/** The pass a moment falls in: the last that starts at or before it (the first, before them all); -1 with none */
export function passAt(passes: Pass[], ms: number): number {
  let lo = 0, hi = passes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (passes[mid].at <= ms) lo = mid + 1; else hi = mid;
  }
  return passes.length ? Math.max(0, lo - 1) : -1;
}

/** The first note at or after `ms` (notes in time order) */
export function noteFrom(notes: Note[], ms: number): number {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].at < ms) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ─── Operations ─────────────────────────────────────────────────────────────

export function apply(p: Perf, op: Op): Perf {
  switch (op.op) {
    case 'cut': return cut(p, op.from, op.to, op.voice);
    case 'flag': return { ...p, flags: [...p.flags.filter(f => !sameTime(f.at, op.at)), { at: op.at, name: op.name }].sort((a, b) => a.at - b.at) };
    case 'unflag': return { ...p, flags: p.flags.filter(f => !sameTime(f.at, op.at)) };
    case 'loud': return loud(p, op.from, op.to, op.values, op.voice);
    case 'vels': return vels(p, op.from, op.to, op.values, op.voice);
    case 'pace': return pace(p, op.from, op.to, op.values, op.voice);
    case 'gaps': return gaps(p, op.from, op.to, op.values, op.voice);
    case 'insert': {
      if (op.to === undefined) return insert(p, op.at, op.clip, op.voice);
      // in place of a stretch: one as long as the clip leaves what follows exactly where it was
      const same = Math.abs(op.at + op.clip.length - op.to) < 1e-6;
      return insert(cut(p, op.at, op.to, op.voice), op.at, op.clip, op.voice, same ? op.to : undefined);
    }
    case 'drop': return drop(p, op.from, op.to, op.voice);
    case 'transpose': return transpose(p, op.from, op.to, op.by, op.voice);
    case 'pitches': return pitches(p, op.from, op.to, op.values, op.voice);
    case 'group': return op.ops.reduce(apply, p);
  }
}

/**
 * A transpose of the same stretch and voice as the last op, made one with it:
 * the op that stands for both (null: they come to nothing), or undefined if
 * they aren't of a piece
 */
export function joined(last: Op | undefined, op: Op): Op | null | undefined {
  if (!last || last.op !== 'transpose' || op.op !== 'transpose') return undefined;
  if (!sameTime(last.from, op.from) || !sameTime(last.to, op.to) || last.voice !== op.voice) return undefined;
  const by = last.by + op.by;
  return by === 0 ? null : { ...last, by };
}

/** Every bloom a pass can name: the take's, then those the edit added */
export function bloomList(t: TakeFile, p: Perf): BloomJSON[] {
  return p.blooms.length ? [...t.blooms.slice(0, p.bloomBase), ...p.blooms] : t.blooms;
}

export const sameTime = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

function cut(p: Perf, from: number, to: number, voice?: Voice): Perf {
  const d = to - from;
  if (!(d > 0)) return p;
  const all = voice === undefined || p.voices === 1;
  const hit = (v: Voice) => all || v === voice;
  // what follows comes back by the stretch's length: what was at its end to exactly its start
  const back = (at: number) => from + (at - to);
  const move = (at: number) => (at >= to ? back(at) : at);

  const notes: Note[] = [];
  for (const n of p.notes) {
    if (!hit(n.voice) || n.at < from) notes.push(n);
    else if (n.at >= to) notes.push({ ...n, at: back(n.at) });
  }
  if (!all) notes.sort((a, b) => a.at - b.at);   // one voice moved against the other

  const passes = p.passes.map((mine, v) => {
    if (!hit(v as Voice)) return mine;
    const out: Pass[] = [];
    for (const s of mine) {
      const at = s.at < from ? s.at : s.at >= to ? back(s.at) : from;
      const end = s.end <= from ? s.end : s.end >= to ? back(s.end) : from;
      if (end > at) out.push(at === s.at && end === s.end ? s : { ...s, at, end });
    }
    return out;
  }) as [Pass[], Pass[]];

  if (!all) return { ...p, notes, passes };
  return {
    ...p, notes, passes,
    flags: p.flags.filter(f => f.at < from || f.at >= to).map(f => ({ ...f, at: move(f.at) })),
    ctl: [
      ...p.ctl.filter(c => c.at < from),
      ...inForce(p.ctl.filter(c => c.at >= from && c.at < to)).map(c => ({ ...c, at: from })),
      ...p.ctl.filter(c => c.at >= to).map(c => ({ ...c, at: back(c.at) })),
    ],
    length: p.length - d,
  };
}

/**
 * Of the controllers and tunings in a stretch that's going, the ones still in
 * force at its end: each controller's last value, the piano's last tuning, the
 * helper's (its name and what followed; a cue is a sound, and goes)
 */
function inForce(cs: Ctl[]): Ctl[] {
  const last = new Map<string, Ctl>();
  let helper: Ctl[] = [];
  for (const c of cs) {
    const e = c.e;
    if (e[1] === 'p') last.set('p', c);
    else if (e[1] === 'm') {
      const m = e[2];
      last.set((m[0] & 0xf0) === 0xb0 ? `c${m[0]}.${m[1]}` : `m${m[0]}`, c);
    } else if (c.tag !== 'cue') {
      if (c.tag === 'name') helper = [];
      helper.push(c);
    }
  }
  return [...last.values(), ...helper].sort((a, b) => cs.indexOf(a) - cs.indexOf(b));
}

// ─── An edit: a take's performance and what's been done to it ───────────────

export class Edit {
  readonly base: Perf;
  ops: Op[];
  undone: Op[] = [];
  perf: Perf;
  /** The performance before the last op, while it's known (amend starts from it) */
  private before: Perf | null = null;

  constructor(base: Perf, ops: Op[] = []) {
    this.base = base;
    this.ops = [...ops];
    this.perf = this.ops.reduce(apply, base);
  }

  do(op: Op): void {
    this.ops.push(op);
    this.undone = [];
    this.before = this.perf;
    this.perf = apply(this.perf, op);
  }

  /** The last op replaced by `op` (null: taken away, not to be redone) */
  amend(op: Op | null): void {
    if (!this.ops.length) { if (op) this.do(op); return; }
    const before = this.before ?? this.ops.slice(0, -1).reduce(apply, this.base);
    this.ops.pop();
    this.undone = [];
    if (op) { this.ops.push(op); this.before = before; this.perf = apply(before, op); }
    else { this.before = null; this.perf = before; }
  }

  /** Take the last operation back; it's returned (null with none) */
  undo(): Op | null {
    const op = this.ops.pop();
    if (!op) return null;
    this.undone.push(op);
    this.perf = this.before ?? this.ops.reduce(apply, this.base);
    this.before = null;
    return op;
  }

  redo(): Op | null {
    const op = this.undone.pop();
    if (!op) return null;
    this.ops.push(op);
    this.before = this.perf;
    this.perf = apply(this.perf, op);
    return op;
  }
}

/** An edit as a file: the take it's of, and the operations */
export interface EditFile {
  kind: 'bloom-edit';
  version: 1;
  take: { recordedAt: number; length: number; events: number };
  ops: Op[];
}

export function editFile(t: TakeFile, ops: Op[]): EditFile {
  return { kind: 'bloom-edit', version: 1, take: { recordedAt: t.recordedAt, length: t.length, events: t.events.length }, ops };
}

/** Whether an edit is of this take */
export function editIsOf(f: EditFile, t: TakeFile): boolean {
  return f.take.recordedAt === t.recordedAt && f.take.events === t.events.length && sameTime(f.take.length, t.length);
}

// ─── Back to a take ─────────────────────────────────────────────────────────

/**
 * The edited performance as a take, to play, to write as a score, to load in
 * Bloom: its notes, the bloom shown at each pass, each note's light
 */
export function renderTake(t: TakeFile, p: Perf): TakeFile {
  const blooms = bloomList(t, p);
  const out: [number, number, TakeEvent][] = [];   // time, order among equals, the event
  const garden = t.events.find(e => e[1] === 'g');
  if (garden) out.push([0, 0, [0, 'g', garden[2] as number]]);
  for (const c of p.ctl) {
    const e = [...c.e] as TakeEvent;
    e[0] = c.at;
    out.push([c.at, 0, e]);
  }
  if (p.voices === 1) out.push([0, 1, [0, 'v', -1]]);
  p.passes.forEach((mine, v) => {
    for (const s of mine) out.push([s.at, 1, v === 0 ? [s.at, 'b', s.bloom, 1, 1] : [s.at, 'v', s.bloom]]);
  });
  const tick = [0, 0];
  let lastLit = '';
  for (const n of p.notes) {
    if (n.ix >= 0) {
      const key = `${n.voice}.${n.ix}.${Math.round(n.at)}`;   // a chord lights its place once
      if (key !== lastLit) out.push([n.at, 2, [n.at, n.voice === 0 ? 'n' : 'w', n.ix, tick[n.voice]++]]);
      lastLit = key;
    }
    out.push([n.at, 3, [n.at, 'm', [0x90 | n.chan, n.pitch, n.vel], 0]]);
    const off = Math.min(n.at + n.dur, p.length);
    out.push([off, -1, [off, 'm', [0x80 | n.chan, n.pitch, 0], 0]]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { ...t, blooms, saved: false, ended: true, length: p.length, events: out.map(x => x[2]) };
}

// ─── What the pictures are drawn from ───────────────────────────────────────

/** How far a pass's bloom is from the one before: 0 the same, 1 the same notes, 2 half of them or more, 3 fewer */
export function seam(a: unknown, b: unknown, same: boolean): 0 | 1 | 2 | 3 {
  if (same) return 0;
  const x = flat(a), y = flat(b);
  if (x.length === y.length && x.every((n, i) => n === y[i])) return 1;
  const had = new Set(x);
  const shared = y.filter(n => had.has(n)).length;
  return shared * 2 >= Math.max(x.length, y.length, 1) ? 2 : 3;
}

function flat(notes: unknown): number[] {
  return Array.isArray(notes) ? (notes as unknown[]).flat(4).filter((n): n is number => typeof n === 'number') : [];
}

export interface Column { lo: number; hi: number; count: number; vel: number; pace: number }

/**
 * The whole performance in `cols` columns of the clock: each one's range of
 * pitch, how many notes, their mean velocity, and its pace (onsets a second,
 * from the middle gap between them; 0 with fewer than two)
 */
export function columns(notes: Note[], length: number, cols: number): Column[] {
  const out: Column[] = Array.from({ length: cols }, () => ({ lo: Infinity, hi: -Infinity, count: 0, vel: 0, pace: 0 }));
  const gaps: number[][] = Array.from({ length: cols }, () => []);
  let prev = -Infinity;
  for (const n of notes) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((n.at / Math.max(length, 1)) * cols)));
    const col = out[c];
    col.lo = Math.min(col.lo, n.pitch);
    col.hi = Math.max(col.hi, n.pitch);
    col.count++;
    col.vel += n.vel;
    if (n.at - prev > 8) { if (prev > -Infinity) gaps[c].push(n.at - prev); prev = n.at; }
  }
  out.forEach((col, c) => {
    if (col.count) col.vel /= col.count;
    const g = gaps[c].sort((a, b) => a - b);
    if (g.length) col.pace = 1000 / g[g.length >> 1];
  });
  return out;
}
