// Manual bloom editor — open with Option+E, Ctrl+Enter to apply, Esc to close

import { Bloom } from '../core/Bloom';
import type { NoteVal } from '../lib/arrays';
import { spellOctave } from '../lib/numbers';

// ─── Note parsing / formatting ────────────────────────────────────────────────

const PC_TABLE: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function midiFromName(s: string): number | null {
  // Accepts: C4, Eb5, F#3, Bb-1, c4, eb5 etc.
  const m = s.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!m) return null;
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const pc = PC_TABLE[name];
  if (pc === undefined) return null;
  const oct = parseInt(m[2], 10);
  const midi = (oct + 1) * 12 + pc;
  return midi >= 0 && midi <= 127 ? midi : null;
}

function parseNoteScalar(s: string): number | null {
  // Integer first
  if (/^-?\d+$/.test(s)) {
    const v = parseInt(s, 10);
    return v >= 0 && v <= 127 ? v : null;
  }
  return midiFromName(s);
}

function parseNoteToken(s: string): NoteVal | null {
  s = s.trim();
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) return null;
    const parts = s.slice(1, -1).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const chord: number[] = [];
    for (const p of parts) {
      const n = parseNoteScalar(p);
      if (n === null) return null;
      chord.push(n);
    }
    return chord;
  }
  return parseNoteScalar(s);
}

/** Tokenize notes text, keeping [...] chord groups together */
function tokenizeNotes(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '[') { depth++; cur += ch; }
    else if (ch === ']') {
      depth--; cur += ch;
      if (depth === 0) { tokens.push(cur.trim()); cur = ''; }
    } else if (depth === 0 && /\s/.test(ch)) {
      if (cur.trim()) tokens.push(cur.trim());
      cur = '';
    } else { cur += ch; }
  }
  if (cur.trim()) tokens.push(cur.trim());
  return tokens;
}

function parseNoteList(text: string): { notes: NoteVal[]; error: string | null } {
  const tokens = tokenizeNotes(text);
  if (!tokens.length) return { notes: [], error: 'No notes entered' };
  const notes: NoteVal[] = [];
  for (const tok of tokens) {
    const n = parseNoteToken(tok);
    if (n === null) return { notes: [], error: `Invalid note: "${tok}"` };
    notes.push(n);
  }
  return { notes, error: null };
}

function parseIntList(
  text: string, min: number, max: number, label: string,
): { values: number[]; error: string | null } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { values: [], error: `No ${label} entered` };
  const values: number[] = [];
  for (const p of parts) {
    if (!/^-?\d+$/.test(p)) return { values: [], error: `Invalid ${label}: "${p}"` };
    const v = parseInt(p, 10);
    if (v < min || v > max) return { values: [], error: `${label} out of range: "${p}" (${min}–${max})` };
    values.push(v);
  }
  return { values, error: null };
}

function parseFloatList(text: string): { values: number[]; error: string | null } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { values: [], error: 'No times entered' };
  const values: number[] = [];
  for (const p of parts) {
    const v = parseFloat(p);
    if (isNaN(v) || v < 0) return { values: [], error: `Invalid time: "${p}" (must be ≥ 0)` };
    values.push(v);
  }
  return { values, error: null };
}

function parseDegrees(text: string): { degrees: number[] | null; error: string | null } {
  text = text.trim();
  if (!text) return { degrees: null, error: null }; // blank → keep current scale
  const parts = text.split(/\s+/).filter(Boolean);
  const degrees: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { degrees: null, error: `Invalid degree: "${p}" (must be 0–11)` };
    const v = parseInt(p, 10);
    if (v > 11) return { degrees: null, error: `Degree out of range: "${p}" (0–11)` };
    degrees.push(v);
  }
  if (degrees.length < 2) return { degrees: null, error: 'Scale needs at least 2 degrees' };
  return { degrees, error: null };
}

function formatNoteVal(n: NoteVal): string {
  if (Array.isArray(n)) return '[' + (n as number[]).map(spellOctave).join(' ') + ']';
  return spellOctave(n as number);
}

// ─── BloomEditor ──────────────────────────────────────────────────────────────

export class BloomEditor {
  private _overlay: HTMLElement;
  private _notesTA!: HTMLTextAreaElement;
  private _velTA!: HTMLTextAreaElement;
  private _timeTA!: HTMLTextAreaElement;
  private _chanTA!: HTMLTextAreaElement;
  private _scaleInp!: HTMLInputElement;
  private _statusEl!: HTMLElement;
  private _onApply: (bloom: Bloom) => void;
  private _bloom: Bloom | null = null;

  constructor(onApply: (bloom: Bloom) => void) {
    this._onApply = onApply;
    this._overlay = this._build();
    document.body.appendChild(this._overlay);
  }

  private _build(): HTMLElement {
    const ov = document.createElement('div');
    ov.id = 'bloom-editor';

    ov.innerHTML = `
      <div id="be-box">
        <div class="be-title">edit bloom <span class="be-hint">ctrl+↵ apply · esc close</span></div>
        <div class="be-row">
          <div class="be-lbl">notes<br><span class="be-sub">MIDI 0–127, C4, Eb5, [C4 E4 G4]</span></div>
          <textarea id="be-notes" class="be-ta" rows="3" spellcheck="false"></textarea>
        </div>
        <div class="be-row">
          <div class="be-lbl">velocities<br><span class="be-sub">integers 0–127</span></div>
          <textarea id="be-vel" class="be-ta" rows="2" spellcheck="false"></textarea>
        </div>
        <div class="be-row">
          <div class="be-lbl">times<br><span class="be-sub">beats ≥ 0</span></div>
          <textarea id="be-time" class="be-ta" rows="2" spellcheck="false"></textarea>
        </div>
        <div class="be-row">
          <div class="be-lbl">channels<br><span class="be-sub">integers 0–15</span></div>
          <textarea id="be-chan" class="be-ta" rows="1" spellcheck="false"></textarea>
        </div>
        <div class="be-row">
          <div class="be-lbl">scale<br><span class="be-sub">degrees 0–11 · blank=keep</span></div>
          <input id="be-scale" class="be-inp" type="text" spellcheck="false">
        </div>
        <div id="be-status" class="be-status"></div>
        <div class="be-btns">
          <button id="be-apply">apply (ctrl+↵)</button>
          <button id="be-close">close (esc)</button>
        </div>
      </div>
    `;

    this._notesTA  = ov.querySelector('#be-notes')!;
    this._velTA    = ov.querySelector('#be-vel')!;
    this._timeTA   = ov.querySelector('#be-time')!;
    this._chanTA   = ov.querySelector('#be-chan')!;
    this._scaleInp = ov.querySelector('#be-scale')!;
    this._statusEl = ov.querySelector('#be-status')!;

    ov.querySelector('#be-apply')!.addEventListener('click', () => this._apply());
    ov.querySelector('#be-close')!.addEventListener('click', () => this.close());

    // Click on the overlay backdrop closes
    ov.addEventListener('click', (e) => { if (e.target === ov) this.close(); });

    // Keyboard shortcuts inside modal
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.stopPropagation(); this._apply(); }
    });

    return ov;
  }

  open(bloom: Bloom): void {
    this._bloom = bloom;
    this._notesTA.value  = bloom.notes.map(formatNoteVal).join('  ');
    this._velTA.value    = bloom.velocities.join(' ');
    this._timeTA.value   = bloom.timeIntervals.join(' ');
    this._chanTA.value   = bloom.chans.join(' ');
    this._scaleInp.value = bloom.scale.degrees.join(' ');
    this._statusEl.textContent = '';
    this._statusEl.className = 'be-status';
    this._overlay.classList.add('open');
    this._notesTA.focus();
    this._notesTA.select();
  }

  close(): void {
    this._overlay.classList.remove('open');
  }

  isOpen(): boolean {
    return this._overlay.classList.contains('open');
  }

  private _apply(): void {
    if (!this._bloom) return;
    const b = this._bloom;

    const nr = parseNoteList(this._notesTA.value);
    if (nr.error) { this._err(nr.error); return; }

    const vr = parseIntList(this._velTA.value, 0, 127, 'velocity');
    if (vr.error) { this._err(vr.error); return; }

    const tr = parseFloatList(this._timeTA.value);
    if (tr.error) { this._err(tr.error); return; }

    const cr = parseIntList(this._chanTA.value, 0, 15, 'channel');
    if (cr.error) { this._err(cr.error); return; }

    const sr = parseDegrees(this._scaleInp.value);
    if (sr.error) { this._err(sr.error); return; }

    b.notes         = nr.notes;
    b.velocities    = vr.values;
    b.timeIntervals = tr.values;
    b.chans         = cr.values;
    if (sr.degrees) b.applyScale(sr.degrees);

    this._onApply(b);
    this._ok('applied');
  }

  private _err(msg: string): void {
    this._statusEl.textContent = '⚠ ' + msg;
    this._statusEl.className = 'be-status be-status--err';
  }

  private _ok(msg: string): void {
    this._statusEl.textContent = '✓ ' + msg;
    this._statusEl.className = 'be-status be-status--ok';
  }
}
