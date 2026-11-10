// Which garden slot the bloom on screen came from: the slot it is (lifted or
// just saved), or, once it's been changed, the slot it was last. The garden
// marks it (gardenVisualization), filled while the bloom is still that slot,
// hollow once changed.

import type { Bloom } from '../core/Bloom';
import { bloomToJSON } from '../io/garden-io';

/** What the bloom sounds and looks like, its name and colour aside (renaming it doesn't make it another) */
function sig(b: Bloom): string {
  const { name: _n, color: _c, colorLevel: _l, ...rest } = bloomToJSON(b) as unknown as Record<string, unknown>;
  return JSON.stringify(rest);
}

export interface OnScreen { slot: Bloom | null; same: boolean }

/**
 * The slot the live bloom is (the cursor's first, then the one it was, then
 * any), or failing that the one it was while that's still in the garden.
 */
export function onScreenSlot(live: Bloom, slots: (Bloom | null)[], was: Bloom | null, cursor: number): OnScreen {
  const notes = live.notes.join();
  const mine = sig(live);
  const order = [slots[cursor] ?? null, was, ...slots];
  for (const s of order) {
    if (s && slots.includes(s) && s.notes.join() === notes && sig(s) === mine) return { slot: s, same: true };
  }
  return was && slots.includes(was) ? { slot: was, same: false } : { slot: null, same: false };
}

/**
 * Whether a named bloom keeps its name when saved over `target` (inserting
 * when `insert`): unchanged it does anywhere, changed only back into the slot
 * it came from. Saved changed into another slot it's a new bloom, unnamed.
 */
export function keepsName(o: OnScreen, target: Bloom | null, insert: boolean): boolean {
  return o.same || (!insert && o.slot !== null && target === o.slot);
}
