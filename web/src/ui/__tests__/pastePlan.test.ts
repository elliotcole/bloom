import { describe, it, expect } from 'vitest';
import { runsOf, clipOf, anchorOf, placesOf, shifted, pastedAt } from '../pastePlan';

/** Paste a clip into a list the way keys.ts does: last run first, so places hold */
function paste<T>(list: T[], sel: number[], clip: { runs: T[][]; offsets: number[] }) {
  const places = placesOf(clip.offsets, anchorOf(sel, list.length), list.length);
  const out = [...list];
  for (let k = clip.runs.length - 1; k >= 0; k--) out.splice(places[k] + 1, 0, ...clip.runs[k]);
  return { out, places, sizes: clip.runs.map(r => r.length) };
}

const src = '5 3 4 a 6 3 b 2 3 c'.split(' ');

describe('paste plan', () => {
  it('finds runs of adjacent indices', () => {
    expect(runsOf([7, 3, 4])).toEqual([[3, 4], [7]]);
    expect(runsOf([])).toEqual([]);
  });

  it('pasted over its own selection, each note gets its copy straight after', () => {
    const sel = [3, 6, 9];
    const clip = clipOf(src, sel);
    expect(clip.offsets).toEqual([0, 3, 6]);
    const { out, places, sizes } = paste(src, sel, clip);
    expect(out.join(' ')).toBe('5 3 4 a a 6 3 b b 2 3 c c');
    expect(pastedAt(places, sizes)).toEqual([4, 8, 12]);
  });

  it('keeps the spacing in another list, from the first selected note', () => {
    const clip = clipOf(src, [3, 6, 9]);
    const { out } = paste('p q r s t u v w x'.split(' '), [1], clip);
    expect(out.join(' ')).toBe('p q a r s t b u v w c x');
  });

  it('keeps a run of adjacent notes whole', () => {
    const list = 'a b c d'.split(' ');
    expect(paste(list, [0, 1, 2], clipOf(list, [0, 1, 2])).out.join(' ')).toBe('a b c a b c d');
    expect(paste(list, [0, 1, 3], clipOf(list, [0, 1, 3])).out.join(' ')).toBe('a b a b c d d');
  });

  it('puts what would fall off the end at the end, in order', () => {
    const clip = clipOf(src, [3, 6, 9]);
    expect(paste(['x', 'y'], [0], clip).out.join(' ')).toBe('x a y b c');
    expect(paste(['x', 'y'], [], clip).out.join(' ')).toBe('x y a b c');
    expect(paste([] as string[], [], clip).out.join(' ')).toBe('a b c');
  });

  it('with nothing selected copies the lot as one run', () => {
    expect(clipOf(['x', 'y'], [])).toEqual({ runs: [['x', 'y']], offsets: [0] });
  });

  it('says where the notes already there went', () => {
    // copies after 3, 6 and 9, one note each
    expect([3, 4, 6, 7, 9].map(i => shifted(i, [3, 6, 9], [1, 1, 1]))).toEqual([3, 5, 7, 9, 11]);
  });
});
