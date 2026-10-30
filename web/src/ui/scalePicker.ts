// The scale picker: every scale and raga in the library, by name, on a chosen
// root. Opened from bloom ▾ (or a click on the scale badge); type to filter,
// ↑↓ to move, ↵ or a click to attach, esc to close.

import type { Scale } from '../lib/scales';
import { ALL_SCALES, scaleTranspose } from '../lib/scales';
import { spell } from '../lib/numbers';
import { Overlay, onKeys } from './overlay';

export interface ScalePickerHost {
  /** The attached scale, if any, and the root a new one goes on */
  current(): Scale | null;
  root(): number;
  /** Attach this scale (written on C) on this root */
  apply(scale: Scale, root: number): void;
}

/** The library in the order it's shown: ragas first, then the scales by size */
function groups(): { title: string; scales: Scale[] }[] {
  const ragas = ALL_SCALES.filter(s => s.root !== undefined);
  const rest = ALL_SCALES.filter(s => s.root === undefined && s.pitchesPerOctave === 12);
  const sizes = [...new Set(rest.map(s => s.degrees.length))].sort((a, b) => a - b);
  return [
    { title: 'ragas (↕ rising and falling differ)', scales: ragas },
    ...sizes.map(n => ({ title: `${n} notes`, scales: rest.filter(s => s.degrees.length === n) })),
  ];
}

export class ScalePicker extends Overlay {
  private input: HTMLInputElement;
  private rootSel: HTMLSelectElement;
  private listEl: HTMLElement;
  private rows: { scale: Scale; el: HTMLElement }[] = [];
  private active = -1;
  private host: ScalePickerHost;

  constructor(host: ScalePickerHost) {
    super(document.createElement('div'), { backdrop: true });
    this.host = host;
    this.el.id = 'scale-picker';
    this.el.innerHTML = `
      <div id="sp-box">
        <div class="cp-hint">type to filter · ↑↓ move · ↵ or click attaches · esc closes</div>
        <div class="sp-top">
          <input class="cp-input" type="text" spellcheck="false" autocomplete="off" placeholder="scale or raga">
          <label class="sp-root">on <select></select></label>
        </div>
        <div class="sp-list"></div>
      </div>`;
    this.input = this.el.querySelector('input')!;
    this.rootSel = this.el.querySelector('select')!;
    this.listEl = this.el.querySelector('.sp-list')!;
    for (let pc = 0; pc < 12; pc++) this.rootSel.append(new Option(spell(pc), String(pc)));
    this.input.addEventListener('input', () => this.render());
    this.rootSel.addEventListener('change', () => { this.render(); this.input.focus(); });
    onKeys(this.input, {
      Escape: () => this.close(),
      ArrowDown: () => this.setActive(Math.min(this.rows.length - 1, this.active + 1)),
      ArrowUp: () => this.setActive(Math.max(0, this.active - 1)),
      Enter: () => this.choose(this.active),
    });
  }

  open(): void {
    this.rootSel.value = String(this.host.root());
    this.input.value = '';
    this.render();
    this.show(this.input);
  }

  private render(): void {
    const q = this.input.value.trim().toLowerCase();
    const root = Number(this.rootSel.value);
    const cur = this.host.current();
    const curKey = cur ? `${cur.name}|${[...cur.degrees].sort((a, b) => a - b).join()}` : '';
    this.listEl.innerHTML = '';
    this.rows = [];
    this.active = -1;
    for (const g of groups()) {
      const hits = g.scales.filter(s => !q || s.name.toLowerCase().includes(q));
      if (!hits.length) continue;
      const h = document.createElement('div');
      h.className = 'sp-group';
      h.textContent = g.title;
      this.listEl.appendChild(h);
      for (const s of hits) {
        const on = scaleTranspose(s, root);
        const row = document.createElement('div');
        row.className = 'cp-sug';
        const notes = (pcs: number[]) => [...pcs].sort((a, b) => (a - root + 12) % 12 - (b - root + 12) % 12).map(p => spell(p)).join(' ');
        const forms = on.up && on.down ? `↑ ${notes(on.up)}  ↓ ${notes(on.down)}` : notes(on.degrees);
        row.innerHTML = `<span class="cp-sug-name"></span><span class="cp-sug-desc"></span>`;
        row.querySelector('.cp-sug-name')!.textContent = `${s.name}${s.up ? ' ↕' : ''}`;
        row.querySelector('.cp-sug-desc')!.textContent = forms;
        if (`${s.name}|${[...on.degrees].sort((a, b) => a - b).join()}` === curKey) row.classList.add('current');
        const i = this.rows.length;
        row.addEventListener('mousemove', () => this.setActive(i));
        row.addEventListener('click', () => this.choose(i));
        this.rows.push({ scale: s, el: row });
        this.listEl.appendChild(row);
      }
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
    this.host.apply(r.scale, Number(this.rootSel.value));
    this.close();
  }
}
