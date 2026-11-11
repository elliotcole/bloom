// opt-↑: only the slot's notes come into the bloom. A loop running takes them
// at once, and every other list carries on from where it had got to: nothing
// restarts, a 6-step accent pattern and a 4-step channel walk run straight on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { setBpm, startLooper, stopAll, updateLooper } from '../scheduler';
import type { MidiOutput } from '../midi';

function bloom(notes: number[], vels: number[], chans: number[]): Bloom {
  const b = new Bloom();
  b.notes = notes; b.timeIntervals = [0.25]; b.velocities = vels; b.chans = chans;
  b.intervals = [0]; b.figures = [0];
  return b;
}

function recorder(): MidiOutput & { ons: { note: number; vel: number; chan: number }[] } {
  const ons: { note: number; vel: number; chan: number }[] = [];
  return { name: 'test', ons, send(d) { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push({ note: d[1], vel: d[2], chan: d[0] & 0x0f }); } };
}

const ACCENTS = [100, 40, 40, 70, 40, 40];
const WALK = [0, 1, 2, 3];
const SLOT = () => bloom([72, 74, 76, 77, 79, 81, 83], [10, 20], [9]);   // its own velocities and channels, not taken

describe('Bloom.liftNotes', () => {
  it('takes the notes and nothing else, as a copy', () => {
    const b = bloom([60, 62, [64, 67] as unknown as number], ACCENTS, WALK);
    const src = bloom([72, [74, 77] as unknown as number], [10], [9]);
    b.liftNotes(src);
    expect(b.notes).toEqual([72, [74, 77]]);
    expect(b.velocities).toEqual(ACCENTS);
    expect(b.chans).toEqual(WALK);
    (src.notes[1] as unknown as number[]).push(80);
    expect(b.notes).toEqual([72, [74, 77]]);   // not shared with the slot
  });
});

describe('opt-↑ while looping', () => {
  beforeEach(() => { vi.useFakeTimers(); setBpm(120); });
  afterEach(() => { stopAll(); vi.useRealTimers(); });

  it('the new notes come in at once and the other lists run on unbroken', () => {
    const out = recorder();
    const live = bloom([60, 62, 64, 65, 67], [...ACCENTS], [...WALK]);
    startLooper(live, out);
    vi.advanceTimersByTime(800);   // a note every 125 ms: partway through the second pass
    const heard = out.ons.length;
    const pos = heard % 5;
    expect(pos).toBeGreaterThan(0);   // mid-pass, not on a downbeat
    live.liftNotes(SLOT());
    updateLooper(live);
    vi.advanceTimersByTime(3000);
    const ons = out.ons;
    // the note already sent ahead plays; from the next the new notes, read on from the same place
    const NEW = [72, 74, 76, 77, 79, 81, 83];
    expect(ons[heard].note).toBe([60, 62, 64, 65, 67][pos]);
    expect(ons.slice(heard + 1, heard + 12).map(o => o.note)).toEqual(Array.from({ length: 11 }, (_, i) => NEW[(pos + 1 + i) % 7]));
    // the accents and the channel walk never restart, before or after
    expect(ons.map(o => o.vel)).toEqual(ons.map((_, i) => ACCENTS[i % 6]));
    expect(ons.map(o => o.chan)).toEqual(ons.map((_, i) => WALK[i % 4]));
  });
});
