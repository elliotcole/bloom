// Duration palettes and rhythm cells (time mode: k)
import { describe, expect, it } from 'vitest';
import { DURATION_PALETTES, RHYTHM_CELLS, cellTimes, euclid, parseCell, pulseOf, ratioText, snapToPalette } from '../rhythms';
import { Bloom } from '../../core/Bloom';

describe('euclid', () => {
  it('spreads the onsets as evenly as they go', () => {
    expect(euclid(3, 8)).toEqual([3, 3, 2]);
    expect(euclid(4, 16)).toEqual([4, 4, 4, 4]);
    expect(euclid(5, 8).reduce((a, b) => a + b)).toBe(8);
    expect(euclid(5, 8).sort()).toEqual([1, 1, 2, 2, 2]);
    expect(euclid(7, 16).length).toBe(7);
  });
  it('nothing for what makes no sense', () => {
    expect(euclid(0, 8)).toEqual([]);
    expect(euclid(9, 8)).toEqual([]);
  });
});

describe('the pulse', () => {
  it('is the commonest duration, the shorter of two as common', () => {
    expect(pulseOf([0.5, 0.25, 0.25, 1])).toBe(0.25);
    expect(pulseOf([0.5, 0.25, 1, 0.5, 0.25])).toBe(0.25);
    expect(pulseOf([])).toBe(0.25);
  });
});

describe('duration palettes', () => {
  it('every palette is ascending and has the makings of a rhythm', () => {
    for (const p of DURATION_PALETTES) {
      expect(p.ratios.length, p.name).toBeGreaterThan(0);
      expect([...p.ratios].sort((a, b) => a - b), p.name).toEqual(p.ratios);
    }
    for (const c of RHYTHM_CELLS) expect(c.cell.length, c.name).toBeGreaterThan(1);
  });

  it('times snap to the nearest duration, by ratio', () => {
    const ternary = DURATION_PALETTES.find(p => p.name === 'ternary')!.ratios;
    const out = snapToPalette([0.25, 0.25, 0.1, 0.5, 0.3], ternary);
    expect(out[0]).toBe(0.25);
    expect(out[2]).toBeCloseTo(0.25 / 3, 5);
    expect(out[3]).toBe(0.5);
    expect(out[4]).toBeCloseTo(0.25 * 4 / 3, 5);
    // everything is one of the palette's durations
    const allowed = ternary.map(r => Math.round(r * 0.25 * 1e6) / 1e6);
    for (const t of out) expect(allowed).toContain(t);
  });

  it('a time already in the palette stays', () => {
    expect(snapToPalette([0.5, 1, 0.25, 0.5], [1 / 4, 1 / 2, 1, 2, 4])).toEqual([0.5, 1, 0.25, 0.5]);
  });
});

describe('rhythm cells', () => {
  it('a cell on a pulse', () => {
    expect(cellTimes([3, 3, 2], 0.25)).toEqual([0.75, 0.75, 0.5]);
  });
  it('typed: k/n or the gaps', () => {
    expect(parseCell('3/8')!.cell).toEqual([3, 3, 2]);
    expect(ratioText(1.5)).toBe('1 1/2');
    expect(ratioText(2 / 3)).toBe('2/3');
    expect(ratioText(2)).toBe('2');
    expect(parseCell('3 3 2')!.cell).toEqual([3, 3, 2]);
    expect(parseCell('1.5, 1')!.cell).toEqual([1.5, 1]);
    expect(parseCell('swing')).toBeNull();
    expect(parseCell('9/8')).toBeNull();
    expect(parseCell('3')).toBeNull();
  });
});

describe('on a bloom', () => {
  it('a palette keeps the list its length; a cell gives it the cell\'s, phasing against the notes', () => {
    const b = new Bloom([60, 62, 64, 65, 67], [80, 80, 80, 80, 80], [0.25, 0.25, 0.5, 0.3, 1], [0]);
    expect(b.snapTimes([1, 2])).toBe(0.25);
    expect(b.timeIntervals).toEqual([0.25, 0.25, 0.5, 0.25, 0.5]);
    expect(b.setRhythm([3, 3, 2])).toBe(0.25);
    expect(b.timeIntervals).toEqual([0.75, 0.75, 0.5]);
    expect(b.notes.length).toBe(5);
  });

  it('opt-shift-z: every list to a length that divides N, so all come round on note N', () => {
    const b = new Bloom([60, 62, 64, 65], [100, 30, 30, 30, 30], [1, 1, 1, 1], [0, 1, 2, 3, 4, 5, 6]);
    const period = b.roundIn(12);
    expect(b.velocities.length).toBe(4);   // 5 → 4 (a tie with 6 goes to the shorter)
    expect(b.chans.length).toBe(6);        // 7 → 6
    expect(b.notes.length).toBe(4);
    expect(period).toBe(12);
    expect(12 % b.velocities.length).toBe(0);
  });
});
