// One base for the page's overlays: the command palette, the bloom editor, the
// list typer, and the scale, tuning and pattern pickers (those three on
// ui/picker.ts). Each is an element that's shown with the class `open`, takes
// the keyboard while it's open, gives it back on close (so the next key goes
// to the bloom), and can be closed by esc or a click on its backdrop. main.ts
// asks Overlay.anyOpen() before a key reaches the bloom.
//
// The keyboard is the overlay's for as long as it's open, wherever the focus
// has got to: a key from outside it goes back to its field (esc closes it), and
// a click on something in it that takes no focus leaves the focus where it was.

/** What to do with a key pressed while an overlay is open and the focus is outside it */
export interface StrayKey {
  /** close the overlay (esc) */
  close: boolean;
  /** put the focus back in the overlay's field */
  refocus: boolean;
  /** stop the browser's own action */
  prevent: boolean;
}

/**
 * A key that didn't come from inside the open overlay. Esc closes it. Anything
 * else sends the focus back to its field; ↵, space and tab are kept from what's
 * behind (a button would be pressed, the focus would move on), a letter is left
 * to land in the field, and the browser's own shortcuts are left alone.
 */
export function strayKey(key: string): StrayKey {
  if (key === 'Escape') return { close: true, refocus: false, prevent: true };
  return { close: false, refocus: true, prevent: key === 'Enter' || key === ' ' || key === 'Tab' };
}

/** The stop after `at` among `count` in a ring (before it, going `back`): tab never leaves */
export function tabStop(at: number, count: number, back: boolean): number {
  if (count <= 0) return -1;
  if (at < 0) return back ? count - 1 : 0;
  return (at + (back ? -1 : 1) + count) % count;
}

const FOCUSABLE = 'input, textarea, select, button, [tabindex]';

export abstract class Overlay {
  /** The open overlays, the latest last: that one has the keyboard */
  private static readonly _open = new Set<Overlay>();

  /** True while any overlay has the keyboard: the bloom's keys wait */
  static anyOpen(): boolean { return Overlay._open.size > 0; }

  private static _top(): Overlay | undefined { return [...Overlay._open].pop(); }

  /** A key anywhere on the page, before anything else hears it (only listening while an overlay is open) */
  private static readonly _onDocKey = (e: KeyboardEvent): void => {
    const top = Overlay._top();
    if (!top || top.el.contains(e.target as Node | null)) return;   // from inside: its own handlers have it
    e.stopPropagation();   // the bloom doesn't hear it
    const what = strayKey(e.key);
    if (what.prevent) e.preventDefault();
    if (what.close) top.close();
    if (what.refocus) top._refocus();
  };

  protected readonly el: HTMLElement;
  /** Where the keyboard goes on show, and where the focus last was inside */
  private _home: HTMLElement | null = null;
  private _last: HTMLElement | null = null;

  /**
   * `el` is the overlay's root, put under `parent` (the body). With `backdrop`,
   * a click on the root itself (outside its box) closes it.
   */
  protected constructor(el: HTMLElement, opts: { parent?: HTMLElement; backdrop?: boolean } = {}) {
    this.el = el;
    if (opts.backdrop) el.addEventListener('mousedown', e => { if (e.target === el) this.close(); });
    el.addEventListener('focusin', e => { this._last = e.target as HTMLElement; });
    // a click on a hint, a title, a header takes the focus off the field: once
    // the browser has moved it, put it back (not prevented: a scrollbar still drags)
    el.addEventListener('mousedown', e => {
      if ((e.target as HTMLElement).closest(FOCUSABLE)) return;
      setTimeout(() => { if (this.isOpen() && !el.contains(document.activeElement)) this._refocus(); }, 0);
    });
    // a key from something in the overlay with no handlers of its own (the scale
    // picker's root select, the editor's buttons): it stops here, esc closes.
    // The fields' own keys (onKeys) never get this far.
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    (opts.parent ?? document.body).appendChild(el);
  }

  isOpen(): boolean { return this.el.classList.contains('open'); }

  /** Show it, the keyboard in `focus` */
  protected show(focus?: HTMLElement): void {
    this.el.classList.add('open');
    if (!Overlay._open.size) document.addEventListener('keydown', Overlay._onDocKey, true);
    Overlay._open.delete(this);   // shown again while open: it's the top one now
    Overlay._open.add(this);
    this._home = focus ?? null;
    this._last = null;
    focus?.focus();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.el.classList.remove('open');
    Overlay._open.delete(this);
    if (!Overlay._open.size) document.removeEventListener('keydown', Overlay._onDocKey, true);
    const active = document.activeElement as HTMLElement | null;
    if (active && this.el.contains(active)) active.blur();   // keys go back to the bloom
    this.onClose?.();
  }

  /** The focus back where it last was in the overlay, or in its first field */
  private _refocus(): void {
    const to = this._last && this._last.isConnected && this._last.offsetParent !== null ? this._last : this._home;
    to?.focus();
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
