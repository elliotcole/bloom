// Bloom lanes — the six parallel lists, each at its own length, with a cursor
// per list as it cycles. Each press leaves a short trace of what it changed.

import { stepName } from '../lib/intervals';
import { formatFigure, isFigure } from '../lib/figures';
import { Bloom } from '../core/Bloom';
import { flatNotes } from '../lib/arrays';
import type { Theme } from './theme';
import type { Shift } from '../audio/playhead';

export type LaneKey = 'notes' | 'time' | 'vel' | 'chan' | 'iv' | 'fig';
export type LaneMode = 'pitch' | 'time' | 'vel' | 'chan' | 'iv' | 'fig' | null;

const LANE_H = 24;
const LABEL_W = 70;
const TRACE_MS = 1400;
export const LANES_HEIGHT = 6 * LANE_H + 10;

const LANES: { key: LaneKey; name: string; mode: LaneMode; freeze?: 'pitch' | 'time' | 'vel' | 'chan' | 'iv' }[] = [
  { key: 'notes', name: 'pitch', mode: 'pitch', freeze: 'pitch' },
  { key: 'time',  name: 'time',  mode: 'time', freeze: 'time' },
  { key: 'vel',   name: 'vel',   mode: 'vel',  freeze: 'vel' },
  { key: 'chan',  name: 'chan',  mode: 'chan', freeze: 'chan' },
  { key: 'iv',    name: 'int',   mode: 'iv',   freeze: 'iv' },
  { key: 'fig',   name: 'fig',   mode: 'fig' }
];

const MODE = '#e8a33a';
const ICE = '#7ab8e8';
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameOf = (m: number) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
const FRACS: Record<string, string> = {
  '0.0625': '1/16', '0.125': '⅛', '0.25': '¼', '0.375': '⅜', '0.5': '½', '0.75': '¾',
  '1': '1', '1.5': '1½', '2': '2', '3': '3', '4': '4',
};
const fmtT = (t: number) => FRACS[String(Math.round(t * 1e4) / 1e4)] ?? t.toFixed(2);
const chanHue = (c: number) => (c * 360) / 16;

/**
 * A chit's hue for every cell of every lane, so equal values wear one colour
 * and a list's pattern shows at a glance (-1: none, as a rest or an empty
 * step). Pitch by pitch class round the wheel; time and velocity from cool
 * (short, soft) to warm (long, loud) through the values in use; channels by
 * channel; intervals and figures a colour each, spread apart.
 */
/** What each cell of each lane says, as the lanes write it */
export function chitLabels(b: Bloom): Record<LaneKey, string[]> {
  return {
    notes: b.notes.map(nt => { const ps = flatNotes([nt]) as number[]; return nameOf(ps[0]) + (ps.length > 1 ? '+' : ''); }),
    time: b.timeIntervals.map(fmtT),
    vel: b.velocities.map(String),
    chan: b.chans.map(String),
    iv: b.intervals.map(s => stepName(s)),
    fig: b.figures.map(f => (isFigure(f) ? formatFigure(f) : '.')),
  };
}

export function chitHues(b: Bloom): Record<LaneKey, number[]> {
  const ramp = (xs: number[], skip = (_: number) => false) => {
    const vals = [...new Set(xs.filter(x => !skip(x)))].sort((p, q) => p - q);
    return xs.map(x => skip(x) ? -1 : vals.length < 2 ? 210 : 210 - (200 * vals.indexOf(x)) / (vals.length - 1));
  };
  const each = (xs: unknown[], none: (x: unknown) => boolean) => {
    const keys: string[] = [];
    return xs.map(x => {
      if (none(x)) return -1;
      const k = JSON.stringify(x);
      if (!keys.includes(k)) keys.push(k);
      return (keys.indexOf(k) * 137.5 + 20) % 360;   // the golden angle: neighbours far apart
    });
  };
  return {
    notes: b.notes.map(nt => (((Math.round((flatNotes([nt]) as number[])[0]) % 12) + 12) % 12) * 30),
    time: ramp(b.timeIntervals.map(t => Math.round(t * 1e4) / 1e4)),
    vel: ramp(b.velocities, v => v <= 0),
    chan: b.chans.map(chanHue),
    iv: each(b.intervals, x => (Array.isArray(x) ? x : [x]).every(v => v === 0)),
    fig: each(b.figures, x => !isFigure(x as never)),
  };
}
const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const amber = (a: number) => `rgba(232,163,58,${Math.max(0, Math.min(1, a))})`;

interface Snapshot { notes: string[]; time: number[]; vel: number[]; chan: number[]; iv: string[]; fig: string[] }

function snapshot(b: Bloom): Snapshot {
  return {
    notes: b.notes.map(n => JSON.stringify(n)),
    time: [...b.timeIntervals], vel: [...b.velocities], chan: [...b.chans],
    iv: b.intervals.map(s => stepName(s)),
    fig: b.figures.map(formatFigure),
  };
}

export class Lanes {
  private last: Snapshot | null = null;
  private changed: Record<LaneKey, Set<number>> | null = null;
  private changedAt = 0;

  /** Call with each new committed state; whatever differs from the previous one gets a trace. */
  observe(b: Bloom): void {
    const now = snapshot(b);
    const prev = this.last;
    this.last = now;
    if (!prev) return;
    const diff = <T>(a: T[], z: T[]) => {
      const s = new Set<number>();
      z.forEach((v, i) => { if (a.length !== z.length || a[i] !== v) s.add(i); });
      return s;
    };
    const changed = {
      notes: diff(prev.notes, now.notes), time: diff(prev.time, now.time),
      vel: diff(prev.vel, now.vel), chan: diff(prev.chan, now.chan), iv: diff(prev.iv, now.iv), fig: diff(prev.fig, now.fig),
    };
    if (Object.values(changed).some(s => s.size)) {
      this.changed = changed;
      this.changedAt = performance.now();
    }
  }

  /** Forget the previous state (e.g. a new bloom), so the next change isn't traced against it. */
  reset(b: Bloom): void { this.last = snapshot(b); this.changed = null; }

  /**
   * Each lane is its own list at its own length. The time lane is drawn to
   * scale; the others in equal cells. `tick` is the running count of notes
   * played (-1 when stopped): each lane's cursor sits at tick mod its length,
   * so lists of different lengths visibly cycle against each other. `shift`
   * puts a list's cursor where a loop that kept its place through edits has it.
   */
  draw(
    ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number,
    b: Bloom, theme: Theme, mode: LaneMode, tick: number, progress: number, voice?: string, shift?: Shift,
  ): void {
    const n = b.notes.length;
    if (!n || !b.timeIntervals.length || !b.velocities.length || !b.chans.length || !b.intervals.length || !b.figures.length) return;
    const fade = this.changed ? Math.max(0, 1 - (performance.now() - this.changedAt) / TRACE_MS) : 0;
    if (fade === 0) this.changed = null;

    const len: Record<LaneKey, number> = {
      notes: n, time: b.timeIntervals.length, vel: b.velocities.length, chan: b.chans.length,
      iv: b.intervals.length, fig: b.figures.length,
    };
    const heat = {
      notes: null as number[] | null,
      time: b.breezeHeat('time'), vel: b.breezeHeat('vel'), chan: b.breezeHeat('chan'), iv: b.breezeHeat('iv'),
      fig: null as number[] | null,
    };
    // pitch heat is per flat note; fold chords to their hottest tone
    const ph = b.breezeHeat('pitch');
    if (ph) {
      let k = 0;
      heat.notes = b.notes.map(nt => {
        const c = Array.isArray(nt) ? (flatNotes([nt]) as number[]).length : 1;
        const h = Math.max(...ph.slice(k, k + c), 0); k += c; return h;
      });
    }

    const hues = chitHues(b);

    // cell edges per lane, as fractions of the lane's width
    const times = b.timeIntervals.map(t => Math.max(0.0001, t));
    const totalT = times.reduce((a, t) => a + t, 0);
    const edges = (k: LaneKey): number[] => {
      const e = [0];
      if (k === 'time') { let acc = 0; for (const t of times) { acc += t; e.push(acc / totalT); } }
      else for (let i = 1; i <= len[k]; i++) e.push(i / len[k]);
      return e;
    };
    const innerW = w - LABEL_W - 8;
    const X = (f: number) => x0 + LABEL_W + f * innerW;

    ctx.save();
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x0, y0, w, LANES_HEIGHT);
    ctx.globalAlpha = 1;
    // two voices: whose lanes these are, down the left edge
    if (voice) {
      ctx.fillStyle = ink(0.12);
      ctx.fillRect(x0, y0 + 4, 12, LANES_HEIGHT - 8);
      ctx.fillStyle = ink(0.8);
      ctx.textAlign = 'center';
      ctx.fillText(voice, x0 + 6, y0 + LANES_HEIGHT / 2);
    }
    const nameX = x0 + (voice ? 16 : 8);

    LANES.forEach((L, r) => {
      const top = y0 + 4 + r * LANE_H, mid = top + (LANE_H - 3) / 2;
      const active = mode === L.mode;
      const frozen = !!L.freeze && !!b.frozen[L.freeze];
      if (active) { ctx.fillStyle = amber(0.07); ctx.fillRect(x0, top, w, LANE_H - 3); }
      ctx.textAlign = 'left';
      ctx.fillStyle = active ? MODE : frozen ? ICE : ink(0.45);
      // intervals in scale steps are marked °
      const name = L.name;
      ctx.fillText(`${frozen ? '❄ ' : ''}${name}`, nameX, mid);
      ctx.fillStyle = ink(0.25);
      ctx.textAlign = 'right';
      ctx.fillText(`×${len[L.key]}`, x0 + LABEL_W - 6, mid);
      ctx.textAlign = 'left';

      const E = edges(L.key);
      const cur = tick >= 0 ? (tick + (L.key === 'notes' ? 0 : shift?.[L.key] ?? 0)) % len[L.key] : -1;
      for (let li = 0; li < len[L.key]; li++) {
        const cx0 = X(E[li]) + 1, cx1 = X(E[li + 1]) - 1, cw = cx1 - cx0;
        if (cw <= 0) continue;
        ctx.fillStyle = ink(li % 2 ? 0.05 : 0.075);
        ctx.fillRect(cx0, top + 1, cw, LANE_H - 5);

        const h = heat[L.key]?.[li] ?? 0;
        if (h > 0.05) { ctx.fillStyle = amber(0.18 * Math.min(1, h)); ctx.fillRect(cx0, top + 1, cw, LANE_H - 5); }
        if (fade > 0 && this.changed![L.key].has(li)) {
          ctx.strokeStyle = amber(fade); ctx.lineWidth = 1.5;
          ctx.strokeRect(cx0 + 0.5, top + 1.5, cw - 1, LANE_H - 6); ctx.lineWidth = 1;
        }
        // this list's own cursor
        if (li === cur) {
          ctx.fillStyle = ink(0.16);
          ctx.fillRect(cx0, top + 1, cw * Math.max(0.04, progress), LANE_H - 5);
          ctx.strokeStyle = ink(0.7); ctx.lineWidth = 1;
          ctx.strokeRect(cx0 + 0.5, top + 1.5, cw - 1, LANE_H - 6);
        }
        if (cw < 14) continue;

        ctx.save();
        ctx.beginPath(); ctx.rect(cx0, top, cw, LANE_H); ctx.clip();
        const a = li === cur ? 1 : 0.8;
        // the chit: equal values, one colour
        let tx = cx0 + 4;
        if (L.key === 'vel') {
          const v = b.velocities[li];
          const bh = (LANE_H - 9) * v / 127;
          ctx.fillStyle = ink(0.25); ctx.fillRect(cx0 + 2, top + LANE_H - 6 - bh, 3, bh);
          tx = cx0 + 8;
        }
        const hue = hues[L.key][li];
        if (hue >= 0 && cw >= 22) {
          ctx.fillStyle = `hsla(${hue},70%,55%,0.9)`;
          ctx.beginPath(); ctx.arc(tx + 4, mid, 4, 0, Math.PI * 2); ctx.fill();
          tx += 12;
        }
        ctx.fillStyle = ink(a);
        if (L.key === 'notes') {
          const ps = flatNotes([b.notes[li]]) as number[];
          ctx.fillText(ps.length > 1 ? nameOf(ps[0]) + '+' : nameOf(ps[0]), tx, mid);
        } else if (L.key === 'time') {
          ctx.fillText(fmtT(b.timeIntervals[li]), tx, mid);
        } else if (L.key === 'vel') {
          ctx.fillText(String(b.velocities[li]), tx, mid);
        } else if (L.key === 'iv') {
          const step = b.intervals[li];
          const ivs = (Array.isArray(step) ? step : [step]).filter(x => x !== 0);
          ctx.fillStyle = ink(ivs.length ? a : 0.3);
          ctx.fillText(stepName(step), tx, mid);
        } else if (L.key === 'fig') {
          const f = b.figures[li];
          ctx.fillStyle = ink(isFigure(f) ? a : 0.3);
          ctx.fillText(isFigure(f) ? formatFigure(f) : '.', tx, mid);
        } else {
          ctx.fillText(String(b.chans[li]), tx, mid);
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  /** True while a trace is still fading. */
  get tracing(): boolean { return this.changed !== null; }
}
