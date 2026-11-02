// The orrery's arithmetic: which rings, how long until they come round
// together, and where each hand points.

import { describe, it, expect } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { rings, lcm, untilConjunction, handAngle } from '../orrery';

function bloom(): Bloom {
  const b = new Bloom();
  b.notes = [60, 62, 64, 65, 67, 69, 71];
  b.timeIntervals = Array.from({ length: 11 }, (_, i) => 0.25 + (i % 3) * 0.25);
  b.velocities = Array.from({ length: 13 }, (_, i) => 60 + i * 4);
  b.chans = [1];
  b.intervals = [0];
  b.figures = [0];
  return b;
}

describe('orrery', () => {
  it('has a ring per list in use, the pitches first, at each list\'s own length', () => {
    const r = rings(bloom());
    expect(r.map(x => [x.key, x.len])).toEqual([['notes', 7], ['time', 11], ['vel', 13], ['chan', 1]]);
  });

  it('adds the interval and figure rings only when the bloom uses them', () => {
    const b = bloom();
    b.intervals = [0, 2, 0];
    b.figures = [0, [0, 1, 2], 0, 0];
    const keys = rings(b).map(x => x.key);
    expect(keys).toEqual(['notes', 'time', 'vel', 'chan', 'iv', 'fig']);
    expect(rings(b).find(x => x.key === 'fig')!.len).toBe(4);
  });

  it('the period is the lengths\' least common multiple', () => {
    expect(lcm([7, 11, 13, 1])).toBe(1001);
    expect(lcm([4, 6])).toBe(12);
    expect(lcm([5])).toBe(5);
  });

  it('counts the notes until the hands next point up together', () => {
    expect(untilConjunction([4, 6], 0)).toBe(0);     // a conjunction now
    expect(untilConjunction([4, 6], 1)).toBe(11);
    expect(untilConjunction([4, 6], 12)).toBe(0);
    expect(untilConjunction([4, 6], 13)).toBe(11);
    expect(untilConjunction([4, 6], -1)).toBe(0);    // stopped
  });

  it('a hand goes round once per pass of its list, sweeping through the current cell', () => {
    expect(handAngle(4, 0)).toBe(0);
    expect(handAngle(4, 1)).toBeCloseTo(Math.PI / 2);
    expect(handAngle(4, 5)).toBeCloseTo(Math.PI / 2);          // the second pass
    expect(handAngle(4, 0, 0.5)).toBeCloseTo(Math.PI / 4);     // halfway through the first cell
    expect(handAngle(7, 7)).toBe(0);                            // back at the top
    expect(handAngle(4, -1, 0.9)).toBe(0);                      // stopped: rests at the top
  });

  it('Z makes every ring the notes\' length', () => {
    const b = bloom();
    b.fitLists();
    expect(rings(b).every(r => r.len === 7)).toBe(true);
    expect(lcm(rings(b).map(r => r.len))).toBe(7);
  });
});
