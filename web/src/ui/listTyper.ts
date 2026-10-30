// Typing a list: in a list mode, ↵ opens one line holding that list as text
// (intervals by name: -P5/10 +3rd+5th ·), ↵ again sets it, shift-↵ sets it
// looped round until it's as long as the notes, esc leaves it be.
//
// ← → select a whole entry at a time (a chord in brackets, a figure in
// parentheses, -P5/10), so typing replaces just that one.
//
// A line can carry more fields after the list (figures: how they take their
// time, their durations, their velocity): tab moves between them, ↵ in any
// sets the lot. A choice is changed with ← → or its first letter.

/** A field after the list: a choice of words, or a line of text (shown only while `when` holds) */
export type TyperField =
  | { kind: 'choice'; label: string; options: string[]; value: string }
  | { kind: 'text'; label: string; value: string; size?: number; when?: (values: string[]) => boolean };

import { Overlay } from './overlay';

/** The entries of a typed list, as [start, end) ranges: (…) and […] groups whole, else runs of non-space */
function entries(text: string): [number, number][] {
  return [...text.matchAll(/\([^)]*\)?|\[[^\]]*\]?|\S+/g)].map(m => [m.index!, m.index! + m[0].length]);
}

export class ListTyper extends Overlay {
  private label: HTMLElement;
  private input: HTMLInputElement;
  private err: HTMLElement;
  private commit: ((text: string, complete: boolean, values: string[]) => string | null) | null = null;
  private fieldsEl: HTMLElement;
  private fields: TyperField[] = [];
  private values: string[] = [];

  constructor(parent: HTMLElement) {
    super(document.createElement('div'), { parent });
    this.el.id = 'list-typer';
    this.el.innerHTML = '<span class="lt-label"></span><input type="text" spellcheck="false" autocomplete="off"><span class="lt-fields"></span><span class="lt-err"></span>';
    this.label = this.el.querySelector('.lt-label')!;
    this.input = this.el.querySelector('input')!;
    this.fieldsEl = this.el.querySelector('.lt-fields')!;
    this.err = this.el.querySelector('.lt-err')!;
    this.input.addEventListener('keydown', e => this.keyIn(e, this.input));
    this.el.addEventListener('input', () => { this.err.textContent = ''; });
    // closes when the focus leaves the line, not when it moves between its fields
    this.el.addEventListener('focusout', (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (!document.hasFocus()) return;   // the window lost focus (cmd-tab): what's typed waits
      if (!to || !this.el.contains(to)) this.close();
    });
  }

  /** A key in the list or a text field: esc leaves, ↵ sets, ← → step through the entries */
  private keyIn(e: KeyboardEvent, input: HTMLInputElement): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.step(input, e.key === 'ArrowRight' ? 1 : -1);
    }
    else if (e.key === 'Enter') { e.preventDefault(); this.done(e.shiftKey); }
  }

  private done(complete: boolean): void {
    const problem = this.commit?.(this.input.value, complete, [...this.values]) ?? null;
    if (problem) this.err.textContent = problem; else this.close();
  }

  /**
   * Show `text` to edit, with `fields` after it; `commit` sets it (complete:
   * loop it to the notes' length; values: the fields') and returns a problem
   * to show, or null when done.
   */
  open(label: string, text: string, commit: (text: string, complete: boolean, values: string[]) => string | null, fields: TyperField[] = []): void {
    this.commit = commit;
    this.label.textContent = label;
    this.input.value = text;
    this.err.textContent = '';
    this.fields = fields;
    this.values = fields.map(f => f.value);
    this.buildFields();
    this.show(this.input);
    this.input.select();
  }

  private buildFields(): void {
    this.fieldsEl.innerHTML = '';
    this.fields.forEach((f, k) => {
      const wrap = document.createElement('span');
      wrap.className = 'lt-field';
      const lab = document.createElement('span');
      lab.className = 'lt-flabel';
      lab.textContent = f.label;
      wrap.appendChild(lab);
      if (f.kind === 'choice') {
        const box = document.createElement('span');
        box.className = 'lt-choice';
        box.tabIndex = 0;
        const paint = () => box.querySelectorAll('span').forEach(o => o.classList.toggle('on', o.textContent === this.values[k]));
        f.options.forEach(opt => {
          const o = document.createElement('span');
          o.textContent = opt;
          o.addEventListener('mousedown', ev => { ev.preventDefault(); this.values[k] = opt; paint(); this.showFields(); box.focus(); });
          box.appendChild(o);
        });
        box.addEventListener('keydown', e => {
          e.stopPropagation();
          const at = f.options.indexOf(this.values[k]);
          const byLetter = f.options.find(o => o[0] === e.key.toLowerCase());
          if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
          if (e.key === 'Enter') { e.preventDefault(); this.done(e.shiftKey); return; }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const d = e.key === 'ArrowRight' ? 1 : -1;
            this.values[k] = f.options[(at + d + f.options.length) % f.options.length];
          } else if (byLetter && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.values[k] = byLetter;
          } else return;
          paint();
          this.showFields();
        });
        paint();
        wrap.appendChild(box);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        inp.value = f.value;
        inp.size = f.size ?? 6;
        inp.addEventListener('keydown', e => this.keyIn(e, inp));
        inp.addEventListener('input', () => { this.values[k] = inp.value; this.showFields(); });
        inp.addEventListener('focus', () => inp.select());
        wrap.appendChild(inp);
      }
      this.fieldsEl.appendChild(wrap);
    });
    this.showFields();
  }

  /** Show only the fields whose `when` holds for the values as they stand */
  private showFields(): void {
    [...this.fieldsEl.children].forEach((el, k) => {
      const f = this.fields[k];
      (el as HTMLElement).style.display = f.kind === 'text' && f.when && !f.when(this.values) ? 'none' : '';
    });
  }

  /** Select the next (1) or previous (-1) whole entry from the selection or caret */
  private step(input: HTMLInputElement, dir: 1 | -1): void {
    const items = entries(input.value);
    if (!items.length) return;
    const a = input.selectionStart ?? 0, z = input.selectionEnd ?? a;
    const all = a === 0 && z === input.value.length && z > 0;
    const pick = all ? (dir > 0 ? items[0] : items[items.length - 1])
      : dir > 0 ? items.find(([s]) => s >= z) : [...items].reverse().find(([, e]) => e <= a);
    if (pick) input.setSelectionRange(pick[0], pick[1]);
  }

  protected override onClose(): void { this.commit = null; }
}
