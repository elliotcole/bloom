import { describe, it, expect } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { chitHues } from '../lanes';

describe('chit colours', () => {
  const b = new Bloom();
  b.notes = [60, 72, 62]; b.timeIntervals = [0.25, 0.5, 0.25]; b.velocities = [80, 0, 40, 80]; b.chans = [0, 3];
  b.intervals = [0, 7, 7, -5]; b.figures = [0];
  const h = chitHues(b);
  it('equal values wear one colour', () => {
    expect(h.notes[0]).toBe(h.notes[1]);   // C4 and C5: one pitch class
    expect(h.notes[2]).not.toBe(h.notes[0]);
    expect(h.time[0]).toBe(h.time[2]);
    expect(h.vel[0]).toBe(h.vel[3]);
    expect(h.iv[1]).toBe(h.iv[2]);
    expect(h.iv[3]).not.toBe(h.iv[1]);
  });
  it('time and velocity run cool to warm; rests and empty steps have none', () => {
    expect(h.time[1]).toBeLessThan(h.time[0]);   // longer: warmer (lower hue)
    expect(h.vel[0]).toBeLessThan(h.vel[2]);
    expect(h.vel[1]).toBe(-1);
    expect(h.iv[0]).toBe(-1);
    expect(h.fig[0]).toBe(-1);
  });
});
