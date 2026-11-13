// The pattern palette (d): the presets, and a box to type your own, each
// previewed on the list it will write out: the indices it reads and how long
// the result is (a warning past PATTERN_WARN, cut at PATTERN_CAP). Type to
// filter the presets or to write a pattern (lib/patterns: `123 +1`); ↑↓ move,
// ↵ or a click bakes, esc closes. D does the last one again without opening.

import {
  PATTERN_CAP, PATTERN_PRESETS, PATTERN_WARN, expandPattern, formatPattern, parsePattern,
} from '../lib/patterns';
import { Picker } from './picker';

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

export class PatternPicker extends Picker<PatternRow> {
  private titleEl: HTMLElement;
  private noteEl: HTMLElement;
  private n = 0;
  private last: string | null = null;
  private bake: ((spec: string) => string | null) | null = null;

  constructor() {
    super({
      id: 'pattern-picker',
      hint: 'type a pattern (123 +1) or a preset · ↑↓ move · ↵ or click bakes · esc closes',
      placeholder: '123 +1',
    });
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'pp-title';
    this.top.before(this.titleEl);
    this.noteEl = document.createElement('div');
    this.noteEl.className = 'pp-note';
    this.box.appendChild(this.noteEl);
  }

  /** Open over a list of `n`; `bake` writes it out and returns what's wrong, or null */
  open(title: string, n: number, last: string | null, bake: (spec: string) => string | null): void {
    this.titleEl.textContent = `${title} · ${n} to read`;
    this.n = n;
    this.last = last;
    this.bake = bake;
    this.openList();
  }

  protected rows(query: string): PatternRow[] { return patternRows(query, this.n, this.last); }

  protected row(r: PatternRow): HTMLElement {
    const el = this.rowEl(r.name, r.problem ? '—' : r.preview);
    el.classList.toggle('pp-bad', r.problem !== null);
    const spec = document.createElement('span');
    spec.className = 'pp-spec';
    spec.textContent = r.spec;
    el.querySelector('.cp-sug-name')!.after(spec);
    return el;
  }

  /** With nothing typed, on the last pattern used */
  protected override start(rows: PatternRow[]): number {
    return this.input.value.trim() ? -1 : rows.findIndex(r => r.spec === this.last);
  }

  protected override activeChanged(r: PatternRow | undefined): void {
    this.note(patternNote(r, this.input.value));
  }

  private note(note: { text: string; kind: 'ok' | 'warn' | 'err' }): void {
    this.noteEl.textContent = note.text;
    this.noteEl.className = `pp-note pp-note--${note.kind}`;
  }

  protected choose(r: PatternRow): boolean {
    if (!this.bake || r.problem) return false;
    const wrong = this.bake(r.spec);
    if (wrong) this.note({ text: wrong, kind: 'err' });
    return !wrong;
  }

  protected override onClose(): void { this.bake = null; }
}
