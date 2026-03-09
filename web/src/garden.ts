// Garden — array of saved bloom slots, navigated with arrow keys

import { Bloom } from './core/Bloom';

export type GardenSlot = Bloom | null;

export class Garden {
  slots: GardenSlot[];
  cursor: number;

  constructor() {
    this.slots = [null];
    this.cursor = 0;
  }

  get current(): GardenSlot {
    return this.slots[this.cursor] ?? null;
  }

  save(bloom: Bloom): void {
    this.slots[this.cursor] = bloom.clone();
  }

  lift(): Bloom | null {
    const s = this.slots[this.cursor];
    return s ? s.clone() : null;
  }

  clear(): void {
    this.slots[this.cursor] = null;
    // If slot was last and is now empty, remove it (if not the only slot)
    if (this.slots[this.cursor] === null && this.slots.length > 1) {
      this.slots.splice(this.cursor, 1);
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }

  /** Insert empty slot at cursor */
  insertEmpty(): void {
    this.slots.splice(this.cursor, 0, null);
  }

  /** Move to next slot. Creates new empty slot if at end. */
  forward(): boolean {
    this.cursor++;
    if (this.cursor >= this.slots.length) {
      this.slots.push(null);
    }
    return this.current !== null;
  }

  /** Move to previous slot (clamps at 0). */
  back(): boolean {
    this.cursor = Math.max(0, this.cursor - 1);
    return this.current !== null;
  }

  /** Jump to a new empty slot at the end. */
  jumpToEnd(): void {
    this.cursor = this.slots.length;
    this.slots.push(null);
  }

  get index(): number {
    return this.cursor;
  }

  get size(): number {
    return this.slots.length;
  }

  /** Blooms only (no nulls) for garden looper */
  get blooms(): Bloom[] {
    return this.slots.filter((s): s is Bloom => s instanceof Bloom);
  }

  toString(): string {
    return `[${this.cursor}/${this.slots.length - 1}]`;
  }
}
