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
