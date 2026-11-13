// Web MIDI API wrapper

import { EchoWatch, inputRole, setInputMuted } from './midiInputs';

export interface MidiOutput {
  name: string;
  send(data: number[], timestampMs?: number): void;
}

export interface MidiInput {
  name: string;
  id: string;
}

export interface MidiState {
  outputs: MidiOutput[];
  inputs: MidiInput[];
  selectedOutput: MidiOutput | null;
  error: string | null;
}

const state: MidiState = {
  outputs: [],
  inputs: [],
  selectedOutput: null,
  error: null,
};

let midiAccess: MIDIAccess | null = null;

/** A note-on that sounds (one at velocity 0 is a note-off) */
export const isNoteOn = (d: ArrayLike<number>): boolean => (d[0] & 0xf0) === 0x90 && d[2] > 0;

// Outputs that aren't MIDI ports (the built-in piano): always offered, first,
// and kept selected when a port comes or goes
const _virtual: MidiOutput[] = [];

/** Offer an output of the page's own beside the MIDI ports (before initMidi) */
export function registerVirtualOutput(out: MidiOutput): void {
  if (_virtual.includes(out)) return;
  _virtual.push(out);
  if (!state.outputs.includes(out)) state.outputs = [..._virtual, ...state.outputs.filter(o => !_virtual.includes(o))];
}

// ─── MIDI message routing ─────────────────────────────────────────────────────

type MidiMsgHandler = (data: Uint8Array, receivedAtMs: number) => void;
const _msgHandlers: Set<MidiMsgHandler> = new Set();

export function onMidiMessage(handler: MidiMsgHandler): void {
  _msgHandlers.add(handler);
}

export function offMidiMessage(handler: MidiMsgHandler): void {
  _msgHandlers.delete(handler);
}

function _dispatchMsg(data: Uint8Array, atMs = performance.now()): void {
  _msgHandlers.forEach(h => h(data, atMs));
}

export function getMidiInputs(): MidiInput[] {
  return state.inputs;
}

export async function initMidi(): Promise<MidiState> {
  if (!navigator.requestMIDIAccess) {
    state.error = 'Web MIDI API not supported in this browser';
    return state;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    _refreshOutputs();
    _refreshInputs();

    midiAccess.onstatechange = () => {
      _refreshOutputs();
      _refreshInputs();
      onOutputsChange?.(state.outputs);
      _onInputs?.();
    };
  } catch (err) {
    state.error = `MIDI access denied: ${err}`;
  }

  return state;
}

// One MidiOutput for each port, by the port's id, for as long as the page
// lives: the list is made again whenever a port comes or goes, and a loop
// that's playing, and the voices the scheduler holds for it, are kept by the
// output they were given. A new one for the same port would lose them.
const _ports = new Map<string, { out: MidiOutput; port: MIDIOutput }>();

function outputFor(port: MIDIOutput): MidiOutput {
  const known = _ports.get(port.id);
  if (known) { known.port = port; return known.out; }   // the same port, back again
  const entry = {
    port,
    out: {
      name: port.name ?? 'Unknown',
      send(data: number[], timestampMs?: number) {
        if (isNoteOn(data)) _echoes.out(data[1], data[2], timestampMs ?? performance.now());
        try {
          entry.port.send(data, timestampMs);
        } catch (_) {
          // ignore stale port errors
        }
      },
    } as MidiOutput,
  };
  _ports.set(port.id, entry);
  return entry.out;
}

function _refreshOutputs(): void {
  if (!midiAccess) return;
  state.outputs = [..._virtual];
  midiAccess.outputs.forEach(output => { state.outputs.push(outputFor(output)); });

  // Auto-select first output if none selected
  if (!state.selectedOutput && state.outputs.length > 0) {
    state.selectedOutput = state.outputs[0];
  }
  // Revalidate current selection
  if (state.selectedOutput) {
    const stillExists = state.outputs.find(o => o.name === state.selectedOutput!.name);
    state.selectedOutput = stillExists ?? (state.outputs[0] ?? null);
  }
}

function _refreshInputs(): void {
  if (!midiAccess) return;
  state.inputs = [];
  midiAccess.inputs.forEach(input => {
    if (/bloom tuning/i.test(input.name ?? '')) return;   // the helper's cues, for the DAW, not for playing
    const name = input.name ?? 'Unknown';
    state.inputs.push({ name, id: input.id });
    // Attach message handler (set afresh each time: it replaces the last)
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      if (!ev.data) return;
      const data = ev.data as Uint8Array;
      // the event's own timestamp is when it arrived, before the page got round to it
      const at = ev.timeStamp || performance.now();
      // clock pulses and active sensing come many times a second and aren't playing: they light nothing
      if (data[0] !== 0xf8 && data[0] !== 0xfe) _onActivity?.(name);
      // the bus Bloom sends on comes back as an input (our own playing), and a muted one isn't heard
      if (inputRole(name, state.selectedOutput?.name ?? null) !== 'listening') return;
      if (isNoteOn(data) && _echoes.heard(name, data[1], data[2], at)) {
        setInputMuted(name, true);   // Bloom's own notes coming back: kept out of takes from here
        _onEcho?.(name);
        return;
      }
      _dispatchMsg(data, at);
    };
  });
}

export function selectOutput(name: string): boolean {
  const found = state.outputs.find(o => o.name === name);
  if (found) { state.selectedOutput = found; return true; }
  return false;
}

export function getState(): MidiState {
  return state;
}

let onOutputsChange: ((outputs: MidiOutput[]) => void) | null = null;

// ─── Inputs: ⚙ → midi lists them, lights one as it sends, and hears of an echo ──
const _echoes = new EchoWatch();
let _onInputs: (() => void) | null = null;
let _onActivity: ((name: string) => void) | null = null;
let _onEcho: ((name: string) => void) | null = null;

export function onInputsChange(cb: () => void): void { _onInputs = cb; }
export function onInputActivity(cb: (name: string) => void): void { _onActivity = cb; }
/** An input found sending Bloom's own notes back, and muted for it */
export function onInputEcho(cb: (name: string) => void): void { _onEcho = cb; }

/** Mute or unmute an input (by hand: an echo is watched for afresh) */
export function muteInput(name: string, muted: boolean): void {
  setInputMuted(name, muted);
  _echoes.forget(name);
}

export function onOutputChange(cb: (outputs: MidiOutput[]) => void): void {
  onOutputsChange = cb;
}

// ─── The tap: a take hears every message on its way out ──────────────────────
// Returns false to hold a message back (a take that has ended lets nothing more
// out). An urgent message (everything off: the panic key, the page closing) is
// heard by the tap like any other but goes out whatever it says.

type MidiTap = (data: number[], atMs: number | undefined) => boolean;
let _tap: MidiTap | null = null;

export function setMidiTap(tap: MidiTap | null): void { _tap = tap; }

function emit(out: MidiOutput, data: number[], atMs?: number, urgent = false): void {
  if (_tap && !_tap(data, atMs) && !urgent) return;
  out.send(data, atMs);
}

// ─── MIDI helpers ─────────────────────────────────────────────────────────────

export function noteOn(out: MidiOutput, chan: number, note: number, vel: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  const v = Math.max(0, Math.min(127, Math.round(vel)));
  emit(out, [0x90 | ch, n, v], atMs);
}

export function noteOff(out: MidiOutput, chan: number, note: number, atMs?: number, urgent = false): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  emit(out, [0x80 | ch, n, 0], atMs, urgent);
}

export function controlChange(out: MidiOutput, chan: number, cc: number, value: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  emit(out, [0xb0 | ch, cc & 0x7f, value & 0x7f], atMs);
}

export function allNotesOff(out: MidiOutput | null, urgent = false): void {
  if (!out) return;
  for (let ch = 0; ch < 16; ch++) {
    emit(out, [0xb0 | ch, 123, 0], undefined, urgent);
  }
}
