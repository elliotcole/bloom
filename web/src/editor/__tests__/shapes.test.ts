// The editor's shapes and patterns, and passes copied and put in: loudness,
// pace, velocities, timing, insert, each as an operation that can be undone.
import { describe, expect, it } from 'vitest';
import { take } from './fixture';
import { Edit, apply, liftTake, renderTake } from '../perf';
import type { Op, Perf } from '../perf';
import { clipOf, clipPattern, shapeAt } from '../ops';

const vel = (p: Perf, at: number) => p.notes.find(n => Math.round(n.at) === at)!.vel;
const at0 = (p: Perf, voice = 0) => p.notes.filter(n => n.voice === voice).map(n => Math.round(n.at * 1000) / 1000);
/** Which of a voice's passes end where the next begins */
const joins = (p: Perf, v: 0 | 1) => p.passes[v].slice(1).map((s, i) => s.at === p.passes[v][i].end);

/** What every op keeps: notes in time order, each voice's passes in order and apart */
function sound(p: Perf): void {
  expect(p.notes.every((n, i) => !i || n.at >= p.notes[i - 1].at)).toBe(true);
  for (const mine of p.passes) {
    expect(mine.every(s => s.end > s.at)).toBe(true);
    expect(mine.every((s, i) => !i || s.at >= mine[i - 1].end - 1e-9)).toBe(true);
  }
  expect(p.flags.every((f, i) => !i || f.at >= p.flags[i - 1].at)).toBe(true);
  expect(p.ctl.every((c, i) => !i || c.at >= p.ctl[i - 1].at)).toBe(true);
}

// take(4): a note every 250 ms from 10, velocities 80 81 82 83 in each pass;
// passes [7, 1007) [1007, 2007) [2007, 3007) [3007, 5010)
const one = liftTake(take(4));
const two = liftTake(take(4, { other: true }));

describe('loudness as a shape', () => {
  it('a crescendo: soft at its start, between in its middle, loud at its end', () => {
    const q = apply(one, { op: 'loud', from: 1007, to: 2007, values: [60, 100] });
    expect(vel(q, 1010)).toBe(Math.round(80 * shapeAt([60, 100], 1007, 2007, 1010) / 100));   // 48
    expect(vel(q, 1010)).toBe(48);
    expect(vel(q, 1510)).toBe(66);   // 82 × 80.1%
    expect(vel(q, 1760)).toBe(75);   // 83 × 90.1%
    expect(vel(q, 760)).toBe(83);    // before it, as it was
    expect(vel(q, 2010)).toBe(80);   // after it too
    sound(q);
  });
  it('three values: up, then down', () => {
    expect([0, 500, 1000, 250].map(t => shapeAt([60, 100, 80], 0, 1000, t))).toEqual([60, 100, 80, 80]);
  });
  it('one value is flat; a velocity stays 1 to 127', () => {
    expect(vel(apply(one, { op: 'loud', from: 7, to: 5010, values: [1000] }), 2010)).toBe(127);
    expect(vel(apply(one, { op: 'loud', from: 7, to: 5010, values: [0] }), 2010)).toBe(1);
    expect(vel(apply(one, { op: 'loud', from: 7, to: 5010, values: [50] }), 2260)).toBe(41);   // 81 / 2, rounded
  });
  it('one voice alone: the other as it was', () => {
    const q = apply(two, { op: 'loud', from: 0, to: 5010, values: [50], voice: 1 });
    expect(q.notes.filter(n => n.voice === 0)).toEqual(two.notes.filter(n => n.voice === 0));
    expect(q.notes.filter(n => n.voice === 1).every(n => n.vel === 30)).toBe(true);
  });
});

describe('pace as a shape', () => {
  it('twice as fast: half as long, the notes after it earlier by just that, its notes shorter', () => {
    const q = apply(one, { op: 'pace', from: 1007, to: 2007, values: [200] });
    expect(q.length).toBe(one.length - 500);
    expect(at0(q).slice(4, 8)).toEqual([1008.5, 1133.5, 1258.5, 1383.5]);
    expect(at0(q).slice(8)).toEqual(at0(one).slice(8).map(t => t - 500));
    expect(q.notes[4].dur).toBe(200);
    expect(q.notes[8].dur).toBe(400);
    expect(q.passes[0].map(s => [s.at, s.end])).toEqual([[7, 1007], [1007, 1507], [1507, 2507], [2507, 4510]]);
    sound(q);
  });
  it('faster and faster: the length is the integral of 1 / speed', () => {
    const q = apply(one, { op: 'pace', from: 1007, to: 2007, values: [100, 150] });
    const L = (1000 / 0.5) * Math.log(1.5);
    expect(q.length).toBeCloseTo(one.length - 1000 + L, 6);
    const d = q.length - one.length;
    expect(at0(q).slice(8)).toEqual(at0(one).slice(8).map(t => Math.round((t + d) * 1000) / 1000));
    expect(q.passes[0][1].end).toBe(q.passes[0][2].at);
    // a note near its start barely moves; one near its end, the most
    expect(q.notes[4].at - 1010).toBeCloseTo(-0.00, 1);
    expect(at0(q)[7]).toBeLessThan(1760);
    sound(q);
  });
  it('flags and controllers after it move with the clock', () => {
    const f = apply(one, { op: 'flag', at: 3007, name: 'III' });
    const q = apply(f, { op: 'pace', from: 1007, to: 2007, values: [50] });
    expect(q.flags).toEqual([{ at: 4007, name: 'III' }]);
    expect(q.length).toBe(one.length + 1000);
  });
  it('one voice alone: the other voice and the clock as they were', () => {
    const f = apply(two, { op: 'flag', at: 3007, name: 'III' });
    const b = two.passes[1][1];
    const q = apply(f, { op: 'pace', from: b.at, to: b.end, values: [200], voice: 1 });
    expect(q.notes.filter(n => n.voice === 0)).toEqual(two.notes.filter(n => n.voice === 0));
    expect(q.passes[0]).toBe(two.passes[0]);
    expect(q.flags).toEqual(f.flags);
    expect(q.ctl).toEqual(f.ctl);
    expect(q.length).toBe(two.length);
    expect(q.passes[1][1].end - q.passes[1][1].at).toBeCloseTo((b.end - b.at) / 2, 6);
    expect(joins(q, 1)).toEqual(joins(two, 1));
    sound(q);
  });
  it('a voice slowed past the end makes the performance as long as it', () => {
    const b = two.passes[1][2];
    const q = apply(two, { op: 'pace', from: b.at, to: b.end, values: [50], voice: 1 });
    expect(q.length).toBeCloseTo(b.at + (b.end - b.at) * 2, 6);
  });
  it('a speed of nothing or less does nothing', () => {
    expect(apply(one, { op: 'pace', from: 1007, to: 2007, values: [100, 0] })).toBe(one);
    expect(apply(one, { op: 'pace', from: 1007, to: 2007, values: [-50] })).toBe(one);
  });
});

describe('velocities as a pattern', () => {
  it('over and over, on through the seam between passes', () => {
    const q = apply(one, { op: 'vels', from: 7, to: 2007, values: [100, 50, 70] });
    expect(q.notes.slice(0, 8).map(n => n.vel)).toEqual([100, 50, 70, 100, 50, 70, 100, 50]);
    expect(q.notes[8].vel).toBe(80);   // after it, as it was
    sound(q);
  });
  it('a chord: the loudest takes the value, the rest keep their proportion to it', () => {
    const chord: Perf = { ...one, notes: [one.notes[0], { ...one.notes[0], id: 99, at: 13, pitch: 55, vel: 40 }, ...one.notes.slice(1)] };
    const q = apply(chord, { op: 'vels', from: 7, to: 1007, values: [100, 60] });
    expect(q.notes.slice(0, 5).map(n => n.vel)).toEqual([100, 50, 60, 100, 60]);
  });
});

describe('timing as a pattern', () => {
  it('the gaps from the values, the first onset where it was, what follows on by the change', () => {
    const q = apply(one, { op: 'gaps', from: 1007, to: 2007, values: [100, 200] });
    expect(at0(q).slice(4, 8)).toEqual([1010, 1110, 1310, 1410]);
    expect(q.passes[0][1].end).toBe(1610);   // the last gap, to its end
    expect(q.passes[0][2].at).toBe(1610);
    expect(q.length).toBe(one.length - 397);
    expect(at0(q).slice(8)).toEqual(at0(one).slice(8).map(t => t - 397));
    expect(q.notes.every(n => n.dur === 400)).toBe(true);
    sound(q);
  });
  it('what lies between onsets moves between where they went', () => {
    const f = apply(one, { op: 'flag', at: 1300, name: 'in' });
    const q = apply(f, { op: 'gaps', from: 1007, to: 2007, values: [100, 200] });
    expect(q.flags[0].at).toBeCloseTo(1110 + (40 / 250) * 200, 9);
  });
  it('one voice alone: the other stays, and the notes are in time order', () => {
    const b = two.passes[1][0];
    const q = apply(two, { op: 'gaps', from: b.at, to: b.end, values: [50] });
    sound(q);
    const r = apply(two, { op: 'gaps', from: b.at, to: b.end, values: [50], voice: 1 });
    expect(r.notes.filter(n => n.voice === 0)).toEqual(two.notes.filter(n => n.voice === 0));
    expect(r.length).toBe(two.length);
    sound(r);
  });
});

describe('copy and paste', () => {
  const clip = clipOf(one, 1007, 2007, 0);
  it('a clip is its notes and passes from its start, and lasts as long', () => {
    expect(clip.length).toBe(1000);
    expect(clip.notes.map(n => n.at)).toEqual([3, 253, 503, 753]);
    expect(clip.passes).toEqual([{ id: 1, at: 0, end: 1000, bloom: 0 }]);
    expect(clipPattern(clip)).toEqual({ vels: [80, 81, 82, 83], gaps: [250, 250, 250, 247] });
  });
  it('put in before a pass: new notes with ids of their own, its pass as recorded, what follows later', () => {
    let p = apply(one, { op: 'flag', at: 3007, name: 'IV' });
    p = apply(p, { op: 'flag', at: 7, name: 'I' });
    p = { ...p, ctl: [...p.ctl, { at: 3500, e: [3500, 'p', 0] }] };
    const q = apply(p, { op: 'insert', at: 3007, clip });
    expect(q.notes.length).toBe(20);
    expect(new Set(q.notes.map(n => n.id)).size).toBe(20);
    expect(q.passes[0].map(s => [s.id, s.at, s.end])).toEqual([[0, 7, 1007], [1, 1007, 2007], [2, 2007, 3007], [1, 3007, 4007], [3, 4007, 6010]]);
    expect(at0(q).slice(12, 16)).toEqual([3010, 3260, 3510, 3760]);
    expect(at0(q).slice(16)).toEqual(at0(one).slice(12).map(t => t + 1000));
    expect(q.flags).toEqual([{ at: 7, name: 'I' }, { at: 4007, name: 'IV' }]);
    expect(q.ctl[q.ctl.length - 1].at).toBe(4500);
    expect(q.length).toBe(one.length + 1000);
    sound(q);
  });
  it('in the middle of a pass: either side of what comes in', () => {
    const q = apply(one, { op: 'insert', at: 1500, clip });
    expect(q.passes[0].slice(1, 4).map(s => [s.id, s.at, s.end])).toEqual([[1, 1007, 1500], [1, 1500, 2500], [1, 2500, 3007]]);
    sound(q);
  });
  it('in place of a selection: the same length here, so the same clock', () => {
    const q = apply(one, { op: 'insert', at: 3007, to: 5010, clip });
    expect(q.length).toBe(one.length - 1003);
    expect(q.passes[0].map(s => s.id)).toEqual([0, 1, 2, 1]);
    sound(q);
  });
  it('into one voice alone: the other and the clock stay', () => {
    const b = two.passes[1][1];
    const c = clipOf(two, b.at, b.end, 1);
    const q = apply(two, { op: 'insert', at: b.at, clip: c, voice: 1 });
    expect(q.notes.filter(n => n.voice === 0)).toEqual(two.notes.filter(n => n.voice === 0));
    expect(q.passes[1].length).toBe(4);
    expect(q.notes.filter(n => n.voice === 1).length).toBe(two.notes.filter(n => n.voice === 1).length + c.notes.length);
    expect(new Set(q.notes.map(n => n.id)).size).toBe(q.notes.length);
    sound(q);
  });
  it('the timing of a pass over one played the same way changes nothing', () => {
    const q = apply(one, { op: 'gaps', from: 2007, to: 3007, values: clipPattern(clip).gaps });
    expect(q.length).toBe(one.length);
    expect(at0(q)).toEqual(at0(one));
  });
});

describe('as edits', () => {
  const clip = clipOf(one, 1007, 2007, 0);
  const ops: Op[] = [
    { op: 'loud', from: 7, to: 2007, values: [60, 100, 80] },
    { op: 'pace', from: 1007, to: 3007, values: [100, 150] },
    { op: 'vels', from: 7, to: 3007, values: [100, 50] },
    { op: 'gaps', from: 7, to: 1007, values: [120, 300] },
    { op: 'insert', at: 1007, clip },
    { op: 'insert', at: 7, to: 1007, clip },
  ];
  it('each keeps the notes in order and the passes apart and joined where they were', () => {
    for (const op of ops) {
      const q = apply(one, op);
      sound(q);
      if (op.op !== 'insert') expect(joins(q, 0)).toEqual(joins(one, 0));
    }
    for (const voice of [0, 1] as const) {
      for (const op of ops) {
        const q = apply(two, { ...op, voice } as Op);
        sound(q);
        if (op.op !== 'insert') expect(joins(q, voice)).toEqual(joins(two, voice));
      }
    }
  });
  it('each written back as a take is in time order', () => {
    for (const t of [take(4), take(4, { other: true })]) {
      const base = liftTake(t);
      for (const op of ops) {
        const r = renderTake(t, apply(base, op));
        expect(r.events.every((e, i) => !i || e[0] >= r.events[i - 1][0])).toBe(true);
      }
    }
  });
  it('all undone, the performance is as it was; from a file, as it was done', () => {
    const e = new Edit(one);
    for (const op of ops) e.do(op);
    const done = e.perf;
    expect(new Edit(one, JSON.parse(JSON.stringify(ops)) as Op[]).perf).toEqual(done);
    while (e.undo());
    expect(e.perf).toEqual(one);
    for (const _ of ops) e.redo();
    expect(e.perf).toEqual(done);
  });
});
