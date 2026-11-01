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
});
