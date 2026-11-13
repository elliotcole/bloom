import { describe, expect, it } from 'vitest';
import { strayKey, tabStop } from '../overlay';
import { onLeave } from '../listTyper';
import { withSuggestion } from '../commandPalette';

describe('a key from outside an open overlay', () => {
  it('esc closes it', () => {
    expect(strayKey('Escape')).toEqual({ close: true, refocus: false, prevent: true });
  });
  it('a letter goes back to its field, the browser left to type it there', () => {
    expect(strayKey('a')).toEqual({ close: false, refocus: true, prevent: false });
  });
  it('↵, space and tab go back to its field without touching what is behind', () => {
    for (const k of ['Enter', ' ', 'Tab']) expect(strayKey(k)).toEqual({ close: false, refocus: true, prevent: true });
  });
});

describe('tab among an overlay’s fields', () => {
  it('goes on to the next, back with shift', () => {
    expect(tabStop(0, 3, false)).toBe(1);
    expect(tabStop(2, 3, true)).toBe(1);
  });
  it('wraps at the ends rather than leaving', () => {
    expect(tabStop(2, 3, false)).toBe(0);
    expect(tabStop(0, 3, true)).toBe(2);
  });
  it('stays put on a single field', () => {
    expect(tabStop(0, 1, false)).toBe(0);
    expect(tabStop(0, 1, true)).toBe(0);
  });
  it('from nowhere, starts at the near end; with no fields, goes nowhere', () => {
    expect(tabStop(-1, 3, false)).toBe(0);
    expect(tabStop(-1, 3, true)).toBe(2);
    expect(tabStop(0, 0, false)).toBe(-1);
  });
});

describe('the focus leaving the typing line', () => {
  it('closes it when nothing was typed', () => {
    expect(onLeave(true, false)).toBe('close');
  });
  it('keeps it when something was: nothing typed is lost unasked', () => {
    expect(onLeave(true, true)).toBe('keep');
  });
  it('waits while the window itself is out of focus', () => {
    expect(onLeave(false, false)).toBe('wait');
    expect(onLeave(false, true)).toBe('wait');
  });
});

describe('taking a suggestion in the command palette', () => {
  it('replaces what is typed', () => {
    expect(withSuggestion('scr', 'scramble')).toBe('scramble');
  });
  it('replaces only the last segment of a chain', () => {
    expect(withSuggestion('pivot.softer.scr', 'scramble')).toBe('pivot.softer.scramble');
    expect(withSuggestion('pivot.', 'scramble')).toBe('pivot.scramble');
  });
});
