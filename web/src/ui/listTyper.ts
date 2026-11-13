// Typing a list: in a list mode, ↵ opens one line holding that list as text
// (intervals by name: -P5/10 +3rd+5th ·), ↵ again sets it, shift-↵ sets it
// looped round until it's as long as the notes, esc leaves it be.
//
// ← → select a whole entry at a time (a chord in brackets, a figure in
// parentheses, -P5/10), so typing replaces just that one.
//
// A line can carry more fields after the list (figures: how they take their
// time, their durations, their velocity): tab moves between them, round from
// the last to the first, ↵ in any sets the lot. A choice is changed with ← →
// or its first letter.
//
// The line closes when the focus goes elsewhere on the page, unless something
// was typed: then it stays, saying so, and the next key comes back to it.

/** A field after the list: a choice of words, or a line of text (shown only while `when` holds) */
export type TyperField =
  | { kind: 'choice'; label: string; options: string[]; value: string }
  | { kind: 'text'; label: string; value: string; size?: number; when?: (values: string[]) => boolean };

import { Overlay, onKeys, tabStop } from './overlay';

/** The entries of a typed list, as [start, end) ranges: (…) and […] groups whole, else runs of non-space */
function entries(text: string): [number, number][] {
  return [...text.matchAll(/\([^)]*\)?|\[[^\]]*\]?|\S+/g)].map(m => [m.index!, m.index! + m[0].length]);
}

/**
 * The focus has left the line. With the window itself out of focus (cmd-tab)
 * nothing happens: what's typed waits. Gone elsewhere on the page, the line
 * closes if nothing was changed, and is kept (with a word about it) if
 * something was: nothing typed is lost without a say.
 */
export function onLeave(windowFocused: boolean, changed: boolean): 'wait' | 'close' | 'keep' {
  if (!windowFocused) return 'wait';
  return changed ? 'keep' : 'close';
}

const NOT_SET = 'not set yet: ↵ sets it, esc leaves it';

type Keys = Record<string, (e: KeyboardEvent) => void | false>;

export class ListTyper extends Overlay {
  private label: HTMLElement;
  private input: HTMLInputElement;
  private err: HTMLElement;
  private commit: ((text: string, complete: boolean, values: string[]) => string | null) | null = null;
  private fieldsEl: HTMLElement;
  private fields: TyperField[] = [];
  private values: string[] = [];
  /** The text and values the line opened with: any difference is something typed */
  private opened = '';

  constructor(parent: HTMLElement) {
    super(document.createElement('div'), { parent });
    this.el.id = 'list-typer';
    this.el.innerHTML = '<span class="lt-label"></span><input type="text" spellcheck="false" autocomplete="off"><span class="lt-fields"></span><span class="lt-err"></span>';
    this.label = this.el.querySelector('.lt-label')!;
    this.input = this.el.querySelector('input')!;
    this.fieldsEl = this.el.querySelector('.lt-fields')!;
    this.err = this.el.querySelector('.lt-err')!;
    onKeys(this.input, this.textKeys(this.input));
    this.el.addEventListener('input', () => { this.err.textContent = ''; });
    // a click on the label or the message leaves the focus where it is
    this.el.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('input, .lt-choice')) e.preventDefault(); });
    // the focus has left the line (not moved between its fields)
    this.el.addEventListener('focusout', (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (!this.isOpen() || (to && this.el.contains(to))) return;
      const what = onLeave(document.hasFocus(), this.state() !== this.opened);
      if (what === 'close') this.close();
      else if (what === 'keep') this.err.textContent = NOT_SET;
    });
  }

  /** Everything that can be typed here, as one string to compare */
  private state(): string { return JSON.stringify([this.input.value, this.values]); }

  /** The keys every field has: esc leaves, ↵ sets, tab goes round the fields */
  private readonly keys: Keys = {
    Escape: () => this.close(),
    Enter: e => this.done(e.shiftKey),
    Tab: e => this.tab(e.shiftKey),
  };

  /** The keys of the list or a text field: the shared ones, and ← → step through the entries */
  private textKeys(input: HTMLInputElement): Keys {
    const step = (dir: 1 | -1) => (e: KeyboardEvent) =>
      e.shiftKey || e.altKey || e.metaKey || e.ctrlKey ? false : this.step(input, dir);   // with a modifier, the browser's own
    return { ...this.keys, ArrowLeft: step(-1), ArrowRight: step(1) };
  }

  /** Tab: on to the next field showing, round from the last to the first (shift: back) */
  private tab(back: boolean): void {
    const stops = [...this.el.querySelectorAll<HTMLElement>('input, .lt-choice')].filter(el => el.offsetParent !== null);
    stops[tabStop(stops.indexOf(document.activeElement as HTMLElement), stops.length, back)]?.focus();
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
    this.opened = this.state();
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
        const set = (opt: string) => { this.values[k] = opt; paint(); this.showFields(); };
        f.options.forEach(opt => {
          const o = document.createElement('span');
          o.textContent = opt;
          o.addEventListener('mousedown', ev => { ev.preventDefault(); set(opt); box.focus(); });
          box.appendChild(o);
        });
        const turn = (d: 1 | -1) => () => set(f.options[(f.options.indexOf(this.values[k]) + d + f.options.length) % f.options.length]);
        // an option's first letter chooses it (the first of two that share one), in either case
        const letters: Keys = {};
        for (const opt of f.options) {
          const pick = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey || e.altKey ? false : set(opt));
          for (const key of [opt[0].toLowerCase(), opt[0].toUpperCase()]) letters[key] ??= pick;
        }
        onKeys(box, { ...letters, ...this.keys, ArrowLeft: turn(-1), ArrowRight: turn(1) });
        paint();
        wrap.appendChild(box);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        inp.value = f.value;
        inp.size = f.size ?? 6;
        onKeys(inp, this.textKeys(inp));
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
