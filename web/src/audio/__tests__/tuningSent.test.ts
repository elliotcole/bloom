// A tuning with no helper to send it to is still sent once (to the piano),
// not worked out again at every play; a refused SysEx isn't asked for again;
// and a helper found running when MIDI is allowed gets what's sounding.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloom } from '../../core/Bloom';

const TUNING = { name: 'test', cents: [0, 90, 204, 294, 408, 498, 588, 702, 792, 906, 996, 1110], period: 1200 };

function bloom(): Bloom {
  const b = new Bloom();
  b.notes = [60]; b.timeIntervals = [1]; b.velocities = [90]; b.chans = [0]; b.intervals = [0]; b.figures = [0];
  b.tuning = { ...TUNING, cents: [...TUNING.cents] };
  return b;
}

const settle = () => new Promise<void>(res => setTimeout(res, 0));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('applying a tuning', () => {
  it('SysEx refused: asked once, and the piano is tuned once for plays of the same tuning', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('refused')));
    vi.stubGlobal('navigator', { requestMIDIAccess: ask });
    const t = await import('../tuningOut');
    const piano: unknown[] = [];
    t.setTuningTap((kind, data) => { if (kind === 'piano') piano.push(data); });
    const b = bloom();
    t.applyTuning(b);
    await settle();
    t.applyTuning(b);
    t.applyTuning(b);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(piano.length).toBe(1);
    expect(t.helperStatus()).toMatch(/not allowed/);
    // a different tuning is still sent
    b.tuning = { ...TUNING, name: 'other', cents: TUNING.cents.map(c => c + 1) };
    t.applyTuning(b);
    expect(piano.length).toBe(2);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('a helper already running when MIDI is allowed is sent the tuning that was applied before', async () => {
    const sent: number[][] = [];
    const helper = { name: 'Bloom Tuning', send(m: number[]) { sent.push(m); } };
    const access = { outputs: new Map([['h', helper]]), addEventListener() {} };
    let allow: () => void = () => {};
    vi.stubGlobal('navigator', { requestMIDIAccess: () => new Promise(res => { allow = () => res(access); }) });
    const t = await import('../tuningOut');
    t.applyTuning(bloom());   // no access yet: only the piano hears it
    expect(sent).toEqual([]);
    allow();
    await settle();
    // its name, the two tables, its cue
    expect(sent.length).toBe(4);
    expect(sent[0].slice(0, 5)).toEqual([0xf0, 0x7d, 0x62, 0x6c, 0x6d]);
    expect(sent[1].slice(0, 5)).toEqual([0xf0, 0x7f, 0x7f, 0x08, 0x02]);
  });
});
