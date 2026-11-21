// The editor's performance: a take lifted into notes and passes, cut and
// flagged by a list of operations, and written back as a take.
import { describe, expect, it } from 'vitest';
import type { TakeFile } from '../../audio/take';
import { nameMessage, cueMessage } from '../../lib/tuning';
import { onsetsOf } from '../../io/musicxml';
import { take } from './fixture';
import { Edit, apply, columns, editFile, editIsOf, liftTake, passAt, renderTake, seam } from '../perf';
import type { Perf } from '../perf';

const ons = (p: Perf, voice = 0) => p.notes.filter(n => n.voice === voice).map(n => [Math.round(n.at), n.pitch]);

describe('lifting a take', () => {
  it('its notes, when they sound and how long, each in its pass and at its place', () => {
    const p = liftTake(take(3));
    expect(p.notes.length).toBe(12);
    expect(p.notes[0]).toMatchObject({ at: 10, dur: 400, pitch: 60, vel: 80, chan: 0, ix: 0, pass: 0, voice: 0 });
    expect(p.notes[5]).toMatchObject({ at: 1260, pitch: 64, ix: 1, pass: 1 });
    expect(p.voices).toBe(1);
  });
  it('a pass from its first note to the next pass, the bloom it played', () => {
    const p = liftTake(take(3));
    expect(p.passes[0].map(s => [s.at, s.end, s.bloom])).toEqual([[7, 1007, 0], [1007, 2007, 0], [2007, 4010, 1]]);
  });
  it('a take that starts on a note (its light came before): those notes have a pass too', () => {
    const t = take(2);
    t.events = t.events.filter(e => !(e[1] === 'n' && e[0] < 20));
    const p = liftTake(t);
    expect(p.passes[0].length).toBe(2);
    expect(p.notes[0].pass).toBe(0);
    expect(p.notes[0].ix).toBe(-1);
  });
  it('everything else that goes out is kept: the pedal, the tuning', () => {
    expect(liftTake(take(1)).ctl.map(c => c.e[1])).toEqual(['m', 'p']);
  });
  it('two voices: each note with its own, each with its own passes', () => {
    const p = liftTake(take(4, { other: true }));
    expect(p.voices).toBe(2);
    expect(p.notes.filter(n => n.voice === 1).every(n => n.chan === 1)).toBe(true);
    expect(p.notes.filter(n => n.voice === 0).every(n => n.chan === 0)).toBe(true);
    expect(p.passes[1].length).toBe(3);
    expect(p.passes[1][0].bloom).toBe(2);
  });
});

describe('a cut', () => {
  const p = liftTake(take(4));
  const [, second, third] = p.passes[0];
  it('takes the notes out and closes the gap', () => {
    const q = apply(p, { op: 'cut', from: second.at, to: second.end });
    expect(q.notes.length).toBe(12);
    expect(q.length).toBe(p.length - 1000);
    expect(ons(q).slice(4, 6)).toEqual([[1010, 61], [1260, 65]]);   // the third pass, where the second was
    expect(q.passes[0].map(s => s.id)).toEqual([0, 2, 3]);
    expect(q.passes[0][1]).toMatchObject({ at: second.at, end: third.at });
  });
  it('can fall anywhere: a pass cut into is shorter', () => {
    const q = apply(p, { op: 'cut', from: 500, to: 1500 });
    expect(q.passes[0].map(s => [s.id, s.at, s.end])).toEqual([[0, 7, 500], [1, 500, 1007], [2, 1007, 2007], [3, 2007, 4010]]);
    expect(ons(q).slice(0, 4)).toEqual([[10, 60], [260, 64], [510, 67], [760, 72]]);
  });
  it('the flags after it move with the clock, the ones inside go', () => {
    let q = apply(p, { op: 'flag', at: second.at, name: 'II' });
    q = apply(q, { op: 'flag', at: third.at, name: 'III' });
    q = apply(q, { op: 'cut', from: second.at, to: second.end });
    expect(q.flags).toEqual([{ at: second.at, name: 'III' }]);
  });
  it('what was in force at its end still is: the last tuning, the pedal', () => {
    const t = take(4);
    t.sysex = [nameMessage('a'), [0xf0, 0x7d, 1, 0xf7], cueMessage(null, 0), nameMessage('b'), [0xf0, 0x7d, 2, 0xf7]];
    t.tables = [[440], [441]];
    t.events.push([1100, 'h', 0], [1101, 'h', 1], [1102, 'h', 2], [1200, 'p', 0], [1300, 'h', 3], [1301, 'h', 4], [1400, 'p', 1], [1500, 'm', [0xb0, 64, 0], 0], [1600, 'm', [0xb0, 64, 90], 0]);
    t.events.sort((a, b) => a[0] - b[0]);
    const q = apply(liftTake(t), { op: 'cut', from: second.at, to: second.end });
    const kept = q.ctl.filter(c => c.at === second.at).map(c => (c.e[1] === 'm' ? c.e[2][2] : [c.e[1], c.e[2]]));
    expect(kept).toEqual([['h', 3], ['h', 4], ['p', 1], 90]);
  });
  it('one voice alone: the other stays where it was, and so does the clock', () => {
    const two = liftTake(take(4, { other: true }));
    const [, b] = two.passes[1];
    const q = apply(two, { op: 'cut', from: b.at, to: b.end, voice: 1 });
    expect(ons(q, 0)).toEqual(ons(two, 0));
    expect(q.length).toBe(two.length);
    expect(q.passes[1].length).toBe(2);
    expect(q.notes.every((n, i) => !i || n.at >= q.notes[i - 1].at)).toBe(true);
  });
});

describe('an edit', () => {
  it('undo is the list one shorter; redo puts it back', () => {
    const base = liftTake(take(4));
    const e = new Edit(base);
    e.do({ op: 'cut', from: 1007, to: 2007 });
    e.do({ op: 'flag', at: 7, name: 'start' });
    expect(e.perf.notes.length).toBe(12);
    expect(e.undo()).toEqual({ op: 'flag', at: 7, name: 'start' });
    expect(e.undo()).toMatchObject({ op: 'cut' });
    expect(e.perf).toEqual(base);
    expect(e.undo()).toBeNull();
    e.redo();
    expect(e.perf.notes.length).toBe(12);
    e.do({ op: 'unflag', at: 7 });
    expect(e.redo()).toBeNull();   // something new was done: nothing to put back
  });
  it('a flag at a time replaces the one there', () => {
    const e = new Edit(liftTake(take(2)));
    e.do({ op: 'flag', at: 7, name: 'a' });
    e.do({ op: 'flag', at: 7.2, name: 'b' });
    expect(e.perf.flags).toEqual([{ at: 7.2, name: 'b' }]);
  });
  it('as a file it names its take', () => {
    const t = take(2);
    const f = editFile(t, [{ op: 'cut', from: 0, to: 10 }]);
    expect(editIsOf(f, t)).toBe(true);
    expect(editIsOf(f, take(3))).toBe(false);
    expect(new Edit(liftTake(t), f.ops).perf.length).toBe(t.length - 10);
  });
});

describe('back to a take', () => {
  it('untouched, it sounds as it did', () => {
    const t = take(4, { other: true });
    const r = renderTake(t, liftTake(t));
    const sounds = (x: TakeFile) => x.events.flatMap(e => (e[1] === 'm' ? [[Math.round((e[0] + e[3]) * 10), ...e[2]].join(' ')] : [])).sort();
    expect(sounds(r)).toEqual(sounds(t));
    expect(r.length).toBe(t.length);
  });
  it('cut, a score of it has a bar for each pass left, and the bloom of each', () => {
    const t = take(4);
    const r = renderTake(t, apply(liftTake(t), { op: 'cut', from: 1007, to: 2007 }));
    expect(onsetsOf(r).filter(o => o.pass).length).toBe(3);
    expect(r.events.filter(e => e[1] === 'b').map(e => e[2])).toEqual([0, 1, 1]);
    expect(r.events.every((e, i) => !i || e[0] >= r.events[i - 1][0])).toBe(true);
  });
});

describe('what the pictures are drawn from', () => {
  it('a pass by its moment', () => {
    const p = liftTake(take(3)).passes[0];
    expect([0, 7, 1006, 1007, 99999].map(ms => passAt(p, ms))).toEqual([0, 0, 0, 1, 2]);
    expect(passAt([], 5)).toBe(-1);
  });
  it('how far a bloom is from the one before', () => {
    expect(seam([60, 64], [60, 64], true)).toBe(0);
    expect(seam([60, 64], [60, 64], false)).toBe(1);   // other lists changed, the notes didn't
    expect(seam([60, 64, 67, 72], [60, 64, 70, 71], false)).toBe(2);
    expect(seam([60, 64, 67, 72], [61, 65, 68, 72], false)).toBe(3);
  });
  it('the whole in columns: range, loudness, pace', () => {
    const c = columns(liftTake(take(4)).notes, 4000, 4);
    expect(c[0]).toMatchObject({ lo: 60, hi: 72, count: 4, pace: 4 });
    expect(c[0].vel).toBe(81.5);
    expect(columns([], 1000, 2)[1]).toMatchObject({ count: 0, pace: 0 });
  });
});
