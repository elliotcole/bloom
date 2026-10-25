// Following a MIDI clock (Ableton Live, or anything that sends one): the tempo,
// and once the transport has told us where it is (Start, Continue or Song
// Position), the beat itself, so a loop can start on the beat and stay locked
// to it.
//
// Clock pulses come 24 to a beat. Instead of averaging the gaps between the
// last few (which jitters with every late pulse), a straight line is fitted
// through the last few beats of pulses, time against position. Its slope is the
// tempo; the line itself maps beats to times and back.

const PPQ = 24;
const WINDOW = 72;          // pulses in the fit: three beats
const MIN_FIT = 12;         // half a beat before trusting a tempo
const LOST_MS = 1000;       // no pulse this long: the clock has gone

export interface ClockState {
  /** a clock is arriving */
  synced: boolean;
  /** its tempo, unrounded */
  bpm: number | null;
  /** the transport is playing and we know which beat is which */
  running: boolean;
}

export class ClockFollower {
  private times: number[] = [];
  private positions: number[] = [];   // in pulses from the song's start (or from the first pulse heard)
  private pos = -1;                   // position of the last pulse
  private phaseKnown = false;
  private playing = false;
  private fit: { a: number; m: number } | null = null;   // time = a + m · position

  /** Feed every incoming MIDI message; returns true when it was a clock message */
  message(data: Uint8Array | number[], t: number): boolean {
    const s = data[0];
    if (s === 0xf8) { this.pulse(t); return true; }
    if (s === 0xfa) {   // Start: the next pulse is the song's first
      this.pos = -1; this.phaseKnown = true; this.playing = true; this.resetFit(); return true;
    }
    if (s === 0xfb) { this.playing = true; return true; }                  // Continue, from where it was
    if (s === 0xfc) { this.playing = false; return true; }                 // Stop
    if (s === 0xf2 && data.length >= 3) {                                  // Song Position, in sixteenths
      this.pos = ((data[2] << 7) | data[1]) * (PPQ / 4) - 1;
      this.phaseKnown = true;
      this.resetFit();
      return true;
    }
    return false;
  }

  private resetFit() { this.times = []; this.positions = []; this.fit = null; }

  private pulse(t: number) {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && t - last > LOST_MS) this.resetFit();   // came back after a gap
    this.pos++;
    this.times.push(t);
    this.positions.push(this.pos);
    if (this.times.length > WINDOW) { this.times.shift(); this.positions.shift(); }
    this.fit = this.times.length >= MIN_FIT ? lineFit(this.positions, this.times) : null;
  }

  state(now: number): ClockState {
    const last = this.times[this.times.length - 1];
    const synced = last !== undefined && now - last < LOST_MS;
    return {
      synced,
      bpm: synced && this.fit ? 60_000 / (this.fit.m * PPQ) : null,
      running: synced && this.playing && this.phaseKnown && this.fit !== null,
    };
  }

  /** While running: the time (performance.now's clock) of a beat, counted from the song's start */
  timeAtBeat(beat: number): number | null {
    return this.fit ? this.fit.a + this.fit.m * beat * PPQ : null;
  }

  /** While running: the beat at a time, fractional */
  beatAt(t: number): number | null {
    return this.fit ? (t - this.fit.a) / this.fit.m / PPQ : null;
  }
}

/** Least squares: y = a + m·x */
function lineFit(x: number[], y: number[]): { a: number; m: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const m = sxx ? sxy / sxx : 0;
  return { a: my - m * mx, m };
}

// ─── The timebase the looper follows ──────────────────────────────────────────

export interface Timebase {
  timeAtBeat(beat: number): number | null;
  beatAt(t: number): number | null;
}

let _timebase: (() => Timebase | null) = () => null;
/** Where the loop asks for the beat: a running clock, or null to keep its own time */
export function setTimebase(get: () => Timebase | null): void { _timebase = get; }
export function timebase(): Timebase | null { return _timebase(); }
