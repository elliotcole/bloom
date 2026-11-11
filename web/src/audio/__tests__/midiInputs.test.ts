// Which inputs Bloom hears, and an input that sends Bloom's own notes back
// (the "All In" track passing everything on over IAC Bus 2 to TouchDesigner
// recorded every note again on channel 1, 24 ms late, into a whole take).

import { describe, expect, it, vi } from 'vitest';
import { EchoWatch, inputMuted, inputRole, setInputMuted } from '../midiInputs';

describe('input roles', () => {
  it('hears every input but the bus Bloom plays on, and not a muted one', () => {
    expect(inputRole('IAC Driver Bus 2', 'IAC Driver Bus 1')).toBe('listening');
    expect(inputRole('IAC Driver Bus 1', 'IAC Driver Bus 1')).toBe('own');
    setInputMuted('IAC Driver Bus 2', true);
    expect(inputRole('IAC Driver Bus 2', 'IAC Driver Bus 1')).toBe('muted');
    expect(inputMuted('IAC Driver Bus 2')).toBe(true);
    setInputMuted('IAC Driver Bus 2', false);
    expect(inputRole('IAC Driver Bus 2', null)).toBe('listening');
  });

  it('remembers mutes by name', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setInputMuted('Bus 3', true);
    expect(JSON.parse(localStorage.getItem('bloom.midiIn.muted')!)).toContain('Bus 3');
    setInputMuted('Bus 3', false);
    expect(JSON.parse(localStorage.getItem('bloom.midiIn.muted')!)).not.toContain('Bus 3');
    vi.unstubAllGlobals();
  });
});

describe('echoes', () => {
  it('finds an input sending back what Bloom played, 24 ms late', () => {
    const w = new EchoWatch();
    let found = -1;
    for (let i = 0; i < 40; i++) {
      const t = i * 130, note = 48 + (i * 7) % 30, vel = 40 + (i * 11) % 60;
      w.out(note, vel, t);
      if (w.heard('Bus 2', note, vel, t + 24) && found < 0) found = i;
    }
    expect(found).toBe(15);   // the sixteenth echo: once there are enough to be sure
    expect(w.echoing('Bus 2')).toBe(true);
  });

  it('flags it once', () => {
    const w = new EchoWatch();
    let flags = 0;
    for (let i = 0; i < 60; i++) { w.out(60, 80, i * 100); if (w.heard('Bus 2', 60, 80, i * 100 + 20)) flags++; }
    expect(flags).toBe(1);
  });

  it("doesn't take a keyboard played along for an echo", () => {
    const w = new EchoWatch();
    for (let i = 0; i < 100; i++) {
      w.out(48 + (i * 7) % 30, 40 + (i * 11) % 60, i * 130);
      // the player now and then hits a note Bloom just played, mostly not
      const echo = i % 5 === 0;
      const note = echo ? 48 + (i * 7) % 30 : 90 - (i % 12), vel = echo ? 40 + (i * 11) % 60 : 64;
      expect(w.heard('Keyboard', note, vel, i * 130 + 30)).toBe(false);
    }
    expect(w.echoing('Keyboard')).toBe(false);
  });

  it('only counts what came soon after Bloom sent it', () => {
    const w = new EchoWatch();
    for (let i = 0; i < 30; i++) {
      w.out(60, 80, i * 1000);
      expect(w.heard('Bus 2', 60, 80, i * 1000 + 400)).toBe(false);   // too late to be the same note
    }
  });

  it('watches afresh once forgotten (muted or unmuted by hand)', () => {
    const w = new EchoWatch();
    for (let i = 0; i < 20; i++) { w.out(60, 80, i * 100); w.heard('Bus 2', 60, 80, i * 100 + 20); }
    expect(w.echoing('Bus 2')).toBe(true);
    w.forget('Bus 2');
    expect(w.echoing('Bus 2')).toBe(false);
  });
});
