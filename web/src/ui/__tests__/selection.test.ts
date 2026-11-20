// A selection put back: the key and scale stay the whole bloom's, and lists
// phasing against the notes stay as they were when events come or go.
import { describe, expect, it } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { SCALES } from '../../lib/scales';
import { extractSelection, mergeSelection } from '../selection';

function bloom(): Bloom {
  const b = new Bloom([60, 62, 64, 65, 67], [80, 40], [0.5, 0.25, 0.25, 0.25, 0.25], 0);
  b.appliedScale = SCALES.major; b.keyRoot = 0;
  return b;
}

describe('a selection put back', () => {
  it('transposing a selected note moves the note, not the key', () => {
    const full = bloom();
    const extracted = extractSelection(full, [2]);
    const worked = extracted.clone();
    worked.transpose(1);
    const { bloom: out } = mergeSelection(full, [2], extracted, worked);
    expect(out.notes).toEqual([60, 62, 65, 65, 67]);
    expect(out.keyRoot).toBe(0);
    expect(out.appliedScale?.name).toBe(SCALES.major.name);
    expect(out.appliedScale?.degrees).toEqual(SCALES.major.degrees);
  });
  it('adding a note among the selection leaves a phasing velocity list alone, and grows the lists in step', () => {
    const full = bloom();
    const extracted = extractSelection(full, [1, 2]);
    const worked = extracted.clone();
    worked.addOne(72);
    const { bloom: out, sel } = mergeSelection(full, [1, 2], extracted, worked);
    expect(out.notes).toEqual([60, 62, 64, 72, 65, 67]);
    expect(out.velocities).toEqual([80, 40]);
    expect(out.timeIntervals.length).toBe(6);
    expect(sel).toEqual([1, 2, 3]);
  });

  // pitch mode's length keys change the notes alone: no other list may be spelled out per event
  const phasing = (): Bloom => {
    const b = new Bloom([60, 62, 64, 65, 67, 69, 71], [90, 70, 50], [0.5, 0.25, 0.25, 0.25], 0);
    b.chans = [1, 2, 3, 4, 5];
    b.appliedScale = SCALES.major; b.keyRoot = 0;
    return b;
  };
  const verbs: [string, (b: Bloom) => void][] = [
    ['a', b => b.shapeList('notes', 'addFromPalette')],
    ['A', b => b.shapeList('notes', 'addRandom')],
    ['z', b => b.shapeList('notes', 'dropLast')],
    ['{', b => b.mergeList('notes')],
    ['"', b => b.repeatLists(2, ['notes'])],
  ];
  for (const [key, fn] of verbs) {
    for (const sel of [[1, 2, 3], [0, 1, 2, 3, 4, 5, 6]]) {
      it(`pitch mode ${key} on ${sel.length === 7 ? 'every event (pins)' : 'a selection'} leaves the phasing lists as they were`, () => {
        const full = phasing();
        const extracted = extractSelection(full, sel);
        const worked = extracted.clone();
        fn(worked);
        const { bloom: out } = mergeSelection(full, sel, extracted, worked);
        expect(out.notes.length).not.toBe(7);
        expect(out.velocities).toEqual([90, 70, 50]);
        expect(out.timeIntervals).toEqual([0.5, 0.25, 0.25, 0.25]);
        expect(out.chans).toEqual([1, 2, 3, 4, 5]);
      });
    }
  }
  it('a list in step with the notes still follows when pitch mode adds one among the selection', () => {
    const full = phasing();
    full.chans = [1, 2, 3, 4, 5, 6, 7];
    const extracted = extractSelection(full, [1, 2]);
    const worked = extracted.clone();
    worked.shapeList('notes', 'addFromPalette');
    const { bloom: out } = mergeSelection(full, [1, 2], extracted, worked);
    expect(out.notes.length).toBe(8);
    expect(out.chans.length).toBe(8);
    expect(out.velocities).toEqual([90, 70, 50]);
  });
});

describe('a sublist typed onto selected events', () => {
  it('puts chords on just those notes, the list spelled out to the notes first', () => {
    const full = new Bloom([60, 62, 64, 65], [80], [1], [0]);
    full.intervals = [0, 0, 0, 0];   // as typeTheSublist spells out an empty list
    const sel = [1, 3];
    const sub = extractSelection(full, sel);
    const worked = sub.snapshot();
    worked.intervals = [[7, -4], 12];
    const out = mergeSelection(full, sel, sub, worked).bloom;
    expect(out.intervals).toEqual([0, [7, -4], 0, 12]);
    expect(out.notes).toEqual([60, 62, 64, 65]);
  });
});

describe('↵ with pins: a list that phases is typed as written', () => {
  it('a short time list stays short; one a value per note, or a selection, types the free events', async () => {
    const { typedAsWritten } = await import('../selection');
    expect(typedAsWritten(false, 3, 11, 4)).toBe(true);    // pins, a 3-long list against 11 notes
    expect(typedAsWritten(false, 11, 11, 4)).toBe(false);  // in step: the pinned events keep theirs
    expect(typedAsWritten(true, 3, 11, 4)).toBe(false);    // a selection: typed onto it
    expect(typedAsWritten(false, 3, 11, 0)).toBe(false);   // no pins: the whole list anyway
  });
});

describe('a box drag selects', () => {
  it('what is inside it; with shift, added to what was selected', async () => {
    const { boxSelection } = await import('../visualization');
    expect(boxSelection([5, 3], [0, 1], false)).toEqual([3, 5]);
    expect(boxSelection([5, 3, 1], [0, 1], true)).toEqual([0, 1, 3, 5]);
    expect(boxSelection([], [2], true)).toEqual([2]);
  });
});
