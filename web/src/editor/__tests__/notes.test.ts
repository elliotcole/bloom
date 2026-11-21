// Single notes: note mode's onsets, silence, pitches moved and typed, nudges
// that make one edit, and several ops done as one step.
import { describe, expect, it } from 'vitest';
import { take } from './fixture';
import { Edit, apply, joined, liftTake } from '../perf';
import type { Op, Perf } from '../perf';
import { nextOnset, onsetBefore, onsetFrom, onsetMembers, onsetOf, placeInPass, prevOnset } from '../notes';
import { nowOf, numbers, pitchOf, pitchesOf } from '../typed';
import { onsetsIn } from '../ops';
import { spellOctave } from '../../lib/numbers';

/** What every op keeps: notes in time order, each voice's passes in order and apart, the ids their own */
function sound(p: Perf): void {
  expect(p.notes.every((n, i) => !i || n.at >= p.notes[i - 1].at)).toBe(true);
  for (const mine of p.passes) {
    expect(mine.every(s => s.end > s.at)).toBe(true);
    expect(mine.every((s, i) => !i || s.at >= mine[i - 1].end - 1e-9)).toBe(true);
  }
  expect(new Set(p.notes.map(n => n.id)).size).toBe(p.notes.length);
}

// take(4): a note every 250 ms from 10, pitches 60 64 67 72 (+1 from the third pass);
// passes [7, 1007) [1007, 2007) [2007, 3007) [3007, 5010)
const one = liftTake(take(4));
const two = liftTake(take(4, { other: true }));
/** one, with a chord: a note 4 ms after the second, a fourth below it */
const chord: Perf = { ...one, notes: [...one.notes.slice(0, 2), { ...one.notes[1], id: 99, at: 264, pitch: 59, vel: 40 }, ...one.notes.slice(2)] };
const pitchesAt = (p: Perf) => p.notes.filter(n => n.voice === 0).map(n => n.pitch);

describe('onsets, round the cursor', () => {
  it('a chord is one onset; the next and the one before go straight through the passes', () => {
    expect(onsetMembers(chord, 0, 1)).toEqual([1, 2]);
    expect(nextOnset(chord, 0, 1)).toBe(3);
    expect(prevOnset(chord, 0, 3)).toBe(1);
    expect(onsetOf(chord, 0, 2)).toBe(1);
    expect(nextOnset(one, 0, 3)).toBe(4);   // the last of the first pass, the first of the second
    expect(prevOnset(one, 0, 0)).toBe(-1);
    expect(nextOnset(one, 0, one.notes.length - 1)).toBe(-1);
  });
  it('found by the moment: the first at or after, the last before', () => {
    expect(onsetFrom(one, 0, 1007)).toBe(4);
    expect(onsetFrom(one, 0, 1010)).toBe(4);
    expect(onsetFrom(one, 0, 1011)).toBe(5);
    expect(onsetFrom(one, 0, 99_999)).toBe(-1);
    expect(onsetBefore(one, 0, 1010)).toBe(3);
    expect(onsetBefore(one, 0, Infinity)).toBe(one.notes.length - 1);
    expect(onsetFrom(chord, 0, 259)).toBe(1);
    expect(onsetFrom(chord, 0, 262)).toBe(3);   // a chord begins with its first note
  });
  it('one voice\'s onsets, the other\'s notes passed over', () => {
    const a = two.notes.findIndex(n => n.voice === 1);
    const b = nextOnset(two, 1, a);
    expect(two.notes[b].voice).toBe(1);
    expect(two.notes.slice(a + 1, b).every(n => n.voice === 0)).toBe(true);
  });
  it('which of its pass\'s onsets it is', () => {
    expect(placeInPass(one, 0, 6)).toEqual({ nth: 3, of: 4, pass: 1 });
    expect(placeInPass(chord, 0, 3)).toEqual({ nth: 3, of: 4, pass: 0 });
  });
});

describe('silence', () => {
  it('the notes that start in it go, and the time stays', () => {
    const q = apply(one, { op: 'drop', from: 1007, to: 1510 });
    expect(q.notes.length).toBe(one.notes.length - 2);
    expect(q.length).toBe(one.length);
    expect(q.passes).toEqual(one.passes);
    expect(q.notes.map(n => n.at)).toEqual(one.notes.map(n => n.at).filter(t => t < 1007 || t >= 1510));
    sound(q);
  });
  it('one voice alone: the other\'s notes there stay', () => {
    const q = apply(two, { op: 'drop', from: 0, to: 2000, voice: 1 });
    expect(q.notes.filter(n => n.voice === 0)).toEqual(two.notes.filter(n => n.voice === 0));
    expect(q.notes.filter(n => n.voice === 1 && n.at < 2000)).toEqual([]);
    sound(q);
  });
});

describe('pitch', () => {
  it('a transpose moves the stretch\'s notes and no others, inside 0 to 127', () => {
    const q = apply(one, { op: 'transpose', from: 1007, to: 2007, by: 2 });
    expect(pitchesAt(q)).toEqual(pitchesAt(one).map((p, i) => (i >= 4 && i < 8 ? p + 2 : p)));
    expect(Math.max(...apply(one, { op: 'transpose', from: 0, to: 9999, by: 100 }).notes.map(n => n.pitch))).toBe(127);
    expect(Math.min(...apply(one, { op: 'transpose', from: 0, to: 9999, by: -100 }).notes.map(n => n.pitch))).toBe(0);
    sound(q);
  });
  it('typed pitches: the onsets in turn, over and over, on through the seam', () => {
    const q = apply(one, { op: 'pitches', from: 510, to: 1510, values: [50, 52] });
    expect(pitchesAt(q).slice(0, 8)).toEqual([60, 64, 50, 52, 50, 52, 67, 72]);
    sound(q);
  });
  it('a chord moves whole, its lowest note to the value', () => {
    const q = apply(chord, { op: 'pitches', from: 7, to: 1007, values: [48] });
    expect(pitchesAt(q).slice(0, 5)).toEqual([48, 53, 48, 48, 48]);   // 64 over 59 is 53 over 48
  });
  it('as typed: numbers, or names as the readout spells them', () => {
    expect(pitchesOf('60 C4, Eb4 F#3 Bb-1 cb4')).toEqual([60, 60, 63, 54, 10, 59]);
    for (const n of [0, 21, 60, 61, 70, 127]) expect(pitchOf(spellOctave(n))).toBe(n);
    expect(pitchesOf('60 H4')).toBeNull();
    expect(pitchOf('200')).toBeNull();
    expect(numbers('0.25, 0.5')).toEqual([0.25, 0.5]);
  });
  it('what a stretch has now, written as it would be typed', () => {
    const os = onsetsIn(chord, 7, 1007);
    expect(nowOf(chord, os, 1007)).toEqual({ pitches: 'C4 B3 G4 C5', vels: '80 81 82 83', gaps: '0.25 0.25 0.25 0.247' });
  });
});

describe('nudges as one edit', () => {
  const up: Op = { op: 'transpose', from: 1007, to: 2007, by: 1 };
  it('a transpose of the same stretch and voice joins the last; to nothing, it goes', () => {
    expect(joined(up, up)).toEqual({ ...up, by: 2 });
    expect(joined(up, { ...up, by: -1 })).toBeNull();
    expect(joined(up, { ...up, to: 3007 })).toBeUndefined();
    expect(joined(up, { ...up, voice: 1 })).toBeUndefined();
    expect(joined({ op: 'cut', from: 1007, to: 2007 }, up)).toBeUndefined();
    expect(joined(undefined, up)).toBeUndefined();
  });
  it('amend replaces the last op: one undo takes the whole nudge back', () => {
    const e = new Edit(one);
    e.do({ op: 'cut', from: 3007, to: 5010 });
    e.do(up);
    e.amend(joined(e.ops[1], up)!);
    e.amend(joined(e.ops[1], { ...up, by: 10 })!);
    expect(e.ops.length).toBe(2);
    expect(e.perf).toEqual(new Edit(one, [{ op: 'cut', from: 3007, to: 5010 }, { ...up, by: 12 }]).perf);
    e.undo();
    expect(e.perf).toEqual(apply(one, { op: 'cut', from: 3007, to: 5010 }));
    e.redo();
    e.amend(null);   // nudged back to nothing
    expect(e.ops.length).toBe(1);
    expect(e.redo()).toBeNull();
  });
});

describe('several ops as one step', () => {
  const group: Op = { op: 'group', label: 'two things', ops: [{ op: 'transpose', from: 7, to: 1007, by: 3 }, { op: 'cut', from: 2007, to: 3007 }, { op: 'drop', from: 7, to: 300 }] };
  it('done in order, and undone as one, back to where it began', () => {
    const e = new Edit(one);
    e.do(group);
    const q = e.perf;
    expect(q.length).toBe(one.length - 1000);
    expect(pitchesAt(q).slice(0, 2)).toEqual([70, 75]);   // 67 72 up 3, the first two silenced
    sound(q);
    expect(e.undo()).toBe(group);
    expect(e.perf).toEqual(one);
    e.redo();
    expect(e.perf).toEqual(q);
    expect(new Edit(one, JSON.parse(JSON.stringify([group])) as Op[]).perf).toEqual(q);
  });
});
