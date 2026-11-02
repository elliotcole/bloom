// The road's arithmetic: the tiles ahead, the fisheye projection, the shapes.

import { describe, it, expect } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { roadAhead, stepTiles, project, tileShape, FOV } from '../road';

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

describe('road', () => {
  it('lays the sounds ahead at the sum of the steps before them, lists read at their own ticks', () => {
    const tiles = roadAhead(bloom(), 0, 3);
    // tick 0: note 0 at 0 (1 beat); tick 1: chord at 1 (½); tick 2: rest, a gap (½); tick 3: note 3 at 2 (1 beat)
    expect(tiles.map(t => [t.i, t.at, t.dur])).toEqual([[0, 0, 1], [1, 1, 0.5], [3, 2, 1]]);
    expect(tiles[1].notes).toEqual([64, 67]);
    expect(tiles.map(t => t.vel)).toEqual([90, 80, 70]);
  });

  it('wraps round the lists and goes on until the beats run out', () => {
    const tiles = roadAhead(bloom(), 2, 6);
    expect(tiles[0]).toMatchObject({ i: 3, tick: 3, at: 0.5 });     // tick 2 is a rest
    expect(tiles[tiles.length - 1].at).toBeLessThanOrEqual(6);
    expect(tiles.length).toBeGreaterThan(4);
  });

  it('a step\'s own tiles start at 0', () => {
    expect(stepTiles(bloom(), 1, 1)).toMatchObject([{ i: 1, at: 0, dur: 0.5 }]);
    expect(stepTiles(bloom(), 2, 2)).toEqual([]);                    // a rest
  });

  it('an empty bloom has no road', () => {
    const b = new Bloom();
    b.notes = [];
    expect(roadAhead(b, 0, 8)).toEqual([]);
  });

  it('projects the far distance to the centre, beside you to the ring, behind beyond it', () => {
    const far = project(0, 1, 1000, 50, 50, 100);
    expect(Math.hypot(far.x - 50, far.y - 50)).toBeLessThan(0.2);
    const beside = project(0, 1, 0, 50, 50, 100);
    expect(Math.hypot(beside.x - 50, beside.y - 50)).toBeCloseTo(100 * 90 / (FOV / 2));
    expect(beside.y).toBeGreaterThan(50);                           // the road is below the eye
    const behind = project(0, 1, -1, 50, 50, 100);
    expect(Math.hypot(behind.x - 50, behind.y - 50)).toBeGreaterThan(Math.hypot(beside.x - 50, beside.y - 50));
    const left = project(-1, 1, 2, 50, 50, 100), right = project(1, 1, 2, 50, 50, 100);
    expect(left.x).toBeLessThan(50);
    expect(right.x - 50).toBeCloseTo(50 - left.x);
  });

  it('a chord\'s tile has a side per note', () => {
    expect(tileShape(1).length).toBe(4);
    expect(tileShape(2).length).toBe(4);   // a diamond
    expect(tileShape(3).length).toBe(3);
    expect(tileShape(4).length).toBe(6);
    expect(tileShape(7).length).toBe(12);  // a disc
    for (const [u, v] of tileShape(5)) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
