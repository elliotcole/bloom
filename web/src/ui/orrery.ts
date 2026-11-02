// Orrery — each list a ring turning at its own period.
//
// The pitches are the outer ring, then the times, the dynamics, the channels,
// and the intervals and figures when the bloom has them. A ring has one cell
// per entry, so a list of 7 and a list of 11 turn at different speeds: each
// ring's hand sits at tick mod its length (and sweeps through the current
// cell as the note sounds), so you watch the lists drift apart and come round
// together. The moment they all point up at once is the conjunction; the
// centre says how many notes until the next one.

import { Bloom } from '../core/Bloom';
import { flatNotes } from '../lib/arrays';
import { isFigure } from '../lib/figures';
import type { Theme } from './theme';

export type RingKey = 'notes' | 'time' | 'vel' | 'chan' | 'iv' | 'fig';
export interface Ring { key: RingKey; name: string; len: number }

/** The rings in use, outermost first: pitch, time, dynamics, channels, then intervals and figures when the bloom has them */
export function rings(b: Bloom): Ring[] {
  const out: Ring[] = [
    { key: 'notes', name: 'pitch', len: b.notes.length },
    { key: 'time', name: 'time', len: b.timeIntervals.length },
    { key: 'vel', name: 'vel', len: b.velocities.length },
    { key: 'chan', name: 'chan', len: b.chans.length },
  ];
  if (b.hasIntervals()) out.push({ key: 'iv', name: 'int', len: b.intervals.length });
  if (b.hasFigures()) out.push({ key: 'fig', name: 'fig', len: b.figures.length });
  return out.filter(r => r.len > 0);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The least common multiple: the notes it takes for every list to come round together */
export function lcm(lengths: number[]): number {
  return lengths.reduce((acc, n) => (acc * n) / gcd(acc, n), 1);
}

/** Notes until every ring is back at its start together: 0 at a conjunction, never negative */
export function untilConjunction(lengths: number[], tick: number): number {
  const period = lcm(lengths);
  return tick < 0 ? 0 : (period - (tick % period)) % period;
}

/**
 * Where a ring's hand points: round the circle by tick mod len cells, plus
 * `progress` (0..1) of the current cell. Radians, 0 at the top, clockwise.
 * A stopped ring (tick < 0) rests at the top.
 */
export function handAngle(len: number, tick: number, progress = 0): number {
  if (tick < 0 || len <= 0) return 0;
  return ((tick % len + Math.min(1, Math.max(0, progress))) / len) * Math.PI * 2;
}

type Hit = (i: number, x: number, y: number, r: number) => void;

const TOP = -Math.PI / 2;
const chanHue = (c: number) => (c * 360) / 16;
const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameOf = (m: number) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

function arc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, w: number, style: string): void {
  if (a1 <= a0 || w <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.lineWidth = w;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/**
 * Draw the orrery. `bloom` is the bloom as written (its lists at their own
 * lengths, not spelled out for a cycle); `tick` the running count of notes
 * played (-1 stopped); `progress` how far through the current note.
 */
export function drawOrreryAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flash: number[] = [],
  theme: Theme,
  tick = -1,
  progress = 0,
  showLabels = false,
  hit?: Hit,
): void {
  const b = bloom.sounding();   // a raga's notes as they sound
  const R = rings(b);
  if (!R.length) return;
  const n = b.notes.length;

  // Bands: the pitch ring is the widest, the others equal, a gap between
  const outer = radius;
  const pitchBand = radius * 0.2;
  const band = radius * 0.075;
  const gap = radius * 0.03;
  const bandOf = (k: number): [number, number] => {
    if (k === 0) return [outer - pitchBand, outer];
    const top = outer - pitchBand - gap - (k - 1) * (band + gap);
    return [top - band, top];
  };
  const lengths = R.map(r => r.len);
  const period = lcm(lengths);
  const conjunction = tick >= 0 && tick % period === 0;
  const playing = tick >= 0;

  // pitch spread within the pitch band
  const pitches = flatNotes(b.notes) as number[];
  const lo = Math.min(...pitches), hi = Math.max(...pitches);
  const maxT = Math.max(...b.timeIntervals, 0.0001);
  const vels = b.velocities;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.font = `${Math.max(8, Math.round(radius * 0.045))}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  R.forEach((ring, k) => {
    const [r0, r1] = bandOf(k);
    const rm = (r0 + r1) / 2, w = r1 - r0;
    const L = ring.len;
    const cell = (Math.PI * 2) / L;
    const g = Math.min(0.03, cell * 0.2);   // the gap between cells
    const cur = playing ? tick % L : -1;

    // the ring's faint track, and its name at the top
    arc(ctx, cx, cy, rm, 0, Math.PI * 2, 0.75, ink(0.07));

    for (let i = 0; i < L; i++) {
      const a0 = TOP + i * cell + g / 2, a1 = TOP + (i + 1) * cell - g / 2;
      const isCur = i === cur;
      const base = isCur ? 0.75 : 0.3;
      switch (ring.key) {
        case 'notes': {
          // the cell's floor, then a dot per pitch at its height
          arc(ctx, cx, cy, r0 + 1, a0, a1, 1, ink(isCur ? 0.3 : 0.1));
          const f = flash[i] ?? 0;
          const am = (a0 + a1) / 2;
          const chord = flatNotes([b.notes[i]]) as number[];
          const vel = vels.length ? vels[(playing ? tick - (tick % n) + i : i) % vels.length] ?? 90 : 90;
          chord.forEach((p, ci) => {
            const h = hi > lo ? (p - lo) / (hi - lo) : 0.5;
            const rr = r0 + 4 + h * (w - 8);
            const a = am + (ci - (chord.length - 1) / 2) * Math.min(0.06, cell * 0.25);
            const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
            const [hh, s, l, al] = theme.noteHsla(((Math.round(p) % 12) + 12) % 12, vel, f);
            const dot = 3 + radius * 0.012 + f * 3;
            if (ci === 0) hit?.(i, x, y, Math.max(9, dot + 3));
            ctx.beginPath();
            ctx.arc(x, y, dot, 0, Math.PI * 2);
            if (theme.strokeOnly) { ctx.lineWidth = 1; ctx.strokeStyle = `hsla(${hh},${s}%,${l}%,${al})`; ctx.stroke(); }
            else { ctx.fillStyle = `hsla(${hh},${s}%,${l}%,${Math.min(1, al + 0.4)})`; ctx.fill(); }
            if (f > 0.1 && theme.glowScale > 0) {
              ctx.beginPath(); ctx.arc(x, y, dot + 2 + f * 4, 0, Math.PI * 2);
              ctx.lineWidth = 1; ctx.strokeStyle = `hsla(${hh},100%,90%,${f * 0.6})`; ctx.stroke();
            }
            if (showLabels) {
              ctx.fillStyle = ink(0.55);
              ctx.fillText(nameOf(p), cx + Math.cos(a) * (r1 + radius * 0.05), cy + Math.sin(a) * (r1 + radius * 0.05));
            }
          });
          break;
        }
        case 'time': {
          // a dash as long as the duration, against the longest
          const t = b.timeIntervals[i];
          const frac = Math.max(0.12, Math.min(1, t / maxT));
          arc(ctx, cx, cy, rm, a0, a1, w, ink(0.06));
          arc(ctx, cx, cy, rm, a0, a0 + (a1 - a0) * frac, w * 0.6, ink(base));
          break;
        }
        case 'vel': {
          // thickness and weight by velocity
          const v = vels[i] / 127;
          arc(ctx, cx, cy, rm, a0, a1, w, ink(0.06));
          arc(ctx, cx, cy, rm, a0, a1, Math.max(1, w * v), ink(0.12 + v * (isCur ? 0.75 : 0.45)));
          break;
        }
        case 'chan': {
          const c = b.chans[i];
          arc(ctx, cx, cy, rm, a0, a1, w * 0.6, `hsla(${chanHue(c)},70%,55%,${isCur ? 0.95 : 0.55})`);
          break;
        }
        case 'iv': {
          const step = b.intervals[i];
          const has = (Array.isArray(step) ? step : [step]).some(x => x !== 0);
          arc(ctx, cx, cy, rm, a0, a1, has ? w * 0.6 : 1, ink(has ? base : 0.12));
          break;
        }
        case 'fig': {
          const has = isFigure(b.figures[i]);
          arc(ctx, cx, cy, rm, a0, a1, has ? w * 0.6 : 1, ink(has ? base : 0.12));
          break;
        }
      }
    }

    // the hand: a radial line across the band, a bead at its outer edge
    const ha = TOP + handAngle(L, tick, progress);
    const alpha = playing ? 0.9 : 0.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ha) * (r0 - gap * 0.4), cy + Math.sin(ha) * (r0 - gap * 0.4));
    ctx.lineTo(cx + Math.cos(ha) * (r1 + gap * 0.4), cy + Math.sin(ha) * (r1 + gap * 0.4));
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ha) * (r1 + gap * 0.4), cy + Math.sin(ha) * (r1 + gap * 0.4), 2, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();

    // the ring's name and length, to the left of the start line
    ctx.fillStyle = ink(0.35);
    ctx.textAlign = 'right';
    ctx.fillText(`${ring.name} ×${L}`, cx - radius * 0.03, cy - rm);
    ctx.textAlign = 'center';
  });

  // the start line all the hands leave from, bright at a conjunction and fading as the note goes
  const innermost = bandOf(R.length - 1)[0] - gap;
  const glow = conjunction ? Math.max(0, 1 - progress) : 0;
  ctx.beginPath();
  ctx.moveTo(cx, cy - innermost);
  ctx.lineTo(cx, cy - outer - gap);
  ctx.lineWidth = 1 + glow * 2;
  ctx.strokeStyle = ink(0.12 + glow * 0.8);
  ctx.stroke();
  if (glow > 0 && theme.glowScale > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outer + gap, 0, Math.PI * 2);
    ctx.lineWidth = 1 + glow * 3;
    ctx.strokeStyle = ink(glow * 0.35);
    ctx.stroke();
  }

  // the centre: the lengths, and the notes until they next come round together
  ctx.fillStyle = ink(0.4);
  ctx.font = `${Math.max(9, Math.round(radius * 0.06))}px ui-monospace, Menlo, monospace`;
  ctx.fillText(lengths.join(' · '), cx, cy - radius * 0.045);
  ctx.fillStyle = ink(0.25);
  const left = untilConjunction(lengths, tick);
  ctx.fillText(playing ? (left === 0 ? `together · ${period}` : `${left} → ${period}`) : `${period}`, cx, cy + radius * 0.045);
  ctx.restore();
}
