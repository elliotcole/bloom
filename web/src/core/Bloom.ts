// Core Bloom class — ported from Bloom.sc

import type { NoteVal, NoteArray } from '../lib/arrays';
import { keyRootOf } from '../lib/tuning';
import { chordOrder, countOf, isDiatonic, makeIv, mapCount, octaveOf, widthOf } from '../lib/intervals';
import type { Tuning } from '../lib/tuning';
import type { Figure } from '../lib/figures';
import { isRunFigure, isSlotFigure, isFigure, figureSlot } from '../lib/figures';
import { keyToDegree, degreeToKey } from '../lib/numbers';
import {
  wrapAt, wrapExtend, flatNotes, coin, exprand, rrand,
  scramble, perfectShuffle, mirror as mirrorArr, stutter as stutterArr,
  sputter as sputterArr, curdle as curdleArr, lace, slide as slideArr,
  pyramid as pyramidArr, permute as permuteArr, rotate as rotateArr,
  matchNesting, resamp1, normalizeSum, indexOfDoubles,
  moveDoublesUpOctave as moveDoublesUpOctaveArr,
} from '../lib/arrays';
import {
  spell, spellToPC, justAbove, justBelow,
  softRound, invertChord, invertMean as invertMeanArr,
  negHarmony as negHarmonyFn,
} from '../lib/numbers';
import type { Scale } from '../lib/scales';
import {
  SCALES, mostSimilarTo, slantMatch, fitByDirection, scaleTranspose,
  notesToScale, nearestInScaleUniqueArr, keyToDegreeArr, degreeToKeyArr, nameScaleDegrees, pcsKey,
} from '../lib/scales';

// ─── Class-level defaults ──────────────────────────────────────────────────────

export const BloomDefaults = {
  lowestPossibleNote: 20,
  highestPossibleNote: 100,
  lowestSeedNote: 50,
  highestSeedNote: 100,
  timeRangeLow: 0.1,
  timeRangeHi: 0.5,
  legato: 2,
  sustain: 4 as number | null,
  maxChan: 0,
  defaultChan: 0,
};

/** One step of the intervals array: 0 = nothing added, a list adds several notes */
export type IntervalVal = number | number[];

/** Notes added by the intervals array sound this much quieter than their parent */
export const ADDED_NOTE_VELOCITY = 0.85;

/** Something that sounds for a note: its own pitches, those the intervals add, or a step of its figure */
export interface Sound {
  /** beats after the note's onset */
  at: number;
  notes: number[];
  vel: number;
  chan: number;
  /** beats held */
  gate: number;
  added?: boolean;
  figure?: boolean;
}

// Pools the random interval operations draw from (lib/intervals: diatonic ones are steps + 100)
const CHROMATIC_INTERVALS = [-12, -9, -8, -7, -5, -4, -3, 3, 4, 5, 7, 8, 9, 12];
const DIATONIC_INTERVALS = [-7, -5, -4, -3, -2, 2, 3, 4, 5, 7].map(k => makeIv(true, k));
const MAX_BAKED_LENGTH = 256;

// An intervals step as its added intervals (0s dropped), and back: [] → 0, [x] → x
const ivArr = (s: IntervalVal): number[] => (Array.isArray(s) ? s : [s]).filter(x => x !== 0);
function ivVal(a: number[]): IntervalVal {
  const u = [...new Set(a.filter(x => x !== 0).map(x => mapCount(x, n => n)))]
    .sort(chordOrder);
  return u.length === 0 ? 0 : u.length === 1 ? u[0] : u;
}
const ivKey = (s: IntervalVal): string => JSON.stringify(ivVal(ivArr(s)));
/** How far apart two steps are: per added note, plus an octave per note one has and the other lacks */
function ivDist(a: IntervalVal, b: IntervalVal): number {
  const x = ivArr(a).map(widthOf).sort((p, q) => p - q), y = ivArr(b).map(widthOf).sort((p, q) => p - q);
  let d = 12 * Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) d += Math.abs(x[i] - y[i]);
  return d;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// ─── Lists, patterns, verbs ───────────────────────────────────────────────────

/** The parallel lists of a bloom: pitches, times, velocities, channels, intervals */
export type ListKey = 'notes' | 'time' | 'vel' | 'chan' | 'iv';

/** Order and length patterns: identical on any list, or on whole notes */
export type PatternOp =
  | 'scramble' | 'shuffle' | 'mirror' | 'rotate<' | 'rotate>'
  | 'stutter' | 'sputter' | 'braid' | 'pyramid';

const PATTERNS: Record<PatternOp, <T>(arr: T[]) => T[]> = {
  scramble: arr => scramble(arr),
  // a perfect shuffle of an odd length would drop the middle element
  shuffle: arr => perfectShuffle(arr.length % 2 ? [...arr, arr[0]] : arr),
  mirror: arr => mirrorArr(arr),
  'rotate<': arr => rotateArr(arr, -1),
  'rotate>': arr => rotateArr(arr, 1),
  stutter: arr => stutterArr(arr, 2),
  sputter: arr => sputterArr(arr, 0.3),
  braid: arr => slideArr(arr, 3),
  pyramid: arr => pyramidArr(arr, 1),
};

/** Value verbs shared by the time, velocity and channel lists (see shapeList) */
export type ListVerb =
  | 'mutate' | 'mutateWild'
  | 'nudgeDown' | 'nudgeUp' | 'octaveDown' | 'octaveUp' | 'stepDown' | 'stepUp'
  | 'breezeDown' | 'breezeUp'
  | 'converge' | 'diverge' | 'unify' | 'invert' | 'invertMid' | 'tiltDown' | 'tiltUp' | 'tilt' | 'curve'
  | 'sortUp' | 'sortDown' | 'fewer' | 'more' | 'quantize' | 'renew' | 'renewWild'
  | 'dropLast' | 'addFromPalette' | 'addRandom' | 'divide';

/** A note with everything that sounds with it */
export interface NoteEvent {
  note: NoteVal;
  vel: number;
  time: number;
  chan: number;
  iv: IntervalVal;
  fig?: Figure;
}

/** Step sizes for the whole-bloom gestures (calm, intensify, vary) */
export const GESTURE = {
  pitchNotes: 2,     // notes moved one scale step per calm / intensify
  rhythmEdits: 1,    // merges (calm) or splits (intensify) per press
  level: 0.06,       // loudness change per press, as a fraction of the mean
  contrast: 0.15,    // accent contrast change per press
  chanChance: 0.5,   // chance a press also moves one note's channel
  vary: 0.18,        // share of notes vary touches
  breeze: 0.3,       // share of notes a breeze moves per press (on average; at least one)
  breezePull: 2,     // extra likelihood for a just-moved note: 2 → three times as likely
  breezeMemory: 0.5, // how much of that pull is left after each further press
  divide: 0.2,       // share of the durations time-mode r divides (at least one)
  varyVel: 6,        // largest velocity change from vary
};

const MIN_TIME = 0.02;
const roundTime = (t: number): number => Math.round(t * 1e6) / 1e6;
const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// The last few scales slant visited (as pitch-class keys), which it avoids
// returning to, so repeated slants travel instead of circling
const SLANT_TRAIL = 6;
const _slantTrail: string[] = [];
// Likewise for steps round the circle of fifths, while they keep one direction
const _stepTrail: string[] = [];
let _stepDir = 0;
const mean = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;

/** Index of the palette value nearest `t` by ratio, so 3/8 lies between 1/4 and 1/2 proportionally */
function nearestByRatio(pal: number[], t: number): number {
  const d = (p: number) => Math.abs(Math.log(Math.max(t, 1e-6) / p));
  return pal.reduce((best, p, i) => (d(p) < d(pal[best]) ? i : best), 0);
}

function nearestLinear(pal: number[], v: number): number {
  return pal.reduce((best, p, i) => (Math.abs(v - p) < Math.abs(v - pal[best]) ? i : best), 0);
}

/** Most common value; ties go to the lower */
function modeOf(arr: number[]): number {
  const counts = new Map<number, number>();
  arr.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best = arr[0];
  counts.forEach((n, v) => {
    const bestN = counts.get(best) ?? 0;
    if (n > bestN || (n === bestN && v < best)) best = v;
  });
  return best;
}

/**
 * About `share` of the indices 0..n-1, and always at least one. `heat` leans
 * the choice toward some indices without excluding the rest: each index's
 * chance is proportional to 1 + GESTURE.breezePull × its heat, scaled so the
 * expected count stays share × n.
 */
function someIndices(n: number, share: number, heat: number[] = []): Set<number> {
  const w = Array.from({ length: n }, (_, i) => 1 + GESTURE.breezePull * (heat[i] ?? 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const picked = new Set<number>();
  w.forEach((wi, i) => { if (coin(Math.min(0.95, (share * n * wi) / sum))) picked.add(i); });
  if (picked.size === 0 && n > 0) picked.add(weightedIndex(w));
  return picked;
}

/** Random index, chosen in proportion to the weights */
function weightedIndex(weights: number[]): number {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Merge a list's distinct values down to at most maxDistinct: the closest
 * neighbouring pair merges, the rarer into the commoner. Values `skip` accepts
 * (rests) are left alone and don't count.
 */
function clusterValues(
  arr: number[], maxDistinct: number,
  dist: (a: number, b: number) => number, skip: (v: number) => boolean = () => false,
): number[] {
  let out = [...arr];
  for (;;) {
    const pal = [...new Set(out.filter(v => !skip(v)))].sort((a, b) => a - b);
    if (pal.length <= Math.max(1, maxDistinct)) return out;
    let bestI = 0;
    for (let i = 1; i < pal.length - 1; i++) {
      if (dist(pal[i], pal[i + 1]) < dist(pal[bestI], pal[bestI + 1])) bestI = i;
    }
    const [a, b] = [pal[bestI], pal[bestI + 1]];
    const count = (v: number) => out.filter(x => x === v).length;
    const [drop, keep] = count(a) <= count(b) ? [a, b] : [b, a];
    out = out.map(v => (v === drop ? keep : v));
  }
}

const ratioDist = (a: number, b: number) => Math.abs(Math.log(b / a));
const linearDist = (a: number, b: number) => Math.abs(b - a);

// ─── Bloom class ──────────────────────────────────────────────────────────────

export class Bloom {
  notes: NoteArray;
  velocities: number[];
  timeIntervals: number[];
  chans: number[];
  /**
   * Notes added at playback, as distances from each note: [0, 0, 7] gives every
   * third note a fifth above it. Cycles at its own length; never alters `notes`.
   */
  intervals: IntervalVal[];
  /** true: intervals count steps of the scale; false: semitones */
  intervalsDiatonic: boolean;
  /**
   * What a note plays instead of itself (lib/figures): 0 nothing, a run of
   * steps in its time, or a garden slot on its own timeline. Cycles at its own
   * length; never alters `notes`.
   */
  figures: Figure[];

  lowestPossibleNote: number;
  highestPossibleNote: number;
  lowestSeedNote: number;
  highestSeedNote: number;
  timeRangeLow: number;
  timeRangeHi: number;
  legato: number;
  sustain: number | null;

  appliedScale: Scale | null;
  /** only on a view from sounding(): the notes as written */
  declare writtenNotes?: NoteArray;
  keyRoot: number;
  name: string;
  /** null: 12-TET. Degree 0 of the tuning sits on tuningRoot, which follows the key */
  tuning: Tuning | null;
  tuningRoot: number;

  stack: Bloom[];
  private saved: Bloom | null = null;
  private savedTimeIntervals: number[] | null = null;
  private nest: NoteArray | null = null;

  static maxChan = BloomDefaults.maxChan;
  static defaultChan = BloomDefaults.defaultChan;

  constructor(
    notes?: NoteArray | number,
    velocities?: number[] | number,
    timeIntervals?: number[] | number,
    chans?: number[] | number,
  ) {
    this.lowestPossibleNote = BloomDefaults.lowestPossibleNote;
    this.highestPossibleNote = BloomDefaults.highestPossibleNote;
    this.lowestSeedNote = BloomDefaults.lowestSeedNote;
    this.highestSeedNote = BloomDefaults.highestSeedNote;
    this.timeRangeLow = BloomDefaults.timeRangeLow;
    this.timeRangeHi = BloomDefaults.timeRangeHi;
    this.legato = BloomDefaults.legato;
    this.sustain = BloomDefaults.sustain;
    this.appliedScale = null;
    this.keyRoot = 0;
    this.name = '';
    this.tuning = null;
    this.tuningRoot = 0;
    this.stack = [];

    const n = notes !== undefined ? notes : 60;
    const v = velocities !== undefined ? velocities : 60;
    const t = timeIntervals !== undefined ? timeIntervals : 0.25;
    const c = chans !== undefined ? chans : Bloom.defaultChan;

    this.notes = Array.isArray(n) ? (n as NoteArray) : [n as number];
    this.velocities = Array.isArray(v) ? (v as number[]) : [v as number];
    this.timeIntervals = Array.isArray(t) ? (t as number[]) : [t as number];
    // A scalar chan fills to the notes length so chans starts aligned with notes
    this.chans = Array.isArray(c) ? (c as number[]) : this.notes.map(() => c as number);
    this.intervals = [0];
    this.intervalsDiatonic = false;
    this.figures = [0];
  }

  // ─── Copy / Import ─────────────────────────────────────────────────────────

  clone(): Bloom {
    const b = new Bloom();
    b.notes = JSON.parse(JSON.stringify(this.notes));
    b.velocities = [...this.velocities];
    b.timeIntervals = [...this.timeIntervals];
    b.chans = [...this.chans];
    b.intervals = JSON.parse(JSON.stringify(this.intervals));
    b.intervalsDiatonic = this.intervalsDiatonic;
    b.figures = JSON.parse(JSON.stringify(this.figures));
    b.lowestPossibleNote = this.lowestPossibleNote;
    b.highestPossibleNote = this.highestPossibleNote;
    b.lowestSeedNote = this.lowestSeedNote;
    b.highestSeedNote = this.highestSeedNote;
    b.timeRangeLow = this.timeRangeLow;
    b.timeRangeHi = this.timeRangeHi;
    b.legato = this.legato;
    b.sustain = this.sustain;
    b.appliedScale = this.appliedScale
      ? { ...this.appliedScale, degrees: [...this.appliedScale.degrees] }
      : null;
    b.keyRoot = this.keyRoot;
    b.name = this.name;
    b.tuning = this.tuning ? JSON.parse(JSON.stringify(this.tuning)) as Tuning : null;
    b.tuningRoot = this.tuningRoot;
    b.stack = this.stack.map(s => s.clone());
    b.saved = this.saved ? this.saved.clone() : null;
    b.savedTimeIntervals = this.savedTimeIntervals ? [...this.savedTimeIntervals] : null;
    b.nest = this.nest ? JSON.parse(JSON.stringify(this.nest)) : null;
    return b;
  }

  import(bloom: Bloom): this {
    const b = bloom.clone();
    this.notes = b.notes;
    this.velocities = b.velocities;
    this.timeIntervals = b.timeIntervals;
    this.chans = b.chans;
    this.intervals = b.intervals;
    this.intervalsDiatonic = b.intervalsDiatonic;
    this.figures = b.figures;
    this.lowestPossibleNote = b.lowestPossibleNote;
    this.highestPossibleNote = b.highestPossibleNote;
    this.lowestSeedNote = b.lowestSeedNote;
    this.highestSeedNote = b.highestSeedNote;
    this.timeRangeLow = b.timeRangeLow;
    this.timeRangeHi = b.timeRangeHi;
    this.legato = b.legato;
    this.sustain = b.sustain;
    this.appliedScale = b.appliedScale;
    this.keyRoot = b.keyRoot;
    this.name = b.name;
    this.tuning = b.tuning;
    this.tuningRoot = b.tuningRoot;
    // don't copy stack
    return this;
  }

  // ─── Nest helpers ──────────────────────────────────────────────────────────

  private saveNest(): void {
    this.nest = JSON.parse(JSON.stringify(this.notes));
  }

  private restoreNest(): void {
    if (this.nest) {
      const flat = flatNotes(this.notes) as number[];
      this.notes = matchNesting(flat, this.nest);
      // velocities/chans stay at their original lengths — wrapAt handles cycling at playback
      this.nest = null;
    }
  }

  // ─── Seeding ───────────────────────────────────────────────────────────────

  seed(numNotes?: number, low?: number, hi?: number): this {
    const n = numNotes !== undefined ? numNotes : Math.round(exprand(4, 10));
    const lo = low ?? this.lowestSeedNote;
    const h = hi ?? this.highestSeedNote;
    this.notes = Array.from({ length: n }, () => Math.round(exprand(lo, h)));
    this.velocities = Array.from({ length: n }, () => Math.round(exprand(30, 110)))
      .sort((a, b) => b - a);
    this.timeIntervals = Array.from({ length: n }, () =>
      Math.round(exprand(this.timeRangeLow, this.timeRangeHi) * 100) / 100,
    );
    this.chans = Array.from({ length: n }, () => Bloom.defaultChan);
    this.appliedScale = null;
    this.enforceRange();
    return this;
  }

  random(numNotes = 0): this {
    return this.seed(numNotes || undefined);
  }

  newNotes(): this {
    this.notes = (this.notes as number[]).map(() =>
      Math.round(exprand(this.lowestSeedNote, this.highestSeedNote)),
    );
    this.enforceRange();
    return this;
  }

  newShape(): this {
    const n = this.notes.length;
    this.velocities = Array.from({ length: n }, () => Math.round(exprand(40, 100)))
      .sort((a, b) => b - a);
    this.timeIntervals = Array.from({ length: n }, () =>
      Math.round(exprand(this.timeRangeLow, this.timeRangeHi) * 100) / 100,
    );
    return this;
  }

  empty(): this {
    this.notes = [];
    this.velocities = [];
    this.timeIntervals = [];
    this.chans = [];
    return this;
  }

  // ─── Mutation ──────────────────────────────────────────────────────────────

  mutateNotes(probability = 0.3): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    this.notes = flat.map(note => {
      const r = Math.random();
      if (r <= probability / 2) return note - 1;
      if (r >= 1 - probability) return note + 1;
      return note;
    });
    this.restoreNest();
    this.enforceRange();
    return this;
  }

  mutateNotesD(probability = 0.3): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const scale = this.scale;
    const degrees = keyToDegreeArr(flat, scale.degrees, scale.pitchesPerOctave);
    const newDegrees = degrees.map(deg =>
      coin(probability) ? (coin(0.5) ? deg + 1 : deg - 1) : deg,
    );
    this.notes = degreeToKeyArr(newDegrees, scale.degrees, scale.pitchesPerOctave);
    this.restoreNest();
    this.enforceRange();
    return this;
  }

  mutateVelocities(maxChange = 30): this {
    this.velocities = this.velocities.map(vel => {
      const change = Math.round(Math.random() * maxChange * (Math.random() < 0.5 ? 1 : -1));
      // Clamp to 1..127: mutation should never silence a note (vel 0 = skip at playback)
      return Math.max(1, Math.min(127, vel + change));
    });
    return this;
  }

  mutateTime(): this {
    const possibilities = [0.25, 0.5, 1, 1, 1, 1.5, 2];
    if (coin(0.5)) {
      this.timeIntervals = scramble(this.timeIntervals);
    } else {
      this.timeIntervals = this.timeIntervals.map(time => {
        const newTime = time * possibilities[Math.floor(Math.random() * possibilities.length)];
        return newTime > 0.05 ? newTime : time;
      });
    }
    return this;
  }

  mutateShape(): this {
    this.mutateTime();
    this.mutateVelocities();
    return this;
  }

  mutate(): this {
    this.mutateNotes();
    this.mutateShape();
    return this;
  }

  mutateD(): this {
    this.mutateNotesD();
    this.mutateShape();
    return this;
  }

  // ─── Ordering ──────────────────────────────────────────────────────────────

  /** Scramble whole notes: each keeps its own time, velocity and channel */
  scramble(): this {
    return this.patternEvents('scramble');
  }

  deepScramble(): this {
    this.saveNest();
    this.notes = scramble(flatNotes(this.notes) as number[]);
    this.restoreNest();
    return this;
  }

  permute(n: number): this {
    this.notes = permuteArr(this.notes, n) as NoteArray;
    return this;
  }

  shuffle(): this {
    return this.patternEvents('shuffle');
  }

  deepShuffle(): this {
    this.saveNest();
    this.notes = perfectShuffle(flatNotes(this.notes) as number[]);
    this.restoreNest();
    return this;
  }

  // ─── Rotation ──────────────────────────────────────────────────────────────

  /** Rotate whole notes */
  rotate(n = 1): this {
    return this.setEvents(rotateArr(this.events(), n));
  }

  rotateNotes(n = 1): this {
    this.notes = rotateArr(this.notes, n) as NoteArray;
    return this;
  }

  rotateVelocities(n = 1): this {
    this.velocities = rotateArr(this.velocities, n);
    return this;
  }

  rotateTime(n = 1): this {
    this.timeIntervals = rotateArr(this.timeIntervals, n);
    return this;
  }

  rotateChans(n = 1): this {
    this.chans = rotateArr(this.chans, n);
    return this;
  }

  // ─── Dynamics ──────────────────────────────────────────────────────────────

  slower(multiplier = 1.2): this {
    return this.scaleTimes(multiplier);
  }

  faster(multiplier = 1.2): this {
    return this.scaleTimes(1 / multiplier);
  }

  /** Scale every time by f. A frozen rhythm palette scales with it, so the lock follows the tempo change. */
  scaleTimes(f: number): this {
    this.timeIntervals = this.timeIntervals.map(t => Math.max(MIN_TIME, roundTime(t * f)));
    if (this.frozen.time) this.frozen.time = this.frozen.time.map(t => roundTime(t * f));
    return this;
  }

  louder(multiplier = 1.2): this {
    this.velocities = this.velocities.map(v => Math.min(127, Math.round(multiplier * v)));
    return this;
  }

  softer(multiplier = 1.2): this {
    // rests (0) stay rests
    this.velocities = this.velocities.map(v => (v === 0 ? 0 : Math.max(20, Math.round(v / multiplier))));
    return this;
  }

  fan(): this {
    this.timeIntervals = [...this.timeIntervals].sort((a, b) => a - b);
    return this;
  }

  avgTime(): this {
    const avg = this.timeIntervals.reduce((a, b) => a + b, 0) / this.timeIntervals.length;
    this.timeIntervals = this.timeIntervals.map(() => avg);
    return this;
  }

  crescendo(): this {
    this.velocities = [...this.velocities].sort((a, b) => a - b);
    return this;
  }

  decrescendo(): this {
    this.velocities = [...this.velocities].sort((a, b) => b - a);
    return this;
  }

  // ─── Expanding / Contracting ───────────────────────────────────────────────

  addOne(noteOrList?: number | number[], vel?: number, time?: number): this {
    if (noteOrList === undefined) {
      this.notes.push(Math.round(rrand(20, 100)));
      if (this.velocities.length <= this.notes.length)
        this.velocities.push(this.velocities[Math.floor(Math.random() * this.velocities.length)]);
      if (this.timeIntervals.length <= this.notes.length)
        this.timeIntervals.push(this.timeIntervals[Math.floor(Math.random() * this.timeIntervals.length)]);
    } else if (Array.isArray(noteOrList)) {
      this.notes.push(noteOrList[0]);
      this.velocities.push(noteOrList[1] ?? this.velocities[Math.floor(Math.random() * this.velocities.length)]);
      this.timeIntervals.push(noteOrList[2] ?? this.timeIntervals[Math.floor(Math.random() * this.timeIntervals.length)]);
    } else {
      this.notes.push(noteOrList);
      this.velocities.push(vel ?? this.velocities[Math.floor(Math.random() * this.velocities.length)]);
      this.timeIntervals.push(time ?? this.timeIntervals[Math.floor(Math.random() * this.timeIntervals.length)]);
    }
    return this;
  }

  addOneInScale(): this {
    const scale = this.asScale();
    if (scale.degrees.length < 2) {
      this.addOne();
    } else {
      const newNote = Math.round(rrand(this.lowestPossibleNote, this.highestPossibleNote));
      const snapped = this._nearestInScale(newNote, scale);
      this.addOne(snapped);
    }
    return this;
  }

  private _nearestInScale(note: number, scale: Scale): number {
    const octave = Math.floor(note / scale.pitchesPerOctave) * scale.pitchesPerOctave;
    const pc = note % scale.pitchesPerOctave;
    let nearest = scale.degrees[0];
    let minDist = Math.abs(pc - scale.degrees[0]);
    for (const d of scale.degrees) {
      const dist = Math.abs(pc - d);
      if (dist < minDist) { minDist = dist; nearest = d; }
    }
    return octave + nearest;
  }

  dropLast(): this {
    this.remove(this.notes.length - 1);
    return this;
  }

  remove(index = 0): this {
    this.notes.splice(index, 1);
    if (this.timeIntervals[index] !== undefined) this.timeIntervals.splice(index, 1);
    if (this.velocities[index] !== undefined) this.velocities.splice(index, 1);
    if (this.chans[index] !== undefined) this.chans.splice(index, 1);
    return this;
  }

  trimTo(length?: number): this {
    const len = length ?? this.notes.length;
    this.notes = this.notes.slice(0, len);
    this.timeIntervals = this.timeIntervals.slice(0, len);
    this.velocities = this.velocities.slice(0, len);
    this.chans = this.chans.slice(0, len);
    return this;
  }

  trimToDur(dur = 4): this {
    // Lists of other lengths (phasing): trim the notes so one pass fits, and
    // leave the velocities and channels cycling as they were.
    if (this.timeIntervals.length !== this.notes.length
      || this.velocities.length !== this.notes.length || this.chans.length !== this.notes.length) {
      const n0 = this.notes.length;
      const times = this.notes.map((_, i) => wrapAt(this.timeIntervals, i));
      const pass = times.reduce((a, b) => a + b, 0);
      if (pass <= dur) {
        if (this.timeIntervals.length === n0) this.timeIntervals[n0 - 1] += dur - pass;
        else this.timeIntervals = [...times.slice(0, -1), times[n0 - 1] + dur - pass];
        return this;
      }
      let acc = 0, n = 0;
      while (acc < dur && n < n0) acc += times[n++];
      times.length = n;
      times[n - 1] = Math.max(MIN_TIME, times[n - 1] - (acc - dur));
      this.notes = this.notes.slice(0, n);
      // the time list now lines up with the notes, since its last value is this pass's own
      this.timeIntervals = times;
      return this;
    }
    const total = this.timeIntervals.reduce((a, b) => a + b, 0);
    if (dur <= total) {
      let acc = 0;
      let n = 0;
      while (acc < dur) {
        acc += this.timeIntervals[n];
        n++;
      }
      this.timeIntervals = this.timeIntervals.slice(0, n);
      const excess = this.timeIntervals.reduce((a, b) => a + b, 0) - dur;
      this.timeIntervals[n - 1] -= excess;
      this.notes = this.notes.slice(0, n);
      this.velocities = this.velocities.slice(0, n);
      this.chans = this.chans.slice(0, n);
    } else {
      this.timeIntervals[this.timeIntervals.length - 1] += dur - total;
    }
    return this;
  }

  scaleToDur(dur = 4): this {
    const norm = normalizeSum(this.timeIntervals);
    this.timeIntervals = norm.map(t => t * dur);
    return this;
  }

  drawCurves(newSize = 10): this {
    this.notes = resamp1(flatNotes(this.notes) as number[], newSize).map(n => Math.round(n));
    this.timeIntervals = resamp1(this.timeIntervals, newSize).map(t => Math.round(t * 1000) / 1000);
    this.velocities = resamp1(this.velocities, newSize).map(v => Math.round(v));
    this.chans = wrapExtend(this.chans, newSize);
    return this;
  }

  drawCurvesD(newSize = 10): this {
    const scale = this.scale;
    this.drawCurves(newSize);
    this.applyScale(scale);
    return this;
  }

  // ─── Thinning ──────────────────────────────────────────────────────────────

  thin(probability = 0.3): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];

    const newNotes: number[] = [];
    const newVels: number[] = [];
    const newTimes: number[] = [];
    const newChans: number[] = [];

    flat.forEach((note, count) => {
      if (Math.random() > probability) {
        newNotes.push(note);
        newVels.push(wrapAt(this.velocities, count));
        newTimes.push(wrapAt(this.timeIntervals, count));
        newChans.push(wrapAt(this.chans, count));
      } else {
        // Add time to previous note's duration
        if (newTimes.length > 0) newTimes[newTimes.length - 1] += wrapAt(this.timeIntervals, count);
      }
    });

    if (newNotes.length > 1) {
      this.notes = newNotes;
      this.velocities = newVels;
      this.timeIntervals = newTimes;
      this.chans = newChans;
    }
    this.restoreNest();
    this.trimTo(newNotes.length);
    return this;
  }

  thinShorten(probability = 0.3): this {
    const newNotes: NoteVal[] = [];
    const newVels: number[] = [];
    const newTimes: number[] = [];
    const newChans: number[] = [];
    this.notes.forEach((note, i) => {
      if (!coin(probability)) {
        newNotes.push(note);
        newVels.push(wrapAt(this.velocities, i));
        newTimes.push(wrapAt(this.timeIntervals, i));
        newChans.push(wrapAt(this.chans, i));
      }
    });
    this.notes = newNotes;
    this.velocities = newVels;
    this.timeIntervals = newTimes;
    this.chans = newChans;
    return this;
  }

  thicken(percentNew = 0.5): this {
    const scale = this.appliedScale ?? this.asScale();
    const thickener = new Bloom().seed(Math.round(this.notes.length * percentNew));
    thickener.applyScale(scale);
    thickener.softer();
    this.blend(thickener);
    this.enforceRange();
    return this;
  }

  thickenLengthen(percentNew = 0.5): this {
    const scale = this.appliedScale ?? this.asScale();
    const thickener = new Bloom().seed(Math.round(this.notes.length * percentNew));
    thickener.applyScale(scale);
    this.interlace(thickener);
    this.enforceRange();
    return this;
  }

  gap(probability = 0.3): this {
    this.velocities = this.velocities.map(v => (coin(probability) ? 0 : v));
    return this;
  }

  unGap(): this {
    const nonZero = this.velocities.filter(v => v !== 0);
    if (nonZero.length === 0) return this;
    const avg = Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length * 100) / 100;
    this.velocities = this.velocities.map(v => (v === 0 ? avg : v));
    return this;
  }

  removeDoubles(): this {
    const groups = indexOfDoubles(flatNotes(this.notes) as number[]);
    const toRemove = new Set<number>();
    groups.forEach(group => group.slice(1).forEach(i => toRemove.add(i)));
    this.notes = this.notes.filter((_, i) => !toRemove.has(i));
    this.timeIntervals = this.timeIntervals.filter((_, i) => !toRemove.has(i));
    this.velocities = this.velocities.filter((_, i) => !toRemove.has(i));
    this.chans = this.chans.filter((_, i) => !toRemove.has(i));
    return this;
  }

  moveDoublesUpOctave(): this {
    this.saveNest();
    this.notes = moveDoublesUpOctaveArr(flatNotes(this.notes) as number[]);
    this.restoreNest();
    return this;
  }

  // ─── Patterning ────────────────────────────────────────────────────────────

  stutter(repetitions = 2): this {
    return this.setEvents(stutterArr(this.events(), repetitions));
  }

  sputter(probability = 0.3): this {
    return this.setEvents(sputterArr(this.events(), probability));
  }

  spray(probability = 0.25): this {
    this.notes = sputterArr(this.notes, probability) as NoteArray;
    this.velocities = sputterArr(this.velocities, probability);
    this.timeIntervals = sputterArr(this.timeIntervals, probability);
    return this;
  }

  mirror(): this {
    return this.patternEvents('mirror');
  }

  pyramid(patternType = 1): this {
    return this.setEvents(pyramidArr(this.events(), patternType));
  }

  slide(windowLength = 3): this {
    return this.setEvents(slideArr(this.events(), windowLength));
  }

  braid(windowLength = 3): this {
    return this.slide(windowLength);
  }

  /** Snap times to a 1/grid grid. A duration never rounds down to 0 (that would stack notes on one instant): it gets one grid step. */
  quantize(grid = 4, margin = 0, strength = 1): this {
    const resolution = 1 / grid;
    this.timeIntervals = this.timeIntervals.map(t => {
      const q = softRound(t, resolution, margin, strength);
      return t > 0 && q <= 0 ? resolution : q;
    });
    return this;
  }

  addComma(dur = 1): this {
    this.timeIntervals[this.timeIntervals.length - 1] += dur;
    return this;
  }

  wrapTime(list?: number | number[]): this {
    const l = list !== undefined
      ? (Array.isArray(list) ? list : [list])
      : this.timeIntervals;
    this.timeIntervals = this.notes.map((_, i) => wrapAt(l, i));
    return this;
  }

  wrapVel(list?: number | number[]): this {
    const l = list !== undefined
      ? (Array.isArray(list) ? list : [list])
      : this.velocities;
    this.velocities = this.notes.map((_, i) => wrapAt(l, i));
    return this;
  }

  wrapChan(list?: number | number[]): this {
    const l = list !== undefined
      ? (Array.isArray(list) ? list : [list])
      : this.chans;
    this.chans = this.notes.map((_, i) => wrapAt(l, i));
    return this;
  }

  // ─── Fusion / Fission ──────────────────────────────────────────────────────

  add(notesOrBloom: number[] | Bloom | number = 60, vels: number | number[] = 60, times: number | number[] = 0.25, chans: number | number[] = 0): this {
    if (notesOrBloom instanceof Bloom) {
      this.notes = [...this.notes, ...notesOrBloom.notes];
      this.velocities = [...this.velocities, ...notesOrBloom.velocities];
      this.timeIntervals = [...this.timeIntervals, ...notesOrBloom.timeIntervals];
      this.chans = [...this.chans, ...notesOrBloom.chans];
    } else {
      const n = Array.isArray(notesOrBloom) ? notesOrBloom : [notesOrBloom];
      const v = Array.isArray(vels) ? vels : [vels];
      const t = Array.isArray(times) ? times : [times];
      const c = Array.isArray(chans) ? chans : [chans];
      this.notes = [...this.notes, ...n];
      this.velocities = [...this.velocities, ...v];
      this.timeIntervals = [...this.timeIntervals, ...t];
      this.chans = [...this.chans, ...c];
    }
    return this;
  }

  concat(bloom: Bloom): Bloom {
    const b = this.clone();
    b.add(bloom);
    return b;
  }

  fromListOfBlooms(list: Array<Bloom | null>): this {
    const blooms = list.filter((b): b is Bloom => b instanceof Bloom);
    this.notes = blooms.flatMap(b => b.notes as NoteVal[]);
    this.timeIntervals = blooms.flatMap(b => b.timeIntervals);
    this.velocities = blooms.flatMap(b => b.velocities);
    this.chans = blooms.flatMap(b => b.chans);
    return this;
  }

  blend(bloom: Bloom): this {
    const mySize = this.notes.length;
    const theirSize = bloom.notes.length;
    const laceSize = Math.max(mySize, theirSize) * 2 - 1;

    const softerBloom = bloom.clone();
    softerBloom.softer();

    this.notes = lace([this.notes, softerBloom.notes], laceSize) as NoteArray;
    this.velocities = lace([this.velocities, softerBloom.velocities], this.notes.length);
    this.timeIntervals = lace([this.timeIntervals, softerBloom.timeIntervals], this.notes.length);
    this.chans = lace([this.chans, softerBloom.chans], this.notes.length);

    // Adjust time intervals: split each orig-new pair
    const newTime: number[] = [];
    for (let i = 0; i < this.timeIntervals.length - 1; i += 2) {
      const orig = this.timeIntervals[i];
      const next = this.timeIntervals[i + 1] ?? 0;
      newTime.push(Math.abs(orig - next));
      newTime.push(next);
    }
    if (this.timeIntervals.length % 2 !== 0) newTime.push(this.timeIntervals[this.timeIntervals.length - 1]);
    this.timeIntervals = newTime;

    return this;
  }

  interlace(bloom: Bloom): this {
    const mySize = this.notes.length;
    const theirSize = bloom.notes.length;
    const laceSize = Math.max(mySize, theirSize) * 2 - 1;

    const softerBloom = bloom.clone();
    softerBloom.softer();
    softerBloom.softer();

    this.notes = lace([this.notes, softerBloom.notes], laceSize) as NoteArray;
    this.velocities = lace([this.velocities, softerBloom.velocities], this.notes.length);
    this.timeIntervals = lace([this.timeIntervals, softerBloom.timeIntervals], this.notes.length);
    this.chans = lace([this.chans, softerBloom.chans], this.notes.length);
    return this;
  }

  applyShape(bloom: Bloom): this {
    this.timeIntervals = [...bloom.timeIntervals];
    this.velocities = [...bloom.velocities];
    this.chans = [...bloom.chans];
    return this;
  }

  cast(bloom: Bloom): this {
    const pcs = this.notes.map(n => {
      const flat = Array.isArray(n) ? (n as number[])[0] : n as number;
      return flat % 12;
    });
    this.notes = bloom.notes.map((note, i) => {
      const pc = pcs[i % pcs.length];
      const target = Array.isArray(note) ? (note as number[])[0] : note as number;
      const allOcts = Array.from({ length: 13 }, (_, j) => pc + 12 * j);
      return allOcts.reduce((best, oct) =>
        Math.abs(oct - target) < Math.abs(best - target) ? oct : best,
      );
    });
    this.timeIntervals = [...bloom.timeIntervals];
    this.velocities = [...bloom.velocities];
    return this;
  }

  curdle(probability = 0.2): Bloom[] {
    const groups = curdleArr(this.notes as NoteVal[], probability);
    return groups.map(groupNotes => {
      const startIdx = (this.notes as NoteVal[]).indexOf(groupNotes[0]);
      const b = new Bloom();
      b.empty();
      b.notes = groupNotes;
      b.velocities = groupNotes.map((_, i) =>
        wrapAt(this.velocities, startIdx + i),
      );
      b.timeIntervals = groupNotes.map((_, i) =>
        wrapAt(this.timeIntervals, startIdx + i),
      );
      b.chans = [0];
      return b;
    });
  }

  split(splitAt?: number): [Bloom, Bloom] {
    this.wrapToNotes();
    const at = splitAt ?? Math.floor(Math.random() * this.notes.length);
    const makeBloom = (ns: NoteVal[], vs: number[], ts: number[], cs: number[]) => {
      const b = new Bloom(ns, vs, ts, cs);
      return b;
    };
    return [
      makeBloom(this.notes.slice(0, at) as NoteVal[], this.velocities.slice(0, at), this.timeIntervals.slice(0, at), this.chans.slice(0, at)),
      makeBloom(this.notes.slice(at) as NoteVal[], this.velocities.slice(at), this.timeIntervals.slice(at), this.chans.slice(at)),
    ];
  }

  // ─── Pitch ─────────────────────────────────────────────────────────────────

  transpose(semitones = 0): this {
    this.saveNest();
    this.notes = (flatNotes(this.notes) as number[]).map(n => n + semitones);
    this.appliedScale = null;
    this.restoreNest();
    this.enforceRange();
    return this;
  }

  dTranspose(steps = 0): this {
    const scale = this.appliedScale ?? this.asScale();
    const degrees = (flatNotes(this.notes) as number[]).map(n =>
      keyToDegreeArr([n], scale.degrees, scale.pitchesPerOctave)[0],
    );
    const newDegrees = degrees.map(d => d + steps);
    this.notes = degreeToKeyArr(newDegrees, scale.degrees, scale.pitchesPerOctave);
    this.enforceRange();
    return this;
  }

  /**
   * A breeze: transpose only some of the notes (GESTURE.breeze of them, at
   * least one). `unit` is scale steps, semitones or octaves. Chord tones move
   * independently.
   */
  breeze(amount = 1, unit: 'step' | 'semitone' | 'octave' = 'step', share = GESTURE.breeze): this {
    const s = this.scale;
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const heat = this.breezeHeatFor('pitch', flat);
    const moving = someIndices(flat.length, share, heat);
    this.notes = flat.map((note, i) => {
      if (!moving.has(i)) return note;
      if (unit === 'step') return this.stepPitch(note, amount, s);
      return note + amount * (unit === 'octave' ? 12 : 1);
    });
    this.restoreNest();
    this.enforceRange();
    this.rememberBreeze('pitch', heat, moving, flatNotes(this.notes) as number[]);
    return this;
  }

  // Breeze memory, per list: how recently each position moved, and the list as
  // the breeze left it. The memory only holds while nothing else has changed
  // that list; any other edit starts the weighting afresh.
  private breezeMemo = new Map<string, { after: string; heat: number[] }>();

  private breezeHeatFor(key: string, values: unknown[]): number[] {
    const memo = this.breezeMemo.get(key);
    return memo && memo.after === JSON.stringify(values) && memo.heat.length === values.length
      ? memo.heat
      : values.map(() => 0);
  }

  /** How recently each position of a list was breezed (0 = not lately), for display. Keys: 'pitch' (flat notes), 'time', 'vel', 'chan'. */
  breezeHeat(key: 'pitch' | ListKey): number[] | null {
    const memo = this.breezeMemo.get(key);
    return memo ? this.breezeHeatFor(key, key === 'pitch' ? flatNotes(this.notes) as number[] : this.getList(key)) : null;
  }

  private rememberBreeze(key: string, heat: number[], moved: Set<number>, after: unknown[]): void {
    this.breezeMemo.set(key, {
      after: JSON.stringify(after),
      heat: heat.map((h, i) => h * GESTURE.breezeMemory + (moved.has(i) ? 1 : 0)),
    });
  }

  compass(lo = 60, hi = 90): this {
    if (hi - lo < 12) hi = lo + 12;
    this.saveNest();
    this.notes = (flatNotes(this.notes) as number[]).map(note => {
      if (note < lo) return justAbove(note, lo);
      if (note > hi) return justBelow(note, hi);
      return note;
    });
    this.restoreNest();
    return this;
  }

  compress(): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const lowest = Math.min(...flat);
    this.notes = flat.map(note => {
      let n = note;
      while (n >= lowest + 12) n -= 12;
      return n;
    });
    this.restoreNest();
    return this;
  }

  /**
   * Shear: widen the range by octaves. About a third of the notes (the
   * breeze's share) each move an octave away from the middle, keeping their
   * pitch class; one that would leave the range moves an octave inward instead.
   */
  shear(share = GESTURE.breeze): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const sorted = [...flat].sort((a, b) => a - b);
    const mid = (sorted[0] + sorted[sorted.length - 1]) / 2;
    const moving = someIndices(flat.length, share);
    this.notes = flat.map((note, i) => {
      if (!moving.has(i)) return note;
      const out = note > mid ? 12 : note < mid ? -12 : (coin(0.5) ? 12 : -12);
      const fits = (m: number) => m >= this.lowestPossibleNote && m <= this.highestPossibleNote;
      return fits(note + out) ? note + out : fits(note - out) ? note - out : note;
    });
    this.restoreNest();
    return this;
  }

  invert(n = 1): this {
    this.saveNest();
    this.notes = invertChord(flatNotes(this.notes) as number[], n);
    this.enforceRange();
    this.restoreNest();
    return this;
  }

  invertMean(): this {
    this.saveNest();
    this.notes = invertMeanArr(flatNotes(this.notes) as number[]);
    this.appliedScale = null;
    this.restoreNest();
    this.appliedScale = this.asScale();
    return this;
  }

  negHarmony(root?: number): this {
    const r = root ?? this.keyRoot;
    this.notes = (flatNotes(this.notes) as number[]).map(n => negHarmonyFn(n, r));
    this.appliedScale = this.asScale();
    return this;
  }

  lower(): this {
    const i = Math.floor(Math.random() * this.notes.length);
    (this.notes as number[])[i] -= 1;
    return this;
  }

  pivot(i = 1): this {
    this.saveNest();
    this.notes = flatNotes(this.notes) as number[];

    let newBloom: Bloom = this;
    for (let k = 0; k < i; k++) {
      newBloom = this.clone();
      newBloom.invert();
    }

    const highestIdx = this._highestNoteIdx(newBloom.notes as number[]);
    const origHighestIdx = this._highestNoteIdx(this.notes as number[]);
    const diff = (newBloom.notes as number[])[highestIdx] - (this.notes as number[])[origHighestIdx];
    newBloom.notes = (newBloom.notes as number[]).map(n => n - diff);

    this.notes = newBloom.notes;
    this.enforceRange();
    this.restoreNest();
    this.appliedScale = this.asScale();
    return this;
  }

  pivotBass(i = 1): this {
    this.saveNest();
    this.notes = flatNotes(this.notes) as number[];

    let newBloom: Bloom = this;
    for (let k = 0; k < i; k++) {
      newBloom = this.clone();
      newBloom.invert();
    }

    const lowestIdx = this._lowestNoteIdx(newBloom.notes as number[]);
    const origLowestIdx = this._lowestNoteIdx(this.notes as number[]);
    const diff = (newBloom.notes as number[])[lowestIdx] - (this.notes as number[])[origLowestIdx];
    newBloom.notes = (newBloom.notes as number[]).map(n => n - diff);

    this.notes = newBloom.notes;
    this.enforceRange();
    this.restoreNest();
    this.appliedScale = this.asScale();
    return this;
  }

  pivotLoudest(i = 1): this {
    this.saveNest();
    this.notes = flatNotes(this.notes) as number[];

    let newBloom: Bloom = this;
    for (let k = 0; k < i; k++) {
      newBloom = this.clone();
      newBloom.invert();
    }

    const loudestIdx = this._loudestNoteIdx();
    const origNote = (this.notes as number[])[loudestIdx];
    const newNote = (newBloom.notes as number[])[loudestIdx];
    const diff = newNote - origNote;
    newBloom.notes = (newBloom.notes as number[]).map(n => n - diff);

    this.notes = newBloom.notes;
    this.enforceRange();
    this.restoreNest();
    this.appliedScale = this.asScale();
    return this;
  }

  flatten(howMany = 1): this {
    const currentScale = this.asScale();
    const size = currentScale.degrees.length;
    const changes = scramble([
      ...Array(howMany).fill(-1),
      ...Array(Math.max(0, size - howMany)).fill(0),
    ].slice(0, size));
    const newDegrees = currentScale.degrees
      .map((d, i) => ((d + changes[i]) % 12 + 12) % 12)
      .sort((a, b) => a - b);
    this.applyScale({ degrees: newDegrees, pitchesPerOctave: 12, name: 'Flattened' });
    return this;
  }

  // ─── Scale / Diatonicism ───────────────────────────────────────────────────

  /**
   * Where a tuning's root sits in this bloom: the key of its attached scale (k
   * and the scale keys attach one), as a key signature names it. A bloom with
   * no scale attached is twelve-note chromatic, and so is a scale that implies
   * no key (whole tone): both put the root on C.
   */
  keyTuningRoot(): number {
    const s = this.appliedScale;
    if (!s) return 0;
    return s.root ?? keyRootOf(s.degrees) ?? 0;   // a raga's Sa, else the key signature's
  }

  /** Move the tuning's root to the bloom's key, unless it was chosen by hand */
  followTuningRoot(): this {
    if (this.tuning?.root !== undefined && this.tuning.root !== null) { this.tuningRoot = this.tuning.root; return this; }
    this.tuningRoot = this.keyTuningRoot();
    return this;
  }

  get scale(): Scale {
    return this.appliedScale ?? this.asScale();
  }

  asScale(): Scale {
    if (!this.notes || this.notes.length === 0) return SCALES.chromatic;
    return notesToScale(flatNotes(this.notes) as number[]);
  }

  applyScale(input?: Scale | number[] | Bloom, root?: number | string): this {
    this.saveNest();
    let newScale: Scale;
    if (!input) {
      newScale = this._chooseScaleObj();
    } else if (input instanceof Bloom) {
      newScale = input.asScale();
    } else if (Array.isArray(input)) {
      newScale = { degrees: input, pitchesPerOctave: 12, name: '' };
    } else {
      newScale = input as Scale;
    }

    if (typeof root === 'string') root = spellToPC(root);
    if (root !== undefined) this.keyRoot = root % 12;

    const rootZeroDegrees = newScale.degrees.map(d => ((d - this.keyRoot) % 12 + 12) % 12).sort((a, b) => a - b);
    const rootShiftedDegrees = rootZeroDegrees.map(d => (d + this.keyRoot) % 12).sort((a, b) => a - b);

    this.appliedScale = { ...newScale, degrees: rootShiftedDegrees };
    this.notes = nearestInScaleUniqueArr(
      flatNotes(this.notes) as number[],
      rootShiftedDegrees,
    );
    this.restoreNest();
    return this;
  }

  /** Attach a scale written on C (a raga's Sa is its C) on this root: the bloom's key, unless given */
  applyScaleOn(scale: Scale, root = this.keyTuningRoot()): this {
    return this.applyScale(scaleTranspose(scale, root));
  }

  private _chooseScaleObj(): Scale {
    const candidates = mostSimilarTo(this.asScale().degrees);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  chooseScale(): this {
    const scale = this._chooseScaleObj();
    this.applyScale(scale);
    return this;
  }

  slantScale(): this {
    const here = pcsKey(this.scale.degrees);
    if (_slantTrail[_slantTrail.length - 1] !== here) _slantTrail.push(here);
    const scale = pick(slantMatch(this.scale.degrees, new Set(_slantTrail)));
    this.applyScale(scale);
    _slantTrail.push(pcsKey(scale.degrees));
    while (_slantTrail.length > SLANT_TRAIL) _slantTrail.shift();
    return this;
  }

  /**
   * One step round the circle of fifths: one pitch class of the scale moves a
   * semitone, sharpward (dir 1) or flatward (-1), and the notes on it move
   * with it. "Sharpward" is measured on the circle of fifths around the
   * scale's own centre, so C major goes to G major (F → F#), and any scale
   * type drifts the same way. A move that keeps the scale's shape (a
   * transposition) is preferred, then one that makes a named scale, then one
   * that moves notes actually played. Returns e.g. "F → F#", or null.
   */
  fifthsward(dir: 1 | -1): string | null {
    const S = new Set(this.scale.degrees.map(this.pcOf));
    if (S.size === 0 || S.size >= 12) return null;
    const fifths = (pc: number) => (pc * 7) % 12;
    // the most compact arc of fifths holding the set, and its middle
    let start = 0, span = 12;
    for (let st = 0; st < 12; st++) {
      const w = Math.max(...[...S].map(pc => (fifths(pc) - st + 12) % 12));
      if (w < span) { span = w; start = st; }
    }
    const centre = start + span / 2;
    const off = (pc: number) => { let d = (fifths(pc) - centre) % 12; if (d < -6) d += 12; if (d >= 6) d -= 12; return d; };

    const flat = flatNotes(this.notes) as number[];
    const used = new Set(flat.map(this.pcOf));
    const shape = (set: number[]) => {
      const sorted = [...set].sort((a, b) => a - b);
      return sorted.map((d, i) => (sorted[(i + 1) % sorted.length] - d + 12) % 12).join(',');
    };
    const rotations = (str: string) => { const a = str.split(','); return a.map((_, i) => [...a.slice(i), ...a.slice(0, i)].join(',')); };
    const myShapes = new Set(rotations(shape([...S])));

    const moves: { from: number; to: number; step: number; score: number }[] = [];
    for (const from of S) {
      for (const step of [1, -1]) {
        const to = (from + step + 12) % 12;
        if (S.has(to) || Math.sign(off(to) - off(from)) !== dir) continue;
        const next = [...S].filter(pc => pc !== from).concat(to);
        const score = (myShapes.has(shape(next)) ? 4 : nameScaleDegrees(next) ? 2 : 0) + (used.has(from) ? 1 : 0);
        moves.push({ from, to, step, score });
      }
    }
    if (_stepDir !== dir) { _stepTrail.length = 0; _stepDir = dir; }
    const here = pcsKey([...S]);
    if (_stepTrail[_stepTrail.length - 1] !== here) _stepTrail.push(here);
    const keyOf = (mv: { from: number; to: number }) => pcsKey([...S].filter(pc => pc !== mv.from).concat(mv.to));
    const ahead = moves.filter(mv => !_stepTrail.includes(keyOf(mv)));
    if (ahead.length) moves.splice(0, moves.length, ...ahead);
    if (!moves.length) return null;
    const best = Math.max(...moves.map(m => m.score));
    const mv = pick(moves.filter(m => m.score === best));

    this.saveNest();
    this.notes = flat.map(m => (this.pcOf(m) === mv.from ? m + mv.step : m));
    this.restoreNest();
    this.enforceRange();
    this.setScalePcs([...S].filter(pc => pc !== mv.from).concat(mv.to));
    _stepTrail.push(keyOf(mv));
    while (_stepTrail.length > SLANT_TRAIL) _stepTrail.shift();
    return `${spell(mv.from)} → ${spell(mv.to)}`;
  }

  setRoot(root: number | string): this {
    if (typeof root === 'string') root = spellToPC(root);
    const scale = this.appliedScale ?? this.asScale();
    this.applyScale(scale, root % 12);
    return this;
  }

  addSharp(): this {
    return this.setRoot(this.keyRoot + 7);
  }

  addFlat(): this {
    return this.setRoot(this.keyRoot - 7);
  }

  reduceScale(): this {
    const degrees = [...this.asScale().degrees];
    degrees.splice(Math.floor(Math.random() * degrees.length), 1);
    const newName = this.appliedScale ? `Reduced ${this.appliedScale.name}` : 'Reduced';
    this.applyScale({ degrees, pitchesPerOctave: 12, name: newName });
    return this;
  }

  // ─── Chords ────────────────────────────────────────────────────────────────

  private saveTimeIntervals(): void {
    this.savedTimeIntervals = [...this.timeIntervals];
  }

  private restoreTimeIntervals(): void {
    if (this.savedTimeIntervals) this.timeIntervals = [...this.savedTimeIntervals];
  }

  chord(): this {
    this.saveTimeIntervals();
    this.notes = [this.notes as NoteVal[]];
    this.timeIntervals = [this.timeIntervals.reduce((a, b) => a + b, 0)];
    this.velocities = [this.velocities[0]];
    this.chans = [this.chans[0]];
    return this;
  }

  chords(notesPerChord = 3): this {
    this.saveTimeIntervals();
    this.flattenChords();
    const flat = this.notes as number[];
    const groups: NoteArray = [];
    for (let i = 0; i < flat.length; i += notesPerChord) {
      const chunk = flat.slice(i, i + notesPerChord);
      groups.push(chunk.length === 1 ? chunk[0] : chunk);
    }
    this.notes = groups;
    this.timeIntervals = groups.map((_, i) =>
      wrapAt(this.savedTimeIntervals ?? this.timeIntervals, i),
    );
    this.velocities = groups.map((_, i) => wrapAt(this.velocities, i));
    return this;
  }

  chordsShorten(notesPerChord = 3): this {
    this.saveTimeIntervals();
    this.flattenChords();
    const flat = this.notes as number[];
    const groups: NoteArray = [];
    for (let i = 0; i < flat.length; i += notesPerChord) {
      const chunk = flat.slice(i, i + notesPerChord);
      groups.push(chunk.length === 1 ? chunk[0] : chunk);
    }
    this.notes = groups;
    this.velocities = groups.map((_, i) => wrapAt(this.velocities, i));
    return this;
  }

  chordsRand(probability = 1 / 3): this {
    this.saveTimeIntervals();
    this.flattenChords();
    const groups = curdleArr(this.notes as NoteVal[], probability);
    this.notes = groups.map(g => (g.length === 1 ? g[0] : g)) as NoteArray;
    this.timeIntervals = this.notes.map((item, i) => {
      const base = wrapAt(this.savedTimeIntervals ?? this.timeIntervals, i);
      return Array.isArray(item) ? base : base;
    });
    this.velocities = this.notes.map((_, i) => wrapAt(this.velocities, i));
    return this;
  }

  chordsRandShorten(probability = 1 / 3): this {
    this.flattenChords();
    const groups = curdleArr(this.notes as NoteVal[], probability);
    this.notes = groups.map(g => (g.length === 1 ? g[0] : g)) as NoteArray;
    return this;
  }

  flattenChords(): this {
    this.notes = flatNotes(this.notes) as NoteArray;
    this.velocities = flatNotes(this.velocities as unknown as NoteArray) as number[];
    this.chans = flatNotes(this.chans as unknown as NoteArray) as number[];
    this.restoreTimeIntervals();
    return this;
  }

  removeChords(): this {
    this.notes = this.notes.map(note =>
      Array.isArray(note) ? (note as NoteVal[])[0] : note,
    ) as NoteArray;
    return this;
  }

  extractChords(): number[][] {
    const result: number[][] = [];
    this.notes.forEach(item => {
      if (Array.isArray(item) && (item as NoteVal[]).length > 1) {
        result.push(item as number[]);
      }
    });
    return result;
  }

  replaceChords(chords: number[][]): this {
    const queue = [...chords].reverse();
    this.notes = this.notes.map(item => {
      if (Array.isArray(item) && (item as NoteVal[]).length > 1) {
        return queue.pop() ?? item;
      }
      return item;
    }) as NoteArray;
    return this;
  }

  // ─── Channels ──────────────────────────────────────────────────────────────

  addChan(): this {
    this.chans.push(Math.floor(Math.random() * (Bloom.maxChan + 1)));
    return this;
  }

  recycleChan(): this {
    this.chans.push(this.chans[Math.floor(Math.random() * this.chans.length)]);
    return this;
  }

  dropChan(): this {
    if (this.chans.length > 1) this.chans.pop();
    return this;
  }

  randChans(): this {
    this.chans = this.chans.map(() => Math.floor(Math.random() * (Bloom.maxChan + 1)));
    return this;
  }

  cycleChans(): this {
    this.chans = this.chans.map(ch => ((ch + 1 + Bloom.maxChan + 1) % (Bloom.maxChan + 1)));
    return this;
  }

  sortChans(): this {
    this.chans = [...this.chans].sort((a, b) => a - b);
    return this;
  }

  /** Replace one randomly-chosen channel slot with a new random channel value */
  oneRandChan(): this {
    const i = Math.floor(Math.random() * this.chans.length);
    this.chans[i] = Math.floor(Math.random() * (Bloom.maxChan + 1));
    return this;
  }

  /** Probabilistically increment each channel by 1, wrapping at maxChan */
  incrementSomeChans(prob = 0.2): this {
    this.chans = this.chans.map(ch =>
      coin(prob) ? (ch + 1 > Bloom.maxChan ? 0 : ch + 1) : ch,
    );
    return this;
  }

  // ─── Channel-mode transformations ──────────────────────────────────────────
  // Mirrors of the note/time/velocity vocabulary, retargeted at the chans array.
  // "Palette" = the set of distinct channels in use. Palette-bound ops are the
  // diatonic analog (stay within current instruments); full-range ops are the
  // chromatic analog (can introduce new instruments).

  /** Distinct channels currently in use, sorted ascending */
  chanPalette(): number[] {
    return [...new Set(this.chans)].sort((a, b) => a - b);
  }

  /** Most common channel (ties broken by lower channel number) */
  modalChan(): number {
    const counts = new Map<number, number>();
    this.chans.forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1));
    let best = this.chans[0] ?? Bloom.defaultChan;
    counts.forEach((n, c) => {
      const bestN = counts.get(best) ?? 0;
      if (n > bestN || (n === bestN && c < best)) best = c;
    });
    return best;
  }

  private wrapChanVal(c: number): number {
    const mod = Bloom.maxChan + 1;
    return ((c % mod) + mod) % mod;
  }

  /** Mutate chans within the palette — timbral reshuffle, no new instruments */
  mutateChansD(probability = 0.35): this {
    const pal = this.chanPalette();
    if (pal.length < 2) return this;
    this.chans = this.chans.map(c => {
      if (!coin(probability)) return c;
      const others = pal.filter(p => p !== c);
      return others[Math.floor(Math.random() * others.length)];
    });
    return this;
  }

  /** Mutate chans across the full range — can introduce new instruments */
  mutateChans(probability = 0.35): this {
    this.chans = this.chans.map(c =>
      coin(probability) ? Math.floor(Math.random() * (Bloom.maxChan + 1)) : c,
    );
    return this;
  }

  /** Merge the rarest channel into the next-rarest — fewer distinct instruments */
  thinChanPalette(): this {
    const pal = this.chanPalette();
    if (pal.length < 2) return this;
    const counts = new Map<number, number>();
    this.chans.forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1));
    const byRarity = [...pal].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
    const [rarest, target] = [byRarity[0], byRarity[1]];
    this.chans = this.chans.map(c => (c === rarest ? target : c));
    return this;
  }

  /** Move roughly half the modal channel's slots onto an unused channel */
  thickenChanPalette(): this {
    const inUse = new Set(this.chans);
    const unused: number[] = [];
    for (let c = 0; c <= Bloom.maxChan; c++) if (!inUse.has(c)) unused.push(c);
    if (unused.length === 0) return this;
    const target = unused[Math.floor(Math.random() * unused.length)];
    const modal = this.modalChan();
    const idxs = this.chans.map((c, i) => (c === modal ? i : -1)).filter(i => i >= 0);
    scramble(idxs).slice(0, Math.ceil(idxs.length / 2)).forEach(i => { this.chans[i] = target; });
    return this;
  }

  /** Each chan steps one toward the modal channel — the "softer" of orchestration */
  convergeChans(): this {
    const m = this.modalChan();
    this.chans = this.chans.map(c => (c === m ? c : c + Math.sign(m - c)));
    return this;
  }

  /** Each chan steps one away from the modal channel (clamped to range) */
  divergeChans(): this {
    const m = this.modalChan();
    this.chans = this.chans.map(c => {
      const dir = c === m ? (coin(0.5) ? 1 : -1) : Math.sign(c - m);
      return Math.max(0, Math.min(Bloom.maxChan, c + dir));
    });
    return this;
  }

  /** All chans → the modal channel — reset to tutti */
  unifyChans(): this {
    const m = this.modalChan();
    this.chans = this.chans.map(() => m);
    return this;
  }

  /** Shift every chan by n, wrapping — move the texture to adjacent instruments */
  shiftChans(n = 1): this {
    this.chans = this.chans.map(c => this.wrapChanVal(c + n));
    return this;
  }

  /** Invert chans within the range: c → maxChan − c */
  invertChans(): this {
    this.chans = this.chans.map(c => Bloom.maxChan - c);
    return this;
  }

  /** Reflect chans around the modal channel (clamped to range) */
  invertChansModal(): this {
    const m = this.modalChan();
    this.chans = this.chans.map(c => Math.max(0, Math.min(Bloom.maxChan, 2 * m - c)));
    return this;
  }

  /** Progressive drift across the array — an instrumentation glissando */
  /** Redraw chans as a smooth curve through the full channel range */
  curveChans(): this {
    const n = this.chans.length;
    if (n === 0) return this;
    const ctrl = Array.from(
      { length: 3 + Math.floor(Math.random() * 3) },
      () => Math.floor(Math.random() * (Bloom.maxChan + 1)),
    );
    this.chans = resamp1(ctrl, n).map(c =>
      Math.max(0, Math.min(Bloom.maxChan, Math.round(c))),
    );
    return this;
  }

  /** Cluster the palette down to at most maxDistinct channels by merging nearest pairs */
  quantizeChanPalette(maxDistinct = 4): this {
    let pal = this.chanPalette();
    while (pal.length > maxDistinct) {
      const counts = new Map<number, number>();
      this.chans.forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1));
      // find the adjacent pair with the smallest gap; merge the rarer into the commoner
      let bestI = 0;
      for (let i = 1; i < pal.length - 1; i++) {
        if (pal[i + 1] - pal[i] < pal[bestI + 1] - pal[bestI]) bestI = i;
      }
      const [a, b] = [pal[bestI], pal[bestI + 1]];
      const drop = (counts.get(a) ?? 0) <= (counts.get(b) ?? 0) ? a : b;
      const keep = drop === a ? b : a;
      this.chans = this.chans.map(c => (c === drop ? keep : c));
      pal = this.chanPalette();
    }
    return this;
  }

  /** Clear: all chans → 0 */
  clearChans(): this {
    this.chans = this.chans.map(() => 0);
    return this;
  }

  /** Fresh random channel array, one per note — the chan analog of a new seed */
  newChans(): this {
    this.chans = this.notes.map(() => Math.floor(Math.random() * (Bloom.maxChan + 1)));
    return this;
  }

  /** Move every chan to the next/previous channel in the palette — the diatonic shift */
  dShiftChans(n = 1): this {
    const pal = this.chanPalette();
    if (pal.length < 2) return this;
    const len = pal.length;
    this.chans = this.chans.map(c => pal[(((pal.indexOf(c) + n) % len) + len) % len]);
    return this;
  }

  // Channel-only patterns, lacing and copying are the shared list operations:
  // patternList('chan', …), laceList('chan', …), copyList('chan', …)

  // ─── Events ────────────────────────────────────────────────────────────────
  // A note with its velocity, time, channel and intervals step. Whole-note
  // operations reorder events, so each note keeps its own rhythm, dynamic and
  // instrument. Lists of other lengths are first wrapped to the notes' length
  // (what one play-through sounds like), which bakes in any phasing.

  events(): NoteEvent[] {
    const at = <T>(arr: T[], i: number, fallback: T): T => (arr.length ? wrapAt(arr, i) : fallback);
    return this.notes.map((note, i) => ({
      note,
      vel: at(this.velocities, i, 60),
      time: at(this.timeIntervals, i, 0.25),
      chan: at(this.chans, i, Bloom.defaultChan),
      iv: at(this.intervals, i, 0 as IntervalVal),
      fig: at(this.figures, i, 0 as Figure),
    }));
  }

  setEvents(evs: NoteEvent[]): this {
    if (evs.length === 0) return this;
    // an untouched [0] intervals list stays as it is
    const carryIntervals = this.hasIntervals();
    const carryFigures = this.hasFigures();
    this.notes = evs.map(e => JSON.parse(JSON.stringify(e.note)) as NoteVal);
    this.velocities = evs.map(e => e.vel);
    this.timeIntervals = evs.map(e => e.time);
    this.chans = evs.map(e => e.chan);
    if (carryIntervals) this.intervals = evs.map(e => JSON.parse(JSON.stringify(e.iv)) as IntervalVal);
    if (carryFigures) this.figures = evs.map(e => JSON.parse(JSON.stringify(e.fig ?? 0)) as Figure);
    return this;
  }

  /** Reorder or repeat whole notes with one of the shared patterns */
  patternEvents(op: PatternOp): this {
    return this.setEvents(PATTERNS[op](this.events()));
  }

  // ─── Lists ─────────────────────────────────────────────────────────────────
  // Any one list, the others left where they are. A list that changes length
  // phases against the notes at playback.

  getList(k: ListKey): unknown[] {
    switch (k) {
      case 'notes': return this.notes;
      case 'time': return this.timeIntervals;
      case 'vel': return this.velocities;
      case 'chan': return this.chans;
      case 'iv': return this.intervals;
    }
  }

  setList(k: ListKey, arr: unknown[]): void {
    switch (k) {
      case 'notes': this.notes = arr as NoteArray; break;
      case 'time': this.timeIntervals = arr as number[]; break;
      case 'vel': this.velocities = arr as number[]; break;
      case 'chan': this.chans = arr as number[]; break;
      case 'iv': this.intervals = arr as IntervalVal[]; break;
    }
  }

  patternList(k: ListKey, op: PatternOp): this {
    const arr = this.getList(k);
    if (arr.length > 0) this.setList(k, PATTERNS[op](arr));
    return this;
  }

  /** Interlace one list with the same list of another bloom */
  laceList(k: ListKey, other: Bloom): this {
    const a = this.getList(k);
    const b = JSON.parse(JSON.stringify(other.getList(k))) as unknown[];
    if (a.length && b.length) this.setList(k, lace([a, b], Math.max(a.length, b.length) * 2 - 1));
    return this;
  }

  /** Copy one list from another bloom */
  copyList(k: ListKey, other: Bloom): this {
    const b = other.getList(k);
    if (b.length) this.setList(k, JSON.parse(JSON.stringify(b)));
    return this;
  }

  /** Sort pitches low to high (or high to low), leaving the rhythm where it is */
  sortNotes(descending = false): this {
    const key = (n: NoteVal): number => (Array.isArray(n) ? Math.min(...(flatNotes(n as NoteArray) as number[])) : n as number);
    this.notes = [...this.notes].sort((a, b) => (descending ? key(b) - key(a) : key(a) - key(b)));
    return this;
  }

  /**
   * The distinct values a list uses, sorted: the bloom's own vocabulary of
   * durations, dynamic levels or instruments. A rest (velocity 0) isn't a level.
   */
  paletteOf(k: 'time' | 'vel' | 'chan'): number[] {
    const src = k === 'time' ? this.timeIntervals.map(roundTime)
      : k === 'vel' ? this.velocities.filter(v => v > 0)
      : this.chans;
    return [...new Set(src)].sort((a, b) => a - b);
  }

  /** Move a time k steps along the palette; past either end it keeps halving or doubling */
  private stepTime(t: number, k: number, pal: number[]): number {
    if (pal.length === 0) return t;
    const j = nearestByRatio(pal, t) + k;
    if (j < 0) return roundTime(pal[0] / 2 ** -j);
    if (j >= pal.length) return roundTime(pal[pal.length - 1] * 2 ** (j - pal.length + 1));
    return pal[j];
  }

  /** Move a velocity k levels along the palette; past either end it moves 8 at a time */
  private stepVel(v: number, k: number, pal: number[]): number {
    if (pal.length === 0) return v;
    const j = nearestLinear(pal, v) + k;
    if (j < 0) return pal[0] + 8 * j;
    if (j >= pal.length) return pal[pal.length - 1] + 8 * (j - pal.length + 1);
    return pal[j];
  }

  /**
   * Apply a shared verb to one list. `amount` is the quantize setting: the grid
   * for time, the most distinct levels for velocity and channels. Returns false
   * when the verb has no meaning for that list.
   */
  shapeList(k: ListKey, verb: ListVerb, amount = 4): boolean {
    if (verb === 'tiltDown' || verb === 'tiltUp') return this.tiltList(k, verb === 'tiltUp' ? 1 : -1);
    if (k === 'notes') return this.shapePitch(verb, amount);
    // only pitch has a key to leave; elsewhere N is n
    if (verb === 'renewWild' && k !== 'iv') verb = 'renew';   // intervals: n keeps where, N doesn't
    if (k === 'time') return this.shapeTimes(verb, amount);
    if (k === 'vel') return this.shapeVels(verb, amount);
    if (k === 'iv') return this.shapeIntervals(verb, amount);
    return this.shapeChans(verb, amount);
  }

  // Pitch verbs count in scale steps, so the scale is pitch's palette. Chords
  // keep their shape: every tone moves, and the nesting is restored after.
  // Tilt builds up: each press makes the slope one step steeper (or shallower),
  // always measured from the list as it was before the first press, so
  // b b b gives the same line as one tilt three steps steep. Any other change
  // to the list starts afresh.
  private tiltMemo = new Map<ListKey, { base: string; after: string; slope: number }>();

  private tiltList(k: ListKey, dir: 1 | -1): boolean {
    const now = JSON.stringify(this.getList(k));
    const memo = this.tiltMemo.get(k);
    const going = memo && memo.after === now;
    const base = going ? memo.base : now;
    const slope = (going ? memo.slope : 0) + dir;
    this.setList(k, JSON.parse(base) as unknown[]);
    if (slope !== 0) this.shapeList(k, 'tilt', slope);
    this.tiltMemo.set(k, { base, after: JSON.stringify(this.getList(k)), slope });
    return true;
  }

  private shapePitch(verb: ListVerb, amount = 0): boolean {
    const flat = flatNotes(this.notes) as number[];
    const n = flat.length;
    if (n === 0) return true;
    const scale = this.appliedScale ?? this.asScale();
    const toDeg = (m: number) => keyToDegree(m, scale.degrees, scale.pitchesPerOctave);
    const toKey = (d: number) => degreeToKey(Math.round(d), scale.degrees, scale.pitchesPerOctave);
    const degs = flat.map(toDeg);
    const sorted = [...degs].sort((a, b) => a - b);
    const centre = sorted[Math.floor((n - 1) / 2)];
    // map flat pitches by degree, keeping chords
    const setDegs = (fn: (d: number, i: number) => number) => {
      this.saveNest();
      this.notes = degs.map((d, i) => toKey(fn(d, i)));
      this.restoreNest();
      this.enforceRange();
    };

    switch (verb) {
      case 'mutate': this.mutateNotesD(); break;
      case 'mutateWild': this.mutateNotes(); break;
      case 'nudgeDown': this.transpose(-1); break;
      case 'nudgeUp': this.transpose(1); break;
      case 'octaveDown': this.transpose(-12); break;
      case 'octaveUp': this.transpose(12); break;
      case 'stepDown': this.dTranspose(-1); break;
      case 'stepUp': this.dTranspose(1); break;
      case 'breezeDown': this.breeze(-1); break;
      case 'breezeUp': this.breeze(1); break;
      // one scale step toward / away from the middle pitch: narrower or wider range
      case 'converge': setDegs(d => (d === centre ? d : d + Math.sign(centre - d))); break;
      case 'diverge': setDegs(d => (d !== centre ? d + Math.sign(d - centre) : coin(0.25) ? d + (coin(0.5) ? 1 : -1) : d)); break;
      case 'unify': setDegs(() => modeOf(degs)); break;
      // highest ↔ lowest, mirrored in scale steps within the range
      case 'invert': setDegs(d => sorted[0] + sorted[n - 1] - d); break;
      case 'invertMid': this.invertMean(); break;
      // a tilt: up to three scale steps up or down by the end
      // the last note `amount` scale steps up (or down), the first where it was
      case 'tilt': setDegs((d, i) => d + Math.round((i / Math.max(1, n - 1)) * amount)); break;
      case 'curve': {
        const ctrl = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => rrand(-3, 3));
        const offs = resamp1(ctrl, n);
        setDegs((d, i) => d + Math.round(offs[i]));
        break;
      }
      case 'sortUp': this.sortNotes(); break;
      case 'sortDown': this.sortNotes(true); break;
      case 'fewer': this.fewerPitchClasses(); break;
      case 'more': this.morePitchClasses(); break;
      case 'quantize': this.applyScale(scale); break;
      case 'renew': setDegs(() => toDeg(Math.round(rrand(this.lowestSeedNote, this.highestSeedNote)))); break;
      // all twelve: the new pitches leave the scale behind, as a new bloom does
      case 'renewWild':
        this.saveNest();
        this.notes = flat.map(() => Math.round(rrand(this.lowestSeedNote, this.highestSeedNote)));
        this.restoreNest();
        this.appliedScale = null;
        this.enforceRange();
        break;
      case 'dropLast': if (this.notes.length > 1) this.notes = this.notes.slice(0, -1); break;
      // as at home: a adds a note in the scale (pitch's palette), A any note
      case 'addFromPalette': this.notes = [...this.notes, toKey(rrand(Math.min(...degs) - 2, Math.max(...degs) + 2))]; break;
      case 'addRandom': {
        const flat = flatNotes(this.notes) as number[];
        this.notes = [...this.notes, Math.round(rrand(Math.min(...flat) - 2, Math.max(...flat) + 2))];
        break;
      }
      default: return false;
    }
    return true;
  }

  // ─── Pitch classes ──────────────────────────────────────────────────────────
  // The scale follows: one class fewer takes it out of the scale, one more adds
  // it, so scale steps and a pitch freeze keep agreeing with what's played.

  private pcOf = (m: number) => ((Math.round(m) % 12) + 12) % 12;

  /** The scale as absolute pitch classes, named after the catalogue when it matches */
  private setScalePcs(pcs: number[]): void {
    const degrees = [...new Set(pcs.map(this.pcOf))].sort((a, b) => a - b);
    this.appliedScale = { degrees, pitchesPerOctave: 12, name: nameScaleDegrees(degrees) };
  }

  /** The nearest pitch to m whose class is in `pcs` (ties broken at random) */
  private nearestWithPc(m: number, pcs: Set<number>): number {
    for (let k = 1; k <= 6; k++) {
      const opts = [m - k, m + k].filter(x => pcs.has(this.pcOf(x)));
      if (opts.length) return pick(opts);
    }
    return m;
  }

  /** One pitch class fewer: the least-used class goes, its notes move to the nearest class still in use */
  fewerPitchClasses(): this {
    const flat = flatNotes(this.notes) as number[];
    const count = new Map<number, number>();
    flat.forEach(m => count.set(this.pcOf(m), (count.get(this.pcOf(m)) ?? 0) + 1));
    if (count.size < 2) return this;
    const least = Math.min(...count.values());
    const gone = pick([...count.keys()].filter(pc => count.get(pc) === least));
    const keep = new Set([...count.keys()].filter(pc => pc !== gone));
    const scaleBefore = (this.appliedScale ?? this.asScale()).degrees;
    this.saveNest();
    this.notes = flat.map(m => (this.pcOf(m) === gone ? this.nearestWithPc(m, keep) : m));
    this.restoreNest();
    this.enforceRange();
    this.setScalePcs([...scaleBefore.filter(d => this.pcOf(d) !== gone), ...keep]);
    return this;
  }

  /**
   * One pitch class more. An unused note of the scale comes in if there is
   * one; otherwise the scale gains the chromatic note that makes a named scale
   * (else any). A note whose class is doubled moves there; if every note has
   * its own class, a note is added instead.
   */
  morePitchClasses(): this {
    const flat = flatNotes(this.notes) as number[];
    if (!flat.length) return this;
    const used = new Set(flat.map(this.pcOf));
    const scalePcs = new Set((this.appliedScale ?? this.asScale()).degrees.map(this.pcOf));
    flat.forEach(m => scalePcs.add(this.pcOf(m)));
    let fresh = [...scalePcs].filter(pc => !used.has(pc));
    if (!fresh.length) {
      const outside = Array.from({ length: 12 }, (_, i) => i).filter(pc => !scalePcs.has(pc));
      if (!outside.length) return this;   // all twelve already
      const named = outside.filter(pc => nameScaleDegrees([...scalePcs, pc]) !== '');
      fresh = named.length ? named : outside;
    }
    const pc = pick(fresh);
    const doubled = flat.map((_, i) => i).filter(i => flat.filter(x => this.pcOf(x) === this.pcOf(flat[i])).length > 1);
    if (doubled.length) {
      // the doubled note closest to the new class moves
      const dist = (i: number) => Math.abs(this.nearestWithPc(flat[i], new Set([pc])) - flat[i]);
      const best = Math.min(...doubled.map(dist));
      const i = pick(doubled.filter(j => dist(j) === best));
      const out = [...flat];
      out[i] = this.nearestWithPc(flat[i], new Set([pc]));
      this.saveNest(); this.notes = out; this.restoreNest();
    } else {
      const mid = [...flat].sort((a, b) => a - b)[Math.floor(flat.length / 2)];
      this.notes = [...this.notes, this.nearestWithPc(mid, new Set([pc]))];
    }
    this.enforceRange();
    this.setScalePcs([...scalePcs, pc]);
    return this;
  }

  // Time verbs work along the palette where they can (halves and doubles of the
  // durations already there), so the groove's vocabulary survives them
  private shapeTimes(verb: ListVerb, amount: number): boolean {
    const ts = this.timeIntervals;
    const n = ts.length;
    if (n === 0) return true;
    const pal = this.paletteOf('time');
    // the commonest duration, or the middle of the palette when none repeats
    const target = pal.length === n ? pal[Math.floor((pal.length - 1) / 2)] : modeOf(ts.map(roundTime));
    const ti = nearestByRatio(pal, target);
    const set = (fn: (t: number, i: number) => number) => {
      this.timeIntervals = ts.map((t, i) => Math.max(MIN_TIME, roundTime(fn(t, i))));
    };

    switch (verb) {
      case 'mutate': set(t => {
        if (!coin(0.25)) return t;
        const others = pal.filter(p => p !== roundTime(t));
        return others.length ? pick(others) : t * pick([0.5, 2]);
      }); break;
      case 'mutateWild': this.mutateTime(); break;
      case 'divide': {
        // a few of the long durations (at least half the longest, likelier the
        // longer they are) each split into two or three equal parts, so a run
        // of presses works down from the long end and never starts on the short
        const longest = Math.max(...ts);
        const weights = ts.map(t => (t >= longest / 2 && t / 2 >= MIN_TIME ? t * t : 0));
        const picked = new Set<number>();
        const want = Math.max(1, Math.round(n * GESTURE.divide));
        while (picked.size < want && weights.some(w => w > 0)) {
          const i = weightedIndex(weights);
          picked.add(i);
          weights[i] = 0;
        }
        this.timeIntervals = ts.flatMap((t, i) => {
          if (!picked.has(i)) return [t];
          const parts = t / 3 >= MIN_TIME && coin(0.5) ? 3 : 2;
          return Array<number>(parts).fill(roundTime(t / parts));
        });
        break;
      }
      case 'nudgeDown': this.faster(); break;
      case 'nudgeUp': this.slower(); break;
      case 'octaveDown': this.scaleTimes(0.5); break;
      case 'octaveUp': this.scaleTimes(2); break;
      case 'stepDown': set(t => this.stepTime(t, -1, pal)); break;
      case 'stepUp': set(t => this.stepTime(t, 1, pal)); break;
      case 'breezeDown': case 'breezeUp': {
        const heat = this.breezeHeatFor('time', ts);
        const moving = someIndices(n, GESTURE.breeze, heat);
        const k = verb === 'breezeUp' ? 1 : -1;
        set((t, i) => (moving.has(i) ? this.stepTime(t, k, pal) : t));
        this.rememberBreeze('time', heat, moving, this.timeIntervals);
        break;
      }
      // one palette step toward / away from the commonest duration
      case 'converge': set(t => {
        const i = nearestByRatio(pal, t);
        return i === ti ? t : pal[i + Math.sign(ti - i)];
      }); break;
      case 'diverge': set(t => {
        const i = nearestByRatio(pal, t);
        if (i !== ti) return this.stepTime(t, Math.sign(i - ti), pal);
        return coin(0.25) ? this.stepTime(t, coin(0.5) ? 1 : -1, pal) : t;
      }); break;
      case 'unify': set(() => target); break;
      // longest ↔ shortest within the palette
      case 'invert': set(t => pal[pal.length - 1 - nearestByRatio(pal, t)]); break;
      // reflect around the geometric mean: doubling and halving are mirror images
      case 'invertMid': {
        const gm = Math.exp(mean(ts.map(t => Math.log(t))));
        set(t => (gm * gm) / t);
        break;
      }
      // accelerando or ritardando: up to two palette steps by the end
      // up: longer toward the end (ritardando); down: shorter (accelerando)
      case 'tilt': set((t, i) => this.stepTime(t, Math.round((i / Math.max(1, n - 1)) * amount), pal)); break;
      case 'curve': {
        const ctrl = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => rrand(-2, 2));
        const offs = resamp1(ctrl, n);
        set((t, i) => this.stepTime(t, Math.round(offs[i]), pal));
        break;
      }
      case 'sortUp': this.timeIntervals = [...ts].sort((a, b) => a - b); break;
      case 'sortDown': this.timeIntervals = [...ts].sort((a, b) => b - a); break;
      case 'fewer':
        if (pal.length > 1) this.timeIntervals = clusterValues(ts.map(roundTime), pal.length - 1, ratioDist);
        break;
      // some of the commonest duration take a new value: its half, double or dotted
      case 'more': {
        const fresh = [target / 2, target * 2, target * 1.5].map(roundTime).filter(v => !pal.includes(v));
        if (fresh.length === 0) break;
        const value = fresh[0];
        const idxs = ts.map((t, i) => (roundTime(t) === target ? i : -1)).filter(i => i >= 0);
        const out = [...ts];
        scramble(idxs).slice(0, Math.max(1, Math.ceil(idxs.length / 3))).forEach(i => { out[i] = value; });
        this.timeIntervals = out;
        break;
      }
      case 'quantize': this.quantize(amount); break;
      case 'renew': {
        const choices = pal.length > 1 ? pal : [target / 2, target, target * 2].map(roundTime);
        this.timeIntervals = this.notes.map(() => pick(choices));
        break;
      }
      case 'dropLast': if (n > 1) this.timeIntervals = ts.slice(0, -1); break;
      case 'addFromPalette': this.timeIntervals = [...ts, pick(ts)]; break;
      case 'addRandom':
        this.timeIntervals = [...ts, roundTime(exprand(this.timeRangeLow, this.timeRangeHi))];
        break;
      default: return false;
    }
    return true;
  }

  // Velocity verbs leave rests (0) as rests
  private shapeVels(verb: ListVerb, amount: number): boolean {
    const vs = this.velocities;
    const n = vs.length;
    const live = vs.filter(v => v > 0);
    const pal = this.paletteOf('vel');
    const set = (fn: (v: number, i: number) => number) => {
      this.velocities = vs.map((v, i) => (v === 0 ? 0 : clampVel(fn(v, i))));
    };
    if (live.length === 0 && !['renew', 'addRandom'].includes(verb)) return true;
    const m = live.length ? mean(live) : 60;
    const lo = Math.min(...live);
    const hi = Math.max(...live);

    switch (verb) {
      case 'mutate': set(v => (coin(0.5) ? v + rrand(-10, 10) : v)); break;
      case 'mutateWild': set(v => v + rrand(-30, 30)); break;
      case 'nudgeDown': this.softer(); break;
      case 'nudgeUp': this.louder(); break;
      case 'octaveDown': set(v => Math.max(20, v / 1.5)); break;
      case 'octaveUp': set(v => v * 1.5); break;
      case 'stepDown': set(v => this.stepVel(v, -1, pal)); break;
      case 'stepUp': set(v => this.stepVel(v, 1, pal)); break;
      case 'breezeDown': case 'breezeUp': {
        const heat = this.breezeHeatFor('vel', vs);
        const moving = someIndices(n, GESTURE.breeze, heat);
        const k = verb === 'breezeUp' ? 1 : -1;
        set((v, i) => (moving.has(i) ? this.stepVel(v, k, pal) : v));
        this.rememberBreeze('vel', heat, moving, this.velocities);
        break;
      }
      // flatter or wider dynamics around the mean; accents keep their places
      case 'converge': set(v => m + (v - m) * 0.75); break;
      case 'diverge': set(v => (hi === lo ? v + rrand(-8, 8) : m + (v - m) * 1.33)); break;
      case 'unify': set(() => m); break;
      case 'invert': set(v => lo + hi - v); break;
      case 'invertMid': set(v => 2 * m - v); break;
      // a dynamic ramp across the bloom, crescendo or decrescendo
      // a ramp about the middle: up is a crescendo, down a decrescendo
      case 'tilt': set((v, i) => v + amount * (i / Math.max(1, n - 1) - 0.5) * 16); break;
      // hairpins: a smooth contour through a few random levels
      case 'curve': {
        const ctrl = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => rrand(30, 110));
        const contour = resamp1(ctrl, n);
        set((_, i) => contour[i]);
        break;
      }
      case 'sortUp': this.crescendo(); break;
      case 'sortDown': this.decrescendo(); break;
      case 'fewer':
        if (pal.length > 1) this.velocities = clusterValues(vs, pal.length - 1, linearDist, v => v === 0);
        break;
      case 'more': set(v => (coin(0.33) ? v + pick([-12, 12]) : v)); break;
      case 'quantize': this.velocities = clusterValues(vs, amount, linearDist, v => v === 0); break;
      case 'renew': this.velocities = this.notes.map(() => Math.round(exprand(40, 110))); break;
      case 'dropLast': if (n > 1) this.velocities = vs.slice(0, -1); break;
      case 'addFromPalette': this.velocities = [...vs, pick(live)]; break;
      case 'addRandom': this.velocities = [...vs, Math.round(exprand(30, 110))]; break;
      default: return false;
    }
    return true;
  }

  private shapeChans(verb: ListVerb, amount: number): boolean {
    switch (verb) {
      case 'mutate': this.mutateChansD(); break;
      case 'mutateWild': this.mutateChans(); break;
      case 'nudgeDown': this.shiftChans(-1); break;
      case 'nudgeUp': this.shiftChans(1); break;
      case 'stepDown': this.dShiftChans(-1); break;
      case 'stepUp': this.dShiftChans(1); break;
      // one step through the palette, for some notes only
      case 'breezeDown': case 'breezeUp': {
        const pal = this.chanPalette();
        if (pal.length < 2) break;
        const heat = this.breezeHeatFor('chan', this.chans);
        const moving = someIndices(this.chans.length, GESTURE.breeze, heat);
        const k = verb === 'breezeUp' ? 1 : -1;
        const len = pal.length;
        this.chans = this.chans.map((c, i) =>
          (moving.has(i) ? pal[(((pal.indexOf(c) + k) % len) + len) % len] : c));
        this.rememberBreeze('chan', heat, moving, this.chans);
        break;
      }
      case 'converge': this.convergeChans(); break;
      case 'diverge': this.divergeChans(); break;
      case 'unify': this.unifyChans(); break;
      case 'invert': this.invertChans(); break;
      case 'invertMid': this.invertChansModal(); break;
      case 'tilt': {
        const n = this.chans.length;
        this.chans = this.chans.map((c, i) =>
          Math.max(0, Math.min(Bloom.maxChan, c + Math.round((i / Math.max(1, n - 1)) * amount))));
        break;
      }
      case 'curve': this.curveChans(); break;
      case 'sortUp': this.sortChans(); break;
      case 'sortDown': this.chans = [...this.chans].sort((a, b) => b - a); break;
      case 'fewer': this.thinChanPalette(); break;
      case 'more': this.thickenChanPalette(); break;
      case 'quantize': this.quantizeChanPalette(amount); break;
      case 'renew': this.newChans(); break;
      case 'dropLast': this.dropChan(); break;
      case 'addFromPalette': this.recycleChan(); break;
      case 'addRandom': this.addChan(); break;
      default: return false;
    }
    return true;
  }

  /** The distinct steps the intervals list uses (a step that adds nothing isn't one) */
  intervalPalette(): IntervalVal[] {
    const seen = new Map<string, IntervalVal>();
    this.intervals.forEach(s => { const v = ivVal(ivArr(s)); if (v !== 0) seen.set(JSON.stringify(v), v); });
    const size = (v: IntervalVal) => ivArr(v).reduce((a, x) => a + Math.abs(widthOf(x)), 0);
    return [...seen.values()].sort((a, b) => ivArr(a).length - ivArr(b).length || size(a) - size(b));
  }

  /**
   * Widen (k > 0) or narrow an interval k places along a ladder of sizes,
   * keeping its side; off either end it moves by the ladder's end gap.
   */
  private stepInterval(iv: number, k: number, ladders: { c: number[]; d: number[] }): number {
    const ladder = isDiatonic(iv) ? ladders.d : ladders.c;
    const size = Math.abs(countOf(iv));
    let to: number;
    if (ladder.length < 2) to = size + k;
    else {
      const j = nearestLinear(ladder, size) + k;
      const last = ladder.length - 1;
      to = j < 0 ? ladder[0] + j * (ladder[1] - ladder[0])
        : j > last ? ladder[last] + (j - last) * (ladder[last] - ladder[last - 1])
        : ladder[j];
    }
    return makeIv(isDiatonic(iv), Math.sign(iv) * Math.max(1, to));
  }

  /**
   * The intervals list as a list like any other. Each step adds notes above or
   * below its parent (0 adds nothing and, like a rest, is left alone). Each
   * interval keeps its kind: a chromatic one moves by semitones, a diatonic
   * one by scale steps (lib/intervals). The palette is the bloom's own distinct
   * steps; the steps along it are the single intervals in use, else the
   * consonant pool.
   */
  private shapeIntervals(verb: ListVerb, amount: number): boolean {
    if (this.intervals.length === 0) this.intervals = [0];
    const st = this.intervals;
    const n = st.length;
    const pool = [...(this.intervalKind() ? DIATONIC_INTERVALS : CHROMATIC_INTERVALS)];
    const singles = [...new Set(st.flatMap(ivArr))];
    // sizes in use (of each kind), else the pool's
    const sizes = (dia: boolean, from: number[]) =>
      [...new Set(from.filter(iv => isDiatonic(iv) === dia).map(iv => Math.abs(countOf(iv))))].sort((a, b) => a - b);
    const ladderOf = (dia: boolean) => {
      const used = sizes(dia, singles);
      return used.length >= 2 ? used : sizes(dia, dia ? DIATONIC_INTERVALS : CHROMATIC_INTERVALS);
    };
    const ladders = { c: ladderOf(false), d: ladderOf(true) };
    const pal = this.intervalPalette();
    // fn gets each interval's count in its own unit (and the interval); the
    // result keeps the kind. One that lands on 0 (unison) goes past it instead.
    const each = (fn: (n: number, iv: number, i: number) => number) => {
      this.intervals = st.map((s, i) => ivVal(ivArr(s).map(iv => {
        const c = countOf(iv);
        const x = Math.round(fn(c, iv, i));
        return makeIv(isDiatonic(iv), x === 0 ? -Math.sign(c) : x);
      })));
    };
    const mag = (c: number, m: number) => Math.sign(c) * Math.max(1, m);
    const live = st.map((_, i) => i).filter(i => ivArr(st[i]).length > 0);
    const randomStep = (): IntervalVal => (coin(0.15) ? ivVal([this.randomInterval(), this.randomInterval()]) : this.randomInterval());
    const nearestOther = (s: IntervalVal, others: IntervalVal[]) =>
      others.reduce((best, o) => (ivDist(s, o) < ivDist(s, best) ? o : best), others[0]);
    const fewer = () => {
      const p = this.intervalPalette();
      if (p.length < 2) return;
      const count = (v: IntervalVal) => this.intervals.filter(s => ivKey(s) === JSON.stringify(v)).length;
      const least = Math.min(...p.map(count));
      const gone = pick(p.filter(v => count(v) === least));
      const rest = p.filter(v => v !== gone);
      const to = nearestOther(gone, rest);
      this.intervals = this.intervals.map(s => (ivKey(s) === JSON.stringify(gone) ? JSON.parse(JSON.stringify(to)) : s));
    };

    switch (verb) {
      // some steps become another step already in use (or a fresh one)
      case 'mutate':
        this.intervals = st.map(s => {
          if (!coin(0.5) || !ivArr(s).length) return s;
          const others = pal.filter(v => JSON.stringify(v) !== ivKey(s));
          return others.length ? JSON.parse(JSON.stringify(pick(others))) : randomStep();
        });
        break;
      case 'mutateWild': this.intervals = st.map(s => (coin(0.5) ? this.randomIntervalStep() : s)); break;
      case 'nudgeDown': each(c => c - 1); break;
      case 'nudgeUp': each(c => c + 1); break;
      // the same pitch class, on the other side or an octave further
      case 'octaveDown': each((c, iv) => c - octaveOf(iv)); break;
      case 'octaveUp': each((c, iv) => c + octaveOf(iv)); break;
      case 'stepDown': each((_, iv) => countOf(this.stepInterval(iv, -1, ladders))); break;
      case 'stepUp': each((_, iv) => countOf(this.stepInterval(iv, 1, ladders))); break;
      case 'breezeDown': case 'breezeUp': {
        const heat = this.breezeHeatFor('iv', st);
        const moving = someIndices(n, GESTURE.breeze, heat);
        const k = verb === 'breezeUp' ? 1 : -1;
        each((c, iv, i) => (moving.has(i) ? countOf(this.stepInterval(iv, k, ladders)) : c));
        this.rememberBreeze('iv', heat, moving, this.intervals);
        break;
      }
      // where the chords fall: evener gaps, or more uneven ones
      case 'converge': return this.respaceIntervals(true);
      case 'diverge': return this.respaceIntervals(false);
      // every step that adds something adds the commonest step
      case 'unify': {
        if (!pal.length) break;
        const common = modeOf(live.map(i => pal.findIndex(v => JSON.stringify(v) === ivKey(st[i]))));
        this.intervals = st.map(s => (ivArr(s).length ? JSON.parse(JSON.stringify(pal[common])) : s));
        break;
      }
      // above ↔ below
      case 'invert': each(c => -c); break;
      // wide ↔ close: the k-th smallest size (of its kind) becomes the k-th largest
      case 'invertMid': {
        each((c, iv) => {
          const sz = sizes(isDiatonic(iv), singles);
          return mag(c, sz[sz.length - 1 - sz.indexOf(Math.abs(c))]);
        });
        break;
      }
      // closing in or opening out across the list
      // up: steps widen toward the end; down: they close in
      case 'tilt': each((c, _, i) => mag(c, Math.abs(c) + Math.round(amount * (i / Math.max(1, n - 1) - 0.5) * 2))); break;
      case 'curve': {
        const ctrl = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => rrand(-3, 3));
        const offs = resamp1(ctrl, n);
        each((c, _, i) => mag(c, Math.abs(c) + Math.round(offs[i])));
        break;
      }
      case 'sortUp': case 'sortDown': {
        const size = (s: IntervalVal) => ivArr(s).reduce((a, x) => a + Math.abs(widthOf(x)), 0);
        this.intervals = [...st].sort((a, b) => (verb === 'sortUp' ? size(a) - size(b) : size(b) - size(a)));
        break;
      }
      case 'fewer': fewer(); break;
      // a repeated step (or a step adding nothing) becomes one not yet in use
      case 'more': {
        const keys = st.map(ivKey);
        const repeated = st.map((_, i) => i).filter(i => keys[i] !== '0' && keys.filter(k => k === keys[i]).length > 1);
        const empty = st.map((_, i) => i).filter(i => keys[i] === '0');
        const fresh = pool.filter(iv => !keys.includes(JSON.stringify(iv)));
        if (!fresh.length) break;
        const iv = pick(fresh);
        if (repeated.length) this.intervals[pick(repeated)] = iv;
        else if (empty.length) this.intervals[pick(empty)] = iv;
        else this.intervals = [...st, iv];
        break;
      }
      // into the scale: each chromatic interval becomes the scale step nearest its size
      case 'quantize': {
        if (!singles.some(iv => !isDiatonic(iv))) return false;
        this.intervals = st.map(s => ivVal(ivArr(s).map(iv => (isDiatonic(iv) ? iv : makeIv(true, Math.sign(iv) * Math.max(1, Math.round(Math.abs(iv) * 7 / 12)))))));
        break;
      }
      // n: new chords in the same places; N: new chords and places
      case 'renew': {
        if (!live.length) { this.randIntervals(); break; }
        this.intervals = st.map(s => (ivArr(s).length ? (coin(0.15) ? ivVal([this.randomInterval(), this.randomInterval()]) : this.randomInterval()) : 0));
        break;
      }
      case 'renewWild': this.randIntervals(); break;
      case 'dropLast': this.dropInterval(); break;
      case 'addFromPalette': this.intervals = [...st, pal.length ? JSON.parse(JSON.stringify(pick(pal))) : this.randomInterval()]; break;
      case 'addRandom': this.intervals = [...st, randomStep()]; break;
      default: return false;
    }
    return true;
  }

  // ─── Split / merge ─────────────────────────────────────────────────────────
  // Groove-safe rhythm edits. A split turns a note into repeats of itself
  // sharing its length (two, unless asked for more); a merge lets a note absorb the next one's time. The total stays the
  // same and durations stay among halves and doubles of what's already there.

  /** Split a note into `slices` repeats; false when none is long enough */
  splitNote(slices = 2): boolean {
    return this._splitAt(-1, slices) >= 0;
  }

  mergeNote(): this {
    this._mergeAt();
    return this;
  }

  /** Split a note (not `avoid`) into `slices`, preferring long notes whose slice is already in the palette. Returns its index or -1. */
  private _splitAt(avoid = -1, slices = 2): number {
    const evs = this.events();
    if (evs.length === 0) return -1;
    const pal = new Set(this.paletteOf('time'));
    const weights = evs.map((e, i) => {
      if (i === avoid || e.time / slices < MIN_TIME) return 0;
      return e.time * (pal.has(roundTime(e.time / slices)) ? 3 : 1);
    });
    if (weights.every(w => w === 0)) return -1;
    const i = weightedIndex(weights);
    const part = roundTime(evs[i].time / slices);
    evs.splice(i, 1, ...Array.from({ length: slices }, () => ({ ...evs[i], time: part })));
    this.setEvents(evs);
    return i;
  }

  /** Merge a note with the next one, preferring pairs whose sum is already in the palette (v/2 + v/2 → v). Returns its index or -1. */
  private _mergeAt(): number {
    const evs = this.events();
    if (evs.length < 3) return -1;
    const pal = new Set(this.paletteOf('time'));
    const weights = evs.slice(0, -1).map((e, i) => (pal.has(roundTime(e.time + evs[i + 1].time)) ? 4 : 1));
    const i = weightedIndex(weights);
    evs.splice(i, 2, { ...evs[i], time: roundTime(evs[i].time + evs[i + 1].time) });
    this.setEvents(evs);
    return i;
  }

  // ─── Gestures ──────────────────────────────────────────────────────────────
  // Whole-bloom moves that nudge pitch, rhythm, dynamics and channels a little
  // at once. Rhythm only changes by splitting and merging. Step sizes: GESTURE.

  /** Busier, louder, wider, more spread out */
  intensify(): this {
    for (let r = 0; r < GESTURE.rhythmEdits; r++) this._splitAt();
    this.shapeDynamics(1 + GESTURE.level, 1 + GESTURE.contrast);
    this.spreadPitch(1, GESTURE.pitchNotes);
    // bring back one rest
    const rest = this.velocities.indexOf(0);
    const live = this.velocities.filter(v => v > 0);
    if (rest >= 0 && live.length) this.velocities[rest] = Math.round(mean(live));
    if (Bloom.maxChan > 0 && this.chans.length && coin(GESTURE.chanChance)) {
      const i = Math.floor(Math.random() * this.chans.length);
      this.chans[i] = this.wrapChanVal(this.chans[i] + (coin(0.5) ? 1 : -1));
    }
    return this;
  }

  /** Sparser, softer, narrower, more unified */
  calm(): this {
    for (let r = 0; r < GESTURE.rhythmEdits; r++) this._mergeAt();
    this.shapeDynamics(1 - GESTURE.level, 1 - GESTURE.contrast);
    this.spreadPitch(-1, GESTURE.pitchNotes);
    if (coin(GESTURE.chanChance)) {
      const modal = this.modalChan();
      const strays = this.chans.map((c, i) => (c !== modal ? i : -1)).filter(i => i >= 0);
      if (strays.length) this.chans[pick(strays)] = modal;
    }
    return this;
  }

  /** Small changes all through: a few scale steps, a merge traded for a split, slight dynamics, a channel swap */
  vary(): this {
    const amt = GESTURE.vary;
    const s = this.scale;
    this.saveNest();
    this.notes = (flatNotes(this.notes) as number[]).map(note =>
      (coin(amt) ? this.stepPitch(note, coin(0.5) ? 1 : -1, s) : note));
    this.restoreNest();
    this.enforceRange();
    if (coin(0.5)) {
      const merged = this._mergeAt();
      if (merged >= 0) this._splitAt(merged);
    }
    this.velocities = this.velocities.map(v =>
      (v === 0 || !coin(amt * 1.5) ? v : clampVel(v + rrand(-GESTURE.varyVel, GESTURE.varyVel))));
    if (this.chanPalette().length > 1) this.mutateChansD(amt / 2);
    return this;
  }

  private stepPitch(note: number, k: number, s: Scale): number {
    const degree = Math.round(keyToDegree(note, s.degrees, s.pitchesPerOctave));
    return degreeToKey(degree + k, s.degrees, s.pitchesPerOctave);
  }

  /** Move the `count` notes farthest from the centre one scale step outward (dir 1) or inward (dir -1) */
  private spreadPitch(dir: 1 | -1, count: number): void {
    const s = this.scale;
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const lo = Math.min(...flat);
    const hi = Math.max(...flat);
    if (flat.length < 2 || (dir === -1 && hi - lo <= 2)) { this.nest = null; return; }
    const centre = (lo + hi) / 2;
    // shuffled first so equally distant notes take turns
    const order = scramble(flat.map((_, i) => i))
      .sort((a, b) => Math.abs(flat[b] - centre) - Math.abs(flat[a] - centre));
    order.slice(0, count).forEach(i => {
      const outward = flat[i] >= centre ? 1 : -1;
      flat[i] = this.stepPitch(flat[i], outward * dir, s);
    });
    this.notes = flat;
    this.restoreNest();
    this.enforceRange();
  }

  /** Scale the overall level and the accent contrast around the mean; rests stay rests */
  private shapeDynamics(level: number, contrast: number): void {
    const live = this.velocities.filter(v => v > 0);
    if (live.length === 0) return;
    const m = mean(live);
    this.velocities = this.velocities.map(v => (v === 0 ? 0 : clampVel(m * level + (v - m) * contrast)));
  }

  // ─── Intervals ─────────────────────────────────────────────────────────────
  // A fifth list, applied as the bloom is rendered: each step adds notes at the
  // given distances from the note it lands on. `notes` is never modified.

  /** True when the intervals array adds nothing */
  hasIntervals(): boolean {
    return this.intervals.some(step => (Array.isArray(step) ? step : [step]).some(iv => iv !== 0));
  }

  /**
   * The notes added to the note at `index`. `tick` selects the intervals step and
   * defaults to `index`; the looper passes its running count so the lists phase.
   */
  addedNotesAt(index: number, tick = index): number[] {
    if (this.intervals.length === 0 || this.notes.length === 0) return [];
    const step = wrapAt(this.intervals, tick);
    const ivs = (Array.isArray(step) ? step : [step]).filter(iv => iv !== 0);
    if (ivs.length === 0) return [];

    const noteVal = wrapAt(this.notes, index);
    const parents = Array.isArray(noteVal) ? flatNotes(noteVal as NoteArray) as number[] : [noteVal as number];
    const scale = ivs.some(isDiatonic) ? this.scale : null;

    const added: number[] = [];
    parents.forEach(parent => {
      ivs.forEach(iv => {
        let n = scale && isDiatonic(iv)
          ? degreeToKey(
            Math.round(keyToDegree(parent, scale.degrees, scale.pitchesPerOctave)) + countOf(iv),
            scale.degrees, scale.pitchesPerOctave,
          )
          : parent + iv;
        while (n > this.highestPossibleNote) n -= 12;
        while (n < this.lowestPossibleNote) n += 12;
        if (!parents.includes(n) && !added.includes(n)) added.push(n);
      });
    });
    return added;
  }

  // ─── Figures ───────────────────────────────────────────────────────────────
  // A sixth list, applied as the bloom is rendered: a note plays a figure
  // instead of itself (lib/figures). `notes` is never modified.

  hasFigures(): boolean {
    return this.figures.some(isFigure);
  }

  /** The figure the note read at `tick` plays, or null for none (an @slot that's empty is none) */
  figureAt(tick: number): Figure | null {
    if (!this.figures.length) return null;
    const f = wrapAt(this.figures, tick);
    if (isSlotFigure(f)) { const src = figureSlot(f.slot); return src && src.notes.length ? f : null; }
    return isFigure(f) ? f : null;
  }

  /** The pitches the note's figure plays besides the note itself (for the views; [] with no figure) */
  figureNotesAt(index: number, tick = index): number[] {
    if (!this.figureAt(tick) || !this.notes.length) return [];
    const nv = wrapAt(this.notes, index);
    const own = Array.isArray(nv) ? flatNotes(nv as NoteArray) as number[] : [nv as number];
    const out = new Set<number>();
    this.soundsAt(index, tick).forEach(s => { if (s.figure) s.notes.forEach(p => { if (!own.includes(p)) out.add(p); }); });
    return [...out];
  }

  /** What the views mark beside a note: the notes its intervals add and those its figure plays */
  extraNotesAt(index: number, tick = index): number[] {
    const added = this.addedNotesAt(index, tick);
    const fig = this.figureNotesAt(index, tick).filter(p => !added.includes(p));
    return fig.length ? added.concat(fig) : added;
  }

  hasExtraNotes(): boolean {
    return this.hasIntervals() || this.hasFigures();
  }

  /** A pitch moved by an interval (lib/intervals) as the intervals list moves it, kept in range */
  private moveBy(parent: number, iv: number): number {
    const scale = this.scale;
    let n = isDiatonic(iv)
      ? degreeToKey(Math.round(keyToDegree(parent, scale.degrees, scale.pitchesPerOctave)) + countOf(iv), scale.degrees, scale.pitchesPerOctave)
      : parent + iv;
    while (n > this.highestPossibleNote) n -= 12;
    while (n < this.lowestPossibleNote) n += 12;
    return n;
  }

  /**
   * Everything that sounds for the note at `index` (of this view: call it on
   * sounding()), its other lists read at `tick`: the note with the notes the
   * intervals add, or its figure in their place. Times and gates in beats,
   * `at` from the note's onset.
   */
  soundsAt(index: number, tick = index, legato = this.legato, sustain = this.sustain): Sound[] {
    const noteVal = wrapAt(this.notes, index);
    const notes = Array.isArray(noteVal) ? flatNotes(noteVal as NoteArray) as number[] : [noteVal as number];
    const vel = wrapAt(this.velocities, tick);
    const time = wrapAt(this.timeIntervals, tick);
    const chan = wrapAt(this.chans, tick);
    const gateOf = (t: number, s = sustain, l = legato) => (s !== null ? s : t * l);
    if (vel <= 0) return [];
    const added = this.addedNotesAt(index, tick);
    const out: Sound[] = [];
    const fig = this.figureAt(tick);
    if (added.length) out.push({ at: 0, notes: added, vel: Math.max(1, Math.round(vel * ADDED_NOTE_VELOCITY)), chan, gate: gateOf(time), added: true });

    if (!fig) { out.unshift({ at: 0, notes, vel, chan, gate: gateOf(time) }); return out; }

    if (isRunFigure(fig)) {
      // subdivide: the steps share the note's time, each from the note itself
      const dt = time / fig.length;
      fig.forEach((step, k) => {
        if (step === null) return;
        out.push({ at: k * dt, notes: notes.map(p => (step === 0 ? p : this.moveBy(p, step))), vel, chan, gate: gateOf(dt), figure: true });
      });
      return out;
    }

    // superimpose: the slot's bloom from its first note, moved to land on this one
    const src = figureSlot((fig as { slot: number }).slot)!.sounding();
    const first = flatNotes([src.notes[0]] as NoteArray) as number[];
    const from = Math.min(...first), to = Math.min(...notes);
    const scale = this.appliedScale;
    const deg = (p: number) => keyToDegree(p, scale!.degrees, scale!.pitchesPerOctave);
    const move = (p: number): number => {
      let n = scale
        ? degreeToKey(Math.round(deg(to)) + Math.round(deg(p)) - Math.round(deg(from)), scale.degrees, scale.pitchesPerOctave)
        : p - from + to;
      while (n > this.highestPossibleNote) n -= 12;
      while (n < this.lowestPossibleNote) n += 12;
      return n;
    };
    const peak = Math.max(1, ...src.velocities);   // its loudest note as loud as this one
    let at = 0;
    src.notes.forEach((nv, i) => {
      const v = wrapAt(src.velocities, i);
      const t = wrapAt(src.timeIntervals, i);
      if (v > 0) {
        const ps = Array.isArray(nv) ? flatNotes(nv as NoteArray) as number[] : [nv as number];
        out.push({
          at, notes: ps.map(move), chan: wrapAt(src.chans, i),
          vel: Math.min(127, Math.max(1, Math.round(v * vel / peak))),
          gate: gateOf(t, src.sustain, src.legato), figure: true,
        });
      }
      at += t;
    });
    return out;
  }

  /**
   * Write the figures that divide notes into the notes (with the intervals
   * too, which sound at each note's start). Lists that phase are first played
   * out until they come out even. Figures from the garden run on their own
   * timelines, so they stay. False when there was nothing to bake.
   */
  bakeFigures(): boolean {
    if (!this.figures.some(isRunFigure) || this.notes.length === 0) return false;
    const n = this.notes.length;
    const m = this.figures.length;
    const length = Math.min((n * m) / gcd(n, m), Math.max(n, MAX_BAKED_LENGTH));
    const view = this.sounding();
    const notes: NoteVal[] = [], vels: number[] = [], times: number[] = [], chans: number[] = [], figs: Figure[] = [];
    for (let i = 0; i < length; i++) {
      const fig = this.figureAt(i);
      const vel = wrapAt(this.velocities, i), time = wrapAt(this.timeIntervals, i), chan = wrapAt(this.chans, i);
      const own = wrapAt(view.notes, i);
      const added = view.addedNotesAt(i % n, i);
      const chord = (ps: number[], extra: number[]): NoteVal => {
        const all = [...new Set([...ps, ...extra])].sort((a, b) => a - b);
        return all.length === 1 ? all[0] : all;
      };
      if (!fig || !isRunFigure(fig) || vel <= 0) {
        notes.push(added.length ? chord(Array.isArray(own) ? flatNotes(own as NoteArray) as number[] : [own as number], added) : JSON.parse(JSON.stringify(own)));
        vels.push(vel); times.push(time); chans.push(chan);
        const raw = wrapAt(this.figures, i);
        figs.push(isSlotFigure(raw) ? { slot: raw.slot } : 0);   // an @slot stays, empty or not
        continue;
      }
      // a rest inside the figure is a silent note
      const steps = view.soundsAt(i % n, i).filter(x => !x.added);
      const dt = time / fig.length;
      fig.forEach((step, k) => {
        const sound = steps.find(x => Math.abs(x.at - k * dt) < 1e-9);
        notes.push(sound ? chord(sound.notes, k === 0 ? added : []) : JSON.parse(JSON.stringify(own)));
        vels.push(step === null ? 0 : vel); times.push(dt); chans.push(chan); figs.push(0);
      });
    }
    this.notes = notes; this.velocities = vels; this.timeIntervals = times; this.chans = chans;
    this.figures = figs.some(isFigure) ? figs : [0];
    if (this.hasIntervals()) this.intervals = [0];
    return true;
  }

  /**
   * The kind new intervals take: true for diatonic. The kind most of the
   * list's intervals have; with none, diatonic when a scale is attached.
   */
  intervalKind(): boolean {
    const all = this.intervals.flatMap(ivArr);
    if (!all.length) return this.appliedScale !== null;
    return all.filter(isDiatonic).length * 2 >= all.length;
  }

  private randomInterval(): number {
    const pool = this.intervalKind() ? DIATONIC_INTERVALS : CHROMATIC_INTERVALS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** A random step: usually nothing, sometimes one interval, occasionally two */
  private randomIntervalStep(): IntervalVal {
    if (coin(0.5)) return 0;
    if (coin(0.15)) {
      const a = this.randomInterval();
      const b = this.randomInterval();
      return a === b ? a : [a, b].sort((x, y) => x - y);
    }
    return this.randomInterval();
  }

  /** Redraw every step. A pristine [0] list becomes a fresh list of 2–6 steps. */
  randIntervals(): this {
    const n = this.intervals.length > 1 ? this.intervals.length : 2 + Math.floor(Math.random() * 5);
    this.intervals = Array.from({ length: n }, () => this.randomIntervalStep());
    // a list of nothing but rests would be inaudible
    if (!this.hasIntervals()) this.intervals[n - 1] = this.randomInterval();
    return this;
  }

  /** Lengthen by one random step */
  addInterval(): this {
    this.intervals.push(this.randomIntervalStep());
    return this;
  }

  /** Shorten by one step */
  dropInterval(): this {
    if (this.intervals.length > 1) this.intervals.pop();
    return this;
  }

  /** Back to [0]: nothing added */
  resetIntervals(): this {
    this.intervals = [0];
    return this;
  }

  /**
   * Widen (or with a negative n, narrow) the intervals: each added note moves
   * further from (or closer to) its parent, above or below alike. In a stacked
   * step the k-th closest note moves k, so the stack's own spacing opens out
   * too ([3, 7] → [4, 9]) instead of the whole stack shifting. Narrowing stops
   * at 1, 2, 3… for the stack's notes; steps of 0 stay off.
   */
  incrementIntervals(n = 1): this {
    const widen = (ivs: number[]): number[] => {
      const order = ivs.map((_, i) => i).filter(i => ivs[i] !== 0)
        .sort((x, y) => Math.abs(widthOf(ivs[x])) - Math.abs(widthOf(ivs[y])));
      const out = [...ivs];
      order.forEach((i, rank) => {
        const c = countOf(ivs[i]);
        const mag = Math.max(rank + 1, Math.abs(c) + n * (rank + 1));
        out[i] = makeIv(isDiatonic(ivs[i]), Math.sign(c) * mag);
      });
      return out;
    };
    this.intervals = this.intervals.map(step =>
      Array.isArray(step) ? ivVal(widen(step)) : widen([step])[0],
    );
    return this;
  }

  rotateIntervals(n = 1): this {
    this.intervals = rotateArr(this.intervals, n);
    return this;
  }

  /**
   * Older saves counted every interval of a bloom in one unit, set by a
   * switch; written in that unit, they become intervals that carry their own.
   */
  adoptLegacyIntervals(diatonic: boolean): this {
    if (diatonic) {
      this.intervals = this.intervals.map(s => ivVal(ivArr(s).map(x => (isDiatonic(x) ? x : makeIv(true, x)))));
    }
    this.intervalsDiatonic = false;
    return this;
  }

  /**
   * Evener (true) or more uneven gaps between the chords, keeping the list's
   * length and the chords in order: one rest moves per press, from the widest
   * gap to the narrowest, or from a gap to another at random. The list is
   * taken round, so rests before the first chord belong to the last gap.
   */
  respaceIntervals(even: boolean): boolean {
    const st = this.intervals;
    const at = st.map((_, i) => i).filter(i => ivArr(st[i]).length);
    if (at.length < 2) return false;
    const L = st.length;
    const gaps = at.map((p, k) => ((at[(k + 1) % at.length] - p + L) % L) || L);
    let from: number, to: number;
    if (even) {
      const hi = Math.max(...gaps), lo = Math.min(...gaps);
      if (hi - lo < 2) return false;   // as even as whole steps allow
      from = pick(gaps.map((_, k) => k).filter(k => gaps[k] === hi));
      to = pick(gaps.map((_, k) => k).filter(k => gaps[k] === lo));
    } else {
      const roomy = gaps.map((_, k) => k).filter(k => gaps[k] > 1);
      if (!roomy.length) return false;
      from = pick(roomy);
      to = pick(gaps.map((_, k) => k).filter(k => k !== from));
    }
    gaps[from]--; gaps[to]++;
    const out: IntervalVal[] = [];
    at.forEach((p, k) => { out.push(st[p]); for (let r = 1; r < gaps[k]; r++) out.push(0); });
    // keep the first chord where it was
    this.intervals = rotateArr(out, at[0]);
    return true;
  }

  /**
   * One more voice in every chord (true), or one fewer (never fewer than one):
   * a new interval of the chord's own kind, from the consonant ones, on the
   * chord's side; thinning drops the widest.
   */
  thickenIntervals(more: boolean): boolean {
    let changed = false;
    this.intervals = this.intervals.map(s => {
      const ivs = ivArr(s);
      if (!ivs.length) return s;
      if (!more) {
        if (ivs.length < 2) return s;
        changed = true;
        const widest = ivs.reduce((w, iv) => (Math.abs(widthOf(iv)) > Math.abs(widthOf(w)) ? iv : w));
        return ivVal(ivs.filter(iv => iv !== widest));
      }
      const dia = isDiatonic(ivs[0]);
      const side = Math.sign(ivs.reduce((a, iv) => a + Math.sign(iv), 0)) || Math.sign(ivs[0]);
      const pool = (dia ? DIATONIC_INTERVALS : CHROMATIC_INTERVALS).filter(iv => Math.sign(iv) === side && !ivs.includes(iv));
      if (!pool.length) return s;
      changed = true;
      return ivVal([...ivs, pick(pool)]);
    });
    return changed;
  }

  /** Something to hear when the list is empty: a fifth below every fourth note */
  startIntervals(): this {
    this.intervals = [-7, 0, 0, 0];
    return this;
  }

  /**
   * Further apart (sparser) or closer together (denser): each step that adds
   * something gets one more rest after it, or one fewer if it has any.
   */
  spaceIntervals(more: boolean): this {
    const out: IntervalVal[] = [];
    const st = this.intervals;
    for (let i = 0; i < st.length; i++) {
      out.push(st[i]);
      if (!ivArr(st[i]).length) continue;
      let j = i + 1;
      while (j < st.length && !ivArr(st[j]).length) j++;
      const rests = j - i - 1;
      const keep = more ? rests + 1 : Math.max(0, rests - 1);
      for (let k = 0; k < keep; k++) out.push(0);
      // rests before the first step that adds something stay as they are
      i = j - 1;
    }
    this.intervals = out.length ? out : [0];
    return this;
  }

  /**
   * Write the added notes into `notes` as chords and reset the intervals.
   * When the lists phase, notes is first repeated until both come out even.
   */
  bakeIntervals(): this {
    if (!this.hasIntervals() || this.notes.length === 0) return this;
    const n = this.notes.length;
    const m = this.intervals.length;
    const length = Math.min((n * m) / gcd(n, m), Math.max(n, MAX_BAKED_LENGTH));
    this.notes = Array.from({ length }, (_, i) => {
      const noteVal = wrapAt(this.notes, i);
      const added = this.addedNotesAt(i);
      if (added.length === 0) return JSON.parse(JSON.stringify(noteVal)) as NoteVal;
      const parents = Array.isArray(noteVal) ? flatNotes(noteVal as NoteArray) as number[] : [noteVal as number];
      return [...parents, ...added].sort((a, b) => a - b);
    });
    this.intervals = [0];
    return this;
  }

  // ─── Storage ───────────────────────────────────────────────────────────────

  save(): this {
    this.saved = this.clone();
    return this;
  }

  restore(): this {
    if (this.saved) {
      this.import(this.saved);
      this.save();
    }
    return this;
  }

  push(): this {
    const snapshot = this.clone();
    // Snapshots don't carry their own history — without this, every push clones
    // the entire existing stack and memory grows exponentially
    snapshot.stack = [];
    this.stack.push(snapshot);
    return this;
  }

  pop(): this {
    const top = this.stack.pop();
    if (top) this.import(top);
    return this;
  }

  popAny(): this {
    if (this.stack.length > 0) {
      const idx = Math.floor(Math.random() * this.stack.length);
      const bloom = this.stack.splice(idx, 1)[0];
      this.import(bloom);
    }
    return this;
  }

  // ─── Housekeeping ──────────────────────────────────────────────────────────

  enforceRange(): this {
    const originalNotes = JSON.parse(JSON.stringify(this.notes));

    const flat = flatNotes(this.notes) as number[];
    const newNotes = flat.map(note => {
      let n = note;
      while (n < this.lowestPossibleNote) n += 12;
      while (n > this.highestPossibleNote) n -= 12;
      return n;
    });

    this.velocities = this.velocities.map(vel => Math.max(0, Math.min(127, vel)));

    this.timeIntervals = this.timeIntervals.map(ti => (ti < 0 ? 0.05 : ti));
    this.chans = this.chans.map(ch => (ch > 15 ? 0 : ch));

    this.notes = newNotes as NoteArray;
    this.notes = matchNesting(flatNotes(this.notes) as number[], originalNotes);
    // velocities/chans keep their original lengths — wrapAt handles cycling at playback

    return this;
  }

  wrapToNotes(): this {
    this.velocities = this.notes.map((_, i) => wrapAt(this.velocities, i));
    this.timeIntervals = this.notes.map((_, i) => wrapAt(this.timeIntervals, i));
    this.chans = this.notes.map((_, i) => wrapAt(this.chans, i));
    return this;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  get lowestNote(): number {
    return this._lowestNoteIdx();
  }

  get highestNote(): number {
    return this._highestNoteIdx();
  }

  get loudestNote(): number {
    return this._loudestNoteIdx();
  }

  private _lowestNoteIdx(notes?: number[]): number {
    const ns = notes ?? flatNotes(this.notes) as number[];
    return ns.indexOf(Math.min(...ns));
  }

  private _highestNoteIdx(notes?: number[]): number {
    const ns = notes ?? flatNotes(this.notes) as number[];
    return ns.indexOf(Math.max(...ns));
  }

  private _loudestNoteIdx(): number {
    return this.velocities.indexOf(Math.max(...this.velocities));
  }

  dur(): number {
    if (this.timeIntervals.length === 0) return 0;
    return this.notes.reduce((sum: number, _: NoteVal, i: number) => sum + wrapAt(this.timeIntervals, i), 0);
  }

  asDegrees(): number[] {
    const scale = this.scale;
    return (flatNotes(this.notes) as number[]).map(note =>
      keyToDegreeArr([note], scale.degrees, scale.pitchesPerOctave)[0],
    );
  }

  // ─── Fixed constraints ─────────────────────────────────────────────────────

  fixedDur: number | false = false;
  fixedDurMode: 'trim' | 'scale' = 'trim';
  fixedGrid: number | false = false;

  /**
   * Palette freezes, one per list. Each captures the bloom's palette when it's
   * switched on (the scale for pitch, the distinct durations, dynamic levels or
   * channels for the others) and, before each play, snaps anything off-palette
   * to its nearest value. Durations are compared by ratio.
   */
  frozen: {
    pitch: Scale | false; time: number[] | false; vel: number[] | false; chan: number[] | false;
    iv: IntervalVal[] | false;
  } = { pitch: false, time: false, vel: false, chan: false, iv: false };

  freeze(k: 'pitch' | 'time' | 'vel' | 'chan' | 'iv', on: boolean): this {
    if (k === 'pitch') this.frozen.pitch = on ? this.scale : false;
    else if (k === 'iv') this.frozen.iv = on && this.intervalPalette().length ? this.intervalPalette() : false;
    else this.frozen[k] = on && this.paletteOf(k).length ? this.paletteOf(k) : false;
    return this;
  }

  resolveFixed(): this {
    // rhythm palette first, so a frozen duration or grid still has the last word on time
    const ft = this.frozen.time;
    if (ft) this.timeIntervals = this.timeIntervals.map(t => ft[nearestByRatio(ft, t)]);
    if (this.fixedDurMode === 'trim') {
      this._resolveFixedGrid();
      this._resolveFixedDur();
    } else {
      this._resolveFixedDur();
      this._resolveFixedGrid();
      if (typeof this.fixedDur === 'number') this.trimToDur(this.fixedDur);
    }
    if (this.frozen.pitch) this.applyScale(this.frozen.pitch);
    const fv = this.frozen.vel;
    if (fv) this.velocities = this.velocities.map(v => (v === 0 ? 0 : fv[nearestLinear(fv, v)]));
    const fc = this.frozen.chan;
    if (fc) this.chans = this.chans.map(c => fc[nearestLinear(fc, c)]);
    const fi = this.frozen.iv;
    if (fi) {
      this.intervals = this.intervals.map(s => (ivArr(s).length === 0 ? s
        : JSON.parse(JSON.stringify(fi.reduce((best, o) => (ivDist(s, o) < ivDist(s, best) ? o : best), fi[0])))));
    }
    return this;
  }

  private _resolveFixedDur(): void {
    if (typeof this.fixedDur === 'number') {
      if (this.fixedDurMode === 'scale') this.scaleToDur(this.fixedDur);
      else this.trimToDur(this.fixedDur);
    }
  }

  private _resolveFixedGrid(): void {
    if (this.fixedGrid !== false) this.quantize(this.fixedGrid as number);
  }

  // ─── Playback interface (consumed by scheduler) ────────────────────────────

  /** Returns flat list of { note, velocity, time, chan } events for playback */
  /** One pass of the notes. `tick` is the running count the other lists are read at, so they keep phasing across passes. */
  /**
   * The bloom as it sounds: a raga sounds each note in the form of the step it
   * takes next (fitByDirection), so its notes can differ from those written.
   * A light view over this bloom with only the notes replaced, the written
   * ones kept in `writtenNotes`; the bloom itself when nothing differs.
   */
  sounding(tick = 0): Bloom {
    const s = this.appliedScale;
    if (!s?.up || !s.down) return this;
    const fitted = fitByDirection(this.notes, i => wrapAt(this.velocities, tick + i) > 0, s);
    if (fitted.every((v, i) => v === this.notes[i])) return this;
    const view = Object.create(this) as Bloom;
    view.notes = fitted;
    view.writtenNotes = this.notes;
    return view;
  }

  /** The note written at i, when the bloom sounds a different one there (a view from sounding()) */
  writtenAt(i: number): number | null {
    const w = this.writtenNotes?.[i];
    return typeof w === 'number' && w !== this.notes[i] ? w : null;
  }

  /** Write what a raga sounds into the notes (see sounding()); false when nothing differs */
  bakeRaga(): boolean {
    const view = this.sounding();
    if (view === this) return false;
    this.notes = view.notes;
    return true;
  }

  // ─── Report ────────────────────────────────────────────────────────────────

  report(): string {
    const scale = this.scale;
    const scaleName = this.appliedScale ? ` [${this.appliedScale.name}]` : '';
    const lines = [
      `notes:      ${JSON.stringify(this.notes)}`,
      `velocities: ${JSON.stringify(this.velocities)}`,
      `times:      ${JSON.stringify(this.timeIntervals.map(t => Math.round(t * 100) / 100))}`,
      `chans:      ${JSON.stringify(this.chans)}`,
      this.hasIntervals()
        ? `intervals:  ${JSON.stringify(this.intervals)} ${this.intervalsDiatonic ? 'scale steps' : 'semitones'}`
        : '',
      this.hasFigures() ? `figures:    ${JSON.stringify(this.figures)}` : '',
      `scale:      [${scale.degrees.join(',')}]${scaleName}`,
      this.name ? `name:       ${this.name}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }
}
