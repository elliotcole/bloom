// Playback scheduler — uses performance.now() + Web MIDI timestamps (no Tone.js Transport)

import { Bloom } from '../core/Bloom';
import { applyTuning } from './tuningOut';
import type { IntervalVal, Sound } from '../core/Bloom';
import type { MidiOutput } from './midi';
import { noteOn, noteOff, allNotesOff } from './midi';
import { wrapAt } from '../lib/arrays';
import { timebase } from './clockSync';

// ─── BPM state ────────────────────────────────────────────────────────────────

let _bpm = 60;

export function setBpm(bpm: number): void {
  _bpm = Math.max(1, bpm);
}

export function getBpm(): number {
  return _bpm;
}

export function beatsToMs(beats: number): number {
  return (beats / _bpm) * 60_000;
}

// ─── Voices ───────────────────────────────────────────────────────────────────
// A note-off releases every sounding copy of that pitch on that channel (in
// MIDI synths and the built-in piano alike). Notes are held long (sustain), so
// a pitch that repeats before the earlier copy's note-off would be cut short
// by it. Each (output, channel, pitch) remembers its latest note-on; a stale
// note-off is skipped, and a repeat cleanly releases the earlier copy first.

const _voices = new WeakMap<MidiOutput, Map<number, number>>();
let _voiceSeq = 0;

function startVoice(out: MidiOutput, chan: number, note: number, vel: number, atMs: number): number {
  let held = _voices.get(out);
  if (!held) { held = new Map(); _voices.set(out, held); }
  const key = chan * 128 + note;
  if (held.has(key)) noteOff(out, chan, note, atMs - 1);
  const id = ++_voiceSeq;
  held.set(key, id);
  noteOn(out, chan, note, vel, atMs);
  return id;
}

function endVoice(out: MidiOutput, chan: number, note: number, id: number, atMs: number): void {
  const held = _voices.get(out);
  const key = chan * 128 + note;
  if (held?.get(key) !== id) return;   // a later copy of this pitch is sounding
  held.delete(key);
  noteOff(out, chan, note, atMs);
}

/** Forget held voices (after all-notes-off). */
function clearVoices(out: MidiOutput): void { _voices.delete(out); }

/**
 * Sound one Sound at `atMs` (performance.now's clock). The note-on is handed
 * to the output `lead` ms ahead, not when it's worked out: a figure's later
 * steps may be beats away, and the voices should know what's sounding when it
 * sounds. Its timers go into `timers` so they can be cancelled (with no lead,
 * a cancelled play leaves nothing pending at the output).
 */
function scheduleSound(out: MidiOutput, s: Sound, atMs: number, lead: number, timers?: ReturnType<typeof setTimeout>[]): void {
  const gateMs = Math.max(10, beatsToMs(s.gate));
  const ids: [number, number][] = [];
  const on = setTimeout(() => {
    s.notes.forEach(n => { if (n >= 0 && n <= 127) ids.push([n, startVoice(out, s.chan, n, s.vel, atMs)]); });
  }, Math.max(0, atMs - performance.now() - lead));
  const off = setTimeout(() => {
    ids.forEach(([n, id]) => endVoice(out, s.chan, n, id, atMs + gateMs));
  }, Math.max(0, atMs + gateMs - performance.now()));
  timers?.push(on, off);
}

// ─── One-shot playback ────────────────────────────────────────────────────────

export interface ActiveNote {
  note: number;
  chan: number;
  offMs: number;
}

/** Play a bloom once. Returns a cleanup function that cancels pending note-offs. */
export function playOnce(
  bloom: Bloom,
  out: MidiOutput,
  legato = bloom.legato,
  sustain = bloom.sustain,
  onNoteOn?: (index: number, tick: number) => void,
  tick = 0,
): () => void {
  applyTuning(bloom);   // each bloom sounds in its own tuning, garden slots included
  const view = bloom.sounding(tick);   // a raga's notes as they sound
  const now = performance.now() + 5;
  let cursor = 0; // ms offset from now
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  bloom.notes.forEach((_, i) => {
    const onAt = now + cursor;
    view.soundsAt(i, tick + i, legato, sustain).forEach(s => scheduleSound(out, s, onAt + beatsToMs(s.at), 0, timeouts));
    timeouts.push(setTimeout(() => onNoteOn?.(i, tick + i), cursor));
    cursor += beatsToMs(wrapAt(bloom.timeIntervals, tick + i));
  });

  return () => {
    timeouts.forEach(clearTimeout);
    allNotesOff(out);
    clearVoices(out);
  };
}

// ─── Looper ───────────────────────────────────────────────────────────────────

const TICK_MS = 25;
const LOOKAHEAD_MS = 100;

interface LoopState {
  bloom: Bloom;
  out: MidiOutput;
  intervalId: ReturnType<typeof setInterval>;
  nextEventTime: number; // ms absolute
  /** Persistent counter across loop boundaries — each list wraps at its own length */
  globalTick: number;
  onNoteOn?: (index: number, tick: number) => void;
  /** Called at the start of every notes cycle with the effective vel/time/chan arrays for that cycle */
  onCycleUpdate?: (vel: number[], time: number[], chan: number[], intervals: IntervalVal[]) => void;
  onLoop?: () => void;
  /** Locked to a running MIDI clock: the clock's beat the loop started on, and the beats played since */
  lock: { start: number; beats: number } | null;
}

let _loop: LoopState | null = null;

/** Build the N effective values for the upcoming notes cycle starting at `tick` */
function buildCycleSlice<T>(
  arr: T[], tick: number, N: number,
): T[] {
  return Array.from({ length: N }, (_, i) => wrapAt(arr, tick + i));
}

export function startLooper(
  bloom: Bloom,
  out: MidiOutput,
  onNoteOn?: (index: number, tick: number) => void,
  onCycleUpdate?: (vel: number[], time: number[], chan: number[], intervals: IntervalVal[]) => void,
  onLoop?: () => void,
): void {
  stopLooper();

  if (bloom.notes.length === 0) return;

  const state: LoopState = {
    bloom,
    out,
    intervalId: 0 as unknown as ReturnType<typeof setInterval>,
    nextEventTime: performance.now(),
    globalTick: 0,
    onNoteOn,
    onCycleUpdate,
    onLoop,
    lock: null,
  };

  state.intervalId = setInterval(() => {
    const now = performance.now();
    const horizon = now + LOOKAHEAD_MS;

    while (state.nextEventTime < horizon) {
      const b = state.bloom;
      // wrapAt throws on empty arrays — bail if any parallel array is empty
      if (b.notes.length === 0 || b.velocities.length === 0
        || b.timeIntervals.length === 0 || b.chans.length === 0) break;

      // Each list cycles at its own independent rate via globalTick
      const noteIdx = state.globalTick % b.notes.length;

      // At the start of each notes cycle: update the display + fire onLoop
      if (noteIdx === 0) {
        // a running clock (Live playing): the cycle starts on its next beat and follows it
        const tb = timebase();
        const at = tb && !state.lock ? tb.beatAt(state.nextEventTime) : null;
        if (tb && at !== null) {
          const start = Math.ceil(at - 0.02);
          state.lock = { start, beats: 0 };
          state.nextEventTime = tb.timeAtBeat(start) ?? state.nextEventTime;
          if (state.nextEventTime >= horizon) break;
        }
        const N = b.notes.length;
        if (state.onCycleUpdate) {
          state.onCycleUpdate(
            buildCycleSlice(b.velocities,    state.globalTick, N),
            buildCycleSlice(b.timeIntervals, state.globalTick, N),
            buildCycleSlice(b.chans,         state.globalTick, N),
            buildCycleSlice(b.intervals.length > 0 ? b.intervals : [0], state.globalTick, N),
          );
        }
        if (state.globalTick > 0) state.onLoop?.();
      }

      const view = b.sounding(state.globalTick - noteIdx);   // a raga's notes as they sound
      const time = wrapAt(b.timeIntervals, state.globalTick);
      const atMs = state.nextEventTime;

      // the note, the notes its intervals add, or its figure; a figure's steps follow a running clock too
      const lock = state.lock;
      view.soundsAt(noteIdx, state.globalTick).forEach(s => {
        const t = lock && s.at ? timebase()?.timeAtBeat(lock.start + lock.beats + s.at) ?? null : null;
        scheduleSound(out, s, t ?? atMs + beatsToMs(s.at), LOOKAHEAD_MS);
      });

      // Fire visual callback at actual note-on time
      const idxSnap = noteIdx, tickSnap = state.globalTick;
      const visualDelay = Math.max(0, atMs - now);
      setTimeout(() => state.onNoteOn?.(idxSnap, tickSnap), visualDelay);

      state.globalTick++;
      if (state.lock) {
        state.lock.beats += time;
        const t = timebase()?.timeAtBeat(state.lock.start + state.lock.beats) ?? null;
        if (t !== null) { state.nextEventTime = t; continue; }
        state.lock = null;   // the clock stopped: carry on in our own time
      }
      state.nextEventTime += beatsToMs(time);
    }
  }, TICK_MS);

  _loop = state;
}

export function updateLooper(bloom: Bloom): void {
  if (_loop) _loop.bloom = bloom;
}

export function stopLooper(): void {
  if (_loop) {
    clearInterval(_loop.intervalId);
    _loop = null;
  }
}

export function isLooping(): boolean {
  return _loop !== null;
}

// ─── Pulsar ───────────────────────────────────────────────────────────────────

interface PulsarState {
  bloom: Bloom;
  out: MidiOutput;
  rateBeats: number;
  intervalId: ReturnType<typeof setInterval>;
  onNoteOn?: (index: number, tick: number) => void;
  onFire?: () => void;
  cancelLastPlay?: () => void;
  /** Running count across fires, so lists of other lengths keep phasing as in the looper */
  tick: number;
}

let _pulsar: PulsarState | null = null;

export function startPulsar(
  bloom: Bloom,
  out: MidiOutput,
  rateBeats = 8,
  onNoteOn?: (index: number, tick: number) => void,
  onFire?: () => void,
  startTick = 0,
): void {
  stopPulsar();

  const fire = () => {
    const p = _pulsar!;
    p.cancelLastPlay?.();
    p.cancelLastPlay = playOnce(p.bloom, out, p.bloom.legato, p.bloom.sustain, p.onNoteOn, p.tick);
    p.tick += p.bloom.notes.length;
    onFire?.();
  };

  const state: PulsarState = {
    bloom,
    out,
    rateBeats,
    intervalId: setInterval(fire, beatsToMs(rateBeats)),
    onNoteOn,
    onFire,
    tick: startTick,
  };

  _pulsar = state;
  fire(); // fire immediately
}

export function updatePulsar(bloom: Bloom): void {
  if (_pulsar) _pulsar.bloom = bloom;
}

export function setPulsarRate(rateBeats: number): void {
  if (!_pulsar) return;
  const { bloom, out, onNoteOn, onFire, tick } = _pulsar;
  startPulsar(bloom, out, rateBeats, onNoteOn, onFire, tick);
}

export function getPulsarRate(): number {
  return _pulsar?.rateBeats ?? 8;
}

export function stopPulsar(): void {
  if (_pulsar) {
    clearInterval(_pulsar.intervalId);
    _pulsar.cancelLastPlay?.();
    _pulsar = null;
  }
}

export function isPulsing(): boolean {
  return _pulsar !== null;
}

export function stopAll(): void {
  stopLooper();
  stopPulsar();
  stopGardenLooper();
  stopGardenPulsar();
}

// ─── Garden Looper ────────────────────────────────────────────────────────────

const NIL_PAUSE_BEATS = 1; // beats to wait at empty garden slots

interface GardenLoopState {
  slots: (Bloom | null)[];  // live reference — changes take effect next cycle
  out: MidiOutput;
  slotIndex: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  cancelCurrent: (() => void) | null;
  onNoteOn?: (index: number) => void;
}

let _gardenLoop: GardenLoopState | null = null;

export function startGardenLooper(
  slots: (Bloom | null)[],
  out: MidiOutput,
  onNoteOn?: (index: number) => void,
): void {
  stopGardenLooper();
  if (slots.every(s => s === null)) return;

  const state: GardenLoopState = {
    slots,
    out,
    slotIndex: 0,
    timeoutId: null,
    cancelCurrent: null,
    onNoteOn,
  };
  _gardenLoop = state;

  const scheduleNext = () => {
    if (!_gardenLoop) return;
    const slot = state.slots[state.slotIndex];
    let durMs: number;

    if (slot) {
      state.cancelCurrent?.();
      state.cancelCurrent = playOnce(slot, out, undefined, undefined, state.onNoteOn);
      durMs = beatsToMs(slot.dur());
    } else {
      durMs = beatsToMs(NIL_PAUSE_BEATS);
    }

    state.slotIndex = (state.slotIndex + 1) % Math.max(1, state.slots.length);
    state.timeoutId = setTimeout(scheduleNext, durMs);
  };

  scheduleNext();
}

export function stopGardenLooper(): void {
  if (_gardenLoop) {
    if (_gardenLoop.timeoutId !== null) clearTimeout(_gardenLoop.timeoutId);
    _gardenLoop.cancelCurrent?.();
    _gardenLoop = null;
  }
}

export function isGardenLooping(): boolean {
  return _gardenLoop !== null;
}

// ─── Garden Pulsar ────────────────────────────────────────────────────────────

interface GardenPulsarState {
  slots: (Bloom | null)[];  // live reference
  out: MidiOutput;
  slotIndex: number;
  rateBeats: number;
  intervalId: ReturnType<typeof setInterval>;
  cancelCurrent: (() => void) | null;
  onNoteOn?: (index: number) => void;
}

let _gardenPulsar: GardenPulsarState | null = null;

export function startGardenPulsar(
  slots: (Bloom | null)[],
  out: MidiOutput,
  rateBeats = 8,
  onNoteOn?: (index: number) => void,
): void {
  stopGardenPulsar();
  if (slots.every(s => s === null)) return;

  const state: GardenPulsarState = {
    slots,
    out,
    slotIndex: 0,
    rateBeats,
    intervalId: 0 as unknown as ReturnType<typeof setInterval>,
    cancelCurrent: null,
    onNoteOn,
  };
  _gardenPulsar = state;

  const fire = () => {
    if (!_gardenPulsar) return;
    const slot = state.slots[state.slotIndex];
    if (slot) {
      state.cancelCurrent?.();
      state.cancelCurrent = playOnce(slot, out, undefined, undefined, state.onNoteOn);
    }
    state.slotIndex = (state.slotIndex + 1) % Math.max(1, state.slots.length);
  };

  state.intervalId = setInterval(fire, beatsToMs(rateBeats));
  fire(); // fire immediately
}

export function stopGardenPulsar(): void {
  if (_gardenPulsar) {
    clearInterval(_gardenPulsar.intervalId);
    _gardenPulsar.cancelCurrent?.();
    _gardenPulsar = null;
  }
}

export function isGardenPulsing(): boolean {
  return _gardenPulsar !== null;
}
