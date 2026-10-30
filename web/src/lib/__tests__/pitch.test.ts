import { describe, expect, it } from 'vitest';
import { keyToDegree, degreeToKey, nearestInScale, stepInScale } from '../numbers';
import { nearestInScaleUniqueArr, SCALES } from '../scales';
import { perfectShuffle } from '../arrays';

const MAJOR = SCALES.major.degrees;           // C major
const PENTA = SCALES.majorPentatonic.degrees;  // C D E G A

describe('keyToDegree / degreeToKey', () => {
  it('round-trips scale notes', () => {
    for (const n of [48, 60, 62, 64, 65, 67, 69, 71, 72, 83]) {
      expect(degreeToKey(keyToDegree(n, MAJOR), MAJOR)).toBe(n);
    }
  });
  it('reads a note above the top degree as nearer the next octave', () => {
    expect(keyToDegree(71, PENTA)).toBeCloseTo(29 + 2 / 3, 5);   // B: two thirds of the way from A to C
    expect(keyToDegree(70, PENTA)).toBeCloseTo(29 + 1 / 3, 5);
  });
  it('reads a note below the bottom degree against the degree below', () => {
    const DMAJ = [1, 2, 4, 6, 7, 9, 11];   // no 0
    expect(keyToDegree(60, DMAJ)).toBeCloseTo(35 - 0.5, 5);   // C between B and C#
  });
});

describe('nearestInScale', () => {
  it('wraps round the octave', () => {
    expect(nearestInScale(71, PENTA)).toBe(72);   // B → C above, not A
    expect(nearestInScale(70, PENTA)).toBe(69);   // Bb → A
    expect(nearestInScale(61, MAJOR)).toBe(62);   // a tie goes up
  });
  it('leaves scale notes alone', () => {
    expect(nearestInScale(67, PENTA)).toBe(67);
  });
});

describe('stepInScale', () => {
  it('steps whole degrees from an off-scale note', () => {
    expect(stepInScale(61, MAJOR, 1)).toBe(64);    // C# reads as D, up one is E
    expect(stepInScale(61, MAJOR, -1)).toBe(60);
    expect(stepInScale(71, PENTA, 1)).toBe(74);    // B reads as C, up one is D
    expect(stepInScale(71, MAJOR, 1)).toBe(72);
    expect(stepInScale(60, MAJOR, -1)).toBe(59);
  });
});

describe('nearestInScaleUniqueArr', () => {
  it('snaps across the octave line', () => {
    expect(nearestInScaleUniqueArr([71, 60, 67], PENTA)).toEqual([72, 60, 67]);
  });
  it('prefers distinct pitch classes on a tie', () => {
    const out = nearestInScaleUniqueArr([61, 62], MAJOR);
    expect(new Set(out).size).toBe(2);
    expect(out).toEqual([60, 62]);
  });
  it('does nothing with an empty scale', () => {
    expect(nearestInScaleUniqueArr([61, 62], [])).toEqual([61, 62]);
  });
});

describe('perfectShuffle', () => {
  it('keeps the length and every element', () => {
    expect(perfectShuffle([1, 2, 3, 4])).toEqual([1, 3, 2, 4]);
    expect(perfectShuffle([1, 2, 3, 4, 5])).toEqual([1, 4, 2, 5, 3]);
    expect(perfectShuffle([1])).toEqual([1]);
  });
});
