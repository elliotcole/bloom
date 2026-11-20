import { describe, it, expect } from 'vitest';
import { figureOn } from '../pasteFigure';

const ev = (...notes: Array<number | number[]>) => notes.map(note => ({ note, vel: 80 }));
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe('paste figure', () => {
  it('moves the figure by semitones with no scale', () => {
    expect(figureOn(ev(60, 64, 67), 62, null).map(e => e.note)).toEqual([66, 69]);
  });

  it('moves it by scale steps when a scale is attached: C E G on D is D F A', () => {
    expect(figureOn(ev(60, 64, 67), 62, C_MAJOR).map(e => e.note)).toEqual([65, 69]);
    expect(figureOn(ev(60, 59, 72), 67, C_MAJOR).map(e => e.note)).toEqual([65, 79]);
  });

  it('carries chords and everything else about each note', () => {
    const out = figureOn(ev(60, [64, 67]), 62, null);
    expect(out).toEqual([{ note: [66, 69], vel: 80 }]);
  });

  it('has nothing to add for one note or none', () => {
    expect(figureOn(ev(60), 62, null)).toEqual([]);
    expect(figureOn([], 62, null)).toEqual([]);
  });
});
