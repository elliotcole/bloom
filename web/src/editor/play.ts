// Playing the edited performance from anywhere in it: on the built-in piano,
// or out of a MIDI port (with its controllers, and its tunings to the helper).

import type { TakeFile } from '../audio/take';
import { takeFrom } from '../audio/takeFrom';
import { every, HIDDEN_LOOKAHEAD_MS, pageHidden } from '../audio/clock';
import type { MidiOutput } from '../audio/midi';
import { pianoOutput, setPianoTuning } from '../audio/synth';
import { replayHelper } from '../audio/tuningOut';

const AHEAD_MS = 150;   // notes are handed to the piano this far ahead, stamped with their time
const LEAD_MS = 40;     // the first of them sounds this long after play is pressed

export class Player {
  /** where it sounds; changing it stops what's playing */
  private out: MidiOutput = pianoOutput;
  private stopTick: (() => void) | null = null;
  private t0 = 0;        // performance.now() at the performance's 0
  private until = 0;
  private handed = new Map<number, number>();   // channel and pitch → when it sounds: no note-off yet

  output(): MidiOutput { return this.out; }
  setOutput(out: MidiOutput): void { this.stop(); this.out = out; }

  playing(): boolean { return this.stopTick !== null; }

  /** ms into the performance */
  position(): number { return Math.max(0, Math.min(performance.now() - this.t0, this.until)); }

  /** Play `take` from `from` ms up to `until`; `ended` is called if it gets there */
  start(take: TakeFile, from: number, until: number, ended: () => void): void {
    this.stop();
    const ev = take.events;
    this.t0 = performance.now() + LEAD_MS - from;
    this.until = until;
    const at = takeFrom(take, from);
    // what's in force there: the tuning, each channel's pedal and controllers
    setPianoTuning(at.piano === undefined || at.piano < 0 ? null : take.tables[at.piano]);
    const first = this.t0 + from - 1;
    if (this.out !== pianoOutput) {
      at.helper.forEach(m => replayHelper(m, first));
      at.midi.forEach(m => this.out.send(m, first));
    }
    let i = at.index;
    const tick = () => {
      const now = performance.now() - this.t0;
      const ahead = pageHidden() ? HIDDEN_LOOKAHEAD_MS : AHEAD_MS;
      while (i < ev.length && ev[i][0] <= now + ahead && ev[i][0] < until) {
        const e = ev[i++];
        if (e[1] === 'm') this.send(e[2], this.t0 + e[0] + e[3]);
        else if (e[1] === 'p') setPianoTuning(e[2] < 0 ? null : take.tables[e[2]]);
        else if (e[1] === 'h' && this.out !== pianoOutput) replayHelper(take.sysex[e[2]], this.t0 + e[0]);
      }
      if (now >= until) { this.stop(); ended(); }
    };
    this.stopTick = every(20, tick);
    tick();
  }

  private send(m: number[], atMs: number): void {
    const st = m[0] & 0xf0, key = (m[0] & 0x0f) * 128 + m[1];
    if (st === 0x90 && m[2] > 0) this.handed.set(key, atMs);
    else if (st === 0x80 || st === 0x90) this.handed.delete(key);
    this.out.send(m, atMs);
  }

  /** Stop: what sounds is let go, and what was handed over ahead of its time, as it starts */
  stop(): void {
    if (!this.stopTick) return;
    this.stopTick();
    this.stopTick = null;
    this.until = this.position();
    const now = performance.now();
    for (const [key, at] of this.handed) {
      const off = [0x80 | (key >> 7), key & 127, 0];
      this.out.send(off, now);
      if (at > now) this.out.send(off, at + 1);
    }
    this.handed.clear();
    if (this.out === pianoOutput) { this.out.send([0xb0, 123, 0]); return; }
    // a port: every channel's pedal lifted and its notes off, or what was held rings on
    for (let ch = 0; ch < 16; ch++) { this.out.send([0xb0 | ch, 64, 0]); this.out.send([0xb0 | ch, 123, 0]); }
  }
}
