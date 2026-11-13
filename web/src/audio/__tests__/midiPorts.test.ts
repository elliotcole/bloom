// The outputs when a port comes or goes: each port keeps the one MidiOutput it
// had, so a loop playing on it and the voices held for it aren't lost. And an
// input's light isn't lit by clock pulses or active sensing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { getState, initMidi, onInputActivity, onMidiMessage, offMidiMessage, selectOutput } from '../midi';
import { playOnce, setBpm, silence } from '../scheduler';

interface Port { id: string; name: string; sent: number[][]; send(d: number[]): void }
const port = (id: string, name: string): Port => {
  const sent: number[][] = [];
  return { id, name, sent, send(d) { sent.push([...d]); } };
};
interface Input { id: string; name: string; onmidimessage: ((e: { data: Uint8Array; timeStamp: number }) => void) | null }

const outputs = new Map<string, Port>();
const inputs = new Map<string, Input>();
const access = { outputs, inputs, onstatechange: null as (() => void) | null };

beforeEach(async () => {
  vi.useFakeTimers();
  setBpm(120);
  outputs.clear(); inputs.clear();
  outputs.set('a', port('a', 'Port A'));
  inputs.set('k', { id: 'k', name: 'Keys', onmidimessage: null });
  vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve(access) });
  await initMidi();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('MIDI outputs across a port coming or going', () => {
  it('a port keeps its output, and the output follows the port', () => {
    const a = getState().outputs.find(o => o.name === 'Port A')!;
    outputs.set('b', port('b', 'Port B'));
    access.onstatechange!();
    expect(getState().outputs.map(o => o.name)).toContain('Port B');
    expect(getState().outputs.find(o => o.name === 'Port A')).toBe(a);
    // unplugged and back: the browser may hand over a new port object under the same id
    const again = port('a', 'Port A');
    outputs.set('a', again);
    access.onstatechange!();
    expect(getState().outputs.find(o => o.name === 'Port A')).toBe(a);
    a.send([0x90, 60, 80]);
    expect(again.sent).toEqual([[0x90, 60, 80]]);
  });

  it('everything off still names the notes a play began before the change', () => {
    selectOutput('Port A');
    const b = new Bloom();
    b.notes = [60]; b.timeIntervals = [4]; b.velocities = [90]; b.chans = [0]; b.intervals = [0]; b.figures = [0];
    playOnce(b, getState().selectedOutput!);
    vi.advanceTimersByTime(20);   // 60 sounds
    outputs.set('b', port('b', 'Port B'));
    access.onstatechange!();
    const sent = outputs.get('a')!.sent;
    sent.length = 0;
    silence(getState().selectedOutput);
    expect(sent).toContainEqual([0x80, 60, 0]);   // not only all-notes-off, which some hosts ignore
  });
});

describe("an input's activity", () => {
  it('is a note or a controller, not a clock pulse or active sensing (which are still heard)', () => {
    const lit: string[] = [];
    const heard: number[] = [];
    onInputActivity(name => lit.push(name));
    const h = (d: Uint8Array) => { heard.push(d[0]); };
    onMidiMessage(h);
    const keys = inputs.get('k')!;
    keys.onmidimessage!({ data: new Uint8Array([0xf8]), timeStamp: 1 });
    keys.onmidimessage!({ data: new Uint8Array([0xfe]), timeStamp: 2 });
    expect(lit).toEqual([]);
    keys.onmidimessage!({ data: new Uint8Array([0x90, 60, 80]), timeStamp: 3 });
    expect(lit).toEqual(['Keys']);
    expect(heard).toEqual([0xf8, 0xfe, 0x90]);   // the clock still reaches whoever follows it
    offMidiMessage(h);
  });
});
