// Command palette — open with Cmd+K, dot-chain commands, Tab/↑↓ to complete, ↵ to execute

import { Bloom } from '../core/Bloom';

export interface PaletteCommand {
  /** Primary name and any aliases (all lowercase) */
  names: string[];
  /** Short description shown in autocomplete */
  description: string;
  /** Execute the command on the given bloom */
  fn: (bloom: Bloom) => void;
}

export class CommandPalette {
  private _overlay: HTMLElement;
  private _input!: HTMLInputElement;
  private _suggestEl!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _commands: PaletteCommand[] = [];
  private _getBloom: () => Bloom;
  private _onExecute: (bloom: Bloom) => void;
  private _selectedIdx = -1;

  constructor(getBloom: () => Bloom, onExecute: (bloom: Bloom) => void) {
    this._getBloom   = getBloom;
    this._onExecute  = onExecute;
    this._overlay    = this._build();
    document.body.appendChild(this._overlay);
  }

  /** Register a command. `names[0]` is the canonical name shown in autocomplete. */
  register(names: string | string[], description: string, fn: (bloom: Bloom) => void): void {
    const nameArr = (Array.isArray(names) ? names : [names]).map(n => n.toLowerCase());
    this._commands.push({ names: nameArr, description, fn });
  }

  // ─── Build UI ───────────────────────────────────────────────────────────────

  private _build(): HTMLElement {
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

    this._input     = ov.querySelector('#cp-input')!;
    this._suggestEl = ov.querySelector('#cp-suggest')!;
    this._statusEl  = ov.querySelector('#cp-status')!;

    this._input.addEventListener('input', () => this._refreshSuggestions());

    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
      if (e.key === 'Enter')  { e.stopPropagation(); this._execute(); return; }
      if (e.key === 'Tab')    { e.preventDefault();  this._completeFirst(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSel(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moveSel(-1); return; }
    });

    // Click backdrop to close
    ov.addEventListener('click', (e) => { if (e.target === ov) this.close(); });

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

    // Close briefly after success
    setTimeout(() => this.close(), 700);
  }

  private _showStatus(msg: string, type: 'ok' | 'err' | ''): void {
    this._statusEl.textContent = msg;
    this._statusEl.className = `cp-status${type ? ' cp-status--' + type : ''}`;
  }

  // ─── Open / close ───────────────────────────────────────────────────────────

  open(): void {
    this._input.value = '';
    this._suggestEl.innerHTML = '';
    this._statusEl.textContent = '';
    this._statusEl.className = 'cp-status';
    this._selectedIdx = -1;
    this._overlay.classList.add('open');
    this._input.focus();
  }

  close(): void {
    this._overlay.classList.remove('open');
  }

  isOpen(): boolean {
    return this._overlay.classList.contains('open');
  }
}
