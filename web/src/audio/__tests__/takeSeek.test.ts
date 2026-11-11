// Auditioning a long take: play it from part way in, and jump about while it plays.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTakes, playTake, seekTake, stopPlaying, takeElapsed, takePhase, useTake } from '../take';
import type { TakeEvent, TakeFile, TakeHost } from '../take';
import type { MidiOutput } from '../midi';

function setup(events: TakeEvent[]) {
  const sent: { m: number[]; at: number }[] = [];
  const out: MidiOutput = { name: 'test', send(m, at) { sent.push({ m: [...m], at: at ?? performance.now() }); } };
  const shown: number[] = [];
  const host: TakeHost = {
    shown: () => { throw new Error('not recording'); }, session: () => { throw new Error('not recording'); },
    silence() {}, out: () => out,
    show: b => shown.push(b.notes[0] as number), garden() {}, light() {}, dark() {}, animate() {}, changed() {},
  };
  initTakes(host);
  const blooms = [60, 70].map(n => ({ notes: [n], velocities: [80], timeIntervals: [0.5], chans: [0], intervals: [0], figures: [0] }));
  const t = { kind: 'bloom-take', version: 1, recordedAt: 0, length: 600_000, ended: true,
    blooms, gardens: [], sysex: [], tables: [], events } as unknown as TakeFile;
  useTake(t);
  return { sent, shown };
}

const notesOn = (sent: { m: number[] }[]) => sent.filter(s => (s.m[0] & 0xf0) === 0x90 && s.m[2] > 0).map(s => s.m[1]);

describe('playing a take from part way in', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { hidden: false }); });
  afterEach(() => { stopPlaying(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  // a note a second from 0:00, the pedal down at the start, the second bloom from 2:00
  const events: TakeEvent[] = [[0, 'm', [0xb0, 64, 127], 0], [0, 'b', 0, 1, 1]];
  for (let s = 0; s < 300; s++) {
    if (s === 120) events.push([s * 1000, 'b', 1, 1, 1]);
    events.push([s * 1000, 'm', [0x90, 40 + (s % 40), 80], 0], [s * 1000 + 500, 'm', [0x80, 40 + (s % 40), 0], 0]);
  }

  it('starts with the pedal down and the bloom then on screen, and plays on from there', () => {
    const { sent, shown } = setup(events);
    expect(playTake(150_000)).toBe(true);
    expect(takePhase()).toBe('playing');
    expect(sent[0].m).toEqual([0xb0, 64, 127]);
    expect(shown).toEqual([70]);
    vi.advanceTimersByTime(3_100);
    expect(notesOn(sent)).toEqual([40 + (150 % 40), 40 + (151 % 40), 40 + (152 % 40), 40 + (153 % 40)]);
    expect(Math.round(takeElapsed() / 100)).toBe(1531);
  });

  it('jumps while playing: what sounds is let go, the take goes on from there', () => {
    const { sent, shown } = setup(events);
    playTake(0);
    vi.advanceTimersByTime(2_100);
    sent.length = 0;
    seekTake(200_000);
    expect(sent.filter(s => s.m[1] === 123).length).toBe(32);   // all notes off, now and just ahead, every channel
    expect(sent.some(s => s.m[0] === 0xb0 && s.m[1] === 64 && s.m[2] === 127)).toBe(true);
    expect(shown.at(-1)).toBe(70);
    vi.advanceTimersByTime(1_100);
    expect(notesOn(sent)).toEqual([40 + (200 % 40), 40 + (201 % 40)]);
    seekTake(30_000);
    expect(shown.at(-1)).toBe(60);
  });
});
