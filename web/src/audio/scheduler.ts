// Playback scheduler — uses performance.now() + Web MIDI timestamps (no Tone.js Transport)

import { Bloom } from '../core/Bloom';
import type { MidiOutput } from './midi';
import { noteOn, noteOff, allNotesOff } from './midi';
import { wrapAt } from '../lib/arrays';

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
  onNoteOn?: (index: number) => void,
): () => void {
  const events = bloom.toEvents();
  const now = performance.now();
  let cursor = 0; // ms offset from now
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  events.forEach((ev, i) => {
    const gateMs = sustain !== null
      ? beatsToMs(sustain)
      : beatsToMs(ev.time * legato);

    const notes = Array.isArray(ev.note) ? ev.note as number[] : [ev.note as number];
    const vel = ev.velocity;
    const chan = ev.chan;
    const onAt = cursor;

    // Schedule note-on(s) + visual callback
    const t = setTimeout(() => {
      if (vel > 0) {
        notes.forEach(n => {
          if (n < 0 || n > 127) return;
          noteOn(out, chan, n, vel, now + onAt);
        });
      }
      onNoteOn?.(i);
    }, onAt);
    timeouts.push(t);

    // Schedule note-off(s)
    const offAt = onAt + Math.max(10, gateMs);
    const tOff = setTimeout(() => {
      notes.forEach(n => {
        if (n < 0 || n > 127 || vel === 0) return;
        noteOff(out, chan, n, now + offAt);
      });
    }, offAt);
    timeouts.push(tOff);

    cursor += beatsToMs(ev.time);
  });

  return () => {
    timeouts.forEach(clearTimeout);
    allNotesOff(out);
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
  onNoteOn?: (index: number) => void;
  /** Called at the start of every notes cycle with the effective vel/time/chan arrays for that cycle */
  onCycleUpdate?: (vel: number[], time: number[], chan: number[]) => void;
  onLoop?: () => void;
}

let _loop: LoopState | null = null;

/** Build the N effective values for the upcoming notes cycle starting at `tick` */
function buildCycleSlice(
  arr: number[], tick: number, N: number,
): number[] {
  return Array.from({ length: N }, (_, i) => wrapAt(arr, tick + i));
}

export function startLooper(
  bloom: Bloom,
  out: MidiOutput,
  onNoteOn?: (index: number) => void,
  onCycleUpdate?: (vel: number[], time: number[], chan: number[]) => void,
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
  };

  state.intervalId = setInterval(() => {
    const now = performance.now();
    const horizon = now + LOOKAHEAD_MS;

    while (state.nextEventTime < horizon) {
      const b = state.bloom;
      if (b.notes.length === 0) break;

      // Each list cycles at its own independent rate via globalTick
      const noteIdx = state.globalTick % b.notes.length;

      // At the start of each notes cycle: update the display + fire onLoop
      if (noteIdx === 0) {
        const N = b.notes.length;
        if (state.onCycleUpdate) {
          state.onCycleUpdate(
            buildCycleSlice(b.velocities,    state.globalTick, N),
            buildCycleSlice(b.timeIntervals, state.globalTick, N),
            buildCycleSlice(b.chans,         state.globalTick, N),
          );
        }
        if (state.globalTick > 0) state.onLoop?.();
      }

      const noteVal = b.notes[noteIdx];
      const notes = Array.isArray(noteVal) ? noteVal as number[] : [noteVal as number];
      const vel  = wrapAt(b.velocities,    state.globalTick);
      const time = wrapAt(b.timeIntervals, state.globalTick);
      const chan = wrapAt(b.chans,         state.globalTick);

      const atMs = state.nextEventTime;
      const legato = b.legato;
      const sustain = b.sustain;
      const gateMs = sustain !== null ? beatsToMs(sustain) : beatsToMs(time * legato);

      if (vel > 0) {
        notes.forEach(n => {
          if (n < 0 || n > 127) return;
          noteOn(out, chan, n, vel, atMs);
          setTimeout(
            () => noteOff(out, chan, n, atMs + Math.max(10, gateMs)),
            atMs - now + Math.max(10, gateMs),
          );
        });
      }

      // Fire visual callback at actual note-on time
      const tickSnap = noteIdx;
      const visualDelay = Math.max(0, atMs - now);
      setTimeout(() => state.onNoteOn?.(tickSnap), visualDelay);

      state.globalTick++;
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
  onNoteOn?: (index: number) => void;
  onFire?: () => void;
  cancelLastPlay?: () => void;
}

let _pulsar: PulsarState | null = null;

export function startPulsar(
  bloom: Bloom,
  out: MidiOutput,
  rateBeats = 8,
  onNoteOn?: (index: number) => void,
  onFire?: () => void,
): void {
  stopPulsar();

  const fire = () => {
    _pulsar!.cancelLastPlay?.();
    _pulsar!.cancelLastPlay = playOnce(_pulsar!.bloom, out, undefined, undefined, _pulsar!.onNoteOn);
    onFire?.();
  };

  const state: PulsarState = {
    bloom,
    out,
    rateBeats,
    intervalId: setInterval(fire, beatsToMs(rateBeats)),
    onNoteOn,
    onFire,
  };

  _pulsar = state;
  fire(); // fire immediately
}

export function updatePulsar(bloom: Bloom): void {
  if (_pulsar) _pulsar.bloom = bloom;
}

export function setPulsarRate(rateBeats: number): void {
  if (!_pulsar) return;
  const { bloom, out, onNoteOn, onFire } = _pulsar;
  startPulsar(bloom, out, rateBeats, onNoteOn, onFire);
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
