// The field's pitch axis: whole octaves around the notes, so a semitone shows
import { describe, expect, it } from 'vitest';
import { fieldRange } from '../visualization';

describe('the field shows pitch up', () => {
  it('whole octaves, C to C, around the notes', () => {
    expect(fieldRange([50, 67, 79], 20, 100)).toEqual([48, 84]);
    expect(fieldRange([60, 72], 20, 100)).toEqual([60, 84]);
  });
  it('an octave and a half at least', () => {
    expect(fieldRange([62, 64, 65], 20, 100)).toEqual([54, 78]);
  });
  it('the compass when there are no notes', () => {
    expect(fieldRange([], 20, 100)).toEqual([20, 100]);
  });
});
