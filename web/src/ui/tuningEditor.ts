// The tuning view (opt-t): the bloom's tuning as a pie in the main area (drawn
// by the visualization, see tuningPie.ts), with these controls either side.
// Click a slice to hear and select the note, move it by commas, set it to a
// ratio; shift-click a second to see and set the interval between them; paste
// a whole scale; choose the root; save to the library or export a .scl. Edits
// go to the bloom's own copy of its tuning, so they're saved with the bloom
// (and undo steps back through them).

import type { Bloom } from '../core/Bloom';
import {
  COMMAS, centsOfRatio, degreeRatio, deviations, editable, fromList, intervalBetween,
  readable, setDegree, setInterval, shiftDegree, toScala,
} from '../lib/tuning';
import type { Tuning } from '../lib/tuning';
import { spell } from '../lib/numbers';
import type { PieMarks } from './tuningPie';

export interface TuningEditorHost {
  bloom: () => Bloom;
  /** Replace the bloom's tuning (null: 12-TET) and refresh */
  commit: (t: Tuning | null, msg: string) => void;
  /** Sound one MIDI note briefly, so a selected degree can be heard */
  audition: (midi: number) => void;
  /** The library's copy of a tuning, by name */
  libraryTuning: (name: string) => Tuning | undefined;
  saveToLibrary: (t: Tuning) => void;
  status: (msg: string) => void;
  /** Show or hide the pie in the main area, and mark the selected notes on it */
  show: (on: boolean) => void;
  mark: (m: PieMarks) => void;
}

const COMMA_KEY = 'bloom.tuningComma';

export class TuningEditor {
  private _el: HTMLElement;
  private _open = false;
  private _a: number | null = null;   // selected degree
  private _b: number | null = null;   // second degree, for an interval
  private _comma = 0;

  private host: TuningEditorHost;

  constructor(host: TuningEditorHost) {
    this.host = host;
    try {
      const i = COMMAS.findIndex(c => c.name === localStorage.getItem(COMMA_KEY));
      this._comma = i >= 0 ? i : COMMAS.findIndex(c => c.name === 'syntonic comma');
    } catch { this._comma = COMMAS.findIndex(c => c.name === 'syntonic comma'); }
    this._el = document.createElement('div');
    this._el.id = 'tuning-view';
    (document.getElementById('viz-area') ?? document.body).appendChild(this._el);
  }

  isOpen(): boolean { return this._open; }
  open(): void { this._open = true; this._el.classList.add('open'); this.host.show(true); this.update(); }
  close(): void { this._open = false; this._el.classList.remove('open'); this.host.show(false); }
  /** The view was left some other way (choosing another view) */
  closed(): void { this._open = false; this._el.classList.remove('open'); }
  toggle(): void { if (this._open) this.close(); else this.open(); }

  /** A slice clicked: select the note and hear it; with shift, the second note of an interval */
  pick(d: number, shift: boolean): void {
    if (shift && this._a !== null && d !== this._a) this._b = d;
    else { this._a = d; this._b = null; }
    this.host.audition(60 + this.root + d);
    this.update();
  }

  private get tuning(): Tuning { return editable(this.host.bloom().tuning); }
  private get root(): number { return this.host.bloom().tuningRoot; }
  private name(d: number): string { return spell((this.root + d) % 12); }

  /** Redraw from the bloom (after any change, from here or from keys) */
  update(): void {
    if (!this._open) return;
    const b = this.host.bloom();
    const t = this.tuning;
    const lib = b.tuning ? this.host.libraryTuning(b.tuning.name) : undefined;
    const a = this._a, bb = this._b;
    const dev = deviations(b.tuning, this.root);
    const cents = (c: number) => `${c.toFixed(1)}¢`;
    const signed = (c: number) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)}`;

    this.host.mark({ a, b: bb });
    let sel = '<div class="te-dim">click a slice to select and hear its note · shift-click a second for the interval</div>';
    if (a !== null) {
      const r = degreeRatio(t, a);
      const marks = t.marks?.[a]?.length ? ` · ${t.marks[a].join(' ')}` : '';
      sel = `<div><b>${this.name(a)}</b> <span class="te-dim">degree ${a}</span> · ${readable(r) ? `<b>${r}</b> · ` : ''}${cents(t.cents[a])}
          · <span class="te-dim">${signed(dev[(this.root + a) % 12])} vs 12-TET${marks}</span></div>
        <div class="te-row">
          <button data-act="down" title="lower ${this.name(a)} by the comma">− comma</button>
          <button data-act="up" title="raise ${this.name(a)} by the comma">+ comma</button>
          <input id="te-set" class="te-inp" placeholder="7/4 or 968.8" title="a ratio or cents above the root">
          <button data-act="set">set ${this.name(a)}</button>
        </div>`;
      if (bb !== null) {
        const iv = intervalBetween(t, a, bb);
        sel += `<div class="te-row"><span>${this.name(a)} → ${this.name(bb)}: ${readable(iv.ratio) ? `<b>${iv.ratio}</b> · ` : ''}${cents(iv.cents)}</span>
          <input id="te-iv" class="te-inp" placeholder="3/2" title="the interval, as a ratio or cents; moves ${this.name(bb)}">
          <button data-act="interval">set interval</button>
          <button data-act="ivcomma" title="${this.name(bb)} exactly one ${COMMAS[this._comma].name} above ${this.name(a)}">= one comma</button></div>`;
      }
    }

    const rootOpts = [`<option value="key"${t.root == null ? ' selected' : ''}>follows the key (${spell(this.root)})</option>`,
      ...Array.from({ length: 12 }, (_, pc) => `<option value="${pc}"${t.root === pc ? ' selected' : ''}>${spell(pc)}</option>`)].join('');
    const commaOpts = COMMAS.map((c, i) =>
      `<option value="${i}"${i === this._comma ? ' selected' : ''}>${c.name} ${c.ratio.n}/${c.ratio.d} (${centsOfRatio(c.ratio).toFixed(1)}¢)</option>`).join('');

    this._el.innerHTML = `
      <div class="tv-side">
        <div class="tv-title">note</div>
        ${sel}
        <div class="te-row"><span class="te-lbl">comma</span><select id="te-comma">${commaOpts}</select></div>
      </div>
      <div class="tv-side">
        <div class="tv-title">tuning: <b>${escapeHtml(t.name)}${b.tuning?.edited ? ' *' : ''}</b>
          <button data-act="close" title="close the tuning view (opt-t)">×</button></div>
        <div class="te-row"><span class="te-lbl">root</span><select id="te-root">${rootOpts}</select></div>
        <div class="te-row te-col"><span class="te-lbl">paste a scale <span class="te-dim">ratios or cents: 11 (1/1 implied), 12, or a .scl</span></span>
          <textarea id="te-paste" class="te-inp" rows="3" spellcheck="false" placeholder="16/15 9/8 6/5 5/4 4/3 45/32 3/2 8/5 5/3 9/5 15/8"></textarea>
          <button data-act="paste">use these</button></div>
        <div class="te-row"><input id="te-name" class="te-inp" value="${escapeHtml(t.name)}" title="the name to save it under"></div>
        <div class="te-row">
          <button data-act="save">save to library</button>
          <button data-act="export">export .scl</button>
          ${lib && b.tuning?.edited ? '<button data-act="revert">revert</button>' : ''}
          <button data-act="equal">back to 12-TET</button></div>
        <div class="te-dim">T / opt-T step through the loaded tunings · opt-t or esc closes</div>
      </div>`;
    this._wire();
  }

  private _wire(): void {
    const q = <T extends HTMLElement>(id: string) => this._el.querySelector<T>(`#${id}`);
    this._el.querySelector('#te-comma')?.addEventListener('change', (e) => {
      this._comma = Number((e.target as HTMLSelectElement).value);
      try { localStorage.setItem(COMMA_KEY, COMMAS[this._comma].name); } catch { /* fine */ }
      (e.target as HTMLElement).blur();
      this.update();   // the "= one comma" button names it
    });
    this._el.querySelector('#te-root')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const t = this.tuning;
      t.root = v === 'key' ? null : Number(v);
      (e.target as HTMLElement).blur();
      this.host.commit(t, v === 'key' ? 'tuning root follows the key' : `tuning root ${spell(Number(v))}`);
    });
    const enter = (id: string, act: string) => q<HTMLInputElement>(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._act(act); }
    });
    enter('te-set', 'set');
    enter('te-iv', 'interval');
    this._el.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach(btn =>
      btn.addEventListener('click', () => { btn.blur(); this._act(btn.dataset.act!); }));
  }

  private _act(act: string): void {
    const t = this.tuning;
    const a = this._a, b = this._b;
    const val = (id: string) => (this._el.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim();
    const result = (r: Tuning | string, msg: string) => {
      if (typeof r === 'string') { this.host.status(r); return; }
      this.host.commit(r, msg);
    };
    switch (act) {
      case 'close': this.close(); break;
      case 'up': case 'down': {
        if (a === null) return;
        const c = COMMAS[this._comma];
        result(shiftDegree(t, a, c.ratio, act === 'up' ? 1 : -1),
          `${this.name(a)} ${act === 'up' ? '+' : '−'} ${c.name}`);
        this.host.audition(60 + this.root + a);
        break;
      }
      case 'set': if (a !== null && val('te-set')) result(setDegree(t, a, val('te-set')), `${this.name(a)} = ${val('te-set')}`); break;
      case 'interval':
        if (a !== null && b !== null && val('te-iv')) result(setInterval(t, a, b, val('te-iv')), `${this.name(a)} → ${this.name(b)} = ${val('te-iv')}`);
        break;
      case 'ivcomma': {
        if (a === null || b === null) return;
        const c = COMMAS[this._comma];
        result(setInterval(t, a, b, `${c.ratio.n}/${c.ratio.d}`), `${this.name(b)} one ${c.name} above ${this.name(a)}`);
        this.host.audition(60 + this.root + b);
        break;
      }
      case 'paste': {
        const r = fromList(val('te-paste'), t.edited ? t.name : `${t.name} (pasted)`);
        if (typeof r !== 'string') { r.root = t.root; r.edited = true; }
        result(r, 'tuning pasted');
        break;
      }
      case 'save': {
        const name = val('te-name') || t.name;
        const saved: Tuning = { ...t, name, edited: false, root: undefined };
        this.host.saveToLibrary(saved);
        result({ ...saved, root: t.root }, `saved "${name}" to the library`);
        break;
      }
      case 'export': {
        const name = val('te-name') || t.name;
        const blob = new Blob([toScala({ ...t, name })], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name.replace(/[^\w\- .]+/g, '_')}.scl`;
        link.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'revert': {
        const lib = this.host.libraryTuning(t.name);
        if (lib) result({ ...editable(lib), root: t.root, edited: false }, `reverted to "${t.name}"`);
        break;
      }
      case 'equal': this.host.commit(null, 'tuning: 12-TET'); break;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}

