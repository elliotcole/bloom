// Where tunings go: the bloom-mts helper (an MTS-ESP master, reached through a
// virtual MIDI port named "Bloom Tuning"), and the built-in piano. Also keeps the
// library of tunings loaded from .scl files.

import type { Bloom } from '../core/Bloom';
import { EQUAL, freqTable, keyRootOf, mtsMessages, nameMessage, parseScala } from '../lib/tuning';
import type { Tuning } from '../lib/tuning';
import { setPianoTuning } from './synth';

// ─── Library ──────────────────────────────────────────────────────────────────

const LIBRARY_KEY = 'bloom.tunings';
let _library: Tuning[] = [];
try {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (raw) _library = JSON.parse(raw) as Tuning[];
} catch { /* private window: starts empty */ }

function saveLibrary() {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(_library)); } catch { /* best effort */ }
}

/** 12-TET first, then the loaded tunings in the order they came */
export function tuningLibrary(): Tuning[] {
  return [EQUAL, ..._library];
}

/** Add .scl files; a file with the name of one already loaded replaces it. Returns what was skipped and why. */
export async function loadScalaFiles(files: FileList | File[]): Promise<{ added: number; skipped: string[] }> {
  const skipped: string[] = [];
  let added = 0;
  for (const f of [...files]) {
    if (!/\.scl$/i.test(f.name)) continue;
    const t = parseScala(await f.text(), f.name);
    if (typeof t === 'string') { skipped.push(`${f.name}: ${t}`); continue; }
    const at = _library.findIndex(x => x.name === t.name);
    if (at >= 0) _library[at] = t; else _library.push(t);
    added++;
  }
  _library.sort((a, b) => a.name.localeCompare(b.name));
  saveLibrary();
  if (added) void connectHelper();
  return { added, skipped };
}

/** Add a tuning to the library, replacing one of the same name */
export function saveToLibrary(t: Tuning): void {
  const copy = JSON.parse(JSON.stringify(t)) as Tuning;
  delete copy.root;
  copy.edited = false;
  const at = _library.findIndex(x => x.name === copy.name);
  if (at >= 0) _library[at] = copy; else _library.push(copy);
  _library.sort((a, b) => a.name.localeCompare(b.name));
  saveLibrary();
}

export function clearLibrary() {
  _library = [];
  saveLibrary();
}

/** The next (dir 1) or previous (−1) tuning in the library after this one, wrapping */
export function stepTuning(current: Tuning | null, dir: 1 | -1): Tuning | null {
  const lib = tuningLibrary();
  const at = Math.max(0, lib.findIndex(t => t.name === (current?.name ?? EQUAL.name)));
  const next = lib[(at + dir + lib.length) % lib.length];
  return next === EQUAL ? null : JSON.parse(JSON.stringify(next)) as Tuning;
}

// ─── Hold: one tuning over every bloom ────────────────────────────────────────
// opt-t holds the tuning that's sounding. While held it plays over every bloom
// (the garden, the loop, loads), and the tuning keys and the tuning view change
// it instead of the bloom; the blooms keep their own, which come back on
// release. Its root follows each bloom's key, or stays where it was held (a
// setting). Never persisted: every session starts with each bloom's own.

const HOLD_ROOT_KEY = 'bloom.holdRoot';
export type HoldRoot = 'key' | 'fixed';
let _held: { tuning: Tuning | null; root: number } | null = null;
let _holdRoot: HoldRoot = (() => {
  try { return localStorage.getItem(HOLD_ROOT_KEY) === 'fixed' ? 'fixed' : 'key'; } catch { return 'key'; }
})();

const copy = (t: Tuning | null): Tuning | null => t ? JSON.parse(JSON.stringify(t)) as Tuning : null;

export function isHeld(): boolean { return _held !== null; }
/** Hold what this bloom sounds in */
export function hold(bloom: Bloom): void { _held = { tuning: copy(bloom.tuning), root: bloom.tuningRoot }; }
export function release(): void { _held = null; }
/** Replace the held tuning (null: 12-TET), keeping its root */
export function setHeldTuning(t: Tuning | null): void { if (_held) _held.tuning = copy(t); }
export function holdRoot(): HoldRoot { return _holdRoot; }
export function setHoldRoot(m: HoldRoot): void {
  _holdRoot = m;
  try { localStorage.setItem(HOLD_ROOT_KEY, m); } catch { /* best effort */ }
}

/** The tuning a bloom sounds in: the held one, else its own */
export function soundingTuning(bloom: Bloom): Tuning | null {
  return _held ? _held.tuning : bloom.tuning;
}
/** Where that tuning's root sits for this bloom */
export function soundingRoot(bloom: Bloom): number {
  if (!_held) return bloom.tuningRoot;
  const t = _held.tuning;
  if (t?.root !== undefined && t.root !== null) return t.root;   // chosen by hand
  if (_holdRoot === 'key') {
    const r = keyRootOf(bloom.scale.degrees);
    if (r !== null) _held.root = r;   // a set that implies no key keeps the last root
  }
  return _held.root;
}
/** The held tuning as a bloom's own (for a new bloom, or to keep it): a root that stays goes with it */
export function heldForBloom(): Tuning | null {
  const t = copy(_held?.tuning ?? null);
  if (t && _holdRoot === 'fixed' && (t.root === undefined || t.root === null)) t.root = _held!.root;
  return t;
}

// ─── The helper ───────────────────────────────────────────────────────────────

const HELPER_PORT = /bloom tuning/i;
let _access: MIDIAccess | null = null;
let _asking: Promise<void> | null = null;
let _onStatus: ((s: string) => void) | null = null;

export function onHelperStatus(cb: (s: string) => void) { _onStatus = cb; }

function helperPort(): MIDIOutput | null {
  if (!_access) return null;
  for (const o of _access.outputs.values()) if (HELPER_PORT.test(o.name ?? '')) return o;
  return null;
}

export function helperStatus(): string {
  if (!_access) return 'helper: not asked yet (load a tuning)';
  return helperPort() ? 'helper: connected' : 'helper: not running (start bloom-mts)';
}

/** Ask for MIDI with SysEx (the browser asks once) and watch for the helper's port */
export function connectHelper(): Promise<void> {
  if (_access || _asking || !navigator.requestMIDIAccess) return _asking ?? Promise.resolve();
  _asking = navigator.requestMIDIAccess({ sysex: true }).then(acc => {
    _access = acc;
    acc.addEventListener('statechange', () => {
      _sentKey = '';   // a helper that has just started gets the table again
      if (_last) applyTuning(_last);
      _onStatus?.(helperStatus());
    });
    _onStatus?.(helperStatus());
  }).catch(() => {
    _onStatus?.('helper: SysEx not allowed in this browser');
  }).finally(() => { _asking = null; });
  return _asking;
}

// ─── Applying a bloom's tuning ────────────────────────────────────────────────

let _sentKey = '';
let _last: Bloom | null = null;

/** What a bloom sounds in: its tuning and where the tuning's root sits */
export function tuningKey(bloom: Bloom): string {
  const t = soundingTuning(bloom);
  return t ? `${t.name}|${t.cents.join(',')}|${t.period}|${soundingRoot(bloom)}` : '12-TET';
}

/** Retune the helper and the piano to this bloom's tuning, if it differs from the last one sent */
export function applyTuning(bloom: Bloom): void {
  _last = bloom;
  const t = soundingTuning(bloom);
  const key = tuningKey(bloom);
  if (key === _sentKey) return;
  const freqs = freqTable(t, soundingRoot(bloom));
  setPianoTuning(t ? freqs : null);
  const port = helperPort();
  if (t && !_access) void connectHelper();
  if (port) {
    try {
      port.send(nameMessage(t ? t.name : EQUAL.name));   // first, so the tables arrive under it
      for (const msg of mtsMessages(freqs)) port.send(msg);
    } catch { /* port went away */ }
  }
  _sentKey = port || !t ? key : '';
}
