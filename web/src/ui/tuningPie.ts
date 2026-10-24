// The tuning view's picture: the bloom's tuning as a pie of its twelve notes,
// C at the top as in the set view. Each slice reaches halfway to its
// neighbours, so its width shows how much room the tuning gives that note, and
// its rim dot sits at the note's exact pitch (12-TET's places are ticks outside).
// Slices light up as their pitch class plays; clicking one selects it.

import type { Bloom } from '../core/Bloom';
import { flatNotes, wrapAt } from '../lib/arrays';
import { spell } from '../lib/numbers';
import { degreeRatio, deviations, editable, readable } from '../lib/tuning';
import type { Theme } from './theme';

/** Selected degrees (from the root), drawn outlined, the interval as a chord */
export interface PieMarks { a: number | null; b: number | null }

/** Where each degree sits, in radians (C at the top, clockwise), from the bloom's tuning and root */
function angles(bloom: Bloom): number[] {
  const t = editable(bloom.tuning);
  const off = bloom.tuningRoot * 100 * t.period / 1200;
  return t.cents.map(c => ((off + c) / t.period) * Math.PI * 2 - Math.PI / 2);
}

/** The slice edges: halfway between each degree and its neighbours, in angle order */
function slices(bloom: Bloom): { deg: number; mid: number; from: number; to: number }[] {
  const ang = angles(bloom);
  const order = ang.map((a, deg) => ({ deg, a })).sort((x, y) => x.a - y.a);
  const TAU = Math.PI * 2;
  return order.map((o, k) => {
    const prev = order[(k + 11) % 12].a - (k === 0 ? TAU : 0);
    const next = order[(k + 1) % 12].a + (k === 11 ? TAU : 0);
    return { deg: o.deg, mid: o.a, from: (prev + o.a) / 2, to: (o.a + next) / 2 };
  });
}

/** The degree whose slice holds the point (in the picture's coordinates), or -1 */
export function degreeAt(bloom: Bloom, cx: number, cy: number, R: number, x: number, y: number): number {
  const d = Math.hypot(x - cx, y - cy);
  if (d > R * 1.3 || d < R * 0.12) return -1;
  const TAU = Math.PI * 2;
  const a = Math.atan2(y - cy, x - cx);
  for (const s of slices(bloom)) {
    const rel = ((a - s.from) % TAU + TAU) % TAU;
    if (rel <= s.to - s.from) return s.deg;
  }
  return -1;
}

export function drawTuningPie(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number,
  bloom: Bloom, flashValues: number[], theme: Theme, marks: PieMarks,
): void {
  const t = editable(bloom.tuning);
  const root = bloom.tuningRoot;
  const dev = deviations(bloom.tuning, root);
  const degOf = (p: number) => ((p - root) % 12 + 12) % 12;

  // each degree's flash, loudness and use in the bloom
  const flash = new Float32Array(12), vel = new Float32Array(12), count = new Int32Array(12);
  for (let i = 0; i < bloom.notes.length; i++) {
    const v = bloom.notes[i];
    for (const p of flatNotes([v])) {
      const d = degOf(Math.round(p));
      flash[d] = Math.max(flash[d], flashValues[i] ?? 0);
      vel[d] = Math.max(vel[d], wrapAt(bloom.velocities, i));
      count[d]++;
    }
  }

  const font = Math.max(9, Math.min(14, R * 0.06));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 12-TET's places, faintly, outside the rim
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02);
    ctx.lineTo(cx + Math.cos(a) * R * 1.07, cy + Math.sin(a) * R * 1.07);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = theme.blendMode;
  for (const s of slices(bloom)) {
    const d = s.deg, pc = (root + d) % 12, f = flash[d];
    const [h, sat, l] = theme.noteHsla(pc, count[d] ? Math.max(vel[d], 60) : 40, f);
    const r = R * (1 + f * 0.07);
    const selected = d === marks.a || d === marks.b;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, s.from, s.to);
    ctx.closePath();
    if (!theme.strokeOnly) {
      const base = count[d] ? 0.16 : 0.05;
      ctx.fillStyle = `hsla(${h},${sat}%,${l}%,${base + f * 0.6})`;
      ctx.fill();
    }
    ctx.strokeStyle = selected ? theme.accent : `hsla(${h},${sat}%,${l}%,${0.25 + f * 0.6})`;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    if (f > 0.05 && theme.glowScale > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, s.from + 0.01, s.to - 0.01);
      ctx.strokeStyle = `hsla(${h},${sat}%,${l}%,${f * 0.5})`;
      ctx.lineWidth = 4 * theme.glowScale;
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // the note's exact place on the rim, its name and deviation outside, its ratio inside
  const ang = angles(bloom);
  for (let d = 0; d < 12; d++) {
    const a = ang[d], f = flash[d], pc = (root + d) % 12;
    const [h, sat, l] = theme.noteHsla(pc, 100, f);
    const at = (k: number) => [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k] as const;
    const [x, y] = at(1 + f * 0.07);
    ctx.fillStyle = `hsla(${h},${sat}%,${Math.min(90, l + 15)}%,${0.7 + f * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, (d === 0 ? 4.5 : 3) + f * 3, 0, Math.PI * 2);
    ctx.fill();
    if (d === 0) {   // the root, ringed
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 8 + f * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const selected = d === marks.a || d === marks.b;
    const [nx, ny] = at(1.16);
    ctx.font = `${selected ? 'bold ' : ''}${font * 1.15}px monospace`;
    ctx.fillStyle = selected || f > 0.3 ? theme.accent : theme.text;
    ctx.fillText(spell(pc), nx, ny);
    const dv = dev[pc];
    const [dx, dy] = [nx, ny + font * 1.3];
    ctx.font = `${font * 0.85}px monospace`;
    ctx.fillStyle = theme.text;
    ctx.globalAlpha = 0.7;
    ctx.fillText(Math.abs(dv) < 0.05 ? '0' : `${dv > 0 ? '+' : '−'}${Math.abs(dv).toFixed(1)}`, dx, dy);
    const ratio = degreeRatio(t, d);
    const [rx, ry] = at(0.74);
    ctx.font = `${font * 0.85}px monospace`;
    ctx.globalAlpha = 0.55 + f * 0.45;
    ctx.fillText(readable(ratio) ? ratio : `${t.cents[d].toFixed(0)}¢`, rx, ry);
    ctx.globalAlpha = 1;
  }

  // the interval being looked at, as a chord across the pie
  if (marks.a !== null && marks.b !== null) {
    const [a, b] = [ang[marks.a], ang[marks.b]];
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(b) * R, cy + Math.sin(b) * R);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // the tuning's name at the centre
  ctx.fillStyle = theme.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.text;
  ctx.font = `${font}px monospace`;
  const name = t.name.length > 22 ? `${t.name.slice(0, 21)}…` : t.name;
  ctx.fillText(`${name}${bloom.tuning?.edited ? ' *' : ''}`, cx, cy - font * 0.7);
  ctx.globalAlpha = 0.6;
  ctx.fillText(`root ${spell(root)}`, cx, cy + font * 0.8);
  ctx.globalAlpha = 1;
}
