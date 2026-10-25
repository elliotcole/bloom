// Typing a list: in a list mode, ↵ opens one line holding that list as text
// (intervals by name: -P5/10 +3rd+5th ·), ↵ again sets it, shift-↵ sets it
// looped round until it's as long as the notes, esc leaves it be.
//
// ← → select a whole entry at a time (a chord in brackets, a figure in
// parentheses, -P5/10), so typing replaces just that one.

/** The entries of a typed list, as [start, end) ranges: (…) and […] groups whole, else runs of non-space */
function entries(text: string): [number, number][] {
  return [...text.matchAll(/\([^)]*\)?|\[[^\]]*\]?|\S+/g)].map(m => [m.index!, m.index! + m[0].length]);
}

export class ListTyper {
  private el: HTMLElement;
  private label: HTMLElement;
  private input: HTMLInputElement;
  private err: HTMLElement;
  private commit: ((text: string, complete: boolean) => string | null) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'list-typer';
    this.el.innerHTML = '<span class="lt-label"></span><input type="text" spellcheck="false" autocomplete="off"><span class="lt-err"></span>';
    this.label = this.el.querySelector('.lt-label')!;
    this.input = this.el.querySelector('input')!;
    this.err = this.el.querySelector('.lt-err')!;
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.step(e.key === 'ArrowRight' ? 1 : -1);
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const problem = this.commit?.(this.input.value, e.shiftKey) ?? null;
        if (problem) this.err.textContent = problem; else this.close();
      }
    });
    this.input.addEventListener('input', () => { this.err.textContent = ''; });
    this.input.addEventListener('blur', () => this.close());
    parent.appendChild(this.el);
  }

  isOpen(): boolean { return this.el.classList.contains('open'); }

  /** Show `text` to edit; `commit` sets it (complete: loop it to the notes' length) and returns a problem to show, or null when done */
  open(label: string, text: string, commit: (text: string, complete: boolean) => string | null): void {
    this.commit = commit;
    this.label.textContent = label;
    this.input.value = text;
    this.err.textContent = '';
    this.el.classList.add('open');
    this.input.focus();
    this.input.select();
  }

  /** Select the next (1) or previous (-1) whole entry from the selection or caret */
  private step(dir: 1 | -1): void {
    const items = entries(this.input.value);
    if (!items.length) return;
    const a = this.input.selectionStart ?? 0, z = this.input.selectionEnd ?? a;
    const all = a === 0 && z === this.input.value.length && z > 0;
    const pick = all ? (dir > 0 ? items[0] : items[items.length - 1])
      : dir > 0 ? items.find(([s]) => s >= z) : [...items].reverse().find(([, e]) => e <= a);
    if (pick) this.input.setSelectionRange(pick[0], pick[1]);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.el.classList.remove('open');
    this.commit = null;
    this.input.blur();
  }
}
