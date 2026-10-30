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
  state.outputs = [..._virtual];
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
    if (/bloom tuning/i.test(input.name ?? '')) return;   // the helper's cues, for the DAW, not for playing
    const name = input.name ?? 'Unknown';
    state.inputs.push({ name, id: input.id });
    // Attach message handler (safe to re-attach — browser deduplicates)
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      // a bus Bloom sends on (an IAC driver) comes back as an input: that's our own playing, not a keyboard's
      if (state.selectedOutput && name === state.selectedOutput.name) return;
      // the event's own timestamp is when it arrived, before the page got round to it
      if (ev.data) _dispatchMsg(ev.data as Uint8Array, ev.timeStamp || performance.now());
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

// ─── The tap: a take hears every message on its way out ──────────────────────
// Returns false to hold a message back (a take that has ended lets nothing more out)

type MidiTap = (data: number[], atMs: number | undefined) => boolean;
let _tap: MidiTap | null = null;

export function setMidiTap(tap: MidiTap | null): void { _tap = tap; }

function emit(out: MidiOutput, data: number[], atMs?: number): void {
  if (_tap && !_tap(data, atMs)) return;
  out.send(data, atMs);
}

// ─── MIDI helpers ─────────────────────────────────────────────────────────────

export function noteOn(out: MidiOutput, chan: number, note: number, vel: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  const v = Math.max(0, Math.min(127, Math.round(vel)));
  emit(out, [0x90 | ch, n, v], atMs);
}

export function noteOff(out: MidiOutput, chan: number, note: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  const n = Math.max(0, Math.min(127, Math.round(note)));
  emit(out, [0x80 | ch, n, 0], atMs);
}

export function controlChange(out: MidiOutput, chan: number, cc: number, value: number, atMs?: number): void {
  const ch = Math.max(0, Math.min(15, chan)) & 0x0f;
  emit(out, [0xb0 | ch, cc & 0x7f, value & 0x7f], atMs);
}

export function allNotesOff(out: MidiOutput | null): void {
  if (!out) return;
  for (let ch = 0; ch < 16; ch++) {
    emit(out, [0xb0 | ch, 123, 0]);
  }
}
