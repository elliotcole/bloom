// Playback scheduler — uses performance.now() + Web MIDI timestamps (no Tone.js Transport)

import { Bloom } from '../core/Bloom';
import { applyTuning } from './tuningOut';
import { after, every } from './clock';
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
  stop: () => void;
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
  /** Changes waiting for the loop to come round (launch quantize); the loop then starts its lists afresh */
  atCycle: (() => void)[];
}

let _loop: LoopState | null = null;

// ─── Two voices: a loop set aside keeps running ──────────────────────────────
// In two-voice mode the focused voice's loop is `_loop`, as ever; the other
// voice's loop is parked here under its name and plays on, its notes lit on
// whatever `onNoteOn` it was parked with, its cycle display and onLoop off.

const _parked = new Map<string, LoopState>();

/** Beats from note `tick` until the notes next come round to their first (0 when it is the first) */
export function beatsToDownbeat(b: Bloom, tick: number): number {
  const n = b.notes.length;
  if (!n || !b.timeIntervals.length) return 0;
  let beats = 0;
  for (let t = tick; ((t % n) + n) % n !== 0; t++) {
    const idx = ((t % n) + n) % n;
    beats += Math.max(0, b.sounding(t - idx).stepAt(idx, t));
  }
  return beats;
}

/** When a loop next starts its notes again, in ms */
function downbeatOf(s: LoopState): number {
  return s.nextEventTime + beatsToMs(beatsToDownbeat(s.bloom, s.globalTick));
}

/** Beats of one pass of the notes starting at `tick` (a tick on the first note), the other lists read where they are */
export function passBeats(b: Bloom, tick: number): number {
  const n = b.notes.length;
  if (!n || !b.timeIntervals.length) return 0;
  const s = b.sounding(tick);
  let beats = 0;
  for (let i = 0; i < n; i++) beats += Math.max(0, s.stepAt(i, tick + i));
  return beats;
}

/** The tick of the notes' next first note, from `tick` (itself when it is one) */
function downbeatTick(b: Bloom, tick: number): number {
  const n = b.notes.length;
  return n ? tick + (((-tick % n) + n) % n) : tick;
}

/** A loop seen from now: its bloom, the tick it plays next, and the beats until it does */
export interface LoopView { bloom: Bloom; tick: number; inBeats: number }

/**
 * Beats from now until two loops next start their notes together (their
 * downbeats within `tol` of each other), looking `limit` beats ahead; null
 * when they don't meet by then. Loops of one length in step meet every pass;
 * different lengths drift and meet at something like their lcm.
 */
export function meetingIn(a: LoopView, b: LoopView, limit = 512, tol = 0.02): number | null {
  const downbeats = (v: LoopView): (() => number | null) => {
    const n = v.bloom.notes.length;
    if (!n || !v.bloom.timeIntervals.length) return () => null;
    let at = v.inBeats + beatsToDownbeat(v.bloom, v.tick);
    let tick = downbeatTick(v.bloom, v.tick);
    return () => {
      if (at > limit) return null;
      const here = at;
      const pass = passBeats(v.bloom, tick);
      if (pass <= 0) { at = Infinity; return here; }
      at += pass; tick += n;
      return here;
    };
  };
  const na = downbeats(a), nb = downbeats(b);
  let x = na(), y = nb();
  while (x !== null && y !== null) {
    if (Math.abs(x - y) <= tol) return Math.max(x, y);
    if (x < y) x = na(); else y = nb();
  }
  return null;
}

/**
 * When the focused loop and the parked one next start together: ms from now,
 * and whether they're in step (meeting on their very next downbeats, with
 * passes of one length). Null when not both looping, or not soon.
 */
export function nextMeeting(): { inMs: number; inStep: boolean } | null {
  const other = _parked.values().next();
  if (!_loop || other.done) return null;
  const now = performance.now();
  const view = (s: LoopState): LoopView => ({ bloom: s.bloom, tick: s.globalTick, inBeats: Math.max(0, s.nextEventTime - now) / beatsToMs(1) });
  const a = view(_loop), b = view(other.value);
  const beats = meetingIn(a, b);
  if (beats === null) return null;
  const next = (v: LoopView) => v.inBeats + beatsToDownbeat(v.bloom, v.tick);
  const pass = (v: LoopView) => passBeats(v.bloom, downbeatTick(v.bloom, v.tick));
  const inStep = Math.abs(beats - next(a)) < 0.02 && Math.abs(beats - next(b)) < 0.02 && Math.abs(pass(a) - pass(b)) < 0.02;
  return { inMs: beatsToMs(beats), inStep };
}

/** Set the focused loop aside under `name`, still playing; its notes now light `onNoteOn` */
export function parkLooper(name: string, bloom: Bloom, onNoteOn?: (index: number, tick: number) => void): boolean {
  stopParked(name);
  if (!_loop) return false;
  _loop.bloom = bloom;
  _loop.onNoteOn = onNoteOn;
  _loop.onCycleUpdate = undefined;
  _loop.onLoop = undefined;
  _parked.set(name, _loop);
  _loop = null;
  return true;
}

/** Bring the loop parked under `name` back as the focused loop, with the focused loop's callbacks */
export function unparkLooper(
  name: string,
  bloom: Bloom,
  onNoteOn?: (index: number, tick: number) => void,
  onCycleUpdate?: LoopState['onCycleUpdate'],
  onLoop?: () => void,
): boolean {
  const s = _parked.get(name);
  if (!s) return false;
  _parked.delete(name);
  stopLooper();
  Object.assign(s, { bloom, onNoteOn, onCycleUpdate, onLoop });
  _loop = s;
  return true;
}

/** The bloom a parked loop plays from now on */
export function setParkedBloom(name: string, bloom: Bloom): void {
  const s = _parked.get(name);
  if (s) s.bloom = bloom;
}

/** A loop parked under `name` (any, when no name) is playing */
export function isParkedLooping(name?: string): boolean {
  return name === undefined ? _parked.size > 0 : _parked.has(name);
}

/** Stop the loop parked under `name` (every parked loop when no name); true when one was playing */
export function stopParked(name?: string): boolean {
  const names = name === undefined ? [..._parked.keys()] : [name];
  let any = false;
  for (const k of names) {
    const s = _parked.get(k);
    if (!s) continue;
    s.stop();
    letGo(s.pending);
    s.atCycle.splice(0).forEach(fn => fn());
    _parked.delete(k);
    any = true;
  }
  return any;
}

/**
 * Start a parked loop under `name` (replacing one there) on the focused loop's
 * next downbeat, so the two run in step: duplicating a voice into the other.
 * At once when nothing is looping.
 */
export function startParkedInStep(name: string, bloom: Bloom, out: MidiOutput, onNoteOn?: (index: number, tick: number) => void): void {
  stopParked(name);
  const focused = _loop;
  const at = focused ? downbeatOf(focused) : undefined;
  _loop = null;
  startLooper(bloom, out, onNoteOn, undefined, undefined, at);
  parkLooper(name, bloom, onNoteOn);
  _loop = focused;
}

/** A parked loop is playing: the focused loop, started now, would join it on its downbeat */
export function parkedDownbeat(): number | undefined {
  const first = _parked.values().next();
  return first.done ? undefined : downbeatOf(first.value);
}

/**
 * Run `fn` when the loop next comes round to its first note (launch quantize),
 * the lists starting together from there; at once when nothing is looping.
 * Stopping the loop runs what's waiting.
 */
export function atNextCycle(fn: () => void): void {
  if (_loop) _loop.atCycle.push(fn); else fn();
}

/** Something is waiting for the loop to come round */
export function cycleWaiting(): boolean {
  return (_loop?.atCycle.length ?? 0) > 0;
}

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
  /** when to start, in ms: two voices start the second loop on the first one's downbeat */
  startAt: number | undefined = parkedDownbeat(),
): void {
  stopLooper();

  if (bloom.notes.length === 0) return;

  const state: LoopState = {
    bloom,
    out,
    stop: () => {},
    nextEventTime: Math.max(performance.now(), startAt ?? 0),
    globalTick: 0,
    onNoteOn,
    onCycleUpdate,
    onLoop,
    lock: null,
    pending: newPending(),
    atCycle: [],
  };

  state.stop = every(TICK_MS, () => {
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
        if (state.atCycle.length) {   // launch quantize: the held change lands here, its lists from the top
          const fns = state.atCycle.splice(0);
          fns.forEach(fn => fn());
          state.globalTick = 0;
          if (b.notes.length === 0 || b.velocities.length === 0 || b.timeIntervals.length === 0 || b.chans.length === 0) break;
        }
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
  });

  _loop = state;
}

export function updateLooper(bloom: Bloom): void {
  if (_loop) _loop.bloom = bloom;
}

/** Stop the loop: nothing more starts (a figure's later steps included); what sounds is released on time */
export function stopLooper(): void {
  if (_loop) {
    _loop.stop();
    letGo(_loop.pending);
    const waiting = _loop.atCycle.splice(0);
    _loop = null;
    waiting.forEach(fn => fn());   // what was waiting for the loop lands now
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
  cancelNext: (() => void) | null;
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
    cancelNext: null,
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
    p.cancelNext = after(Math.max(0, p.nextAt - performance.now()), fire);
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
    _pulsar.cancelNext?.();
    _pulsar.cancelLastPlay?.();
    _pulsar = null;
  }
}

export function isPulsing(): boolean {
  return _pulsar !== null;
}

export function stopAll(): void {
  stopLooper();
  stopParked();
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
  cancelNext: (() => void) | null;
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
    cancelNext: null,
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
    state.cancelNext = after(Math.max(0, state.nextAt - performance.now()), scheduleNext);
  };

  scheduleNext();
}

export function stopGardenLooper(): void {
  if (_gardenLoop) {
    _gardenLoop.cancelNext?.();
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
  stop: () => void;
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
    stop: () => {},
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

  state.stop = every(beatsToMs(rateBeats), fire);   // a fixed pulse: setPulsarRate restarts it
  fire(); // fire immediately
}

export function stopGardenPulsar(): void {
  if (_gardenPulsar) {
    _gardenPulsar.stop();
    _gardenPulsar.cancelCurrent?.();
    _gardenPulsar = null;
  }
}

export function isGardenPulsing(): boolean {
  return _gardenPulsar !== null;
}
