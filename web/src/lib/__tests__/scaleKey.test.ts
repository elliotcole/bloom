import { describe, it, expect } from 'vitest';
import { scaleKey, scaleTitle, identifyScale, SCALES, scaleTranspose } from '../scales';

const set = (degrees: number[], name = '') => ({ degrees, pitchesPerOctave: 12, name });

describe('a scale\'s key and title', () => {
  it('Marva on C is in C, not the key signature\'s G', () => {
    const marva = set([0, 1, 4, 6, 7, 9, 11], 'C Marva');
    expect(scaleKey(marva)).toBe(0);
    expect(scaleTitle(marva)).toBe('Marva');
    // the same notes with no name (after a pivot) read the same
    expect(scaleKey(set(marva.degrees))).toBe(0);
    expect(scaleTitle(set(marva.degrees))).toBe('Marva');
  });

  it('follows a catalogue scale put on another root', () => {
    const s = scaleTranspose(SCALES.marva, 7);
    expect(scaleKey(s)).toBe(7);
    expect(scaleTitle(s)).toBe('Marva');
  });

  it('keeps the key signature for notes inside one', () => {
    expect(scaleKey(set([2, 4, 5, 7, 9, 11, 0], 'D Dorian'))).toBe(0);
    expect(scaleTitle(set([2, 4, 5, 7, 9, 11, 0], 'D Dorian'))).toBe('D Dorian');
    expect(scaleKey(set([0, 2, 4, 7, 9]))).toBe(0);
  });

  it('puts harmonic minor on its own root', () => {
    expect(scaleKey(set([9, 11, 0, 2, 4, 5, 8]))).toBe(9);
  });

  it('lets Sa and a centre chosen by hand win', () => {
    expect(scaleKey({ ...set([0, 1, 4, 6, 7, 9, 11]), tonic: 4 })).toBe(4);
    expect(scaleKey({ ...set([0, 1, 4, 6, 7, 9, 11]), root: 7 })).toBe(7);
  });

  it('identifies nothing in a set the catalogue lacks', () => {
    expect(identifyScale([0, 1, 2])).toBeNull();
    expect(scaleTitle(set([0, 1, 2]))).toBe('');
  });
});
