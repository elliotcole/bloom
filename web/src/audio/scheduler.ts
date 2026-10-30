// Playback scheduler — uses performance.now() + Web MIDI timestamps (no Tone.js Transport)

import { Bloom } from '../core/Bloom';
import { applyTuning } from './tuningOut';
import type { IntervalVal, Sound } from '../core/Bloom';
import type { Figure } from '../lib/figures';
import type { MidiOutput } from './midi';
import { noteOn, noteOff, allNotesOff } from './midi';
import { wrapAt } from '../lib/arrays';
import { timebase } from './clockSync';

type Timer = ReturnType<typeof setTimeout>;

// A page that's covered or in a background tab gets its timers once a second
// at best, so everything is handed to the output further ahead, stamped with
// its time (Web MIDI and the piano both honour a timestamp)
const LOOKAHEAD_HIDDEN_MS = 1500;
const hidden = (): boolean => typeof document !== 'undefined' && document.hidden;

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
 * Everything off, now: a note-off for every voice the scheduler knows it
 * holds (some synths and hosts ignore all-notes-off), then all-notes-off on
 * every channel for anything else, the pedal lifted
 */
export function silence(out: MidiOutput | null): void {
  if (!out) return;
  const held = _voices.get(out);
  held?.forEach((_, key) => noteOff(out, key >> 7, key & 127));
  allNotesOff(out);
  clearVoices(out);
}

/**
 * Sound one Sound at `atMs` (performance.now's clock). The note-on is handed
 * to the output `lead` ms ahead, not when it's worked out: a figure's later
 * steps may be beats away, and the voices should know what's sounding when it
 * sounds. The note-off goes `offLead` ahead (0 while the page is visible, so a
 * repeat of the pitch before then can still take the voice over). The timers
 * go into `pending`, so a stop can let go of what hasn't started while what
 * sounds still ends on time.
 */
function scheduleSound(out: MidiOutput, s: Sound, atMs: number, lead: number, pending?: Pending, offLead = 0): void {
  const gateMs = Math.max(10, beatsToMs(s.gate));
  const ids: [number, number][] = [];
  const on: Timer = setTimeout(() => {
    pending?.on.delete(on);
    s.notes.forEach(n => { if (n >= 0 && n <= 127) ids.push([n, startVoice(out, s.chan, n, s.vel, atMs)]); });
  }, Math.max(0, atMs - performance.now() - lead));
  const off: Timer = setTimeout(() => {
    pending?.off.delete(off);
    ids.forEach(([n, id]) => endVoice(out, s.chan, n, id, atMs + gateMs));
  }, Math.max(0, atMs + gateMs - performance.now() - offLead));
  pending?.on.add(on);
  pending?.off.add(off);
}

/** Timers of sounds not yet started (on), of their releases (off), and of the picture (visual) */
interface Pending { on: Set<Timer>; off: Set<Timer>; visual: Set<Timer> }
const newPending = (): Pending => ({ on: new Set(), off: new Set(), visual: new Set() });
/** Nothing more starts and the picture stops; what sounds is released on time */
function letGo(p: Pending): void {
  p.on.forEach(clearTimeout); p.on.clear();
  p.visual.forEach(clearTimeout); p.visual.clear();
}
/** Everything, releases too (after a silence, or when nothing was sent) */
function cancelAll(p: Pending): void {
  letGo(p);
  p.off.forEach(clearTimeout); p.off.clear();
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
  const pending = newPending();
  const lead = hidden() ? LOOKAHEAD_HIDDEN_MS : 0;

  bloom.notes.forEach((_, i) => {
    const onAt = now + cursor;
    view.soundsAt(i, tick + i, legato, sustain).forEach(s => scheduleSound(out, s, onAt + beatsToMs(s.at), lead, pending, lead));
    const v = setTimeout(() => { pending.visual.delete(v); onNoteOn?.(i, tick + i); }, cursor);
    pending.visual.add(v);
    cursor += beatsToMs(view.stepAt(i, tick + i));   // an inserted figure takes its own length
  });

  return () => {
    cancelAll(pending);
    silence(out);
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
  /** Called at the start of every notes cycle with the effective vel/time/chan/intervals/figures arrays for that cycle */
  onCycleUpdate?: (vel: number[], time: number[], chan: number[], intervals: IntervalVal[], figures: Figure[]) => void;
  onLoop?: () => void;
  /** Locked to a running MIDI clock: the clock's beat the loop started on, and the beats played since */
  lock: { start: number; beats: number } | null;
  pending: Pending;
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
  onCycleUpdate?: (vel: number[], time: number[], chan: number[], intervals: IntervalVal[], figures: Figure[]) => void,
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
    pending: newPending(),
  };

  state.intervalId = setInterval(() => {
    const now = performance.now();
    const lookahead = hidden() ? LOOKAHEAD_HIDDEN_MS : LOOKAHEAD_MS;
    const horizon = now + lookahead;

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
            buildCycleSlice(b.figures.length > 0 ? b.figures : [0 as Figure], state.globalTick, N),
          );
        }
        if (state.globalTick > 0) state.onLoop?.();
      }

      const view = b.sounding(state.globalTick - noteIdx);   // a raga's notes as they sound
      const time = view.stepAt(noteIdx, state.globalTick);   // an inserted figure takes its own length
      const atMs = state.nextEventTime;

      // the note, the notes its intervals add, or its figure; a figure's steps follow a running clock too
      const lock = state.lock;
      view.soundsAt(noteIdx, state.globalTick).forEach(s => {
        const t = lock && s.at ? timebase()?.timeAtBeat(lock.start + lock.beats + s.at) ?? null : null;
        scheduleSound(out, s, t ?? atMs + beatsToMs(s.at), lookahead, state.pending, lookahead - LOOKAHEAD_MS);
      });

      // Fire visual callback at actual note-on time
      const idxSnap = noteIdx, tickSnap = state.globalTick;
      const v = setTimeout(() => { state.pending.visual.delete(v); state.onNoteOn?.(idxSnap, tickSnap); }, Math.max(0, atMs - now));
      state.pending.visual.add(v);

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

/** Stop the loop: nothing more starts (a figure's later steps included); what sounds is released on time */
export function stopLooper(): void {
  if (_loop) {
    clearInterval(_loop.intervalId);
    letGo(_loop.pending);
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
  /** the next fire, set afresh each time at the tempo of the moment */
  timeoutId: Timer | null;
  nextAt: number;
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

  const state: PulsarState = {
    bloom,
    out,
    rateBeats,
    timeoutId: null,
    nextAt: performance.now(),
    onNoteOn,
    onFire,
    tick: startTick,
  };

  const fire = () => {
    const p = _pulsar;
    if (p !== state) return;
    p.cancelLastPlay?.();
    p.cancelLastPlay = playOnce(p.bloom, out, p.bloom.legato, p.bloom.sustain, p.onNoteOn, p.tick);
    p.tick += p.bloom.notes.length;
    onFire?.();
    // from the time it was due, not the time it ran, so the pulse doesn't drift
    p.nextAt += beatsToMs(p.rateBeats);
    p.timeoutId = setTimeout(fire, Math.max(0, p.nextAt - performance.now()));
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
    if (_pulsar.timeoutId !== null) clearTimeout(_pulsar.timeoutId);
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
  timeoutId: Timer | null;
  nextAt: number;
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
    nextAt: performance.now(),
    cancelCurrent: null,
    onNoteOn,
  };
  _gardenLoop = state;

  const scheduleNext = () => {
    if (_gardenLoop !== state) return;
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
    // from when this slot was due, not when it ran, so the garden doesn't drift
    state.nextAt += durMs;
    state.timeoutId = setTimeout(scheduleNext, Math.max(0, state.nextAt - performance.now()));
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

  state.intervalId = setInterval(fire, beatsToMs(rateBeats));   // a fixed pulse: setPulsarRate restarts it
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
