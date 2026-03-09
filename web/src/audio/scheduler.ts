// Playback scheduler — uses performance.now() + Web MIDI timestamps (no Tone.js Transport)

import { Bloom } from '../core/Bloom';
import type { MidiOutput } from './midi';
import { noteOn, noteOff, allNotesOff } from './midi';

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
  eventIndex: number;
  events: ReturnType<Bloom['toEvents']>; // refreshed at each cycle boundary
  onNoteOn?: (index: number) => void;
  onLoop?: () => void;
}

let _loop: LoopState | null = null;

export function startLooper(
  bloom: Bloom,
  out: MidiOutput,
  onNoteOn?: (index: number) => void,
  onLoop?: () => void,
): void {
  stopLooper();

  const events = bloom.toEvents();
  if (events.length === 0) return;

  const state: LoopState = {
    bloom,
    out,
    intervalId: 0 as unknown as ReturnType<typeof setInterval>,
    nextEventTime: performance.now(),
    eventIndex: 0,
    events,
    onNoteOn,
    onLoop,
  };

  state.intervalId = setInterval(() => {
    const now = performance.now();
    const horizon = now + LOOKAHEAD_MS;

    while (state.nextEventTime < horizon) {
      const ev = state.events[state.eventIndex];
      const notes = Array.isArray(ev.note) ? ev.note as number[] : [ev.note as number];
      const vel = ev.velocity;
      const chan = ev.chan;
      const atMs = state.nextEventTime;
      const legato = state.bloom.legato;
      const sustain = state.bloom.sustain;
      const gateMs = sustain !== null
        ? beatsToMs(sustain)
        : beatsToMs(ev.time * legato);

      if (vel > 0) {
        notes.forEach(n => {
          if (n < 0 || n > 127) return;
          noteOn(out, chan, n, vel, atMs);
          setTimeout(() => noteOff(out, chan, n, atMs + Math.max(10, gateMs)), atMs - now + Math.max(10, gateMs));
        });
      }

      // Fire visual callback at actual note-on time
      const noteIdx = state.eventIndex;
      const visualDelay = Math.max(0, atMs - now);
      setTimeout(() => state.onNoteOn?.(noteIdx), visualDelay);

      state.eventIndex++;
      if (state.eventIndex >= state.events.length) {
        state.eventIndex = 0;
        // Refresh events from current bloom at cycle boundary
        const next = state.bloom.toEvents();
        if (next.length > 0) state.events = next;
        state.onLoop?.();
      }

      state.nextEventTime += beatsToMs(ev.time);
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
