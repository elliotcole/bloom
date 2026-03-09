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

let _recording = false;
let _startMs = 0;
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
  _startMs = performance.now();
  _captured = [];
  onMidiMessage(_handler);
}

export function stopRecording(bloom: Bloom): void {
  offMidiMessage(_handler);
  _recording = false;
  if (_captured.length === 0) return;

  const msPerBeat = 60_000 / getBpm();

  bloom.notes = _captured.map(e => e.note);
  bloom.velocities = _captured.map(e => e.vel);
  bloom.chans = _captured.map(e => e.chan);

  // timeInterval[i] = gap from previous note-on (first = gap from recording start)
  bloom.timeIntervals = _captured.map((e, i) => {
    const prevMs = i === 0 ? _startMs : _captured[i - 1].onTimeMs;
    return Math.max(0.01, (e.onTimeMs - prevMs) / msPerBeat);
  });

  bloom.enforceRange();
}

export function isRecording(): boolean {
  return _recording;
}
