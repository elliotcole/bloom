// One base for the page's overlays: the command palette, the bloom editor, the
// scale picker and the list typer. Each is an element that's shown with the
// class `open`, takes the keyboard while it's open, gives it back on close
// (so the next key goes to the bloom), and can be closed by esc or a click on
// its backdrop. main.ts asks Overlay.anyOpen() before a key reaches the bloom.

export abstract class Overlay {
  private static readonly _open = new Set<Overlay>();

  /** True while any overlay has the keyboard: the bloom's keys wait */
  static anyOpen(): boolean { return Overlay._open.size > 0; }

  protected readonly el: HTMLElement;

  /**
   * `el` is the overlay's root, put under `parent` (the body). With `backdrop`,
   * a click on the root itself (outside its box) closes it.
   */
  protected constructor(el: HTMLElement, opts: { parent?: HTMLElement; backdrop?: boolean } = {}) {
    this.el = el;
    if (opts.backdrop) el.addEventListener('mousedown', e => { if (e.target === el) this.close(); });
    (opts.parent ?? document.body).appendChild(el);
  }

  isOpen(): boolean { return this.el.classList.contains('open'); }

  /** Show it, the keyboard in `focus` */
  protected show(focus?: HTMLElement): void {
    this.el.classList.add('open');
    Overlay._open.add(this);
    focus?.focus();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.el.classList.remove('open');
    Overlay._open.delete(this);
    const active = document.activeElement as HTMLElement | null;
    if (active && this.el.contains(active)) active.blur();   // keys go back to the bloom
    this.onClose?.();
  }

  /** After the overlay has closed */
  protected onClose?(): void;
}

/**
 * Keys on a field inside an overlay. Every key stops there (the bloom doesn't
 * hear it); the handlers named run for theirs, and the browser's own action is
 * prevented unless a handler returns false.
 */
export function onKeys(el: HTMLElement, handlers: Record<string, (e: KeyboardEvent) => void | false>): void {
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    const h = handlers[e.key];
    if (h && h(e) !== false) e.preventDefault();
  });
}
