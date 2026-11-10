// Where a loop is in each list, kept through edits. A loop reads every list
// at its tick (each wrapping at its own length), so a change to a list's
// length would move it to another place. Instead the loop keeps its place: an
// edit ahead of where a list has got to is heard as it comes, one behind it
// waits for the next time round, and nothing jumps. The notes set the tick
// (their place is tick % length, so the cycle still starts on the first note);
// every other list carries a shift from the tick, applied by playedView.

import type { Bloom } from '../core/Bloom';

export type ShiftKey = 'vel' | 'time' | 'chan' | 'iv' | 'fig';
export type Shift = Record<ShiftKey, number>;
type Seen = Record<'notes' | ShiftKey, string[]>;

export const NO_SHIFT: Shift = { vel: 0, time: 0, chan: 0, iv: 0, fig: 0 };
const FIELD: Record<ShiftKey, 'velocities' | 'timeIntervals' | 'chans' | 'intervals' | 'figures'> =
  { vel: 'velocities', time: 'timeIntervals', chan: 'chans', iv: 'intervals', fig: 'figures' };
const KEYS = Object.keys(FIELD) as ShiftKey[];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Each list as it stands, an item a string (notes and steps may be chords) */
export function seenOf(b: Bloom): Seen {
  const s = (a: unknown[]) => a.map(x => JSON.stringify(x));
  return { notes: s(b.notes), vel: s(b.velocities), time: s(b.timeIntervals), chan: s(b.chans), iv: s(b.intervals), fig: s(b.figures) };
}

/**
 * The place in `after` that keeps `pos` in `before` (the index to play next):
 * past the edit, it moves with what follows; at or before it, it stays, so
 * what was put in there plays next; inside what was replaced, as far in as
 * the new part goes. An edit that keeps the length moves nothing.
 */
export function keepPlace(before: string[], after: string[], pos: number): number {
  const a = before.length, b = after.length;
  if (!b) return 0;
  if (a === b) return pos % b;
  let p = 0;
  while (p < a && p < b && before[p] === after[p]) p++;
  let s = 0;
  while (s < a - p && s < b - p && before[a - 1 - s] === after[b - 1 - s]) s++;
  const at = pos <= p ? pos : pos >= a - s ? pos + b - a : Math.min(pos, b - s);
  return mod(at, b);
}

export interface Place { tick: number; shift: Shift; seen: Seen }

/** The loop's place after the bloom changed from what it had seen */
export function follow(place: Place, b: Bloom): Place {
  const now = seenOf(b);
  const { seen, shift } = place;
  let tick = place.tick;
  const n0 = seen.notes.length, n1 = now.notes.length;
  if (n0 && n1 && n0 !== n1) {
    const pos = mod(tick, n0);
    tick = Math.floor(tick / n0) * n1 + keepPlace(seen.notes, now.notes, pos);
  }
  const next = { ...shift };
  for (const k of KEYS) {
    const l0 = seen[k].length, l1 = now[k].length;
    if (!l1) { next[k] = 0; continue; }
    const pos = l0 ? mod(place.tick + shift[k], l0) : 0;
    next[k] = mod(keepPlace(seen[k], now[k], pos) - tick, l1);
  }
  return { tick, shift: next, seen: now };
}

/** The bloom as the loop reads it: each list turned by its shift, so reading it at the tick reads its place */
export function playedView(b: Bloom, shift: Shift): Bloom {
  if (KEYS.every(k => !shift[k])) return b;
  const view = Object.create(b) as Bloom;
  for (const k of KEYS) {
    if (!shift[k]) continue;
    const f = FIELD[k];
    Object.defineProperty(view, f, {
      get: () => {
        const a = b[f] as unknown[];
        const r = a.length ? mod(shift[k], a.length) : 0;
        return r ? [...a.slice(r), ...a.slice(0, r)] : a;
      },
      set: (v: unknown[]) => { (b as unknown as Record<string, unknown>)[f] = v; },
    });
  }
  return view;
}
