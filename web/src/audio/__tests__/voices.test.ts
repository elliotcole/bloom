// Two voices in the scheduler: a loop set aside keeps playing, a second loop
// starts on the first one's downbeat, and copying a voice starts it in step.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import {
  beatsToDownbeat, beatsToMs, startLooper, stopLooper, isLooping, stopAll,
  parkLooper, unparkLooper, isParkedLooping, stopParked, startParkedInStep, setBpm,
  passBeats, meetingIn, nextMeeting,
} from '../scheduler';
import type { MidiOutput } from '../midi';

function bloom(notes: number[], times: number[]): Bloom {
  const b = new Bloom();
  b.notes = notes; b.timeIntervals = times; b.velocities = [90]; b.chans = [0];
  b.intervals = [0]; b.figures = [0];
  return b;
}

/** An output that keeps every note-on with when it was due */
function recorder(): MidiOutput & { ons: { note: number; at: number }[] } {
  const ons: { note: number; at: number }[] = [];
  return { name: 'test', ons, send(d, at) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push({ note: d[1], at: at ?? performance.now() }); } };
}

describe('beats to the downbeat', () => {
  it('sums the steps left in the pass, wrapping round the time list', () => {
    const b = bloom([60, 62, 64], [1, 0.5]);
    expect(beatsToDownbeat(b, 0)).toBe(0);
    expect(beatsToDownbeat(b, 1)).toBe(0.5 + 1);   // ticks 1 and 2: times[1], times[0]
    expect(beatsToDownbeat(b, 2)).toBe(1);
    expect(beatsToDownbeat(b, 3)).toBe(0);
    expect(beatsToDownbeat(b, 4)).toBe(1 + 0.5);   // tick 4 → times[0], tick 5 → times[1]
  });
});

describe('two voices in the scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
  afterEach(() => { stopAll(); vi.useRealTimers(); });

  it('a parked loop keeps playing while the focused one is stopped', () => {
    const out = recorder();
    const a = bloom([60, 62], [1]);
    startLooper(a, out);
    parkLooper('A', a);
    expect(isLooping()).toBe(false);
    expect(isParkedLooping('A')).toBe(true);
    vi.advanceTimersByTime(3000);
    const n = out.ons.length;
    expect(n).toBeGreaterThan(4);
    stopLooper();   // the focused loop (none) stops; A plays on
    vi.advanceTimersByTime(1000);
    expect(out.ons.length).toBeGreaterThan(n);
    expect(stopParked('A')).toBe(true);
    expect(isParkedLooping()).toBe(false);
  });

  it('a second loop started beside a parked one starts on its downbeat', () => {
    const out = recorder();
    const a = bloom([60, 62, 64], [1]);   // a 3-beat pass
    startLooper(a, out);
    vi.advanceTimersByTime(30);
    const t0 = out.ons[0].at;
    parkLooper('A', a);
    vi.advanceTimersByTime(beatsToMs(1.2));
    startLooper(bloom([72, 74], [0.5]), out);   // B
    vi.advanceTimersByTime(beatsToMs(2));
    const firstB = out.ons.find(o => o.note === 72)!;
    expect(firstB.at).toBeCloseTo(t0 + beatsToMs(3), 0);
  });

  it('unparking hands the loop back as the focused one, still playing from where it was', () => {
    const out = recorder();
    const a = bloom([60, 62], [1]);
    startLooper(a, out);
    parkLooper('A', a);
    vi.advanceTimersByTime(beatsToMs(4));
    expect(unparkLooper('A', a)).toBe(true);
    expect(isLooping()).toBe(true);
    expect(isParkedLooping('A')).toBe(false);
  });

  it('copying the focused voice into a looping other starts the copy on the focused downbeat, in step', () => {
    const out = recorder();
    const a = bloom([60, 62, 64, 65], [0.5]);   // a 2-beat pass
    startLooper(a, out);
    vi.advanceTimersByTime(30);
    const t0 = out.ons[0].at;
    startParkedInStep('B', bloom([48, 50, 52], [0.75]), out);   // set B going
    vi.advanceTimersByTime(beatsToMs(2.3));
    const copy = a.clone();
    copy.transpose(24);
    startParkedInStep('B', copy, out);
    vi.advanceTimersByTime(beatsToMs(3));
    const firstCopy = out.ons.find(o => o.note === 84)!;
    expect(firstCopy.at).toBeCloseTo(t0 + beatsToMs(4), 0);   // A's third pass
    expect(isLooping()).toBe(true);
    expect(isParkedLooping('B')).toBe(true);
  });

  it('stopAll stops the parked loops too', () => {
    const out = recorder();
    startLooper(bloom([60], [1]), out);
    parkLooper('A', bloom([60], [1]));
    stopAll();
    expect(isParkedLooping()).toBe(false);
  });
});

describe('where two loops meet', () => {
  it('passBeats reads a phasing time list where it is', () => {
    const b = bloom([60, 62], [1, 2, 3]);
    expect([0, 2, 4, 6].map(t => passBeats(b, t))).toEqual([3, 4, 5, 3]);
  });

  it('loops of one length in step meet at once', () => {
    const a = bloom([60, 62, 64, 65], [1]);
    expect(meetingIn({ bloom: a, tick: 0, inBeats: 0 }, { bloom: a.clone(), tick: 0, inBeats: 0 })).toBe(0);
  });

  it('four beats against three, one note in, meet at the next common downbeat', () => {
    const four = bloom([60, 62, 64, 65], [1]);
    const three = bloom([60, 62, 64], [1]);
    // started together a beat ago: downbeats at 3, 7, 11 and 2, 5, 8, 11
    expect(meetingIn({ bloom: four, tick: 1, inBeats: 0 }, { bloom: three, tick: 1, inBeats: 0 })).toBe(11);
    // the three-note loop on its first note now, the other one beat in
    expect(meetingIn({ bloom: four, tick: 1, inBeats: 0 }, { bloom: three, tick: 0, inBeats: 0 })).toBe(3);
  });

  it('follows a phasing list from pass to pass', () => {
    const a = bloom([60, 62], [1, 2, 3]);   // passes of 3, 4, 5, then again
    const b = bloom([60], [4]);              // a pass every 4
    // a's downbeats 0, 3, 7, 12; b's 7, 11, 15: they meet at 7 (a pass of 3 every time would make it 15)
    expect(meetingIn({ bloom: a, tick: 0, inBeats: 0 }, { bloom: b, tick: 0, inBeats: 7 })).toBe(7);
  });

  it('is null when they never come round together within the limit', () => {
    const a = bloom([60], [1]);
    expect(meetingIn({ bloom: a, tick: 0, inBeats: 0 }, { bloom: a.clone(), tick: 0, inBeats: 0.5 }, 64)).toBeNull();
  });

  it('nextMeeting is null unless the focused loop and a parked one both run', () => {
    stopAll();
    expect(nextMeeting()).toBeNull();
  });
});
