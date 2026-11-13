// A loop that finds itself behind (a list stood empty, the page stalled, the
// machine slept) passes over what it missed instead of playing it all at
// once; one locked to a MIDI clock lets go when the clock starts its count
// again; and what's due to be handed over goes at once, not on a timer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { setBpm, startLooper, startPulsar, stopAll, updateLooper } from '../scheduler';
import { ClockFollower, setTimebase } from '../clockSync';
import type { MidiOutput } from '../midi';

function bloom(notes: number[], times: number[]): Bloom {
  const b = new Bloom();
  b.notes = notes; b.timeIntervals = times; b.velocities = [90]; b.chans = [0];
  b.intervals = [0]; b.figures = [0]; b.sustain = 0.1;
  return b;
}

function recorder(): MidiOutput & { ons: { note: number; at: number; sentAt: number }[] } {
  const ons: { note: number; at: number; sentAt: number }[] = [];
  return { name: 'test', ons, send(d, at) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push({ note: d[1], at: at ?? performance.now(), sentAt: performance.now() }); } };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { hidden: false }); setBpm(120); setTimebase(() => null); });
afterEach(() => { stopAll(); setTimebase(() => null); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('a loop that fell behind', () => {
  it('passes over the steps it missed and comes back in where it would have been', () => {
    const out = recorder();
    const NOTES = [60, 62, 64, 65];
    const b = bloom(NOTES, [0.5]);   // a note every 250 ms
    startLooper(b, out);
    vi.advanceTimersByTime(1000);
    const t0 = out.ons[0].at;
    b.velocities = []; updateLooper(b);   // nothing can play: the loop stands still
    vi.advanceTimersByTime(3000);
    b.velocities = [90]; updateLooper(b);
    const back = performance.now(), before = out.ons.length;
    vi.advanceTimersByTime(60);
    expect(out.ons.length - before).toBeLessThanOrEqual(1);   // not the twelve it missed
    vi.advanceTimersByTime(2000);
    const after = out.ons.slice(before);
    expect(after[0].at).toBeGreaterThanOrEqual(back - 100);
    expect(after[0].at).toBeLessThan(back + 250);
    // on the beat it always had, each note the one a loop that never stopped would be on
    after.forEach(o => {
      const step = (o.at - t0) / 250;
      expect(step).toBe(Math.round(step));
      expect(o.note).toBe(NOTES[step % 4]);
    });
    expect(after.slice(1).map((o, i) => o.at - after[i].at).every(g => g === 250)).toBe(true);
  });
});

describe('a loop locked to a MIDI clock', () => {
  it('lets go when the clock starts again, instead of waiting for the old beat number', () => {
    const clock = new ClockFollower();
    setTimebase(() => (clock.state(performance.now()).running ? clock : null));
    const pulse = 500 / 24;   // 120 bpm
    const run = (ms: number) => { for (let k = 0; k < Math.round(ms / pulse); k++) { vi.advanceTimersByTime(pulse); clock.message([0xf8], performance.now()); } };
    const out = recorder();
    clock.message([0xfa], performance.now());
    run(1000);
    startLooper(bloom([60], [4]), out);   // one note every 4 beats, 2 s: nothing is scheduled while the clock is away
    run(8500);
    clock.message([0xfc], performance.now());   // Live stopped…
    vi.advanceTimersByTime(100);
    clock.message([0xfa], performance.now());   // …and started again from the top
    run(12_000);
    const gaps = out.ons.slice(1).map((o, i) => Math.round(o.at - out.ons[i].at));
    expect(gaps.length).toBeGreaterThan(6);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2600);   // it was 11600: the wait for beat 18 of the new count
    expect(gaps.slice(-2)).toEqual([2000, 2000]);          // and it's locked again
  });

  it('the count moves on at Start, Song Position and a gap, not at a pulse or Stop', () => {
    const c = new ClockFollower();
    const e0 = c.epoch;
    c.message([0xf8], 0); c.message([0xf8], 20); c.message([0xfc], 30);
    expect(c.epoch).toBe(e0);
    c.message([0xfa], 40);
    expect(c.epoch).toBe(e0 + 1);
    c.message([0xf2, 0, 1], 50);
    expect(c.epoch).toBe(e0 + 2);
    c.message([0xf8], 60); c.message([0xf8], 5000);   // back after more than a second
    expect(c.epoch).toBe(e0 + 3);
  });
});

describe('what is due to be handed over', () => {
  it('goes at once in a hidden page, not on a timer the page would run late', () => {
    vi.stubGlobal('document', { hidden: true });
    const out = recorder();
    startPulsar(bloom([60, 62, 64], [1]), out, 8);   // notes at 0, 500 and 1000 ms: all inside the hidden lookahead
    expect(out.ons.map(o => o.note)).toEqual([60, 62, 64]);   // with no timer run
    expect(out.ons.map(o => Math.round(o.at - out.ons[0].at))).toEqual([0, 500, 1000]);   // each stamped with its own time
  });
});
