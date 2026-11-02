// Road — the notes as tiles on a road that comes at you, in five-point
// (fisheye) perspective.
//
// You stand on the road looking along it. What the loop will play next is
// laid out ahead, rising from the vanishing point at the centre, so the road
// ahead is drawn before it sounds and a transform visibly rewrites it. The
// tile that sounds passes under you; what has passed wraps round the rim and
// dissolves. A lane per channel; a tile per sound, as long as the note's
// time, lifted by its pitch, in its pitch class's colour, as bright as its
// velocity; a chord's tile is a shape with a side per note. An added note
// (intervals) is an outline; a figure's step a smaller tile.

import { Bloom } from '../core/Bloom';
import type { Theme } from './theme';

/** One sound on the road: `at` in beats from the reference onset (negative: past) */
export interface Tile {
  /** the event index in the bloom (for selection) */
  i: number;
  tick: number;
  at: number;
  /** beats long */
  dur: number;
  notes: number[];
  vel: number;
  chan: number;
  added?: boolean;
  figure?: boolean;
}

/**
 * The road ahead from `tick` (that note included): every sound until `beats`
 * have passed or `maxSteps` notes, onsets in beats from the first note's onset.
 * A rest leaves a gap. Nothing for an empty bloom.
 */
export function roadAhead(b: Bloom, tick: number, beats: number, maxSteps = 96): Tile[] {
  const n = b.notes.length;
  if (!n || !b.timeIntervals.length) return [];
  const out: Tile[] = [];
  let acc = 0;
  let view: Bloom | null = null, viewStart = -1;
  for (let j = 0; j < maxSteps && acc < beats; j++) {
    const t = tick + j;
    const idx = ((t % n) + n) % n;
    const cycleStart = t - idx;
    if (cycleStart !== viewStart) { view = b.sounding(cycleStart); viewStart = cycleStart; }
    const step = Math.max(0.0001, b.stepAt(idx, t));
    for (const s of view!.soundsAt(idx, t)) {
      out.push({
        i: idx, tick: t, at: acc + s.at,
        dur: Math.max(0.02, Math.min(s.gate, step - s.at)),
        notes: s.notes, vel: s.vel, chan: s.chan, added: s.added, figure: s.figure,
      });
    }
    acc += step;
  }
  return out;
}

/** A sounding step's tiles with their onsets from that step's own onset */
export function stepTiles(b: Bloom, index: number, tick: number): Tile[] {
  return roadAhead(b, tick, Infinity, 1).filter(t => t.i === index);
}

// ─── Five-point perspective ───────────────────────────────────────────────────
//
// The eye is at the origin looking along +z, the road at y = 1 below it.
// Equidistant (fisheye) projection: a point's angle off the view axis becomes
// its distance from the centre, so the vanishing point is the centre, things
// beside you are on a ring, and things behind you lie beyond it.

/** The whole field of view in degrees: FOV/2 reaches the picture's radius R */
export const FOV = 300;
const HALF = (FOV / 2) * (Math.PI / 180);

export interface Projected { x: number; y: number; theta: number }

export function project(x: number, y: number, z: number, cx: number, cy: number, R: number): Projected {
  const theta = Math.atan2(Math.hypot(x, y), z);
  const r = (R * theta) / HALF;
  const phi = Math.atan2(y, x);
  return { x: cx + Math.cos(phi) * r, y: cy + Math.sin(phi) * r, theta };
}

/** The shape of a tile for a chord of `size` notes, as (u, v) in the unit square: a single note fills it, a dyad is a diamond, a triad a triangle, four a hexagon, more a disc */
export function tileShape(size: number): [number, number][] {
  if (size <= 1) return [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (size === 2) return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  if (size === 3) return [[0, 0], [1, 0], [0.5, 1]];
  if (size === 4) return [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
  return Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * Math.PI * 2;
    return [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5] as [number, number];
  });
}

type Hit = (i: number, x: number, y: number, r: number) => void;

const ROAD_Y = 1;            // the road this far below the eye
const ROAD_HALF = 1;         // the road this wide either side
const HORIZON = 32;          // beats ahead that are drawn
const BEHIND = -2.2;         // beats behind that are drawn (then they're past the rim)
const SUBDIV = 5;            // segments per tile edge, so straight edges curve

const ink = (a: number) => `rgba(255,255,255,${Math.max(0, Math.min(1, a))})`;
const chanHue = (c: number) => (c * 360) / 16;

/** Subdivide a polygon's edges so the fisheye bends them */
function bend(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    for (let s = 0; s < SUBDIV; s++) {
      const f = s / SUBDIV;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

/**
 * Draw the road. `tiles` have `at` in beats from now (negative: already
 * sounded); the current tile (at <= 0 < at + dur) is lit by `flash` at its
 * index. `playing` false draws the bloom as a road from its start.
 */
export function drawRoadAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, R: number,
  bloom: Bloom,
  tiles: Tile[],
  flash: number[] = [],
  theme: Theme,
  playing = false,
  hit?: Hit,
): void {
  const chans = [...new Set(tiles.map(t => t.chan))].sort((a, b) => a - b);
  const lanes = Math.max(1, chans.length);
  const laneW = (ROAD_HALF * 2) / lanes;
  const laneX = (c: number) => -ROAD_HALF + chans.indexOf(c) * laneW;
  const P = (x: number, y: number, z: number) => project(x, y, z, cx, cy, R);
  const pitches = tiles.flatMap(t => t.notes);
  const lo = Math.min(...pitches, bloom.lowestPossibleNote), hi = Math.max(...pitches, bloom.highestPossibleNote);
  const lift = (p: number) => ROAD_Y * (1 - 0.4 * (hi > lo ? (p - lo) / (hi - lo) : 0.5));

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineJoin = 'round';

  // the road: lane edges running from behind you to the horizon, and a line across at every beat
  const zs: number[] = [];
  for (let z = BEHIND; z < 0; z += 0.1) zs.push(z);
  for (let k = 0; k <= 60; k++) zs.push(Math.pow(1.12, k) * 0.05);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let l = 0; l <= lanes; l++) {
    const x = -ROAD_HALF + l * laneW;
    ctx.beginPath();
    zs.forEach((z, k) => { const p = P(x, ROAD_Y, z); if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
  }
  // beat lines move with the music: where the beats fall relative to now
  const nowOffset = playing ? ((tiles.find(t => t.at <= 0 && t.at + t.dur > 0)?.at ?? 0) % 1 + 1) % 1 : 0;
  for (let bz = Math.ceil(BEHIND); bz < HORIZON; bz++) {
    const z = bz - nowOffset;
    if (z < BEHIND) continue;
    ctx.strokeStyle = ink(0.05 + 0.1 / (1 + Math.abs(z)));
    ctx.beginPath();
    for (let s = 0; s <= 8; s++) { const p = P(-ROAD_HALF + (s / 8) * ROAD_HALF * 2, ROAD_Y, z); if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }

  // the tiles, far to near, so the near ones paint over
  const drawn = tiles.filter(t => t.at < HORIZON && t.at + t.dur > BEHIND).sort((a, b) => b.at - a.at);
  const hitDone = new Set<number>();
  for (const t of drawn) {
    const z0 = Math.max(BEHIND, t.at), z1 = Math.min(HORIZON, t.at + t.dur);
    if (z1 <= z0) continue;
    const x0 = laneX(t.chan) + laneW * 0.08, x1 = laneX(t.chan) + laneW * 0.92;
    const inset = t.figure ? 0.25 : 0;
    const y = lift(Math.min(...t.notes));
    const current = t.at <= 0 && t.at + t.dur > 0;
    const f = current ? (flash[t.i] ?? 0) : 0;
    const [h, s, l, a] = theme.noteHsla(((Math.round(t.notes[0]) % 12) + 12) % 12, t.vel, f);
    // fog ahead, dissolving behind
    const near = 0.12 + 0.88 * Math.exp(-Math.max(0, t.at) / 5);
    const behind = t.at + t.dur <= 0 ? Math.max(0, 1 - (-(t.at + t.dur)) / -BEHIND) : 1;
    const alpha = Math.min(1, (a + 0.3) * near * behind);
    const shape = tileShape(t.notes.length);
    const poly = (yy: number) => bend(shape.map(([u, v]) => [x0 + inset * (x1 - x0) + u * (1 - 2 * inset) * (x1 - x0), z0 + inset * (z1 - z0) + v * (1 - 2 * inset) * (z1 - z0)] as [number, number]))
      .map(([x, z]) => P(x, yy, z));
    const trace = (pts: Projected[]) => { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };

    // its shadow on the road, then the tile at its height
    if (y < ROAD_Y - 0.01 && !t.added) {
      trace(poly(ROAD_Y));
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${alpha * 0.12})`;
      ctx.fill();
    }
    const pts = poly(y);
    trace(pts);
    if (t.added || theme.strokeOnly) {
      ctx.lineWidth = t.added ? 1 : 1.2;
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${alpha})`;
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${alpha})`;
      ctx.fill();
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = `hsla(${h},${s}%,${Math.min(98, l + 20)}%,${alpha * 0.6})`;
      ctx.stroke();
    }
    if (f > 0.1 && theme.glowScale > 0) {
      ctx.lineWidth = 1 + f * 3;
      ctx.strokeStyle = `hsla(${h},100%,92%,${f * 0.8})`;
      ctx.stroke();
    }
    // a lane's colour at its near edge, faint, so lanes read as channels
    if (lanes > 1 && current) {
      ctx.fillStyle = `hsla(${chanHue(t.chan)},70%,55%,0.25)`;
      const q = P((x0 + x1) / 2, ROAD_Y, Math.max(BEHIND, z0));
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // the first tile ahead with this index is where a click finds the event
    if (!t.added && !t.figure && t.at >= 0 && !hitDone.has(t.i)) {
      hitDone.add(t.i);
      const mx = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length, my = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
      const rr = Math.max(6, Math.max(...pts.map(p => Math.hypot(p.x - mx, p.y - my))) * 0.6);
      hit?.(t.i, mx, my, rr);
    }
  }

  // the ring where things pass beside you, and the vanishing point
  const rim = (R * (Math.PI / 2)) / HALF;
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, Math.PI * 2);
  ctx.strokeStyle = ink(0.08);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = ink(0.35);
  ctx.fill();
  ctx.restore();
}
