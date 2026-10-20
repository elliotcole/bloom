// Bloom lanes — the four parallel lists drawn on one time axis, two loop passes
// wide so phasing shows. Each press leaves a short trace of what it changed.

import { Bloom } from '../core/Bloom';
import { flatNotes } from '../lib/arrays';
import type { Theme } from './theme';

type LaneKey = 'notes' | 'time' | 'vel' | 'chan';
export type LaneMode = 'time' | 'vel' | 'chan' | null;

const PASSES = 2;
const LANE_H = 24;
const LABEL_W = 70;
const TRACE_MS = 1400;
export const LANES_HEIGHT = 4 * LANE_H + 10;

const LANES: { key: LaneKey; name: string; mode: LaneMode; freeze: 'pitch' | 'time' | 'vel' | 'chan' }[] = [
  { key: 'notes', name: 'pitch', mode: null,   freeze: 'pitch' },
  { key: 'time',  name: 'time',  mode: 'time', freeze: 'time' },
  { key: 'vel',   name: 'vel',   mode: 'vel',  freeze: 'vel' },
  { key: 'chan',  name: 'chan',  mode: 'chan', freeze: 'chan' },
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
const wrap = <T>(a: T[], i: number): T => a[((i % a.length) + a.length) % a.length];
const chanHue = (c: number) => (c * 360) / 16;
const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const amber = (a: number) => `rgba(232,163,58,${Math.max(0, Math.min(1, a))})`;

interface Snapshot { notes: string[]; time: number[]; vel: number[]; chan: number[] }

function snapshot(b: Bloom): Snapshot {
  return {
    notes: b.notes.map(n => JSON.stringify(n)),
    time: [...b.timeIntervals], vel: [...b.velocities], chan: [...b.chans],
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
      vel: diff(prev.vel, now.vel), chan: diff(prev.chan, now.chan),
    };
    if (Object.values(changed).some(s => s.size)) {
      this.changed = changed;
      this.changedAt = performance.now();
    }
  }

  /** Forget the previous state (e.g. a new bloom), so the next change isn't traced against it. */
  reset(b: Bloom): void { this.last = snapshot(b); this.changed = null; }

  draw(
    ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number,
    b: Bloom, theme: Theme, mode: LaneMode, playIndex: number, playProgress: number,
  ): void {
    const n = b.notes.length;
    if (!n || !b.timeIntervals.length || !b.velocities.length || !b.chans.length) return;
    const fade = this.changed ? Math.max(0, 1 - (performance.now() - this.changedAt) / TRACE_MS) : 0;
    if (fade === 0) this.changed = null;

    // Timeline: the looper advances every list by its own running count, so
    // lists of other lengths line up differently on the second pass.
    const len: Record<LaneKey, number> = {
      notes: n, time: b.timeIntervals.length, vel: b.velocities.length, chan: b.chans.length,
    };
    const evs: { pass: number; i: number; tick: number; t: number; dt: number; vel: number; chan: number; note: unknown }[] = [];
    let total = 0;
    for (let p = 0; p < PASSES; p++) for (let i = 0; i < n; i++) {
      const tick = p * n + i;
      const dt = Math.max(0.0001, wrap(b.timeIntervals, tick));
      evs.push({ pass: p, i, tick, t: total, dt, vel: wrap(b.velocities, tick), chan: wrap(b.chans, tick), note: b.notes[i] });
      total += dt;
    }
    const X = (t: number) => x0 + LABEL_W + (t / total) * (w - LABEL_W - 8);
    const heat = {
      notes: null as number[] | null,
      time: b.breezeHeat('time'), vel: b.breezeHeat('vel'), chan: b.breezeHeat('chan'),
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
      ctx.fillText(`${frozen ? '❄ ' : ''}${L.name}`, x0 + 8, mid);
      ctx.fillStyle = ink(0.25);
      ctx.textAlign = 'right';
      ctx.fillText(`×${len[L.key]}`, x0 + LABEL_W - 6, mid);
      ctx.textAlign = 'left';

      for (const e of evs) {
        const cx0 = X(e.t) + 1, cx1 = X(e.t + e.dt) - 1, cw = cx1 - cx0;
        if (cw <= 0) continue;
        const li = L.key === 'notes' ? e.i : e.tick % len[L.key];
        const cycle = Math.floor(e.tick / len[L.key]);
        // alternate shading per cycle of this list: where it changes, the list wrapped
        ctx.fillStyle = ink(cycle % 2 ? 0.03 : 0.065);
        ctx.fillRect(cx0, top + 1, cw, LANE_H - 5);
        if (li === 0) { ctx.fillStyle = active ? MODE : ink(0.3); ctx.fillRect(cx0, top + 1, 2, LANE_H - 5); }

        const h = heat[L.key]?.[li] ?? 0;
        if (h > 0.05) { ctx.fillStyle = amber(0.18 * Math.min(1, h)); ctx.fillRect(cx0, top + 1, cw, LANE_H - 5); }
        if (fade > 0 && this.changed![L.key].has(li)) {
          ctx.strokeStyle = amber(fade); ctx.lineWidth = 1.5;
          ctx.strokeRect(cx0 + 0.5, top + 1.5, cw - 1, LANE_H - 6); ctx.lineWidth = 1;
        }
        if (e.pass === 0 && e.i === playIndex) {
          ctx.fillStyle = ink(0.12);
          ctx.fillRect(cx0, top + 1, cw * Math.max(0.04, playProgress), LANE_H - 5);
        }
        if (cw < 14) continue;

        const dim = e.pass ? 0.5 : 1;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx0, top, cw, LANE_H); ctx.clip();
        ctx.fillStyle = ink(0.8 * dim);
        if (L.key === 'notes') {
          const ps = flatNotes([e.note] as Parameters<typeof flatNotes>[0]) as number[];
          ctx.fillText(ps.length > 1 ? nameOf(ps[0]) + '+' : nameOf(ps[0]), cx0 + 4, mid);
        } else if (L.key === 'time') {
          ctx.fillText(fmtT(e.dt), cx0 + 4, mid);
        } else if (L.key === 'vel') {
          const bh = (LANE_H - 9) * e.vel / 127;
          ctx.fillStyle = ink(0.25 * dim); ctx.fillRect(cx0 + 2, top + LANE_H - 6 - bh, 3, bh);
          ctx.fillStyle = ink(0.8 * dim); ctx.fillText(String(e.vel), cx0 + 8, mid);
        } else {
          ctx.fillStyle = `hsla(${chanHue(e.chan)},70%,55%,${0.9 * dim})`;
          ctx.beginPath(); ctx.arc(cx0 + 8, mid, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = ink(0.8 * dim); ctx.fillText(String(e.chan), cx0 + 16, mid);
        }
        ctx.restore();
      }
    });

    // the pass boundary
    const p2 = evs[n];
    if (p2) {
      ctx.strokeStyle = ink(0.3); ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(X(p2.t), y0 + 2); ctx.lineTo(X(p2.t), y0 + LANES_HEIGHT - 4); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** True while a trace is still fading. */
  get tracing(): boolean { return this.changed !== null; }
}
