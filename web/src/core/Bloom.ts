// Core Bloom class — ported from Bloom.sc

import type { NoteVal, NoteArray } from '../lib/arrays';
import {
  wrapAt, wrapExtend, flatNotes, coin, exprand, rrand,
  scramble, perfectShuffle, mirror as mirrorArr, stutter as stutterArr,
  sputter as sputterArr, curdle as curdleArr, lace, slide as slideArr,
  pyramid as pyramidArr, permute as permuteArr, rotate as rotateArr,
  matchNesting, resamp1, normalizeSum, indexOfDoubles,
  moveDoublesUpOctave as moveDoublesUpOctaveArr,
} from '../lib/arrays';
import {
  spellToPC, justAbove, justBelow,
  softRound, invertChord, invertMean as invertMeanArr,
  negHarmony as negHarmonyFn,
} from '../lib/numbers';
import type { Scale } from '../lib/scales';
import {
  SCALES, mostSimilarTo, slantMatch,
  notesToScale, nearestInScaleUniqueArr, keyToDegreeArr, degreeToKeyArr,
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

// ─── Bloom class ──────────────────────────────────────────────────────────────

export class Bloom {
  notes: NoteArray;
  velocities: number[];
  timeIntervals: number[];
  chans: number[];

  lowestPossibleNote: number;
  highestPossibleNote: number;
  lowestSeedNote: number;
  highestSeedNote: number;
  timeRangeLow: number;
  timeRangeHi: number;
  legato: number;
  sustain: number | null;

  appliedScale: Scale | null;
  keyRoot: number;
  name: string;

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
    this.stack = [];

    const n = notes !== undefined ? notes : 60;
    const v = velocities !== undefined ? velocities : 60;
    const t = timeIntervals !== undefined ? timeIntervals : 0.25;
    const c = chans !== undefined ? chans : Bloom.defaultChan;

    this.notes = Array.isArray(n) ? (n as NoteArray) : [n as number];
    this.velocities = Array.isArray(v) ? (v as number[]) : [v as number];
    this.timeIntervals = Array.isArray(t) ? (t as number[]) : [t as number];
    this.chans = Array.isArray(c) ? (c as number[]) : [c as number];
  }

  // ─── Copy / Import ─────────────────────────────────────────────────────────

  clone(): Bloom {
    const b = new Bloom();
    b.notes = JSON.parse(JSON.stringify(this.notes));
    b.velocities = [...this.velocities];
    b.timeIntervals = [...this.timeIntervals];
    b.chans = [...this.chans];
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
    this.chans = [0];
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
      let v = vel + change;
      while (v < 0) v += 12;
      while (v > 127) v -= 12;
      return v;
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

  scramble(): this {
    this.notes = scramble(this.notes) as NoteArray;
    return this;
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
    // Ensure even length for perfect shuffle
    if (this.notes.length % 2 !== 0) {
      this.addOne(this.notes[0] as number, this.velocities[0], this.timeIntervals[0]);
    }
    this.notes = perfectShuffle(this.notes) as NoteArray;
    this.timeIntervals = perfectShuffle(this.timeIntervals);
    this.velocities = perfectShuffle(this.velocities);
    return this;
  }

  deepShuffle(): this {
    this.saveNest();
    this.notes = perfectShuffle(flatNotes(this.notes) as number[]);
    this.restoreNest();
    return this;
  }

  // ─── Rotation ──────────────────────────────────────────────────────────────

  rotate(n = 1): this {
    this.notes = rotateArr(this.notes, n) as NoteArray;
    this.timeIntervals = rotateArr(this.timeIntervals, n);
    return this;
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
    this.timeIntervals = this.timeIntervals.map(t =>
      Math.round(t * multiplier * 100) / 100,
    );
    return this;
  }

  faster(multiplier = 1.2): this {
    this.timeIntervals = this.timeIntervals.map(t =>
      Math.round((t / multiplier) * 100) / 100,
    );
    return this;
  }

  louder(multiplier = 1.2): this {
    this.velocities = this.velocities.map(v => Math.min(127, Math.round(multiplier * v)));
    return this;
  }

  softer(multiplier = 1.2): this {
    this.velocities = this.velocities.map(v => Math.max(20, Math.round(v / multiplier)));
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
    this.notes = stutterArr(this.notes, repetitions) as NoteArray;
    this.velocities = stutterArr(this.velocities, repetitions);
    this.timeIntervals = stutterArr(this.timeIntervals, repetitions);
    this.chans = stutterArr(this.chans, repetitions);
    return this;
  }

  sputter(probability = 0.3): this {
    // Create sputtered index plan, then map each array through it
    const indices = Array.from({ length: this.notes.length }, (_, i) => i);
    const plan = sputterArr(indices, probability);
    this.notes = plan.map(i => wrapAt(this.notes, i));
    this.timeIntervals = plan.map(i => wrapAt(this.timeIntervals, i));
    this.velocities = plan.map(i => wrapAt(this.velocities, i));
    this.chans = plan.map(i => wrapAt(this.chans, i));
    return this;
  }

  spray(probability = 0.25): this {
    this.notes = sputterArr(this.notes, probability) as NoteArray;
    this.velocities = sputterArr(this.velocities, probability);
    this.timeIntervals = sputterArr(this.timeIntervals, probability);
    return this;
  }

  mirror(): this {
    this.notes = mirrorArr(this.notes) as NoteArray;
    this.velocities = mirrorArr(this.velocities);
    this.timeIntervals = mirrorArr(this.timeIntervals);
    this.chans = mirrorArr(this.chans);
    return this;
  }

  pyramid(patternType = 1): this {
    this.notes = pyramidArr(this.notes, patternType) as NoteArray;
    this.timeIntervals = pyramidArr(this.timeIntervals, patternType);
    this.velocities = pyramidArr(this.velocities, patternType);
    return this;
  }

  slide(windowLength = 3): this {
    this.notes = slideArr(wrapExtend(this.notes, Math.max(this.notes.length, windowLength)), windowLength) as NoteArray;
    this.timeIntervals = slideArr(wrapExtend(this.timeIntervals, this.notes.length), windowLength);
    this.velocities = slideArr(wrapExtend(this.velocities, this.notes.length), windowLength);
    return this;
  }

  braid(windowLength = 3): this {
    return this.slide(windowLength);
  }

  ratchet(repetitions?: number, index?: number): this {
    const sorted = [...this.timeIntervals].sort((a, b) => b - a);
    const idx = index ?? this.timeIntervals.indexOf(sorted[0]);
    const reps = repetitions ?? (Math.random() < 0.5 ? 2 : 3);

    const note = wrapAt(this.notes, idx) as NoteVal;
    const vel = wrapAt(this.velocities, idx);
    const time = wrapAt(this.timeIntervals, idx);
    const chan = wrapAt(this.chans, idx);

    this.remove(idx);

    for (let r = 0; r < reps; r++) {
      if (time > 0) {
        this.notes.splice(idx + r, 0, note);
        this.velocities.splice(idx + r, 0, vel);
        this.timeIntervals.splice(idx + r, 0, time / reps);
        this.chans.splice(idx + r, 0, chan);
      }
    }
    return this;
  }

  quantize(grid = 4, margin = 0, strength = 1): this {
    const resolution = 1 / grid;
    this.timeIntervals = this.timeIntervals.map(t => softRound(t, resolution, margin, strength));
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

  shear(): this {
    this.saveNest();
    const flat = flatNotes(this.notes) as number[];
    const lowestIdx = flat.indexOf(Math.min(...flat));
    const lowestNote = flat[lowestIdx];
    this.notes = flat.map((note, i) => {
      if (i === lowestIdx) return note;
      const change = (Math.floor(Math.random() * 5) - 2) * 12;
      let newNote = note + change;
      while (newNote < lowestNote) newNote += 12;
      return newNote;
    });
    this.restoreNest();
    this.compass(this.lowestPossibleNote, this.highestPossibleNote);
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
    const currentScale = this.scale;
    const candidates = slantMatch(currentScale.degrees);
    const scale = candidates[Math.floor(Math.random() * candidates.length)];
    this.applyScale(scale);
    return this;
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
    this.stack.push(this.clone());
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

    this.velocities = this.velocities.map(vel => {
      let v = vel;
      while (v < 0) v += 12;
      while (v > 127) v -= 12;
      return v;
    });

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
  fixedScale: Scale | false = false;

  resolveFixed(): this {
    if (this.fixedDurMode === 'trim') {
      this._resolveFixedGrid();
      this._resolveFixedDur();
    } else {
      this._resolveFixedDur();
      this._resolveFixedGrid();
      if (typeof this.fixedDur === 'number') this.trimToDur(this.fixedDur);
    }
    this._resolveFixedScale();
    return this;
  }

  private _resolveFixedDur(): void {
    if (typeof this.fixedDur === 'number') {
      if (this.fixedDurMode === 'scale') this.scaleToDur(this.fixedDur);
      else this.trimToDur(this.fixedDur);
    }
  }

  private _resolveFixedScale(): void {
    if (this.fixedScale) this.applyScale(this.fixedScale);
  }

  private _resolveFixedGrid(): void {
    if (this.fixedGrid !== false) this.quantize(this.fixedGrid as number);
  }

  // ─── Playback interface (consumed by scheduler) ────────────────────────────

  /** Returns flat list of { note, velocity, time, chan } events for playback */
  toEvents(): Array<{ note: number | number[]; velocity: number; time: number; chan: number }> {
    return this.notes.map((note, i) => ({
      note: Array.isArray(note) ? (note as number[]) : note as number,
      velocity: wrapAt(this.velocities, i),
      time: wrapAt(this.timeIntervals, i),
      chan: wrapAt(this.chans, i),
    }));
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
      `scale:      [${scale.degrees.join(',')}]${scaleName}`,
      this.name ? `name:       ${this.name}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }
}
