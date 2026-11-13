import { describe, expect, it } from 'vitest';
import { scaleRows } from '../scalePicker';
import { ALL_SCALES, scaleTranspose } from '../../lib/scales';

describe('scale picker rows', () => {
  it('lists the ragas first, then the scales by size, with nothing typed', () => {
    const rows = scaleRows('', 0, null);
    expect(rows[0].group).toMatch(/^ragas/);
    const sizes = rows.filter(r => !/^ragas/.test(r.group)).map(r => r.scale.degrees.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(rows.every(r => !r.current)).toBe(true);
  });
  it('filters on the name, in any case', () => {
    const name = ALL_SCALES.find(s => s.root === undefined && s.pitchesPerOctave === 12)!.name;
    const rows = scaleRows(name.toUpperCase(), 0, null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.scale.name.toLowerCase().includes(name.toLowerCase()))).toBe(true);
    expect(scaleRows('no such scale zzz', 0, null)).toEqual([]);
  });
  it('spells a scale from the chosen root up, and marks the attached one on that root', () => {
    const s = ALL_SCALES.find(x => x.root === undefined && x.pitchesPerOctave === 12 && x.degrees.length === 7)!;
    const on = scaleTranspose(s, 2);
    const rows = scaleRows(s.name, 2, on);
    const row = rows.find(r => r.scale === s)!;
    expect(row.current).toBe(true);
    expect(row.notes.split(' ')[0]).toBe('D');
    expect(scaleRows(s.name, 3, on).find(r => r.scale === s)!.current).toBe(false);
  });
});
