// The pattern palette (d): the presets, and a box to type your own, each
// previewed on the list it will write out: the indices it reads and how long
// the result is (a warning past PATTERN_WARN, cut at PATTERN_CAP). Type to
// filter the presets or to write a pattern (lib/patterns: `123 +1`); ↑↓ move,
// ↵ or a click bakes, esc closes. D does the last one again without opening.

import {
  PATTERN_CAP, PATTERN_PRESETS, PATTERN_WARN, expandPattern, formatPattern, parsePattern,
} from '../lib/patterns';
import { Overlay, onKeys } from './overlay';

/** A row of the palette: a preset, the pattern being typed, or the last one used */
export interface PatternRow {
  name: string;
  spec: string;
  /** the windows it reads on this list, as typed (123 234 345) */
  preview: string;
  length: number;
  capped: boolean;
  /** why it can't be baked on this list */
  problem: string | null;
}

const PREVIEW_CHARS = 64;

function row(name: string, spec: string, n: number): PatternRow {
  const p = parsePattern(spec);
  const e = typeof p === 'string' ? p : expandPattern(p, n);
  if (typeof e === 'string') return { name, spec, preview: '', length: 0, capped: false, problem: e };
  const all = formatPattern(e.rounds, n);
  const preview = all.length > PREVIEW_CHARS ? `${all.slice(0, PREVIEW_CHARS).replace(/\s\S*$/, '')} …` : all;
  return { name, spec, preview, length: e.length, capped: e.capped, problem: null };
}

/**
 * What the palette lists for `query` on a list of `n`: what's typed, when it
 * reads as a pattern, then the presets whose name or spec it matches (all of
 * them with nothing typed, the last pattern used first if it isn't one).
 */
export function patternRows(query: string, n: number, last: string | null = null): PatternRow[] {
  const q = query.trim().toLowerCase();
  const presets = PATTERN_PRESETS.filter(p => !q || p.name.includes(q) || p.spec.includes(q)).map(p => row(p.name, p.spec, n));
  if (!q) return last && !PATTERN_PRESETS.some(p => p.spec === last) ? [row('last', last, n), ...presets] : presets;
  const typed = typeof parsePattern(query) === 'string' ? null : row('yours', query.trim(), n);
  return typed && !presets.some(p => p.spec === typed.spec) ? [typed, ...presets] : presets;
}

/** The line under the list: what the active row writes out, or what's wrong */
export function patternNote(r: PatternRow | undefined, query: string): { text: string; kind: 'ok' | 'warn' | 'err' } {
  if (!r) {
    const p = query.trim() ? parsePattern(query) : 'type a pattern, like 123 +1, or a preset’s name';
    return { text: typeof p === 'string' ? p : '', kind: 'err' };
  }
  if (r.problem) return { text: r.problem, kind: 'err' };
  if (r.capped) return { text: `${r.length} notes: cut at ${PATTERN_CAP}, a whole window at a time`, kind: 'warn' };
  if (r.length > PATTERN_WARN) return { text: `${r.length} notes: a long one`, kind: 'warn' };
  return { text: `${r.length} notes`, kind: 'ok' };
}

export class PatternPicker extends Overlay {
  private input: HTMLInputElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private noteEl: HTMLElement;
  private rows: PatternRow[] = [];
  private rowEls: HTMLElement[] = [];
  private active = -1;
  private n = 0;
  private last: string | null = null;
  private bake: ((spec: string) => string | null) | null = null;

  constructor() {
    super(document.createElement('div'), { backdrop: true });
    this.el.id = 'pattern-picker';
    this.el.innerHTML = `
      <div id="pp-box">
        <div class="cp-hint">type a pattern (123 +1) or a preset · ↑↓ move · ↵ or click bakes · esc closes</div>
        <div class="pp-title"></div>
        <input class="cp-input" type="text" spellcheck="false" autocomplete="off" placeholder="123 +1">
        <div class="pp-list"></div>
        <div class="pp-note"></div>
      </div>`;
    this.input = this.el.querySelector('input')!;
    this.titleEl = this.el.querySelector('.pp-title')!;
    this.listEl = this.el.querySelector('.pp-list')!;
    this.noteEl = this.el.querySelector('.pp-note')!;
    this.input.addEventListener('input', () => this.render());
    onKeys(this.input, {
      Escape: () => this.close(),
      ArrowDown: () => this.setActive(Math.min(this.rows.length - 1, this.active + 1)),
      ArrowUp: () => this.setActive(Math.max(0, this.active - 1)),
      Enter: () => this.choose(this.active),
    });
  }

  /** Open over a list of `n`; `bake` writes it out and returns what's wrong, or null */
  open(title: string, n: number, last: string | null, bake: (spec: string) => string | null): void {
    this.titleEl.textContent = `${title} · ${n} to read`;
    this.n = n;
    this.last = last;
    this.bake = bake;
    this.input.value = '';
    this.render();
    this.show(this.input);
  }

  private render(): void {
    this.rows = patternRows(this.input.value, this.n, this.last);
    this.listEl.innerHTML = '';
    this.rowEls = this.rows.map((r, i) => {
      const el = document.createElement('div');
      el.className = 'cp-sug' + (r.problem ? ' pp-bad' : '');
      el.innerHTML = '<span class="cp-sug-name"></span><span class="pp-spec"></span><span class="cp-sug-desc"></span>';
      el.querySelector('.cp-sug-name')!.textContent = r.name;
      el.querySelector('.pp-spec')!.textContent = r.spec;
      el.querySelector('.cp-sug-desc')!.textContent = r.problem ? '—' : r.preview;
      el.addEventListener('mousemove', () => this.setActive(i));
      el.addEventListener('click', () => this.choose(i));
      this.listEl.appendChild(el);
      return el;
    });
    this.active = -1;
    const lastAt = this.input.value.trim() ? -1 : this.rows.findIndex(r => r.spec === this.last);
    this.setActive(this.rows.length ? Math.max(0, lastAt) : -1);
  }

  private setActive(i: number): void {
    this.rowEls[this.active]?.classList.remove('active');
    this.active = i;
    this.rowEls[i]?.classList.add('active');
    this.rowEls[i]?.scrollIntoView({ block: 'nearest' });
    const note = patternNote(this.rows[i], this.input.value);
    this.noteEl.textContent = note.text;
    this.noteEl.className = `pp-note pp-note--${note.kind}`;
  }

  private choose(i: number): void {
    const r = this.rows[i];
    if (!r || !this.bake) return;
    if (r.problem) return;
    const wrong = this.bake(r.spec);
    if (wrong) { this.noteEl.textContent = wrong; this.noteEl.className = 'pp-note pp-note--err'; return; }
    this.close();
  }

  protected override onClose(): void { this.bake = null; }
}
