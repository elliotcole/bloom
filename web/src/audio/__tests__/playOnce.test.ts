// A new play (space) stops the last one as a loop stops: nothing more starts,
// what sounds is released on time, and no all-notes-off goes out (some
// instruments honour it under a held pedal, cutting off what rings).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { playOnce, setBpm, stopAll } from '../scheduler';
import type { MidiOutput } from '../midi';

function recorder(): MidiOutput & { sent: number[][] } {
  const sent: number[][] = [];
  return { name: 'test', sent, send(d) { sent.push([...d]); } };
}

describe('playing again', () => {
  beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
  afterEach(() => { stopAll(); vi.useRealTimers(); });

  it('sends no all-notes-off, and every note it started still ends', () => {
    const b = new Bloom();
    b.notes = [60, 62, 64, 65]; b.timeIntervals = [0.5]; b.velocities = [80]; b.chans = [0];
    b.intervals = [0]; b.figures = [0];
    const out = recorder();
    const cancel = playOnce(b, out);
    vi.advanceTimersByTime(600);   // three notes in (one every 250 ms)
    cancel();
    playOnce(b, out);
    vi.advanceTimersByTime(10000);
    expect(out.sent.some(m => (m[0] & 0xf0) === 0xb0 && m[1] === 123)).toBe(false);
    const ons = out.sent.filter(m => (m[0] & 0xf0) === 0x90 && m[2] > 0).length;
    const offs = out.sent.filter(m => (m[0] & 0xf0) === 0x80 || ((m[0] & 0xf0) === 0x90 && m[2] === 0)).length;
    expect(ons).toBe(3 + 4);   // the first play stopped after three
    expect(offs).toBe(ons);
  });
});
