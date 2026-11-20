// Duration palettes and rhythm cells (time mode: k)
import { describe, expect, it } from 'vitest';
import { DURATION_PALETTES, RHYTHM_CELLS, cellTimes, euclid, parseBeats, parseCell, pulseOf, ratioText, snapToPalette } from '../rhythms';
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

  it('a chosen palette holds the times, as a key holds the notes', () => {
    const b = new Bloom([60, 62, 64, 65, 67], [80], [0.25, 0.25, 0.5, 0.3, 1], [0]);
    b.snapTimes([2 / 3, 4 / 3], 'swing');
    expect(b.frozen.rhythm).toEqual({ name: 'swing', pulse: 0.25 });
    expect(b.timePalette().length).toBe(2);
    // whatever a key does next, the times come back into it before they sound
    b.timeIntervals = [0.1, 0.9, 0.3];
    b.resolveFixed();
    expect(b.timeIntervals.every(t => b.rhythmScale()!.includes(t))).toBe(true);   // on the palette, in some octave of it
    // the next palette is measured on the same pulse, not on swing's commonest value
    expect(b.snapTimes([1, 2], 'long short')).toBe(0.25);
    expect(b.frozen.time).toEqual([0.25, 0.5]);
    // the time verbs see the whole palette, not just the durations in use
    b.timeIntervals = [0.25, 0.25, 0.25];
    expect(b.timePalette()).toEqual([0.25, 0.5]);
  });

  it('the palette follows a tempo change; a cell or a freeze by hand lets it go', () => {
    const b = new Bloom([60, 62, 64], [80], [0.25, 0.5, 0.25], [0]);
    b.snapTimes([1, 2], 'long short');
    b.scaleTimes(2);
    expect(b.frozen.rhythm!.pulse).toBe(0.5);
    expect(b.frozen.time).toEqual([0.5, 1]);
    b.setRhythm([3, 3, 2]);
    expect(b.frozen.time).toBe(false);
    expect(b.frozen.rhythm).toBeUndefined();
    b.snapTimes([1, 2], 'long short');
    b.freeze('time', true);
    expect(b.frozen.rhythm).toBeUndefined();
  });

  it('times written by hand that leave the palette let it go; ones that fit keep it', () => {
    const b = new Bloom([60, 62, 64], [80], [0.25, 0.5, 0.25], [0]);
    b.snapTimes([1, 2], 'long short');
    b.timeIntervals = [0.5, 0.5, 0.25];
    expect(b.releaseTimesIfOutside()).toBe('');
    expect(b.frozen.rhythm?.name).toBe('long short');
    b.timeIntervals = [0.5, 0.33, 0.25];
    expect(b.releaseTimesIfOutside()).toBe('long short');
    expect(b.frozen.time).toBe(false);
    expect(b.frozen.rhythm).toBeUndefined();
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

describe('a basis reads as a fraction of a beat', () => {
  it('down to the small ones', () => {
    expect(ratioText(0.25)).toBe('1/4');
    expect(ratioText(0.125)).toBe('1/8');
    expect(ratioText(1 / 16)).toBe('1/16');
    expect(ratioText(1 / 6)).toBe('1/6');
  });
});

describe('a locked palette is a rhythmic scale', () => {
  it('3 4 walk on past its ends, by its octaves, and stay in it', () => {
    const b = new Bloom([60], [80], [0.2], [0]);
    b.snapTimes([1, 3 / 2], 'aksak', 0.2);   // aksak on a basis of 1/5
    expect(b.rhythmScale()!.filter(t => t >= 0.2 && t <= 1.2)).toEqual([0.2, 0.3, 0.4, 0.6, 0.8, 1.2]);
    for (let i = 0; i < 4; i++) { b.shapeList('time', 'stepUp'); b.resolveFixed(); }
    expect(b.timeIntervals).toEqual([0.8]);
    expect(b.frozen.rhythm?.name).toBe('aksak');
    b.shapeList('time', 'stepDown'); b.resolveFixed();
    expect(b.timeIntervals).toEqual([0.6]);
  });
  it('a time typed on the scale, past the palette, keeps the lock', () => {
    const b = new Bloom([60, 62], [80], [0.2, 0.3], [0]);
    b.snapTimes([1, 3 / 2], 'aksak', 0.2);
    b.timeIntervals = [0.8, 1.2];
    expect(b.releaseTimesIfOutside()).toBe('');
    b.timeIntervals = [1];
    expect(b.releaseTimesIfOutside()).toBe('aksak');
  });
  it('a palette can be chosen on a basis given (the other voice\'s)', () => {
    const b = new Bloom([60, 62], [80], [0.25, 0.5], [0]);
    expect(b.lockedBasis()).toBeNull();
    b.snapTimes([1, 2], 'long short', 0.2);
    expect(b.lockedBasis()).toBe(0.2);
    expect(b.timeIntervals).toEqual([0.2, 0.4]);
  });
});

describe('cut and squeeze to a length in beats', () => {
  it('a length as typed', () => {
    expect(parseBeats('4')).toBe(4);
    expect(parseBeats('2.5')).toBe(2.5);
    expect(parseBeats('3/2')).toBe(1.5);
    expect(parseBeats('1 1/2')).toBe(1.5);
    expect(parseBeats('0')).toBeNull();
    expect(parseBeats('four')).toBeNull();
  });
  it('time mode, cut: the time list looped round and cut there, the notes untouched', () => {
    const b = new Bloom([60, 62, 64], [80], [1, 0.5, 0.5], [0]);
    b.cutTimesTo(1.25);
    expect(b.timeIntervals).toEqual([1, 0.25]);
    b.timeIntervals = [1, 0.5];
    b.cutTimesTo(4);
    expect(b.timeIntervals).toEqual([1, 0.5, 1, 0.5, 1]);
    expect(b.notes.length).toBe(3);
  });
  it('time mode, squeeze: the time list scaled to sum to the length, its shape kept', () => {
    const b = new Bloom([60, 62, 64], [80], [1, 0.5, 0.5], [0]);
    b.squeezeTo(4, true);
    expect(b.timeIntervals).toEqual([2, 1, 1]);
  });
  it('home: squeeze makes one pass of the notes that long; cut ends notes and times there', () => {
    const b = new Bloom([60, 62, 64, 65], [80], [1, 0.5], [0]);   // a pass: 1 .5 1 .5 = 3
    b.squeezeTo(6);
    expect(b.timeIntervals).toEqual([2, 1]);
    expect(b.passDur()).toBe(6);
    const c = new Bloom([60, 62, 64, 65], [80, 70, 60, 50], [1, 1, 1, 1], [0]);
    c.trimToDur(2.5);
    expect(c.notes.length).toBe(3);
    expect(c.timeIntervals).toEqual([1, 1, 0.5]);
    expect(c.velocities).toEqual([80, 70, 60]);
  });
  it('squeeze carries a locked palette with it', () => {
    const b = new Bloom([60, 62], [80], [0.25, 0.5], [0]);
    b.snapTimes([1, 2], 'long short', 0.25);
    b.squeezeTo(1.5, true);
    expect(b.lockedBasis()).toBe(0.5);
    expect(b.timeIntervals).toEqual([0.5, 1]);
  });
});
