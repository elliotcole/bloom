// cmd-z takes back a change to the garden: a save over a slot, a delete, an insert
import { describe, expect, it } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { Garden } from '../../garden';
import { sameSlots, slotsOf, undoGardenStep } from '../gardenHistory';
import type { GardenStep } from '../gardenHistory';

const bloom = (n: number) => new Bloom([n], [80], [1], [0]);

/** Do something to the garden and return the step it made, as keys.ts records it */
function change(g: Garden, fn: () => void): GardenStep {
  const before = slotsOf(g), cursor = g.cursor;
  fn();
  return { before, after: slotsOf(g), cursor };
}

describe('the garden in the undo history', () => {
  it('moving past the end is no change', () => {
    const g = new Garden();
    g.save(bloom(60));
    const was = slotsOf(g);
    g.forward(); g.forward(); g.back();
    expect(sameSlots(slotsOf(g), was)).toBe(true);
  });

  it('a save over a slot comes back, and goes forward again', () => {
    const g = new Garden();
    g.save(bloom(60));
    const keeper = g.current;
    const step = change(g, () => g.save(bloom(72)));
    expect(g.current).not.toBe(keeper);
    const redo = undoGardenStep(g, step)!;
    expect(g.current).toBe(keeper);
    undoGardenStep(g, redo);
    expect(g.current!.notes).toEqual([72]);
  });

  it('a deleted slot comes back where it was, the cursor on it', () => {
    const g = new Garden();
    g.save(bloom(60)); g.forward(); g.save(bloom(62)); g.forward(); g.save(bloom(64));
    g.back();
    const step = change(g, () => g.clear());
    expect(slotsOf(g).map(s => s!.notes[0])).toEqual([60, 64]);
    g.forward();   // wander off
    undoGardenStep(g, step);
    expect(slotsOf(g).map(s => s!.notes[0])).toEqual([60, 62, 64]);
    expect(g.cursor).toBe(1);
  });

  it('an insert is taken out again', () => {
    const g = new Garden();
    g.save(bloom(60));
    const step = change(g, () => g.insert(bloom(59)));
    expect(slotsOf(g).length).toBe(2);
    undoGardenStep(g, step);
    expect(slotsOf(g).map(s => s!.notes[0])).toEqual([60]);
  });

  it('a garden changed since (by the other voice) is left alone', () => {
    const g = new Garden();
    g.save(bloom(60));
    const step = change(g, () => g.save(bloom(72)));
    g.forward(); g.save(bloom(48));
    expect(undoGardenStep(g, step)).toBeNull();
    expect(slotsOf(g).map(s => s!.notes[0])).toEqual([72, 48]);
  });
});
