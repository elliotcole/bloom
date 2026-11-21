// The editor's key table, and the window the passes strip looks through.
import { describe, expect, it } from 'vitest';
import { KEYS, atLevel, chordOf, cueLine, helpHtml, keyFor, shown } from '../keys';
import { clampWin, lasting, rulerStep, showWin, stamp, zoomWin } from '../window';

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('the keys', () => {
  it('a press as the table spells it', () => {
    expect(chordOf(press(' '))).toBe('space');
    expect(chordOf(press(' ', { shiftKey: true }))).toBe('⇧space');
    expect(chordOf(press('M', { shiftKey: true }))).toBe('M');   // the character says it
    expect(chordOf(press('ArrowLeft', { shiftKey: true, altKey: true }))).toBe('⌥⇧ArrowLeft');
    expect(chordOf(press('Z', { metaKey: true, shiftKey: true }))).toBe('⌘⇧z');
    expect(chordOf(press('s', { ctrlKey: true }))).toBe('⌘s');
  });
  it('no chord does two things at one level, and every key says what it does', () => {
    for (const level of ['pass', 'note'] as const) {
      const all = KEYS.filter(k => atLevel(k, level)).flatMap(k => k.chord);
      expect(new Set(all).size, level).toBe(all.length);
    }
    expect(KEYS.every(k => k.does.length > 3 && k.chord.length > 0)).toBe(true);
  });
  it('a press finds the key for the level: arrows by pass, or by onset in note mode', () => {
    expect(keyFor(press('ArrowRight'))?.does).toBe('the next pass');
    expect(keyFor(press('ArrowRight'), 'note')?.does).toBe('the next onset');
    expect(keyFor(press('ArrowLeft', { altKey: true }), 'note')?.does).toMatch(/first onset of the pass before/);
    expect(keyFor(press('Enter'))?.group).toBe('notes');
    expect(keyFor(press('Enter'), 'note')).toBeUndefined();
    expect(keyFor(press('s'), 'note')).toBeUndefined();   // sections are a pass-level thing
    // the edits work at both
    for (const k of ['x', 'd', 'p', 't', 'v', '1', '2', '!', '@']) expect(keyFor(press(k), 'note'), k).toBe(keyFor(press(k)));
    expect(keyFor(press('k', { metaKey: true }), 'note')?.does).toMatch(/palette/);
    // up and down stay closer and wider
    expect(keyFor(press('ArrowUp'), 'note')).toBe(keyFor(press('ArrowUp')));
  });
  it('each level has its own cue line, short enough to read across the page', () => {
    expect(cueLine('pass')).toContain('↵ notes');
    expect(cueLine('pass')).not.toContain('esc passes');
    expect(cueLine('note')).toContain('← → onset');
    expect(cueLine('note')).toContain('d silence');
    for (const level of ['pass', 'note'] as const) expect(cueLine(level).length, level).toBeLessThanOrEqual(210);
  });
  it('a press finds its key', () => {
    expect(keyFor(press('x'))?.does).toMatch(/^delete/);
    expect(keyFor(press('Backspace'))).toBe(keyFor(press('x')));
    expect(keyFor(press('q'))).toBeUndefined();
  });
  it('the help has every key, the cue line the ones marked for it', () => {
    const help = helpHtml();
    for (const k of KEYS) expect(help).toContain(k.does.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    expect(help).toContain('<b>⌥⇧←</b>');
    expect(help).toContain('<h3>notes</h3>');
    expect(help).toContain('<b>↵</b>');
    expect(cueLine()).toContain('x delete');
    expect(shown('⌘⇧ArrowRight')).toBe('⌘⇧→');
  });
});

describe('the window', () => {
  const H = 3_600_000;
  it('stays inside the performance, and shows all of a short one', () => {
    expect(clampWin({ from: -5, span: 60_000 }, H)).toEqual({ from: 0, span: 60_000 });
    expect(clampWin({ from: H, span: 60_000 }, H)).toEqual({ from: H - 60_000, span: 60_000 });
    expect(clampWin({ from: 0, span: 60_000 }, 900)).toEqual({ from: 0, span: 900 });
  });
  it('closer and wider about a moment, which stays where it was', () => {
    const w = zoomWin({ from: 100_000, span: 60_000 }, 0.5, 115_000, H);
    expect(w.span).toBe(30_000);
    expect((115_000 - w.from) / w.span).toBeCloseTo(0.25);
    expect(zoomWin(w, 1000, 115_000, H)).toEqual({ from: 0, span: H });
    expect(zoomWin(w, 0.00001, 115_000, H).span).toBe(2000);
  });
  it('turns like a page to show a stretch that is out of view, and not otherwise', () => {
    const w = { from: 100_000, span: 60_000 };
    expect(showWin(w, 120_000, 124_000, H)).toBe(w);
    expect(showWin(w, 200_000, 204_000, H)).toEqual({ from: 188_000, span: 60_000 });
    expect(showWin(w, 50_000, 54_000, H).from).toBe(38_000);
    expect(showWin(w, 0, 4000, H).from).toBe(0);
  });
  it('the clock', () => {
    expect(stamp(3_731_400)).toBe('1:02:11');
    expect(stamp(3_731_460, true)).toBe('1:02:11.5');
    expect(stamp(59_960, true)).toBe('1:00.0');
    expect(lasting(21_400)).toBe('21.4 s');
    expect(lasting(185_000)).toBe('3:05');
    expect(rulerStep(60_000, 1200)).toBe(5000);
    expect(rulerStep(H * 2, 1200)).toBe(600_000);
  });
});
