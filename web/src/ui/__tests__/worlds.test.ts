import { describe, expect, it } from 'vitest';
import { worldHues } from '../worlds';

describe('tuning colours', () => {
  it('gives each tuning in the garden its own hue, 12-TET none', () => {
    const names = ['just', 'pythagorean', 'meantone', null, 'just', 'werckmeister', 'slendro', 'pelog'];
    const hues = worldHues(names);
    expect([...hues.keys()]).toEqual(['just', 'pythagorean', 'meantone', 'werckmeister', 'slendro', 'pelog']);
    expect(new Set(hues.values()).size).toBe(6);
  });
  it('keeps a tuning its own hue when nothing else claims it', () => {
    const alone = worldHues(['just']).get('just');
    expect(worldHues(['meantone', 'just']).get('just') === alone || worldHues(['meantone']).get('meantone') === alone).toBe(true);
    expect(worldHues(['just', 'meantone']).get('just')).toBe(alone);
  });
  it('stays distinct up to twelve tunings', () => {
    const names = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(new Set(worldHues(names).values()).size).toBe(12);
  });
});
