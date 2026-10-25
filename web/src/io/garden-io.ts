// Garden save / load — serialises current bloom + all garden slots to JSON

import { Bloom } from '../core/Bloom';
import { Garden } from '../garden';
import type { Scale } from '../lib/scales';
import type { Tuning } from '../lib/tuning';

// ─── JSON types ───────────────────────────────────────────────────────────────

interface BloomJSON {
  notes: unknown;           // NoteArray — may be nested
  velocities: number[];
  timeIntervals: number[];
  chans: number[];
  intervals?: unknown;          // IntervalVal[] — absent in files saved before intervals existed
  intervalsDiatonic?: boolean;
  lowestPossibleNote: number;
  highestPossibleNote: number;
  lowestSeedNote: number;
  highestSeedNote: number;
  timeRangeLow: number;
  timeRangeHi: number;
  legato: number;
  sustain: number | null;
  appliedScale: Scale | null;
  keyRoot: number;
  name: string;
  tuning?: Tuning | null;   // absent in files saved before tunings existed
  tuningRoot?: number;
}

interface GardenFile {
  version: 1;
  savedAt?: number;         // ms since epoch — autosave only
  bloom: BloomJSON;
  garden: {
    cursor: number;
    slots: (BloomJSON | null)[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bloomToJSON(b: Bloom): BloomJSON {
  return {
    notes: JSON.parse(JSON.stringify(b.notes)),
    velocities: [...b.velocities],
    timeIntervals: [...b.timeIntervals],
    chans: [...b.chans],
    intervals: JSON.parse(JSON.stringify(b.intervals)),
    intervalsDiatonic: b.intervalsDiatonic,
    lowestPossibleNote: b.lowestPossibleNote,
    highestPossibleNote: b.highestPossibleNote,
    lowestSeedNote: b.lowestSeedNote,
    highestSeedNote: b.highestSeedNote,
    timeRangeLow: b.timeRangeLow,
    timeRangeHi: b.timeRangeHi,
    legato: b.legato,
    sustain: b.sustain,
    appliedScale: b.appliedScale
      ? { ...b.appliedScale, degrees: [...b.appliedScale.degrees] }
      : null,
    keyRoot: b.keyRoot,
    name: b.name,
    tuning: b.tuning ? JSON.parse(JSON.stringify(b.tuning)) as Tuning : null,
    tuningRoot: b.tuningRoot,
  };
}

function bloomFromJSON(json: BloomJSON): Bloom {
  const b = new Bloom();
  b.notes = json.notes as Bloom['notes'];
  b.velocities = json.velocities;
  b.timeIntervals = json.timeIntervals;
  b.chans = json.chans;
  if (Array.isArray(json.intervals) && json.intervals.length > 0) {
    b.intervals = json.intervals as Bloom['intervals'];
  }
  b.adoptLegacyIntervals(json.intervalsDiatonic ?? false);   // older saves: one unit for every interval
  b.lowestPossibleNote = json.lowestPossibleNote;
  b.highestPossibleNote = json.highestPossibleNote;
  b.lowestSeedNote = json.lowestSeedNote;
  b.highestSeedNote = json.highestSeedNote;
  b.timeRangeLow = json.timeRangeLow;
  b.timeRangeHi = json.timeRangeHi;
  b.legato = json.legato;
  b.sustain = json.sustain;
  b.appliedScale = json.appliedScale;
  b.keyRoot = json.keyRoot;
  b.name = json.name ?? '';
  b.tuning = json.tuning ?? null;
  b.tuningRoot = json.tuningRoot ?? 0;
  return b;
}

function toGardenFile(bloom: Bloom, garden: Garden): GardenFile {
  return {
    version: 1,
    bloom: bloomToJSON(bloom),
    garden: {
      cursor: garden.cursor,
      slots: garden.slots.map(s => (s ? bloomToJSON(s) : null)),
    },
  };
}

function applyGardenFile(data: GardenFile, bloom: Bloom, garden: Garden): void {
  if (data.version !== 1) throw new Error(`unknown version ${data.version}`);
  bloom.import(bloomFromJSON(data.bloom));
  garden.slots = data.garden.slots.map(s => (s ? bloomFromJSON(s) : null));
  garden.cursor = Math.max(0, Math.min(data.garden.cursor, garden.slots.length - 1));
}

// ─── Autosave (localStorage) ──────────────────────────────────────────────────

const AUTOSAVE_KEY = 'bloom-garden-autosave';
let _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Mirror the current state to localStorage, debounced. Best-effort — never throws. */
export function autosaveGarden(bloom: Bloom, garden: Garden): void {
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    _autosaveTimer = null;
    try {
      const file = { ...toGardenFile(bloom, garden), savedAt: Date.now() };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
    } catch {
      // storage full or unavailable — autosave is best-effort
    }
  }, 250);
}

export interface AutosaveInfo {
  raw: string;
  savedAt: number | null;
  blooms: number;           // filled garden slots
  notes: number;            // notes in the current bloom
}

/** Look at the last autosave without applying it; null if there is none. */
export function peekAutosave(): AutosaveInfo | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as GardenFile;
    if (data.version !== 1) return null;
    const notes = Array.isArray(data.bloom.notes) ? data.bloom.notes.length : 0;
    return {
      raw,
      savedAt: data.savedAt ?? null,
      blooms: data.garden.slots.filter(Boolean).length,
      notes,
    };
  } catch {
    return null;
  }
}

/** Apply an autosave found by peekAutosave. Returns true if state was restored. */
export function restoreAutosave(raw: string, bloom: Bloom, garden: Garden): boolean {
  try {
    applyGardenFile(JSON.parse(raw) as GardenFile, bloom, garden);
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function saveGarden(bloom: Bloom, garden: Garden): void {
  const file = toGardenFile(bloom, garden);

  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/T/, '-').replace(/:/g, '');
  a.download = `garden-${ts}.bloom`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadGarden(
  bloom: Bloom,
  garden: Garden,
  onDone: (err?: string) => void,
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bloom,.json,application/json';

  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) { onDone(); return; }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyGardenFile(JSON.parse(reader.result as string) as GardenFile, bloom, garden);
        onDone();
      } catch (err) {
        onDone(`load failed: ${(err as Error).message}`);
      }
    };
    reader.onerror = () => onDone('could not read file');
    reader.readAsText(file);
  };

  input.click();
}
