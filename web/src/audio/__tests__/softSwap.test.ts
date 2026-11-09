// A soft swap (shift-↑ while looping): the lifted bloom lands when the loop
// comes round, and a list as long as the one it replaces carries on from where
// that one had got to, so a 6-step accent pattern over a 5-note bloom isn't reset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { atNextCycle, setBpm, startLooper, stopAll, updateLooper } from '../scheduler';
import type { MidiOutput } from '../midi';

function bloom(notes: number[], vels: number[]): Bloom {
  const b = new Bloom();
  b.notes = notes; b.timeIntervals = [0.25]; b.velocities = vels; b.chans = [0];
  b.intervals = [0]; b.figures = [0];
  return b;
}

function recorder(): MidiOutput & { ons: { note: number; vel: number }[] } {
  const ons: { note: number; vel: number }[] = [];
  return { name: 'test', ons, send(d) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push({ note: d[1], vel: d[2] }); } };
}

const ACCENTS = [100, 40, 40, 70, 40, 40];

function swapAfter(soft: boolean): { note: number; vel: number }[] {
  const out = recorder();
  const live = bloom([60, 62, 64, 65, 67], ACCENTS);
  startLooper(live, out);
  vi.advanceTimersByTime(1100);   // into the second pass (a note every 125 ms)
  const next = bloom([60, 62, 63, 65, 67], ACCENTS);   // one note mutated, the accents the same
  atNextCycle(tick => {
    const before = live.listLengths();
    live.import(next);
    if (soft) live.carryLists(before, tick);
    updateLooper(live);
  });
  vi.advanceTimersByTime(3000);
  return out.ons;
}

describe('soft swap', () => {
  beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
  afterEach(() => { stopAll(); vi.useRealTimers(); });

  it('carries the accents on across the swap', () => {
    const ons = swapAfter(true);
    const vels = ons.map(o => o.vel);
    // the accents never restart: the whole run is the pattern, round and round
    expect(vels).toEqual(vels.map((_, i) => ACCENTS[i % 6]));
    expect(ons.some(o => o.note === 63)).toBe(true);   // the new bloom did land
  });

  it('a plain lift starts them from the top, as before', () => {
    const ons = swapAfter(false);
    const at = ons.findIndex(o => o.note === 63) - 2;   // the new bloom's first note
    expect(at).toBe(10);   // landed on the third pass
    expect(ons.slice(at, at + 6).map(o => o.vel)).toEqual(ACCENTS);
    expect(ons.slice(0, at).map(o => o.vel)).toEqual(ons.slice(0, at).map((_, i) => ACCENTS[i % 6]));
    expect(at % 6).not.toBe(0);   // so the pattern was cut short: the reset
  });
});

describe('carryLists', () => {
  it('turns a list of the same length on to where it had got, and leaves a new length from the top', () => {
    const b = bloom([60, 62, 64, 65, 67], [1, 2, 3, 4, 5, 6]);
    b.chans = [1, 2, 3];
    const before = { ...b.listLengths(), chan: 4 };
    expect(b.carryLists(before, 10)).toEqual(['time', 'vel', 'iv', 'fig']);
    expect(b.velocities).toEqual([5, 6, 1, 2, 3, 4]);   // tick 10 is the 5th of 6
    expect(b.chans).toEqual([1, 2, 3]);
    expect(b.notes).toEqual([60, 62, 64, 65, 67]);
  });
});
