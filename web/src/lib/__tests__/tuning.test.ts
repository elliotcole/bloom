import { describe, it, expect } from 'vitest';
import {
  ALTERATIONS, centsOfRatio, clearAlterations, commaOf, editable, fromList, intervalBetween, recentre, stepAlterations,
} from '../tuning';
import type { Tuning } from '../tuning';
import { hejiAccidental } from '../../ui/heji';

const JUST = fromList('16/15 9/8 6/5 5/4 4/3 45/32 3/2 8/5 5/3 9/5 15/8', 'just') as Tuning;

describe('the commas', () => {
  it('runs smallest first, 2–5¢ apart, from 4.5¢ to 53¢', () => {
    expect(ALTERATIONS.map(c => c.id).join('')).toBe('knthyspzejfdqu');
    const c = ALTERATIONS.map(a => centsOfRatio(a.ratio));
    c.slice(1).forEach((x, i) => expect(x - c[i]).toBeGreaterThan(1.9));
    c.slice(1).forEach((x, i) => expect(x - c[i]).toBeLessThan(5.1));
    expect(new Set(ALTERATIONS.map(a => a.id)).size).toBe(14);
    expect(centsOfRatio(commaOf('n').ratio)).toBeCloseTo(7.139, 2);
    expect(centsOfRatio(commaOf('h').ratio)).toBeCloseTo(14.730, 2);
  });

  it('moves a note by them exactly', () => {
    const t = stepAlterations(editable(JUST), [4], 'n', 1);
    expect(t.ratios![4]).toBe('1215/968');   // 5/4 × 243/242
    const u = stepAlterations(editable(JUST), [1], 'h', -1);
    expect(u.ratios![1]).toBe('65536/61965');   // 16/15 ÷ 4131/4096
  });

  it('writes them as letters, HEJI having no sign', () => {
    expect(hejiAccidental('E', { n: 1, h: -2 }).text).toBe('+n−2h');
    expect(hejiAccidental('E', { s: 1, n: 1 })).toMatchObject({ text: '+n' });
    expect(hejiAccidental('E', { k: -1, q: 2, p: 1 }).text).toBe('−k+p+2q');
  });
});

describe('recentre (opt-k in tuning mode)', () => {
  it('makes a degree 1/1 and keeps every interval', () => {
    const t = recentre(editable(JUST), 7);   // G becomes 1/1
    expect(t.ratios![0]).toBe('1/1');
    expect(t.ratios![5]).toBe('4/3');   // the old 1/1, a fourth above G
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
      expect(intervalBetween(t, a, b).cents).toBeCloseTo(intervalBetween(JUST, (a + 7) % 12, (b + 7) % 12).cents, 6);
    }
    expect(t.cents.every(c => c >= 0 && c < 1200)).toBe(true);
    expect(t.turn).toBe(7);
  });

  it('turns the alterations with it, the new 1/1 unaltered', () => {
    const altered = stepAlterations(stepAlterations(editable(JUST), [7], 's', 1), [11], 's', 1);
    const t = recentre(altered, 7);
    expect(t.alter![0]).toEqual({});
    expect(t.alter![4]).toEqual({});   // old 11, also +s: the same as the new 1/1
    expect(t.alter![5]).toEqual({ s: -1 });   // old 0, unaltered: a comma below now
    expect(intervalBetween(t, 0, 4).cents).toBeCloseTo(intervalBetween(altered, 7, 11).cents, 6);
  });

  it('turns back to where it was, and clearing finds the turned notes', () => {
    const t = recentre(recentre(editable(JUST), 7), 5);
    expect(t.turn).toBeUndefined();
    expect(t.ratios).toEqual(editable(JUST).ratios);
    const turned = stepAlterations(recentre(editable(JUST), 2), [3], 's', 1);
    const cleared = clearAlterations(turned, [3], JUST);
    expect(cleared.ratios![3]).toBe(recentre(editable(JUST), 2).ratios![3]);
  });
});
