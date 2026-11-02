// The weave's arithmetic: what a row records, how the warp is laid out, and
// how the rows fit.

import { describe, it, expect } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { weaveRow, weaveRows, weavePeriod, warp, rowHeight, fitWeave } from '../weave';

function bloom(): Bloom {
  const b = new Bloom();
  b.notes = [60, [64, 67], 62, 65];
  b.timeIntervals = [1, 0.5, 0.5];
  b.velocities = [90, 80, 0, 70, 60];
  b.chans = [1];
  b.intervals = [0];
  b.figures = [0];
  return b;
}

describe('weave', () => {
  it('a row records the note, its time as height, and where every list was', () => {
    const r = weaveRow(bloom(), 1, 1);
    expect(r.notes).toEqual([64, 67]);
    expect(r.dur).toBe(0.5);
    expect(r.vel).toBe(80);
    expect(r.threads.map(t => [t.key, t.idx, t.len])).toEqual([['notes', 1, 4], ['time', 1, 3], ['vel', 1, 5], ['chan', 0, 1]]);
    expect(r.conj).toBe(false);
  });

  it('a rest is a row of bare warp, as tall as its time', () => {
    const r = weaveRow(bloom(), 2, 2);
    expect(r.notes).toEqual([]);
    expect(r.dur).toBe(0.5);
  });

  it('the lists read at their own ticks, so the second cycle differs from the first', () => {
    const rows = weaveRows(bloom(), 0, 8);
    expect(rows.map(r => r.i)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(rows[4].threads.find(t => t.key === 'time')!.idx).toBe(1);     // tick 4 mod 3
    expect(rows[4].dur).toBe(0.5);
    expect(rows[5].vel).toBe(90);                                          // tick 5 → vel[0]
    expect(rows[7].notes).toEqual([]);                                     // tick 7 → vel[2] = 0: a rest where the first cycle had a note
  });

  it('a conjunction is every list back at its start: the first row, and again after the period', () => {
    const b = bloom();
    expect(weavePeriod(b)).toBe(60);   // 4 · 3 · 5 · 1
    const rows = weaveRows(b, 0, 61);
    expect(rows.filter(r => r.conj).map(r => r.tick)).toEqual([0, 60]);
  });

  it('the warp has a group per list, the pitches first, filling the width with gaps between, a short list still given room', () => {
    const g = warp(bloom(), 10, 1000);
    expect(g.map(x => x.key)).toEqual(['notes', 'time', 'vel', 'chan']);
    expect(g[0].x0).toBe(10);
    expect(g[g.length - 1].x1).toBeCloseTo(1010);
    expect(g[3].x1 - g[3].x0).toBeGreaterThan(100);          // chan ×1 gets three cells' worth
    for (let k = 0; k + 1 < g.length; k++) expect(g[k + 1].x0).toBeGreaterThan(g[k].x1);
  });

  it('Z makes every thread the same cell in every row: a plain weave', () => {
    const b = bloom();
    b.fitLists();
    const rows = weaveRows(b, 0, 8);
    for (const r of rows) expect(new Set(r.threads.map(t => t.idx)).size).toBe(1);
    expect(weavePeriod(b)).toBe(4);
  });

  it('rows are never thinner than 2px and a long note is capped at 8 beats; fitWeave lays them out in a height', () => {
    expect(rowHeight(0.02, 10)).toBe(2);
    expect(rowHeight(1, 10)).toBe(10);
    expect(rowHeight(32, 10)).toBe(80);
    const rows = weaveRows(bloom(), 0, 3);   // 1 + 0.5 + 0.5 beats
    expect(fitWeave(rows, 200)).toBe(100);
  });
});
