// Command palette — open with Cmd+K, dot-chain commands, Tab/↑↓ to complete, ↵ to execute

import { Bloom } from '../core/Bloom';
import { Overlay, onKeys } from './overlay';

export interface PaletteCommand {
  /** Primary name and any aliases (all lowercase) */
  names: string[];
  /** Short description shown in autocomplete */
  description: string;
  /** Execute the command on the given bloom */
  fn: (bloom: Bloom) => void;
}

export class CommandPalette extends Overlay {
  private _input!: HTMLInputElement;
  private _suggestEl!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _commands: PaletteCommand[] = [];
  private _getBloom: () => Bloom;
  private _onExecute: (bloom: Bloom) => void;
  private _selectedIdx = -1;

  constructor(getBloom: () => Bloom, onExecute: (bloom: Bloom) => void) {
    super(CommandPalette._build(), { backdrop: true });
    this._getBloom   = getBloom;
    this._onExecute  = onExecute;
    this._input     = this.el.querySelector('#cp-input')!;
    this._suggestEl = this.el.querySelector('#cp-suggest')!;
    this._statusEl  = this.el.querySelector('#cp-status')!;
    this._input.addEventListener('input', () => this._refreshSuggestions());
    onKeys(this._input, {
      Escape: () => this.close(),
      Enter: () => this._execute(),
      Tab: () => this._completeFirst(),
      ArrowDown: () => this._moveSel(1),
      ArrowUp: () => this._moveSel(-1),
    });
  }

  /** Register a command. `names[0]` is the canonical name shown in autocomplete. */
  register(names: string | string[], description: string, fn: (bloom: Bloom) => void): void {
    const nameArr = (Array.isArray(names) ? names : [names]).map(n => n.toLowerCase());
    this._commands.push({ names: nameArr, description, fn });
  }

  // ─── Build UI ───────────────────────────────────────────────────────────────

  private static _build(): HTMLElement {
    const ov = document.createElement('div');
    ov.id = 'cmd-palette';

    ov.innerHTML = `
      <div id="cp-box">
        <div class="cp-hint">dot-chain commands · tab/↑↓ complete · ↵ execute · esc close</div>
        <input id="cp-input" class="cp-input" type="text" spellcheck="false"
               autocomplete="off" placeholder="scramble.pivot.softer.softer">
        <div id="cp-suggest" class="cp-suggest"></div>
        <div id="cp-status" class="cp-status"></div>
      </div>
    `;

    return ov;
  }

  // ─── Autocomplete ───────────────────────────────────────────────────────────

  /** The segment currently being typed (after the last '.') */
  private _currentSegment(): string {
    const val = this._input.value;
    const dot = val.lastIndexOf('.');
    return (dot === -1 ? val : val.slice(dot + 1)).toLowerCase();
  }

  private _refreshSuggestions(): void {
    const seg = this._currentSegment();
    this._selectedIdx = -1;
    this._suggestEl.innerHTML = '';
    if (!seg) return;

    const matches = this._commands.filter(c =>
      c.names.some(n => n.startsWith(seg)),
    ).slice(0, 10);

    for (const cmd of matches) {
      const div = document.createElement('div');
      div.className = 'cp-sug';
      div.dataset.name = cmd.names[0];
      div.innerHTML =
        `<span class="cp-sug-name">${cmd.names[0]}</span>` +
        `<span class="cp-sug-desc">${cmd.description}</span>`;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._applySuggestion(cmd.names[0]);
      });
      this._suggestEl.appendChild(div);
    }
  }

  private _moveSel(dir: number): void {
    const items = Array.from(this._suggestEl.querySelectorAll<HTMLElement>('.cp-sug'));
    if (!items.length) return;
    items[this._selectedIdx]?.classList.remove('active');
    this._selectedIdx = Math.max(-1, Math.min(items.length - 1, this._selectedIdx + dir));
    items[this._selectedIdx]?.classList.add('active');
    items[this._selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  private _completeFirst(): void {
    const active = this._suggestEl.querySelector<HTMLElement>('.cp-sug.active');
    const first  = (active ?? this._suggestEl.querySelector<HTMLElement>('.cp-sug'));
    if (first?.dataset.name) this._applySuggestion(first.dataset.name);
  }

  private _applySuggestion(name: string): void {
    const val = this._input.value;
    const dot = val.lastIndexOf('.');
    this._input.value = (dot === -1 ? '' : val.slice(0, dot + 1)) + name;
    this._refreshSuggestions();
    this._input.focus();
  }

  // ─── Execution ──────────────────────────────────────────────────────────────

  private _findCommand(seg: string): PaletteCommand | null {
    const name = seg.toLowerCase();
    return this._commands.find(c => c.names.includes(name)) ?? null;
  }

  private _execute(): void {
    const raw = this._input.value.trim();
    if (!raw) { this.close(); return; }

    const segments = raw.split('.').map(s => s.trim()).filter(Boolean);
    const bloom = this._getBloom();
    const errors: string[] = [];
    const executed: string[] = [];

    for (const seg of segments) {
      const cmd = this._findCommand(seg);
      if (!cmd) { errors.push(`unknown: "${seg}"`); continue; }
      try {
        cmd.fn(bloom);
        executed.push(cmd.names[0]);
      } catch (err) {
        errors.push(`error in "${seg}": ${(err as Error).message ?? err}`);
      }
    }

    if (errors.length) {
      this._showStatus('⚠ ' + errors.join(' · '), 'err');
      return;
    }

    this._onExecute(bloom);
    this._showStatus('✓ ' + executed.join(' → '), 'ok');
    this._input.value = '';
    this._suggestEl.innerHTML = '';

    // Close briefly after success (unless it's been reopened meanwhile)
    if (this._closeTimer !== null) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => { this._closeTimer = null; this.close(); }, 700);
  }

  private _showStatus(msg: string, type: 'ok' | 'err' | ''): void {
    this._statusEl.textContent = msg;
    this._statusEl.className = `cp-status${type ? ' cp-status--' + type : ''}`;
  }

  // ─── Open / close ───────────────────────────────────────────────────────────

  private _closeTimer: ReturnType<typeof setTimeout> | null = null;

  open(): void {
    if (this._closeTimer !== null) { clearTimeout(this._closeTimer); this._closeTimer = null; }
    this._input.value = '';
    this._suggestEl.innerHTML = '';
    this._statusEl.textContent = '';
    this._statusEl.className = 'cp-status';
    this._selectedIdx = -1;
    this.show(this._input);
  }
}
