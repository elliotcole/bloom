// A loop keeps its place through edits: notes put in or taken out ahead of the
// playhead are heard as it reaches them, ones behind wait for the next time
// round, and the notes and every other list carry on without a jump.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { setBpm, startLooper, stopAll, updateLooper } from '../scheduler';
import { keepPlace } from '../playhead';
import type { MidiOutput } from '../midi';

const L = (s: string) => s.split('');

describe('keepPlace', () => {
  it('an edit ahead: the place stays, so what was put in plays next', () => {
    expect(keepPlace(L('abcde'), L('abXcde'), 2)).toBe(2);   // inserted where the playhead is
    expect(keepPlace(L('abcde'), L('abcdXe'), 1)).toBe(1);
    expect(keepPlace(L('abcde'), L('abde'), 2)).toBe(2);     // the next note deleted: the one after it plays
  });
  it('an edit behind: the place moves with what follows', () => {
    expect(keepPlace(L('abcde'), L('Xabcde'), 3)).toBe(4);   // still d next
    expect(keepPlace(L('abcde'), L('bcde'), 3)).toBe(2);     // still d next
    expect(keepPlace(L('abcde'), L('aXYbcde'), 4)).toBe(6);  // a paste behind
  });
  it('inside what was replaced: as far in as the new part goes; past the end, round to the top', () => {
    expect(keepPlace(L('abcdef'), L('aXf'), 3)).toBe(2);
    expect(keepPlace(L('abcde'), L('abcd'), 4)).toBe(0);
  });
  it('the same length: nothing moves', () => {
    expect(keepPlace(L('abcde'), L('edcba'), 3)).toBe(3);
  });
});

function recorder(): MidiOutput & { ons: { note: number; vel: number }[] } {
  const ons: { note: number; vel: number }[] = [];
  return { name: 'test', ons, send(d) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push({ note: d[1], vel: d[2] }); } };
}

const ACCENTS = [100, 40, 40, 70, 40, 40];

function looping(): { b: Bloom; ons: { note: number; vel: number }[] } {
  const b = new Bloom();
  b.notes = [60, 62, 64, 65, 67]; b.timeIntervals = [0.25]; b.velocities = [...ACCENTS]; b.chans = [0];
  b.intervals = [0]; b.figures = [0];
  const out = recorder();
  startLooper(b, out);
  return { b, ons: out.ons };
}

describe('a loop keeps its place through edits', () => {
  beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
  afterEach(() => { stopAll(); vi.useRealTimers(); });

  it('a note put in ahead plays as the playhead gets there, the accents unbroken', () => {
    const { b, ons } = looping();
    vi.advanceTimersByTime(650);   // a note every 125 ms: into the second pass
    const heard = ons.length, pos = heard % 5;
    expect(pos).toBeLessThanOrEqual(2);
    const notes = [60, 62, 64, 65, 67];
    b.notes = [...notes.slice(0, pos + 2), 72, ...notes.slice(pos + 2)];   // just ahead of the playhead
    updateLooper(b);
    vi.advanceTimersByTime(2000);
    // the pass goes on to the new note and through it, nothing skipped or repeated
    expect(ons.slice(heard, heard + 6 - pos).map(o => o.note)).toEqual([...notes.slice(pos, pos + 2), 72, ...notes.slice(pos + 2)]);
    expect(ons.map(o => o.vel)).toEqual(ons.map((_, i) => ACCENTS[i % 6]));
  });

  it('a note taken out behind: no jump; it is gone from the next pass', () => {
    const { b, ons } = looping();
    vi.advanceTimersByTime(800);
    const heard = ons.length;
    const notes = [60, 62, 64, 65, 67];
    const pos = heard % 5;
    expect(pos).toBeGreaterThan(0);
    b.notes = notes.filter((_, i) => i !== 0);   // the first note, already played this pass
    updateLooper(b);
    vi.advanceTimersByTime(2000);
    // the pass carries on from where it was, then the four notes round and round
    expect(ons.slice(heard, heard + 5 - pos).map(o => o.note)).toEqual(notes.slice(pos));
    const rest = ons.slice(heard + 5 - pos).map(o => o.note);
    expect(rest).toEqual(rest.map((_, i) => [62, 64, 65, 67][i % 4]));
    expect(ons.map(o => o.vel)).toEqual(ons.map((_, i) => ACCENTS[i % 6]));
  });
});
