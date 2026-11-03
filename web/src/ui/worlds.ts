// A colour for each tuning, so the garden shows at a glance which "world" each
// bloom lives in, and the ◊ badge wears the same colour. A tuning's colour comes
// from its name (the same tuning keeps its colour from session to session); two
// tunings in the garden that would share one are moved apart, so within the
// garden each tuning's colour is its own. 12-TET, the default, has none.

import type { Bloom } from '../core/Bloom';

/** Well-spaced hues, ordered so neighbours differ */
const HUES = [200, 30, 140, 300, 55, 250, 0, 170, 90, 330, 220, 15];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The tuning a bloom keeps (its world): its name, or null for 12-TET */
export function worldOf(b: Bloom | null): string | null {
  return b?.tuning?.name ?? null;
}

/**
 * A hue for each tuning named, in order of first appearance: each starts at its
 * name's own hue and moves on to the next free one when that's taken. Past
 * twelve tunings, colours repeat.
 */
export function worldHues(names: (string | null)[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const name of names) {
    if (name === null || out.has(name)) continue;
    let k = hash(name) % HUES.length;
    for (let tries = 0; tries < HUES.length && taken.has(k); tries++) k = (k + 1) % HUES.length;
    taken.add(k);
    out.set(name, HUES[k]);
  }
  return out;
}

/** The colour of a world's hue */
export function worldColor(hue: number, alpha = 1): string {
  return `hsla(${hue}, 70%, 62%, ${alpha})`;
}
