// A loop of a bloom whose times are all 0 still moves on (it used to hang the
// tab); the pulse rate is kept while nothing pulses, and the garden's pulsar
// follows it and the tempo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import {
  getPulsarRate, setBpm, setPulsarRate, startGardenPulsar, startLooper, stopAll, stopGardenPulsar,
} from '../scheduler';
import type { MidiOutput } from '../midi';

function bloom(times: number[]): Bloom {
  const b = new Bloom();
  b.notes = [60, 62]; b.timeIntervals = times; b.velocities = [80]; b.chans = [0];
  b.intervals = [0]; b.figures = [0];
  return b;
}

function recorder(): MidiOutput & { ons: number[] } {
  const ons: number[] = [];
  return { name: 'test', ons, send(d) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push(performance.now()); } };
}

beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
afterEach(() => { stopAll(); stopGardenPulsar(); setPulsarRate(8); vi.useRealTimers(); });

describe('a loop of all-zero times', () => {
  it('plays on at the smallest step', () => {
    const out = recorder();
    startLooper(bloom([0]), out);
    vi.advanceTimersByTime(500);
    expect(out.ons.length).toBeGreaterThan(10);
    expect(out.ons.length).toBeLessThan(200);
  });
});

describe('the pulse rate', () => {
  it('is kept while nothing pulses', () => {
    setPulsarRate(5);
    expect(getPulsarRate()).toBe(5);
  });

  it('the garden pulsar takes a new rate and a new tempo from its next pulse', () => {
    const out = recorder();
    const one = bloom([0.25]); one.notes = [60];   // a note a pulse
    setPulsarRate(2);                       // 2 beats at 120: a pulse a second
    startGardenPulsar([one], out, getPulsarRate());
    vi.advanceTimersByTime(2100);           // pulses at 0, 1000, 2000 (the next is set for 3000)
    setPulsarRate(1);                       // then every 500 ms
    vi.advanceTimersByTime(2000);           // 3000, 3500, 4000 (the next is set for 4500)
    setBpm(60);                             // then every 1000 ms
    vi.advanceTimersByTime(3000);           // 4500, 5500, 6500
    const gaps = out.ons.slice(1).map((t, i) => Math.round(t - out.ons[i]));
    expect(gaps).toEqual([1000, 1000, 1000, 500, 500, 500, 1000, 1000]);
  });
});
