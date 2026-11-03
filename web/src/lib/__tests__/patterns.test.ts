// The pattern language: a window read, moved, read again.

import { describe, it, expect } from 'vitest';
import { parsePattern, expandPattern, formatPattern, bakePattern, resolveStep, PATTERN_PRESETS, PATTERN_CAP } from '../patterns';
import type { Pattern } from '../patterns';
import { slide, pyramid, mirror, stutter } from '../arrays';

const ABC = ['a', 'b', 'c', 'd', 'e'];
const shown = (spec: string, n = 5) => {
  const p = parsePattern(spec) as Pattern;
  if (typeof p === 'string') throw new Error(p);
  const e = expandPattern(p, n);
  return typeof e === 'string' ? e : formatPattern(e.rounds, n);
};
const baked = (spec: string, arr: unknown[] = ABC) => {
  const r = bakePattern(arr, spec, () => 0);
  if (typeof r === 'string') throw new Error(r);
  return r.values;
};

describe('patterns: the shapes we have', () => {
  it('braid is 123 +1, the same as today\'s slide of 3', () => {
    expect(shown('123 +1')).toBe('123 234 345');
    for (const n of [3, 4, 7, 9]) {
      const arr = Array.from({ length: n }, (_, i) => i * 10);
      expect(baked('123 +1', arr)).toEqual(slide(arr, 3));
    }
  });

  it('pyramid is 1 0,+1, the same as today\'s pyramid', () => {
    expect(shown('1 0,+1')).toBe('1 12 123 1234 12345');
    expect(baked('1 0,+1')).toEqual(pyramid(ABC, 1));
  });

  it('the other pyramids, mirror and stutter are settings of the same machine', () => {
    expect(baked('n -1,0')).toEqual(pyramid(ABC, 2));
    expect(baked('1..n 0,-1')).toEqual(pyramid(ABC, 3));
    expect(baked('1..n +1,0')).toEqual(pyramid(ABC, 4));
    expect(baked('1 0,+1 |')).toEqual(pyramid(ABC, 5));
    expect(baked('1 +1 |')).toEqual(mirror(ABC));
    expect(baked('11 +1')).toEqual(stutter(ABC, 2));
  });
});

describe('patterns: new shapes', () => {
  it('a wedge closes in, opening out opens', () => {
    expect(shown('1..n +1,-1')).toBe('12345 234 3');
    expect(shown('3 -1,+1')).toBe('3 234 12345');
  });

  it('a motif keeps its shape at a fixed width', () => {
    expect(shown('13 +1')).toBe('13 24 35');
    expect(shown('1213 +1')).toBe('1213 2324 3435');
    expect(shown('5432 -1')).toBe('5432 4321');   // the next would reach 0: stops
    expect(shown('321 +1')).toBe('321 432 543');
  });

  it('a changing window reads a run at the first window\'s stride and direction', () => {
    expect(shown('13 0,+2', 7)).toBe('13 135 1357');
    expect(shown('54321 +1,-1')).toBe('54321 432 3');
    expect(shown('1213 0,+1')).toMatch(/motif needs a window that keeps its width/);
  });

  it('no movement plays the window once: a reordering', () => {
    expect(shown('53124')).toBe('53124');
    expect(shown('123 0')).toBe('123');
  });

  it('flags: alternate, backward, there and back, twice, wrap', () => {
    expect(shown('123 +1 a')).toBe('123 432 345');
    expect(shown('123 +1 r')).toBe('321 432 543');
    expect(shown('12 +1 x2', 3)).toBe('12 12 23 23');
    expect(shown('123 +1 ~')).toBe('123 234 345 451 512');
    expect(shown('1 0,+1 ~', 3)).toBe('1 12 123');
    expect(shown('123 +1 a|')).toBe('123 432 345 432 123');
  });

  it('spaced words for long lists, shown with spaces and dots', () => {
    expect(shown('1 10 +1', 12)).toBe('1 10 · 2 11 · 3 12');
  });

  it('wildcards: * from the window, ** from anywhere, rolled anew each time', () => {
    const e = expandPattern(parsePattern('1* +1') as Pattern, 5);
    if (typeof e === 'string') throw new Error(e);
    expect(e.rounds[1][1]).toEqual({ any: 'window', lo: 1, hi: 2 });
    expect(formatPattern(e.rounds, 5)).toBe('1* 2* 3* 4*');
    expect(resolveStep({ any: 'window', lo: 1, hi: 2 }, 5, () => 0.99)).toBe(2);
    expect(resolveStep({ any: 'all' }, 5, () => 0.99)).toBe(4);
    const rolls = new Set(Array.from({ length: 200 }, () => resolveStep({ any: 'window', lo: 1, hi: 3 }, 5)));
    expect([...rolls].sort()).toEqual([1, 2, 3]);
    expect(shown('** 0,+1')).toMatch(/takes no \*/);
    expect(shown('1** +1')).toBe('1** 2** 3** 4** 5**');   // ** doesn't widen the window
  });

  it('stops at the cap, whole windows at a time', () => {
    const e = expandPattern(parsePattern('1 0,+1') as Pattern, 40);
    if (typeof e === 'string') throw new Error(e);
    expect(e.capped).toBe(true);
    expect(e.length).toBeLessThanOrEqual(PATTERN_CAP);
    expect(e.rounds.every((w, i) => w.length === i + 1)).toBe(true);
  });
});

describe('patterns: what goes wrong is said', () => {
  it.each([
    ['', /first window/],
    ['+1', /start with the first window/],
    ['103 +1', /indices start at 1/],
    ['123 +1 q', /flags are/],
    ['123 +1 x0', /count of 1 or more/],
  ])('%j', (spec, msg) => {
    expect(parsePattern(spec)).toMatch(msg);
  });

  it('a window past the list', () => {
    expect(shown('1 9 +1')).toMatch(/has 5: there's no 9/);
    expect(bakePattern(['a', 'b'], '123 +1')).toMatch(/no 3/);
  });

  it('every preset reads and fits a list of 5', () => {
    for (const p of PATTERN_PRESETS) {
      const e = parsePattern(p.spec);
      expect(typeof e, p.name).not.toBe('string');
      expect(typeof expandPattern(e as Pattern, 5), p.name).not.toBe('string');
    }
  });
});
