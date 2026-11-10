import { describe, it, expect } from 'vitest';
import { Bloom } from '../../core/Bloom';
import { onScreenSlot, keepsName } from '../onScreen';

const make = (notes: number[]) => { const b = new Bloom(); b.notes = notes; b.velocities = [80]; b.timeIntervals = [0.25]; b.chans = [0]; return b; };

describe('the slot on screen', () => {
  it('is the slot the bloom is, even renamed, and stays marked (changed) after an edit', () => {
    const a = make([60, 62]), b = make([64, 65]);
    const slots = [a, b, null];
    const live = b.clone();
    live.name = 'renamed';
    let o = onScreenSlot(live, slots, null, 0);
    expect(o).toEqual({ slot: b, same: true });
    live.notes = [64, 66];
    o = onScreenSlot(live, slots, o.slot, 0);
    expect(o).toEqual({ slot: b, same: false });
    o = onScreenSlot(live, [a, null], o.slot, 0);   // its slot deleted
    expect(o).toEqual({ slot: null, same: false });
  });

  it('prefers the cursor when two slots are alike', () => {
    const a = make([60]), a2 = make([60]);
    expect(onScreenSlot(a.clone(), [a, a2], null, 1).slot).toBe(a2);
  });
});

describe('keepsName', () => {
  const a = new Bloom(), b = new Bloom();
  it('changed, back into its own slot: kept; into another, or inserted: lost', () => {
    const changed = { slot: a, same: false };
    expect(keepsName(changed, a, false)).toBe(true);
    expect(keepsName(changed, b, false)).toBe(false);
    expect(keepsName(changed, null, false)).toBe(false);
    expect(keepsName(changed, a, true)).toBe(false);
    expect(keepsName({ slot: null, same: false }, null, false)).toBe(false);
  });
  it('unchanged: kept anywhere', () => {
    expect(keepsName({ slot: a, same: true }, b, true)).toBe(true);
  });
});
