// One filter-list for the pickers (scales, tunings, patterns): a field to type
// in, the rows that match under it, one of them active. ↑↓ move, ↵ or a click
// chooses, esc closes. A picker says what its rows are for what's typed, how a
// row looks and what choosing one does; the rest is here.

import { Overlay, onKeys } from './overlay';

/** True when `text` has every word of `query` (any case); nothing typed matches all */
export function hasWords(text: string, query: string): boolean {
  const t = text.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(w => t.includes(w));
}

/** The rows of a picker and which is active: no DOM, so it can be tested */
export class FilterList<T> {
  items: T[] = [];
  /** The active row's index, -1 with no rows */
  active = -1;

  /** New rows (what's typed changed): the active one is `start` when it's among them, else the first */
  fill(items: T[], start = -1): void {
    this.items = items;
    this.active = !items.length ? -1 : start >= 0 && start < items.length ? start : 0;
  }

  /** ↑↓: one row along, stopping at the ends */
  move(d: 1 | -1): void {
    if (this.items.length) this.active = Math.max(0, Math.min(this.items.length - 1, this.active + d));
  }

  /** Make row `i` the active one (the mouse over it); false when there's no such row */
  point(i: number): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return false;
    this.active = i;
    return true;
  }

  /** The active row, undefined with none */
  current(): T | undefined { return this.items[this.active]; }
}

export interface PickerOptions {
  /** the root's id (the picker's own CSS hangs on it) */
  id: string;
  hint: string;
  placeholder: string;
}

export abstract class Picker<T> extends Overlay {
  protected readonly box: HTMLElement;
  /** The line holding the field: a picker can put more beside it */
  protected readonly top: HTMLElement;
  protected readonly input: HTMLInputElement;
  protected readonly listEl: HTMLElement;
  private readonly list = new FilterList<T>();
  private rowEls: HTMLElement[] = [];

  protected constructor(opts: PickerOptions) {
    super(document.createElement('div'), { backdrop: true });
    this.el.id = opts.id;
    this.el.className = 'picker';
    this.el.innerHTML = `
      <div class="picker-box">
        <div class="cp-hint"></div>
        <div class="picker-top"><input class="cp-input" type="text" spellcheck="false" autocomplete="off"></div>
        <div class="picker-list"></div>
      </div>`;
    this.box = this.el.querySelector('.picker-box')!;
    this.top = this.el.querySelector('.picker-top')!;
    this.input = this.el.querySelector('input')!;
    this.listEl = this.el.querySelector('.picker-list')!;
    this.el.querySelector('.cp-hint')!.textContent = opts.hint;
    this.input.placeholder = opts.placeholder;
    this.input.addEventListener('input', () => this.render());
    onKeys(this.input, {
      Escape: () => this.close(),
      ArrowDown: () => { this.list.move(1); this.paint(); },
      ArrowUp: () => { this.list.move(-1); this.paint(); },
      Enter: () => this.pick(this.list.active),
    });
  }

  /** The rows for what's typed, in the order shown */
  protected abstract rows(query: string): T[];
  /** A row's element (rowEl makes the usual one) */
  protected abstract row(item: T): HTMLElement;
  /** Choose a row; false keeps the picker open */
  protected abstract choose(item: T): boolean;
  /** The row to start on among `items`, -1 for the first */
  protected start(_items: T[]): number { return -1; }
  /** A header to put over a row when it differs from the row before's */
  protected group(_item: T): string | null { return null; }
  /** The active row changed (or the rows did): undefined with no rows */
  protected activeChanged(_item: T | undefined): void { /* nothing more to show */ }

  /** The usual row: a name and what it is */
  protected rowEl(name: string, desc: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cp-sug';
    el.innerHTML = '<span class="cp-sug-name"></span><span class="cp-sug-desc"></span>';
    el.querySelector('.cp-sug-name')!.textContent = name;
    el.querySelector('.cp-sug-desc')!.textContent = desc;
    return el;
  }

  /** Show it with nothing typed, the keyboard in the field */
  protected openList(): void {
    this.input.value = '';
    this.render();
    this.show(this.input);
  }

  /** Lay the rows out again for what's typed */
  protected render(): void {
    const items = this.rows(this.input.value);
    this.list.fill(items, this.start(items));
    this.listEl.innerHTML = '';
    let head: string | null = null;
    this.rowEls = items.map((item, i) => {
      const g = this.group(item);
      if (g !== null && g !== head) {
        const h = document.createElement('div');
        h.className = 'picker-group';
        h.textContent = g;
        this.listEl.appendChild(h);
      }
      head = g;
      const el = this.row(item);
      el.addEventListener('mousemove', () => { if (this.list.active !== i && this.list.point(i)) this.paint(); });
      el.addEventListener('click', () => this.pick(i));
      this.listEl.appendChild(el);
      return el;
    });
    this.paint();
  }

  /** Mark the active row and bring it into view */
  private paint(): void {
    this.rowEls.forEach((el, i) => el.classList.toggle('active', i === this.list.active));
    this.rowEls[this.list.active]?.scrollIntoView({ block: 'nearest' });
    this.activeChanged(this.list.current());
  }

  private pick(i: number): void {
    if (!this.list.point(i)) return;
    this.paint();
    if (this.choose(this.list.items[i])) this.close();
  }
}
