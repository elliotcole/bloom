// Web MIDI API wrapper

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
  available: boolean;
  error: string | null;
}

const state: MidiState = {
  outputs: [],
  inputs: [],
  selectedOutput: null,
  available: false,
  error: null,
};

let midiAccess: MIDIAccess | null = null;

// ─── MIDI message routing ─────────────────────────────────────────────────────

type MidiMsgHandler = (data: Uint8Array, receivedAtMs: number) => void;
const _msgHandlers: Set<MidiMsgHandler> = new Set();

export function onMidiMessage(handler: MidiMsgHandler): void {
  _msgHandlers.add(handler);
}

export function offMidiMessage(handler: MidiMsgHandler): void {
  _msgHandlers.delete(handler);
}

function _dispatchMsg(data: Uint8Array): void {
  const atMs = performance.now();
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
    state.available = true;
    _refreshOutputs();
    _refreshInputs();

    midiAccess.onstatechange = () => {
      _refreshOutputs();
      _refreshInputs();
      onOutputsChange?.(state.outputs);
    };
  } catch (err) {
    state.error = `MIDI access denied: ${err}`;
  }

  return state;
}

function _refreshOutputs(): void {
  if (!midiAccess) return;
  state.outputs = [];
  midiAccess.outputs.forEach(output => {
    state.outputs.push({
      name: output.name ?? 'Unknown',
      send(data: number[], timestampMs?: number) {
        try {
          output.send(data, timestampMs);
        } catch (_) {
          // ignore stale port errors
        }
      },
    });
  });

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
    state.inputs.push({ name: input.name ?? 'Unknown', id: input.id });
    // Attach message handler (safe to re-attach — browser deduplicates)
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      if (ev.data) _dispatchMsg(ev.data as Uint8Array);
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

export function onOutputChange(cb: (outputs: MidiOutput[]) => void): void {
  onOutputsChange = cb;
}

// ─── MIDI helpers ─────────────────────────────────────────────────────────────

export function noteOn(out: MidiOutput, chan: number, note: number, vel: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  const v = Math.max(0, Math.min(127, Math.round(vel)));
  out.send([0x90 | ch, n, v], atMs);
}

export function noteOff(out: MidiOutput, chan: number, note: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  out.send([0x80 | ch, n, 0], atMs);
}

export function controlChange(out: MidiOutput, chan: number, cc: number, value: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  out.send([0xb0 | ch, cc & 0x7f, value & 0x7f], atMs);
}

export function allNotesOff(out: MidiOutput | null): void {
  if (!out) return;
  for (let ch = 0; ch < 16; ch++) {
    out.send([0xb0 | ch, 123, 0]);
  }
}
