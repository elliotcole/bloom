// Select mode's verbs: the selection as a list, moved like any other
import { describe, expect, it } from 'vitest';
import { everyNth, fewer, increment, invert, mirror, more, rotate, scramble, slice } from '../selectVerbs';

/** A fixed run of "random" numbers */
const rng = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('select mode', () => {
  it('= adds about an eighth of the events, at least one, never a pinned one', () => {
    expect(increment(5)).toBe(1);
    expect(increment(16)).toBe(2);
    expect(more([], 16, [], rng(0)).length).toBe(2);
    const sel = more([0], 4, [1], rng(0));
    expect(sel).toEqual([0, 2]);
    for (let k = 0; k < 20; k++) expect(more([0], 4, [1])).not.toContain(1);
  });

  it('= on a full selection and - on an empty one change nothing', () => {
    expect(more([0, 1, 2], 3)).toEqual([0, 1, 2]);
    expect(fewer([], 8)).toEqual([]);
  });

  it('- takes as many away', () => {
    expect(fewer([0, 3, 5, 9], 16, rng(0)).length).toBe(2);
    expect(fewer([4], 5)).toEqual([]);
  });

  it('9 0 rotate, round the end', () => {
    expect(rotate([0, 2, 4], 5, 1)).toEqual([0, 1, 3]);
    expect(rotate([0, 2, 4], 5, -1)).toEqual([1, 3, 4]);
  });

  it('R mirrors, i inverts (the pinned left out)', () => {
    expect(mirror([0, 1], 5)).toEqual([3, 4]);
    expect(invert([0, 1], 5)).toEqual([2, 3, 4]);
    expect(invert([0, 1], 5, [4])).toEqual([2, 3]);
  });

  it('s keeps the count and moves the places', () => {
    const sel = scramble([0, 1, 2], 10, [9]);
    expect(sel.length).toBe(3);
    expect(sel).not.toContain(9);
    expect(scramble([], 16).length).toBe(2);   // nothing selected: an increment's worth
  });

  it('e every Nth, from an offset', () => {
    expect(everyNth(8, 3)).toEqual([0, 3, 6]);
    expect(everyNth(8, 3, 1)).toEqual([1, 4, 7]);
    expect(everyNth(8, 2, 0, [2])).toEqual([0, 4, 6]);
  });

  it('l: the loudest, every event at that level; again, the next level too', () => {
    const vel = [100, 30, 100, 60, 30, 0];
    const top = slice(vel, [], true);
    expect(top).toEqual([0, 2]);
    const two = slice(vel, top, true);
    expect(two).toEqual([0, 2, 3]);
    expect(slice(vel, two, true)).toEqual([0, 1, 2, 3, 4]);
    // some other selection: the slice starts afresh
    expect(slice(vel, [1], true)).toEqual([0, 2]);
  });

  it('L: the softest, a rest left out; a pinned event is never taken', () => {
    const vel = [100, 30, 100, 60, 30, 0];
    expect(slice(vel, [], false, [], v => v <= 0)).toEqual([1, 4]);
    expect(slice(vel, [], true, [0])).toEqual([2]);
  });

  it('the deepest slice stays put', () => {
    expect(slice([5, 5], [0, 1], true)).toEqual([0, 1]);
  });
});

describe('o: the same pitch classes', () => {
  it('every event sounding a pitch class the selected do, in any octave; chords if any note does; pins stay out', async () => {
    const { samePitchClasses } = await import('../selectVerbs');
    const pcs = [[0], [2], [0], [7], [4, 0], [2]];   // C D C' G (E C) D'
    expect(samePitchClasses(pcs, [0])).toEqual([0, 2, 4]);
    expect(samePitchClasses(pcs, [1, 3])).toEqual([1, 3, 5]);
    expect(samePitchClasses(pcs, [0], [2])).toEqual([0, 4]);
    expect(samePitchClasses(pcs, [])).toEqual([]);
  });
});
