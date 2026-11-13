// The built-in piano takes its messages in the order they came. A note-on
// used to wait on a promise while its note-off went straight through: sent
// together (a take's replay hands over a batch at once), the release found
// nothing to release and the note rang the length of its sample.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as string[], state: 'running', starts: 0, wake: () => {} }));

vi.mock('tone', () => {
  class Node {
    gain = { rampTo() {} };
    toDestination() { return this; }
    connect() { return this; }
    dispose() {}
  }
  class Reverb extends Node { generate() { return Promise.resolve(); } }
  class Sampler extends Node {
    constructor(o: { onload: () => void }) { super(); void Promise.resolve().then(() => o.onload()); }
    triggerAttack(p: string) { h.calls.push(`on ${p}`); }
    triggerRelease(p: string) { h.calls.push(`off ${p}`); }
    releaseAll() { h.calls.push('all off'); }
  }
  return {
    Gain: Node, Reverb, Sampler,
    now: () => 0,
    getContext: () => ({ state: h.state }),
    start: () => { h.starts++; return new Promise<void>(res => { h.wake = () => { h.state = 'running'; res(); }; }); },
  };
});

import { loadSynth, pianoOutput } from '../synth';

beforeEach(async () => { await loadSynth(); h.calls.length = 0; h.starts = 0; h.state = 'running'; });

describe('the piano', () => {
  it('running: a note-on and its note-off sent together are both acted on, in order, at once', () => {
    pianoOutput.send([0x90, 60, 80], 10);
    pianoOutput.send([0x80, 60, 0], 20);
    expect(h.calls).toEqual(['on C4', 'off C4']);
  });

  it('waking: everything waits its turn behind the start, and nothing is lost', async () => {
    h.state = 'suspended';
    pianoOutput.send([0x90, 60, 80]);
    pianoOutput.send([0x80, 60, 0]);
    pianoOutput.send([0x90, 62, 80]);
    pianoOutput.send([0xb0, 123, 0]);
    expect(h.calls).toEqual([]);
    expect(h.starts).toBe(1);   // asked to start once, not once a message
    h.wake();
    await new Promise<void>(res => setTimeout(res, 0));
    expect(h.calls).toEqual(['on C4', 'off C4', 'on D4', 'all off']);
    pianoOutput.send([0x90, 64, 80]);   // and from then on, at once again
    expect(h.calls.at(-1)).toBe('on E4');
  });
});
