// The tuning picker: every loaded tuning by name, chosen on purpose rather
// than stepped through (] [ sound each one on the way). Opened with l in
// tuning mode; type to filter, ↑↓ to move, ↵ or a click to choose, esc to
// close. Nothing sounds until a tuning is chosen.

import type { Tuning } from '../lib/tuning';
import { Overlay, onKeys } from './overlay';

export interface TuningPickerHost {
  /** The loaded tunings, 12-TET first */
  library(): Tuning[];
  /** The sounding tuning's name ('12-TET' when none) */
  current(): string;
  /** Make this the base under the same alterations */
  apply(t: Tuning): void;
}

/** The tunings whose name or description has every word typed, in library order */
export function filterTunings(lib: Tuning[], q: string): Tuning[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return lib.filter(t => words.every(w => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(w)));
}

export class TuningPicker extends Overlay {
  private input: HTMLInputElement;
  private listEl: HTMLElement;
  private rows: { t: Tuning; el: HTMLElement }[] = [];
  private active = -1;
  private host: TuningPickerHost;

  constructor(host: TuningPickerHost) {
    super(document.createElement('div'), { backdrop: true });
    this.host = host;
    this.el.id = 'tuning-picker';
    this.el.className = 'picker';
    this.el.innerHTML = `
      <div class="picker-box">
        <div class="cp-hint">type to filter · ↑↓ move · ↵ or click chooses · esc closes</div>
        <input class="cp-input" type="text" spellcheck="false" autocomplete="off" placeholder="tuning">
        <div class="sp-list"></div>
      </div>`;
    this.input = this.el.querySelector('input')!;
    this.listEl = this.el.querySelector('.sp-list')!;
    this.input.addEventListener('input', () => this.render());
    onKeys(this.input, {
      Escape: () => this.close(),
      ArrowDown: () => this.setActive(Math.min(this.rows.length - 1, this.active + 1)),
      ArrowUp: () => this.setActive(Math.max(0, this.active - 1)),
      Enter: () => this.choose(this.active),
    });
  }

  open(): void {
    this.input.value = '';
    this.render();
    this.show(this.input);
  }

  private render(): void {
    const cur = this.host.current();
    this.listEl.innerHTML = '';
    this.rows = [];
    this.active = -1;
    for (const t of filterTunings(this.host.library(), this.input.value)) {
      const row = document.createElement('div');
      row.className = 'cp-sug';
      row.innerHTML = `<span class="cp-sug-name"></span><span class="cp-sug-desc"></span>`;
      row.querySelector('.cp-sug-name')!.textContent = t.name;
      row.querySelector('.cp-sug-desc')!.textContent = t.description ?? '';
      if (t.name === cur) row.classList.add('current');
      const i = this.rows.length;
      row.addEventListener('mousemove', () => this.setActive(i));
      row.addEventListener('click', () => this.choose(i));
      this.rows.push({ t, el: row });
      this.listEl.appendChild(row);
    }
    if (this.rows.length) this.setActive(Math.max(0, this.rows.findIndex(r => r.el.classList.contains('current'))));
  }

  private setActive(i: number): void {
    this.rows[this.active]?.el.classList.remove('active');
    this.active = i;
    const r = this.rows[i];
    if (!r) return;
    r.el.classList.add('active');
    r.el.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const r = this.rows[i];
    if (!r) return;
    this.host.apply(r.t);
    this.close();
  }
}
