// An empty entry is written as a period, a key on every keyboard, and what is
// shown can be typed back in.

import { describe, it, expect } from 'vitest';
import { formatIntervals, parseIntervals, stepName } from '../intervals';
import { formatFigure, parseFigures } from '../figures';

describe('empty entries', () => {
  it('an empty interval step shows as a period and reads back', () => {
    expect(stepName(0)).toBe('.');
    const shown = formatIntervals([7, 0, 0]);
    expect(shown).not.toContain('·');
    expect(parseIntervals(shown).list).toEqual([7, 0, 0]);
  });

  it('a rest in a figure shows as a period and reads back', () => {
    const shown = formatFigure([0, null, 2]);
    expect(shown).toContain('.');
    expect(shown).not.toContain('·');
    expect(parseFigures(shown).error).toBeNull();
  });
});

describe('chords of intervals', () => {
  it('are written in parentheses and read back, brackets and the old run-together form too', () => {
    expect(stepName([-7, -12])).toBe('(-P5 -P8)');
    expect(stepName(7)).toBe('+P5');
    const shown = formatIntervals([[-7, -12], 0, 0, 0, 4]);
    expect(shown).toBe('(-P5 -P8)/4 +M3');
    expect(parseIntervals(shown).list).toEqual([[-7, -12], 0, 0, 0, 4]);
    expect(parseIntervals('[+3rd +5th] (P5 M3)').list).toEqual(parseIntervals('+3rd+5th +P5+M3').list);
    expect(parseIntervals('-P5-P8').list).toEqual(parseIntervals('(-P5 -P8)').list);
    expect(parseIntervals('(-P5 -P8').error).toMatch(/closing/);
  });
});
