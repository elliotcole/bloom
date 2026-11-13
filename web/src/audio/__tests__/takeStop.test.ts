// Stopping a take's replay, jumping in it, and ending a take being recorded:
// a note handed to the output ahead of its time (a loop's notes are, a
// lookahead ahead) still sounds after an all-notes-off sent now, and used to
// be left with no note-off at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { armTake, initTakes, lastTake, playTake, seekTake, sentAhead, stopPlaying, stopTake, takePhase, useTake } from '../take';
import type { TakeEvent, TakeFile, TakeHost } from '../take';
import { setBpm, silence, startLooper, stopAll } from '../scheduler';
import type { MidiOutput } from '../midi';

interface Sent { m: number[]; at: number; sentAt: number }

function output(): MidiOutput & { sent: Sent[] } {
  const sent: Sent[] = [];
  return { name: 'test', sent, send(m, at) { sent.push({ m: [...m], at: at ?? performance.now(), sentAt: performance.now() }); } };
}

const isOn = (s: Sent) => (s.m[0] & 0xf0) === 0x90 && s.m[2] > 0;
const isOff = (s: Sent) => (s.m[0] & 0xf0) === 0x80;
/** Note-ons with no note-off for their pitch at or after their time */
const unreleased = (sent: Sent[]) => sent.filter(isOn).filter(o => !sent.some(f => isOff(f) && f.m[1] === o.m[1] && f.at >= o.at));

function host(out: MidiOutput, more: Partial<TakeHost> = {}): TakeHost {
  return {
    shown: () => { throw new Error('not recording'); }, session: () => { throw new Error('not recording'); },
    silence() {}, out: () => out, show() {}, garden() {}, light() {}, dark() {}, animate() {}, changed() {}, ...more,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { hidden: false }); setBpm(120); });
afterEach(() => { stopPlaying(); stopAll(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('a replay stopped or moved while a note is handed over ahead', () => {
  // as a loop records: each note-on sent 100 ms ahead of its time, its note-off on time
  const events: TakeEvent[] = [[0, 'b', 0, 1, 1]];
  for (let k = 0; k < 40; k++) events.push([k * 250 + 900, 'm', [0x90, 60 + k, 80], 100], [k * 250 + 1200, 'm', [0x80, 60 + k, 0], 0]);
  events.sort((a, b) => a[0] - b[0]);
  const take = { kind: 'bloom-take', version: 1, recordedAt: 0, length: 600_000, ended: true,
    blooms: [{ notes: [60], velocities: [80], timeIntervals: [0.5], chans: [0], intervals: [0], figures: [0] }],
    gardens: [], sysex: [], tables: [], events } as unknown as TakeFile;

  function playTo900(): MidiOutput & { sent: Sent[] } {
    const out = output();
    initTakes(host(out));
    useTake(take);
    playTake(0);
    vi.advanceTimersByTime(900);   // note 60 is with the output now, to sound in 140 ms
    expect(out.sent.filter(isOn).map(s => Math.round(s.at - performance.now()))).toEqual([140]);
    return out;
  }

  it('stop: the note gets its note-off as it starts, and an all-notes-off after it', () => {
    const out = playTo900();
    const now = performance.now();
    stopPlaying();
    vi.advanceTimersByTime(2000);
    expect(unreleased(out.sent)).toEqual([]);
    const offs = out.sent.filter(s => isOff(s) && s.m[1] === 60).map(s => Math.round(s.at - now));
    expect(offs).toEqual([0, 141]);
    const allOff = out.sent.filter(s => s.m[1] === 123).map(s => Math.round(s.at - now));
    expect(Math.max(...allOff)).toBe(141);
    expect(out.sent.filter(isOn).length).toBe(1);   // and nothing more was struck
  });

  it('a jump: the same, before the take sounds from its new place', () => {
    const out = playTo900();
    const now = performance.now();
    seekTake(300_000);
    expect(out.sent.filter(s => isOff(s) && s.m[1] === 60).map(s => Math.round(s.at - now))).toEqual([0, 141]);
    expect(unreleased(out.sent)).toEqual([]);
  });

  it('a note sounding (not ahead) is let go once, now', () => {
    const out = playTo900();
    vi.advanceTimersByTime(200);   // 60 sounds; 62 has been handed over
    const now = performance.now();
    stopPlaying();
    expect(out.sent.filter(s => isOff(s) && s.m[1] === 60 && s.sentAt === now).map(s => s.at - now)).toEqual([0]);
  });
});

describe('ending a take while a loop plays', () => {
  function bloom(): Bloom {
    const b = new Bloom();
    b.notes = [60, 62, 64, 65]; b.timeIntervals = [0.5]; b.velocities = [90]; b.chans = [0];
    b.intervals = [0]; b.figures = [0];
    return b;
  }

  it('a note sent ahead of the stop is let go as it starts; the take keeps neither', () => {
    const out = output(), b = bloom();
    initTakes(host(out, {
      shown: () => ({ bloom: b, trace: true }),
      session: () => ({ bloom: b, garden: { cursor: 0, slots: [] } as never }),
      silence: () => stopAll(),
    }));
    armTake();
    startLooper(b, out);
    vi.advanceTimersByTime(680);   // notes at 0, 250, 500; the one for 750 went to the output at 650
    const now = performance.now();
    const ahead = out.sent.filter(s => isOn(s) && s.at > now);
    expect(ahead.map(s => s.m[1])).toEqual([65]);
    stopTake();
    expect(takePhase()).toBe('ending');
    expect(out.sent.some(s => isOff(s) && s.m[1] === 65 && s.at > ahead[0].at && s.at <= ahead[0].at + 2)).toBe(true);
    vi.advanceTimersByTime(11_000);
    expect(takePhase()).toBe('idle');
    expect(unreleased(out.sent)).toEqual([]);
    expect(lastTake()!.events.some(e => e[1] === 'm' && e[2][1] === 65)).toBe(false);
  });

  it('everything off gets out during the hold (the page closing), though nothing else does', () => {
    const out = output(), b = bloom();
    initTakes(host(out, {
      shown: () => ({ bloom: b, trace: true }),
      session: () => ({ bloom: b, garden: { cursor: 0, slots: [] } as never }),
      silence: () => stopAll(),
    }));
    armTake();
    startLooper(b, out);
    vi.advanceTimersByTime(600);
    stopTake();
    const before = out.sent.length;
    startLooper(b, out);   // a loop started in the hold is not heard
    vi.advanceTimersByTime(300);
    expect(out.sent.length).toBe(before);
    silence(out);
    expect(out.sent.slice(before).filter(s => s.m[1] === 123).length).toBe(16);
  });

  it('sentAhead: the note-ons due after the end, by channel and pitch', () => {
    const f = { events: [[100, 'm', [0x90, 60, 80], 0], [150, 'm', [0x91, 62, 80], 100], [160, 'm', [0x80, 60, 0], 100]] } as unknown as TakeFile;
    expect([...sentAhead(f, 200)]).toEqual([[128 + 62, 250]]);
  });
});
