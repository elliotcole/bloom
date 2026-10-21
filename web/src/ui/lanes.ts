// Bloom lanes — the five parallel lists, each at its own length, with a cursor
// per list as it cycles. Each press leaves a short trace of what it changed.

import { Bloom } from '../core/Bloom';
import { flatNotes } from '../lib/arrays';
import type { Theme } from './theme';

type LaneKey = 'notes' | 'time' | 'vel' | 'chan' | 'iv';
export type LaneMode = 'pitch' | 'time' | 'vel' | 'chan' | 'iv' | null;

const LANE_H = 24;
const LABEL_W = 70;
const TRACE_MS = 1400;
export const LANES_HEIGHT = 5 * LANE_H + 10;

const LANES: { key: LaneKey; name: string; mode: LaneMode; freeze: 'pitch' | 'time' | 'vel' | 'chan' | 'iv' }[] = [
  { key: 'notes', name: 'pitch', mode: 'pitch', freeze: 'pitch' },
  { key: 'time',  name: 'time',  mode: 'time', freeze: 'time' },
  { key: 'vel',   name: 'vel',   mode: 'vel',  freeze: 'vel' },
  { key: 'chan',  name: 'chan',  mode: 'chan', freeze: 'chan' },
  { key: 'iv',    name: 'int',   mode: 'iv',   freeze: 'iv' },
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
const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const amber = (a: number) => `rgba(232,163,58,${Math.max(0, Math.min(1, a))})`;

interface Snapshot { notes: string[]; time: number[]; vel: number[]; chan: number[]; iv: string[] }

function snapshot(b: Bloom): Snapshot {
  return {
    notes: b.notes.map(n => JSON.stringify(n)),
    time: [...b.timeIntervals], vel: [...b.velocities], chan: [...b.chans],
    iv: b.intervals.map(s => JSON.stringify(s)),
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
      vel: diff(prev.vel, now.vel), chan: diff(prev.chan, now.chan), iv: diff(prev.iv, now.iv),
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
   * so lists of different lengths visibly cycle against each other.
   */
  draw(
    ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number,
    b: Bloom, theme: Theme, mode: LaneMode, tick: number, progress: number,
  ): void {
    const n = b.notes.length;
    if (!n || !b.timeIntervals.length || !b.velocities.length || !b.chans.length || !b.intervals.length) return;
    const fade = this.changed ? Math.max(0, 1 - (performance.now() - this.changedAt) / TRACE_MS) : 0;
    if (fade === 0) this.changed = null;

    const len: Record<LaneKey, number> = {
      notes: n, time: b.timeIntervals.length, vel: b.velocities.length, chan: b.chans.length,
      iv: b.intervals.length,
    };
    const heat = {
      notes: null as number[] | null,
      time: b.breezeHeat('time'), vel: b.breezeHeat('vel'), chan: b.breezeHeat('chan'), iv: b.breezeHeat('iv'),
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

    LANES.forEach((L, r) => {
      const top = y0 + 4 + r * LANE_H, mid = top + (LANE_H - 3) / 2;
      const active = mode === L.mode;
      const frozen = !!b.frozen[L.freeze];
      if (active) { ctx.fillStyle = amber(0.07); ctx.fillRect(x0, top, w, LANE_H - 3); }
      ctx.textAlign = 'left';
      ctx.fillStyle = active ? MODE : frozen ? ICE : ink(0.45);
      // intervals in scale steps are marked °
      const name = L.key === 'iv' && b.intervalsDiatonic ? `${L.name}°` : L.name;
      ctx.fillText(`${frozen ? '❄ ' : ''}${name}`, x0 + 8, mid);
      ctx.fillStyle = ink(0.25);
      ctx.textAlign = 'right';
      ctx.fillText(`×${len[L.key]}`, x0 + LABEL_W - 6, mid);
      ctx.textAlign = 'left';

      const E = edges(L.key);
      const cur = tick >= 0 ? tick % len[L.key] : -1;
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
        ctx.fillStyle = ink(a);
        if (L.key === 'notes') {
          const ps = flatNotes([b.notes[li]]) as number[];
          ctx.fillText(ps.length > 1 ? nameOf(ps[0]) + '+' : nameOf(ps[0]), cx0 + 4, mid);
        } else if (L.key === 'time') {
          ctx.fillText(fmtT(b.timeIntervals[li]), cx0 + 4, mid);
        } else if (L.key === 'vel') {
          const v = b.velocities[li];
          const bh = (LANE_H - 9) * v / 127;
          ctx.fillStyle = ink(0.25); ctx.fillRect(cx0 + 2, top + LANE_H - 6 - bh, 3, bh);
          ctx.fillStyle = ink(a); ctx.fillText(String(v), cx0 + 8, mid);
        } else if (L.key === 'iv') {
          const step = b.intervals[li];
          const ivs = (Array.isArray(step) ? step : [step]).filter(x => x !== 0);
          ctx.fillStyle = ink(ivs.length ? a : 0.3);
          ctx.fillText(ivs.length ? ivs.map(x => (x > 0 ? `+${x}` : String(x))).join(' ') : '·', cx0 + 4, mid);
        } else {
          const c = b.chans[li];
          ctx.fillStyle = `hsla(${chanHue(c)},70%,55%,0.9)`;
          ctx.beginPath(); ctx.arc(cx0 + 8, mid, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = ink(a); ctx.fillText(String(c), cx0 + 16, mid);
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  /** True while a trace is still fading. */
  get tracing(): boolean { return this.changed !== null; }
}
