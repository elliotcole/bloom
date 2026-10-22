// Where tunings go: the bloom-mts helper (an MTS-ESP master, reached through a
// virtual MIDI port named "Bloom Tuning"), and the built-in piano. Also keeps the
// library of tunings loaded from .scl files.

import type { Bloom } from '../core/Bloom';
import { EQUAL, freqTable, mtsMessages, nameMessage, parseScala } from '../lib/tuning';
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

export function clearLibrary() {
  _library = [];
  saveLibrary();
}

/** The next (dir 1) or previous (−1) tuning in the library after this one, wrapping */
export function stepTuning(current: Tuning | null, dir: 1 | -1): Tuning | null {
  const lib = tuningLibrary();
  const at = Math.max(0, lib.findIndex(t => t.name === (current?.name ?? EQUAL.name)));
  const next = lib[(at + dir + lib.length) % lib.length];
  return next === EQUAL ? null : { ...next, cents: [...next.cents] };
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
  const t = bloom.tuning;
  return t ? `${t.name}|${t.cents.join(',')}|${t.period}|${bloom.tuningRoot}` : '12-TET';
}

/** Retune the helper and the piano to this bloom's tuning, if it differs from the last one sent */
export function applyTuning(bloom: Bloom): void {
  _last = bloom;
  const t = bloom.tuning;
  const key = tuningKey(bloom);
  if (key === _sentKey) return;
  const freqs = freqTable(t, bloom.tuningRoot);
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
