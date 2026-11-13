// The garden in the undo history. A key that changes the garden's slots (a
// save, an insert, a delete, a load) is a step like any other: cmd-z puts the
// slots back as they were. Moving through the garden isn't a change, so the
// empty slot that moving past the end adds doesn't count.

import type { Garden, GardenSlot } from '../garden';

/** One change to the garden: the slots before and after, and where the cursor was */
export interface GardenStep { before: GardenSlot[]; after: GardenSlot[]; cursor: number }

/** The slots as they stand, the empty ones at the end left off */
export function slotsOf(g: Garden): GardenSlot[] {
  const s = [...g.slots];
  while (s.length > 1 && s[s.length - 1] === null) s.pop();
  return s;
}

export function sameSlots(a: GardenSlot[], b: GardenSlot[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Take a step back: the garden as it was before it, the cursor where it was.
 * Returns the step that goes forward again, or null when the garden is no
 * longer as the step left it (the other voice changed it since), in which
 * case nothing is touched.
 */
export function undoGardenStep(g: Garden, step: GardenStep): GardenStep | null {
  if (!sameSlots(slotsOf(g), step.after)) return null;
  const forward: GardenStep = { before: step.after, after: step.before, cursor: g.cursor };
  g.slots = [...step.before];
  g.cursor = Math.max(0, Math.min(step.cursor, g.slots.length - 1));
  return forward;
}
