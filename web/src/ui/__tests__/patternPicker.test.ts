import { describe, expect, it } from 'vitest';
import { patternNote, patternRows } from '../patternPicker';
import { PATTERN_PRESETS } from '../../lib/patterns';

describe('pattern palette rows', () => {
  it('lists every preset, previewed on the list, with nothing typed', () => {
    const rows = patternRows('', 5);
    expect(rows.map(r => r.spec)).toEqual(PATTERN_PRESETS.map(p => p.spec));
    const braid = rows.find(r => r.name === 'braid')!;
    expect(braid.preview).toBe('123 234 345');
    expect(braid.length).toBe(9);
    expect(braid.problem).toBeNull();
  });
  it('puts the last pattern first when it is not a preset', () => {
    expect(patternRows('', 5, '13 +2')[0]).toMatchObject({ name: 'last', spec: '13 +2', preview: '13 35' });
    expect(patternRows('', 5, '123 +1')[0].name).toBe('braid');
  });
  it('filters the presets by name or spec', () => {
    expect(patternRows('pyr', 5).map(r => r.name)).toEqual(['pyramid']);
    expect(patternRows('braid', 5).map(r => r.name)).toEqual(['braid', 'braid, one loose']);
  });
  it('offers what is typed when it reads as a pattern, first', () => {
    const rows = patternRows('53124', 5);
    expect(rows[0]).toMatchObject({ name: 'yours', spec: '53124', preview: '53124', length: 5 });
  });
  it('names a typed preset by its name, not twice', () => {
    const rows = patternRows('123 +1', 5);
    expect(rows.filter(r => r.spec === '123 +1').map(r => r.name)).toEqual(['braid']);
  });
  it('marks a pattern that does not fit the list', () => {
    const rows = patternRows('', 1);
    expect(rows.find(r => r.name === 'braid')!.problem).toMatch(/list of 1|no 2/);
  });
  it('shortens a long preview', () => {
    const r = patternRows('', 30).find(r => r.name === 'pyramid')!;
    expect(r.preview.endsWith(' …')).toBe(true);
    expect(r.preview.length).toBeLessThanOrEqual(66);
    expect(r.length).toBe(465);
  });
});

describe('pattern palette note', () => {
  it('says the length, warns when long, says when cut', () => {
    expect(patternNote(patternRows('123 +1', 5)[0], '123 +1')).toEqual({ text: '9 notes', kind: 'ok' });
    expect(patternNote(patternRows('1 0,+1', 30)[0], '1 0,+1').kind).toBe('warn');
    expect(patternNote(patternRows('1 0,+1', 40)[0], '1 0,+1').text).toMatch(/cut at 500/);
  });
  it('says why nothing reads', () => {
    expect(patternNote(undefined, '123 q')).toEqual({ text: 'q: the flags are a r | ~ x2', kind: 'err' });
    expect(patternNote(undefined, '').text).toMatch(/type a pattern/);
  });
});
