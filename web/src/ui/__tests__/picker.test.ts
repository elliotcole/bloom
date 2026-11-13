import { describe, expect, it } from 'vitest';
import { FilterList, hasWords } from '../picker';

describe('a picker’s rows', () => {
  const list = () => { const l = new FilterList<string>(); l.fill(['a', 'b', 'c']); return l; };

  it('starts on the first row, or the one asked for when it is there', () => {
    expect(list().active).toBe(0);
    const l = new FilterList<string>();
    l.fill(['a', 'b', 'c'], 2);
    expect(l.current()).toBe('c');
    l.fill(['a', 'b'], 5);
    expect(l.active).toBe(0);
  });
  it('has no active row with no rows, and ↑↓ leave it so', () => {
    const l = new FilterList<string>();
    l.fill([], 1);
    expect(l.active).toBe(-1);
    l.move(1);
    l.move(-1);
    expect(l.active).toBe(-1);
    expect(l.current()).toBeUndefined();
  });
  it('↑↓ move one row and stop at the ends', () => {
    const l = list();
    l.move(-1);
    expect(l.active).toBe(0);
    l.move(1); l.move(1); l.move(1);
    expect(l.current()).toBe('c');
  });
  it('points at a row that is there, and ignores one that is not', () => {
    const l = list();
    expect(l.point(1)).toBe(true);
    expect(l.current()).toBe('b');
    expect(l.point(3)).toBe(false);
    expect(l.point(-1)).toBe(false);
    expect(l.current()).toBe('b');
  });
  it('filtering again starts over: the old active row is not kept', () => {
    const l = list();
    l.move(1); l.move(1);
    l.fill(['c']);
    expect(l.current()).toBe('c');
    expect(l.active).toBe(0);
  });
});

describe('matching what is typed', () => {
  it('needs every word, in any case; nothing typed matches all', () => {
    expect(hasWords('La Monte Young, The Well-Tuned Piano', 'well PIANO')).toBe(true);
    expect(hasWords('La Monte Young', 'young partch')).toBe(false);
    expect(hasWords('anything', '  ')).toBe(true);
  });
});
