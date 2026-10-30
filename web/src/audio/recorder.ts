// MIDI recorder — captures note-on events and assembles them into a Bloom

import { Bloom } from '../core/Bloom';
import { onMidiMessage, offMidiMessage } from './midi';
import { getBpm } from './scheduler';

interface CapturedNote {
  note: number;
  vel: number;
  chan: number;
  onTimeMs: number;
}

const CHORD_MS = 30;   // notes this close together are one chord

let _recording = false;
let _captured: CapturedNote[] = [];

function _handler(data: Uint8Array, atMs: number): void {
  const status = data[0] & 0xf0;
  const chan = data[0] & 0x0f;
  const note = data[1];
  const vel = data[2];

  // Note-on with velocity > 0
  if (status === 0x90 && vel > 0) {
    _captured.push({ note, vel, chan, onTimeMs: atMs });
  }
  // Note-offs are ignored — timeIntervals derive from consecutive note-on gaps,
  // matching the SC behavior of bloom.record()
}

export function startRecording(): void {
  _recording = true;
  _captured = [];
  onMidiMessage(_handler);
}

export function stopRecording(bloom: Bloom): void {
  const stopMs = performance.now(); // capture before unregistering handler
  offMidiMessage(_handler);
  _recording = false;
  if (_captured.length === 0) return;

  const msPerBeat = 60_000 / getBpm();

  // notes struck together (within CHORD_MS of the first) are one chord, at the loudest's velocity
  const groups: CapturedNote[][] = [];
  [..._captured].sort((a, b) => a.onTimeMs - b.onTimeMs).forEach(e => {
    const g = groups[groups.length - 1];
    if (g && e.onTimeMs - g[0].onTimeMs <= CHORD_MS) g.push(e); else groups.push([e]);
  });
  bloom.notes = groups.map(g => (g.length === 1 ? g[0].note : [...new Set(g.map(e => e.note))].sort((a, b) => a - b)));
  bloom.velocities = groups.map(g => Math.max(...g.map(e => e.vel)));
  bloom.chans = groups.map(g => g[0].chan);

  // timeInterval[i] = gap from note[i] to note[i+1].
  // Clock starts on the first note-on (dead time before playing is ignored).
  // Last note measures to the moment recording was stopped (second ` tap).
  const intervals: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const nextMs = i < groups.length - 1 ? groups[i + 1][0].onTimeMs : stopMs;
    intervals.push(Math.max(0.02, Math.round(((nextMs - groups[i][0].onTimeMs) / msPerBeat) * 1000) / 1000));
  }
  bloom.timeIntervals = intervals;

  bloom.enforceRange();
}

export function isRecording(): boolean {
  return _recording;
}
