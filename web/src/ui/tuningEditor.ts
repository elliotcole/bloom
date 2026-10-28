// The tuning view (opt-t): the bloom's tuning as a pie in the main area (drawn
// by the visualization, see tuningPie.ts), with these controls either side.
// Click a slice to hear and select the note, move it by commas, set it to a
// ratio; shift-click a second to see and set the interval between them; paste
// a whole scale; choose the root; save to the library or export a .scl. Edits
// go to the bloom's own copy of its tuning, so they're saved with the bloom
// (and undo steps back through them).

import type { Bloom } from '../core/Bloom';
import {
  ALTERATIONS, alterText, alterationsOf, centsOfRatio, commaAbove, commaOf, degreeRatio, deviations,
  clearAlterations, editable, fromList, intervalBetween, isAltered, readable, setDegree, setInterval,
  shiftDegree, toScala, toggleAlterations,
} from '../lib/tuning';
import type { CommaId, Tuning } from '../lib/tuning';
import { PALETTE_GLYPH, loadHeji } from './heji';
import { spell } from '../lib/numbers';
import type { PieMarks } from './tuningPie';
import { holdRoot, isHeld, originalTuning, setHoldRoot, soundingRoot, soundingTuning } from '../audio/tuningOut';

export interface TuningEditorHost {
  bloom: () => Bloom;
  /** Replace the sounding tuning (the held one while held, else the bloom's; null: 12-TET) and refresh */
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
  /** opt-t: hold the sounding tuning over every bloom, or release it */
  toggleHold: () => void;
  /** Give the bloom the held tuning as its own */
  keepHeld: () => void;
  /** The hold's root setting changed: retune */
  retune: () => void;
}

const COMMA_KEY = 'bloom.alterComma';

export class TuningEditor {
  private _el: HTMLElement;
  private _open = false;
  private _a: number | null = null;   // selected degree
  private _b: number | null = null;   // second degree, for an interval
  private _comma: CommaId = 's';   // the alterations palette's choice
  private _audition = false;   // clicks and edits play the note: off, so nothing extra sounds in performance

  private host: TuningEditorHost;

  constructor(host: TuningEditorHost) {
    this.host = host;
    try {
      const id = localStorage.getItem(COMMA_KEY);
      if (ALTERATIONS.some(c => c.id === id)) this._comma = id as CommaId;
    } catch { /* syntonic */ }
    void loadHeji().then(() => this.update());
    this._el = document.createElement('div');
    this._el.id = 'tuning-view';
    (document.getElementById('viz-area') ?? document.body).appendChild(this._el);
  }

  isOpen(): boolean { return this._open; }
  open(): void { this._open = true; this._el.classList.add('open'); this.host.show(true); this.update(); }
  close(): void { this._open = false; this._el.classList.remove('open'); this.host.show(false); }
  /** The view was left some other way (choosing another view) */
  closed(): void { this._open = false; this._el.classList.remove('open'); this.host.show(false); }
  toggle(): void { if (this._open) this.close(); else this.open(); }

  /** The comma the alterations palette has chosen (for 3 / 4 / # / $ too) */
  comma(): CommaId { return this._comma; }
  /** The selected degrees, or none */
  picked(): number[] { return [this._a, this._b].filter((d): d is number => d !== null); }
  clearPick(): void { this._a = null; this._b = null; this.update(); }

  /** A slice clicked: select the note (and hear it, with audition on); with shift, the second note of an interval */
  pick(d: number, shift: boolean): void {
    if (shift && this._a !== null && d !== this._a) this._b = d;
    else { this._a = d; this._b = null; }
    this.hear(d);
    this.update();
  }

  /** Play a degree, only with audition on */
  private hear(d: number): void {
    if (this._audition) this.host.audition(60 + this.root + d);
  }

  private get tuning(): Tuning { return editable(soundingTuning(this.host.bloom())); }
  private get root(): number { return soundingRoot(this.host.bloom()); }
  private name(d: number): string { return spell((this.root + d) % 12); }

  /** Redraw from the bloom (after any change, from here or from keys) */
  update(): void {
    if (!this._open) return;
    const b = this.host.bloom();
    const t = this.tuning;
    const own = soundingTuning(b);
    const held = isHeld();
    const lib = own ? this.host.libraryTuning(own.name) : undefined;
    const a = this._a, bb = this._b;
    const dev = deviations(own, this.root);
    const cents = (c: number) => `${c.toFixed(1)}¢`;
    const signed = (c: number) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)}`;

    this.host.mark({ a, b: bb });
    let sel = '<div class="te-dim">click a slice to select its note · shift-click a second for the interval</div>';
    if (a !== null) {
      const r = degreeRatio(t, a);
      const alt = alterText(t.alter?.[a]);
      const marks = alt ? ` · <b>${alt}</b>` : '';
      sel = `<div><b>${this.name(a)}</b> <span class="te-dim">degree ${a}</span> · ${readable(r) ? `<b>${r}</b> · ` : ''}${cents(t.cents[a])}
          · <span class="te-dim">${signed(dev[(this.root + a) % 12])} vs 12-TET${marks}</span></div>
        <div class="te-row">
          <button data-act="down" title="lower ${this.name(a)} by a ${commaOf(this._comma).name}">− ${this._comma}</button>
          <button data-act="up" title="raise ${this.name(a)} by a ${commaOf(this._comma).name}">+ ${this._comma}</button>
          <input id="te-set" class="te-inp" placeholder="7/4 or 968.8" title="a ratio or cents above the root">
          <button data-act="set">set ${this.name(a)}</button>
          ${a !== 0 ? `<button data-act="comma" title="${this.name(a)} becomes the note below it, ${this.name((a + 11) % 12)}, raised by one ${commaOf(this._comma).name}: the step between them is the comma">= ${this.name((a + 11) % 12)} +${this._comma}</button>` : ''}
        </div>`;
      if (bb !== null) {
        const iv = intervalBetween(t, a, bb);
        sel += `<div class="te-row"><span>${this.name(a)} → ${this.name(bb)}: ${readable(iv.ratio) ? `<b>${iv.ratio}</b> · ` : ''}${cents(iv.cents)}</span>
          <input id="te-iv" class="te-inp" placeholder="3/2" title="the interval, as a ratio or cents; moves ${this.name(bb)}">
          <button data-act="interval">set interval</button>
          <button data-act="ivcomma" title="${this.name(bb)} becomes ${this.name(a)} raised by one ${commaOf(this._comma).name}">= ${this.name(a)} +${this._comma}</button></div>`;
      }
    }

    const rootOpts = [`<option value="key"${t.root == null ? ' selected' : ''}>follows the key (${spell(this.root)})</option>`,
      ...Array.from({ length: 12 }, (_, pc) => `<option value="${pc}"${t.root === pc ? ' selected' : ''}>${spell(pc)}</option>`)].join('');
    const palette = ALTERATIONS.map(c => `<button class="tv-comma${c.id === this._comma ? ' on' : ''}" data-comma="${c.id}"
        title="${c.name} ${c.ratio.n}/${c.ratio.d} (${centsOfRatio(c.ratio).toFixed(1)}¢): 3 / 4 move notes down / up by it, # / $ breeze">
        <span class="tv-glyph${c.id === 'p' ? ' tv-letter' : ''}">${PALETTE_GLYPH[c.id]}</span><span class="tv-id">${c.id}</span></button>`).join('');
    const alterList = alterationsOf(t).map(x => alterText(x) || '0').join(' ');

    this._el.innerHTML = `
      <div class="tv-side">
        <div class="tv-title"><span>note</span>
          <button data-act="audition" class="${this._audition ? 'on' : ''}" title="play a note when you click its slice or change it (off: nothing extra sounds while you perform)">audition ${this._audition ? 'on' : 'off'}</button></div>
        ${sel}
        <div class="tv-title">alterations${t.alterOff ? ' — off' : ''}</div>
        <div class="te-alter${t.alterOff ? ' off' : ''}" title="each note's commas, from the root: 9 / 0 rotate them, 3 / 4 move notes, # / $ breeze, 2 clears (the selected notes, or all); 1 switches them off and on">${alterList}</div>
        ${isAltered(own) ? `<div class="te-row"><button data-act="alteroff" title="1">${t.alterOff ? 'switch on' : 'switch off'}</button>
          <button data-act="unalter" title="2: back to the tuning as it came (the selected notes, or all)">clear ${this.picked().length ? this.picked().map(d => this.name(d)).join(' ') : 'all'}</button></div>` : ''}
      </div>
      <div class="tv-palette${t.alterOff ? ' off' : ''}"><span class="tv-pal-lbl">alterations${t.alterOff ? ' (off)' : ''}</span>${palette}</div>
      <div class="tv-side">
        <div class="tv-title"><span>${held ? 'held ' : ''}tuning: <b>${escapeHtml(t.name)}${own?.edited ? ' *' : ''}</b>${t.notes ? ` <span class="te-dim" title="each key sounds the scale's nearest note">${t.notes} notes on 12 keys</span>` : ''}</span>
          <button data-act="close" title="close the tuning view (opt-t)">×</button></div>
        <div class="te-row"><span class="te-lbl">root</span><select id="te-root">${rootOpts}</select></div>
        <div class="te-row te-col"><span class="te-lbl">paste a scale <span class="te-dim">ratios or cents: 11 (1/1 implied), 12, fewer (each key takes the nearest), or a .scl</span></span>
          <textarea id="te-paste" class="te-inp" rows="3" spellcheck="false" placeholder="16/15 9/8 6/5 5/4 4/3 45/32 3/2 8/5 5/3 9/5 15/8"></textarea>
          <button data-act="paste">use these</button></div>
        <div class="te-row"><input id="te-name" class="te-inp" value="${escapeHtml(t.name)}" title="the name to save it under"></div>
        <div class="te-row">
          <button data-act="save">save to library</button>
          <button data-act="export">export .scl</button>
          ${lib && own?.edited ? '<button data-act="revert">revert</button>' : ''}
          <button data-act="equal">back to 12-TET</button></div>
        <div class="tv-title">hold</div>
        ${held ? `<div class="te-dim">this tuning plays over every bloom; each keeps its own for when it's released</div>
        <div class="te-row"><span class="te-lbl">held root</span><select id="te-holdroot" title="where the held tuning's root sits (a root chosen above wins)">
          <option value="key"${holdRoot() === 'key' ? ' selected' : ''}>follows each bloom's key</option>
          <option value="fixed"${holdRoot() === 'fixed' ? ' selected' : ''}>stays on ${spell(this.root)}</option></select></div>
        <div class="te-row"><button data-act="hold" title="opt-t">release</button>
          <button data-act="keep" title="this bloom keeps the held tuning as its own">keep in this bloom</button></div>`
        : `<div class="te-row"><button data-act="hold" title="opt-t">hold over every bloom</button></div>`}
        <div class="te-dim">[ ] step through the loaded tunings · opt-t holds · T or esc leaves</div>
      </div>`;
    this._wire();
  }

  private _wire(): void {
    const q = <T extends HTMLElement>(id: string) => this._el.querySelector<T>(`#${id}`);
    this._el.querySelectorAll<HTMLButtonElement>('.tv-comma').forEach(btn => btn.addEventListener('click', () => {
      btn.blur();
      this._comma = btn.dataset.comma as CommaId;
      try { localStorage.setItem(COMMA_KEY, this._comma); } catch { /* fine */ }
      this.host.status(`alterations: ${commaOf(this._comma).name}`);
      this.update();
    }));
    this._el.querySelector('#te-holdroot')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value as 'key' | 'fixed';
      (e.target as HTMLElement).blur();
      setHoldRoot(v);
      this.host.retune();
      this.host.status(v === 'key' ? "held tuning's root follows each bloom's key" : `held tuning's root stays on ${spell(this.root)}`);
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
      case 'audition': this._audition = !this._audition; this.update(); this.host.status(`audition ${this._audition ? 'on: clicks play the note' : 'off'}`); break;
      case 'comma': {
        if (a === null || a === 0) return;
        const below = (a + 11) % 12;
        result(commaAbove(t, below, a, this._comma), `${this.name(a)} one ${commaOf(this._comma).name} above ${this.name(below)}`);
        this.hear(a);
        break;
      }
      case 'hold': this.host.toggleHold(); break;
      case 'keep': this.host.keepHeld(); break;
      case 'up': case 'down': {
        if (a === null) return;
        result(shiftDegree(t, a, this._comma, act === 'up' ? 1 : -1),
          `${this.name(a)} ${act === 'up' ? '+' : '−'} ${commaOf(this._comma).name}`);
        this.hear(a);
        break;
      }
      case 'set': if (a !== null && val('te-set')) result(setDegree(t, a, val('te-set')), `${this.name(a)} = ${val('te-set')}`); break;
      case 'interval':
        if (a !== null && b !== null && val('te-iv')) result(setInterval(t, a, b, val('te-iv')), `${this.name(a)} → ${this.name(b)} = ${val('te-iv')}`);
        break;
      case 'ivcomma': {
        if (a === null || b === null) return;
        result(commaAbove(t, a, b, this._comma), `${this.name(b)} one ${commaOf(this._comma).name} above ${this.name(a)}`);
        this.hear(b);
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
      case 'unalter': {
        const degs = this.picked().length ? this.picked() : Array.from({ length: 12 }, (_, i) => i);
        result(clearAlterations(t, degs, originalTuning(soundingTuning(this.host.bloom()))), `${this.picked().length ? this.picked().map(d => this.name(d)).join(' ') : 'every note'}: back to the tuning as it came`);
        break;
      }
      case 'alteroff': result(toggleAlterations(t), t.alterOff ? 'alterations on' : 'alterations off: the base sounds'); break;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}

