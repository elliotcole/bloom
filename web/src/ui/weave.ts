// Weave — the performance as cloth.
//
// The warp runs down the picture: a group of threads per list in use (pitch,
// time, vel, chan, and int and fig when the bloom has them), one thread per
// entry. The weft is the notes as they sound: one row per note, as tall as
// the note's time, in its pitch class's colour, as bright as its velocity.
// In each group the weft shows (floats over the warp) only at the cell that
// list is on, so a list of 7 lays a diagonal of one slope and a list of 11
// another: the phasing comes out as twill, and their interference as moiré.
// A rest is a row of bare warp. A conjunction (every list back at its start)
// draws a line across the cloth and knots the selvedge. The cloth grows for
// as long as the session plays and can be saved as one image.

import { Bloom } from '../core/Bloom';
import { rings, lcm } from './orrery';
import type { RingKey } from './orrery';
import type { Theme } from './theme';

/** Where one list was when a row was woven */
export interface Thread { key: RingKey; idx: number; len: number }

/** One row of the cloth: one note's worth */
export interface Row {
  /** the event index in the bloom (for selection) */
  i: number;
  tick: number;
  /** beats: the row's height */
  dur: number;
  /** the pitches that sounded; none for a rest */
  notes: number[];
  /** the pitches intervals added */
  extra: number[];
  vel: number;
  chan: number;
  threads: Thread[];
  /** every list at its start */
  conj: boolean;
}

/** The warp's layout: a group of `len` threads per list, from x0 to x1 */
export interface Group { key: RingKey; name: string; len: number; x0: number; x1: number }

/** The notes it takes for the cloth's pattern to repeat: the lists' least common multiple */
export function weavePeriod(b: Bloom): number {
  const R = rings(b);
  return R.length ? lcm(R.map(r => r.len)) : 1;
}

/** The row woven when event `index` sounds at `tick`: what sounded, and where every list was */
export function weaveRow(b: Bloom, index: number, tick: number): Row {
  const threads = rings(b).map(r => ({ key: r.key, idx: ((tick % r.len) + r.len) % r.len, len: r.len }));
  const row: Row = {
    i: index, tick, dur: 1, notes: [], extra: [], vel: 0, chan: 1, threads,
    conj: threads.length > 0 && threads.every(t => t.idx === 0),
  };
  const n = b.notes.length;
  if (!n || !b.timeIntervals.length || index < 0 || index >= n) return row;
  const view = b.sounding(tick - index);   // a raga's notes as they sound this cycle
  row.dur = Math.max(0.02, b.stepAt(index, tick));
  for (const s of view.soundsAt(index, tick)) {
    if (s.added) row.extra.push(...s.notes);
    else {
      row.notes.push(...s.notes);
      if (!row.vel) { row.vel = s.vel; row.chan = s.chan; }
    }
  }
  return row;
}

/** `count` rows from `tick` on, as the loop would weave them */
export function weaveRows(b: Bloom, tick: number, count: number): Row[] {
  const n = b.notes.length;
  if (!n) return [];
  const out: Row[] = [];
  for (let t = tick; t < tick + count; t++) out.push(weaveRow(b, ((t % n) + n) % n, t));
  return out;
}

/** The warp across `w` from `x`: a group per list, wide in proportion to its length (a short list still gets room), a gap between */
export function warp(b: Bloom, x: number, w: number): Group[] {
  const R = rings(b);
  if (!R.length) return [];
  const gap = R.length > 1 ? w * 0.02 : 0;
  const inner = w - gap * (R.length - 1);
  const weights = R.map(r => Math.min(24, Math.max(3, r.len)));
  const total = weights.reduce((a, c) => a + c, 0);
  let cx = x;
  return R.map((r, k) => {
    const gw = (inner * weights[k]) / total;
    const g: Group = { key: r.key, name: r.name, len: r.len, x0: cx, x1: cx + gw };
    cx += gw + gap;
    return g;
  });
}

/** A row's height in px: its beats at `pxPerBeat`, never under 2px, a long note or rest capped at 8 beats */
export function rowHeight(dur: number, pxPerBeat: number): number {
  return Math.max(2, Math.min(dur, 8) * pxPerBeat);
}

/** The px per beat that lays `rows` out in `h` */
export function fitWeave(rows: Row[], h: number): number {
  const beats = rows.reduce((a, r) => a + Math.min(r.dur, 8), 0);
  return beats > 0 ? h / beats : 1;
}

type Hit = (i: number, x: number, y: number, r: number) => void;

const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const pcOf = (m: number) => ((Math.round(m) % 12) + 12) % 12;
const SELVEDGE = 8;

/**
 * Draw the cloth in the box x, y, w, h: the newest row at the bottom, older
 * rows up from it until they run out or leave the top. `progress` (0..1) is
 * how far the shuttle has carried the newest row across.
 */
export function drawWeaveAt(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  rows: Row[],
  flash: number[] = [],
  theme: Theme,
  pxPerBeat: number,
  progress = 1,
  hit?: Hit,
): void {
  const labels = h >= 80;
  const labelH = labels ? 14 : 0;
  const ch = h - labelH;
  const groups = warp(bloom, x + SELVEDGE, w - SELVEDGE * 2);
  if (!groups.length) return;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;

  // the warp: a faint thread per entry
  for (const g of groups) {
    const cw = (g.x1 - g.x0) / g.len;
    if (cw < 2.5) {
      ctx.fillStyle = ink(0.04);
      ctx.fillRect(g.x0, y, g.x1 - g.x0, ch);
      continue;
    }
    ctx.strokeStyle = ink(0.08);
    ctx.beginPath();
    for (let c = 0; c < g.len; c++) {
      const xc = Math.round(g.x0 + (c + 0.5) * cw) + 0.5;
      ctx.moveTo(xc, y);
      ctx.lineTo(xc, y + ch);
    }
    ctx.stroke();
  }

  // the weft, newest row at the bottom
  const byKey = new Map(groups.map(g => [g.key, g]));
  let yb = y + ch;
  for (let k = rows.length - 1; k >= 0 && yb > y; k--) {
    const row = rows[k];
    const newest = k === rows.length - 1;
    const rh = rowHeight(row.dur, pxPerBeat);
    const yt = Math.max(y, yb - rh);
    const f = newest ? (flash[row.i] ?? 0) : 0;
    const shuttle = newest && progress < 1;
    if (shuttle) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, yt, w * Math.max(0, progress), yb - yt);
      ctx.clip();
    }

    // a conjunction: a line across the cloth, a knot at the selvedge
    if (row.conj) {
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(yt) + 0.5);
      ctx.lineTo(x + w, Math.round(yt) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x, yt, SELVEDGE * 0.5, Math.max(2, Math.min(rh, SELVEDGE)));
    }

    if (!row.notes.length) { if (shuttle) ctx.restore(); yb = yt; continue; }   // a rest: bare warp

    const low = Math.min(...row.notes);
    const [hh, s, l, a] = theme.noteHsla(pcOf(low), row.vel, f);
    const weft = `hsla(${hh},${s}%,${l}%,${Math.min(1, a + 0.25)})`;

    // the thread crossing between groups
    const ym = Math.round((yt + yb) / 2) + 0.5;
    ctx.strokeStyle = `hsla(${hh},${s}%,${l}%,${Math.min(1, a + 0.25) * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(x, ym);
    ctx.lineTo(groups[0].x0, ym);
    for (let gi = 0; gi + 1 < groups.length; gi++) { ctx.moveTo(groups[gi].x1, ym); ctx.lineTo(groups[gi + 1].x0, ym); }
    ctx.moveTo(groups[groups.length - 1].x1, ym);
    ctx.lineTo(x + w, ym);
    ctx.stroke();

    // a float per list at the cell it is on
    for (const t of row.threads) {
      const g = byKey.get(t.key);
      if (!g) continue;
      const cw = (g.x1 - g.x0) / t.len;   // the row's own length: a transform changes the slope, not the past
      const fx = g.x0 + t.idx * cw;
      const fw = Math.max(1, cw - 1), fh = Math.max(1, yb - yt - 1);
      if (t.key === 'notes') {
        const m = row.notes.length;
        const sub = fh / m;
        row.notes.slice().sort((p, q) => q - p).forEach((p, ci) => {   // highest on top
          const [h2, s2, l2, a2] = theme.noteHsla(pcOf(p), row.vel, f);
          const col = `hsla(${h2},${s2}%,${l2}%,${Math.min(1, a2 + 0.25)})`;
          if (theme.strokeOnly) { ctx.strokeStyle = col; ctx.strokeRect(fx + 1, yt + 1 + ci * sub, fw - 1, Math.max(1, sub - 1)); }
          else { ctx.fillStyle = col; ctx.fillRect(fx + 0.5, yt + 0.5 + ci * sub, fw, Math.max(1, sub - (m > 1 ? 1 : 0))); }
        });
        if (row.extra.length) {   // what intervals added: an outline over the float
          ctx.strokeStyle = ink(0.7);
          ctx.strokeRect(fx + 1.5, yt + 1.5, Math.max(1, fw - 2), Math.max(1, fh - 2));
        }
        hit?.(row.i, fx + cw / 2, (yt + yb) / 2, Math.max(6, Math.min(cw, rh) / 2));
      } else {
        if (theme.strokeOnly) { ctx.strokeStyle = weft; ctx.strokeRect(fx + 1, yt + 1, fw - 1, fh - 1); }
        else { ctx.fillStyle = weft; ctx.fillRect(fx + 0.5, yt + 0.5, fw, fh); }
      }
      if (f > 0.1 && theme.glowScale > 0) {
        ctx.strokeStyle = `hsla(${hh},100%,88%,${f * 0.7})`;
        ctx.strokeRect(fx - 0.5, yt - 0.5, fw + 2, fh + 2);
      }
    }
    if (shuttle) ctx.restore();
    yb = yt;
  }

  // the groups' names and lengths along the hem
  if (labels) {
    ctx.fillStyle = ink(0.35);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const g of groups) ctx.fillText(`${g.name} ×${g.len}`, (g.x0 + g.x1) / 2, y + h - 1);
  }
  ctx.restore();
}

/** The whole cloth as one image: the newest 7000 rows at most, no taller than 16000px */
export function weaveImage(bloom: Bloom, rows: Row[], theme: Theme, width = 1200): HTMLCanvasElement {
  const kept = rows.slice(-7000);
  const px = Math.min(16, fitWeave(kept, 16000 - 60));
  const H = 60 + kept.reduce((a, r) => a + rowHeight(r.dur, px), 0);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.ceil(H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  drawWeaveAt(ctx, 30, 20, width - 60, c.height - 40, bloom, kept, [], theme, px, 1);
  return c;
}
