// Bloom's verbs on passes of a take: a pass made a bloom and back, the verbs
// run between, passes that sound the same coming out the same, and the blooms
// the reworked passes name carried through undo, paste, a take and a score.
import { describe, expect, it } from 'vitest';
import { take } from './fixture';
import { Edit, apply, bloomList, liftTake, renderTake } from '../perf';
import type { Op, Perf } from '../perf';
import { clipOf } from '../ops';
import { bloomOfClip, clipOfBloom, rework } from '../rework';
import { takeToMusicXML } from '../../io/musicxml';
import type { Bloom } from '../../core/Bloom';
import { BLOOM_COMMANDS } from '../../ui/bloomCommands';

const t4 = take(4);
const one = liftTake(t4);
const command = (name: string) => BLOOM_COMMANDS.find(c => c.names.includes(name))!.fn;
/** A voice's notes in a stretch, from its start: when, what, how loud */
const sounds = (p: Perf, from: number, to: number, v = 0) =>
  p.notes.filter(n => n.voice === v && n.at >= from && n.at < to).map(n => [Math.round((n.at - from) * 1000) / 1000, n.pitch, n.vel]);

/** What every op keeps: notes in time order, each voice's passes in order and apart, the ids their own */
function sound(p: Perf): void {
  expect(p.notes.every((n, i) => !i || n.at >= p.notes[i - 1].at)).toBe(true);
  for (const mine of p.passes) expect(mine.every((s, i) => s.end > s.at && (!i || s.at >= mine[i - 1].end - 1e-9))).toBe(true);
  expect(new Set(p.notes.map(n => n.id)).size).toBe(p.notes.length);
}

describe('a pass as a bloom, and back', () => {
  const s = one.passes[0][1], was = clipOf(one, s.at, s.end, 0);
  it('the bloom has what sounds: notes, the loudest of each onset, the gaps in seconds; its own bloom\'s ranges; no intervals or figures', () => {
    const b = bloomOfClip(t4.blooms[s.bloom], was)!;
    expect(b.notes).toEqual([60, 64, 67, 72]);
    expect(b.velocities).toEqual([80, 81, 82, 83]);
    expect(b.timeIntervals).toEqual([0.25, 0.25, 0.25, 0.247]);
    expect(b.intervals).toEqual([0]);
    expect(b.figures).toEqual([0]);
  });
  it('with nothing done, the pass comes back as it was', () => {
    const chord: Perf = { ...one, notes: [...one.notes.slice(0, 5), { ...one.notes[4], id: 99, at: 1012, pitch: 55, vel: 40, dur: 900 }, ...one.notes.slice(5)] };
    const c = clipOf(chord, s.at, s.end, 0);
    const back = clipOfBloom(bloomOfClip(t4.blooms[s.bloom], c)!, c, s.id);
    expect(back.length).toBeCloseTo(c.length, 6);
    const key = (n: { at: number; pitch: number; vel: number; dur: number }) => [n.pitch, n.vel, n.dur];
    expect(back.notes.map(key).sort()).toEqual(c.notes.map(key).sort());
    // the chord at its first note's time, within half a millisecond
    back.notes.forEach(n => expect(c.notes.some(m => m.pitch === n.pitch && Math.abs(m.at - n.at) < 8.5)).toBe(true));
    expect(back.notes.filter(n => n.ix === 0).map(n => n.at)).toEqual([3, 3]);
    const q = apply(chord, { op: 'insert', at: s.at, to: s.end, clip: back });
    const onsets = (p: Perf) => sounds(p, s.at, s.end).filter((x, i, a) => !i || (x[0] as number) - (a[i - 1][0] as number) > 8 || x[1] !== a[i - 1][1]);
    expect(onsets(q).map(x => [Math.round(x[0] as number), x[1]])).toEqual([[3, 55], [3, 60], [253, 64], [503, 67], [753, 72]]);
  });
  it('a pass with nothing done to it by the whole route is as it was', () => {
    const r = rework(one, bloomList(t4, one), [one.passes[0][1]], () => {}, 'nothing')!;
    const q = apply(one, r.op);
    expect(sounds(q, 1007, 2007)).toEqual(sounds(one, 1007, 2007));
    for (const [x, y] of q.notes.map((n, i) => [n.at, one.notes[i].at])) expect(Math.abs(x - y)).toBeLessThan(0.5);
    expect(q.length).toBeCloseTo(one.length, 6);
    sound(q);
  });
});

describe('verbs on passes', () => {
  it('up1: each note a semitone up, its time and loudness as they were', () => {
    const r = rework(one, bloomList(t4, one), one.passes[0].slice(1, 3), command('up1'), 'up1 on passes 2–3')!;
    const q = apply(one, r.op);
    expect(sounds(q, 1007, 2007)).toEqual(sounds(one, 1007, 2007).map(([t, p, v]) => [t, (p as number) + 1, v]));
    expect(sounds(q, 2007, 3007)).toEqual(sounds(one, 2007, 3007).map(([t, p, v]) => [t, (p as number) + 1, v]));
    expect(sounds(q, 7, 1007)).toEqual(sounds(one, 7, 1007));
    expect(r.kinds).toBe(2);
    sound(q);
  });
  it('mirror makes the pass longer, and what follows moves on', () => {
    const r = rework(one, bloomList(t4, one), [one.passes[0][0]], command('mirror'), 'mirror')!;
    const q = apply(one, r.op), s = q.passes[0][0];
    const pitches = q.notes.filter(n => n.at < s.end).map(n => n.pitch);
    expect(pitches.length).toBeGreaterThan(4);
    expect(q.length - one.length).toBeCloseTo((s.end - s.at) - 1000, 6);
    expect(q.passes[0][1].at).toBe(s.end);
    sound(q);
  });
  it('passes that sound the same come out the same from a verb that throws dice', () => {
    const t = take(6, { change: 6, notes: [60, 62, 64, 65, 67, 69, 71, 72] });
    const p = liftTake(t);
    const r = rework(p, bloomList(t, p), p.passes[0], command('scramble'), 'scramble')!;
    expect(r.kinds).toBe(2);   // the last pass of the take is longer: the other kind
    const q = apply(p, r.op);
    const runs = q.passes[0].slice(0, 5).map(s => sounds(q, s.at, s.end));
    for (const x of runs.slice(1, 5)) expect(x).toEqual(runs[0]);
    sound(q);
  });
  it('a group of them, undone, is the performance as it was', () => {
    const e = new Edit(one);
    e.do(rework(one, bloomList(t4, one), one.passes[0], command('scramble'), 'scramble')!.op);
    e.undo();
    expect(e.perf).toEqual(one);
  });
});

describe('the blooms a rework adds', () => {
  const r = rework(one, bloomList(t4, one), one.passes[0].slice(0, 2), command('down12'), 'down12')!;
  const q = apply(one, r.op);
  it('the reworked passes name a bloom that has what they play, the same one for passes alike', () => {
    expect(q.blooms.length).toBe(1);
    expect(q.passes[0].slice(0, 2).map(s => s.bloom)).toEqual([t4.blooms.length, t4.blooms.length]);
    const all = bloomList(t4, q);
    expect(all.length).toBe(t4.blooms.length + 1);
    expect(all[t4.blooms.length].notes).toEqual([48, 52, 55, 60]);
    expect(q.passes[0][2].bloom).toBe(1);
  });
  it('copied and pasted (here, or after the rework is undone), a pass still names its bloom', () => {
    const c = clipOf(q, q.passes[0][0].at, q.passes[0][0].end, 0);
    expect(c.blooms?.length).toBe(1);
    expect(c.passes[0].bloom).toBe(-2);
    const there = apply(q, { op: 'insert', at: q.passes[0][3].at, clip: c });
    expect(there.blooms.length).toBe(1);   // the same bloom: used again
    expect(there.passes[0][3].bloom).toBe(t4.blooms.length);
    const gone = apply(one, { op: 'insert', at: one.passes[0][3].at, clip: c });
    expect(bloomList(t4, gone)[gone.passes[0][3].bloom].notes).toEqual([48, 52, 55, 60]);
  });
  it('a take written from it carries every bloom, its events in time order; a score of it can be written', () => {
    const t = renderTake(t4, q);
    expect(t.blooms.length).toBe(t4.blooms.length + 1);
    expect(t.events.filter(e => e[1] === 'b').map(e => e[2])).toEqual([t4.blooms.length, t4.blooms.length, 1, 1]);
    expect(t.events.every((e, i) => !i || e[0] >= t.events[i - 1][0])).toBe(true);
    expect(() => takeToMusicXML(t, { title: 'reworked' })).not.toThrow();
    expect(liftTake(t).notes.map(n => n.pitch)).toEqual(q.notes.map(n => n.pitch));
  });
  it('two voices: a pass of one voice reworked, the other as it was', () => {
    const t = take(4, { other: true }), p = liftTake(t);
    const run = (b: Bloom) => b.transpose(2);
    const x = rework(p, bloomList(t, p), [p.passes[1][1]], run, 'up2', 1)!;
    const y = apply(p, x.op as Op);
    expect(y.notes.filter(n => n.voice === 0)).toEqual(p.notes.filter(n => n.voice === 0));
    const s = p.passes[1][1];
    expect(sounds(y, s.at, s.end, 1)).toEqual(sounds(p, s.at, s.end, 1).map(([a, b, c]) => [a, (b as number) + 2, c]));
    sound(y);
    expect(renderTake(t, y).events.every((e, i, a) => !i || e[0] >= a[i - 1][0])).toBe(true);
  });
});

describe('in place, to the note', () => {
  it('a pass put back as it was leaves what follows exactly where it was, and no sliver of a pass', () => {
    const t = take(6, { change: 3 });
    const p = liftTake(t);
    const done = rework(p, bloomList(t, p), p.passes[0], () => {}, 'nothing')!;
    const q = apply(p, done.op);
    expect(q.length).toBe(p.length);
    expect(q.passes[0].map(s => [s.at, s.end])).toEqual(p.passes[0].map(s => [s.at, s.end]));
    expect(q.notes.map(n => [n.at, n.pitch, n.vel])).toEqual(p.notes.map(n => [n.at, n.pitch, n.vel]));
  });
  it('a cut brings what was at its end to exactly its start', () => {
    const p = liftTake(take(4));
    const [a, b, c] = p.passes[0];
    const q = apply(p, { op: 'cut', from: a.at + 0.3, to: b.end });
    expect(q.passes[0][1].at).toBe(a.at + 0.3);
    expect(q.notes.find(n => n.pass === c.id)!.at - q.passes[0][1].at).toBeCloseTo(3, 6);
  });
});
