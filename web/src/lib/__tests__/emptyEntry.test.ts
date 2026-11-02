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
