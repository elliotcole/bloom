// Garden save / load — serialises current bloom + all garden slots to JSON

import { Bloom } from '../core/Bloom';
import { Garden } from '../garden';
import type { Scale } from '../lib/scales';
import type { Tuning } from '../lib/tuning';

// ─── JSON types ───────────────────────────────────────────────────────────────

export interface BloomJSON {
  notes: unknown;           // NoteArray — may be nested
  velocities: number[];
  timeIntervals: number[];
  chans: number[];
  intervals?: unknown;          // IntervalVal[] — absent in files saved before intervals existed
  intervalsDiatonic?: boolean;
  figures?: unknown;            // Figure[] — absent in files saved before figures existed
  figureTime?: string;          // divide | insert | superimpose (absent: divide)
  figureDurs?: number[];
  figureVel?: number;
  intervalVel?: number;
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

export function bloomToJSON(b: Bloom): BloomJSON {
  return {
    notes: JSON.parse(JSON.stringify(b.notes)),
    velocities: [...b.velocities],
    timeIntervals: [...b.timeIntervals],
    chans: [...b.chans],
    intervals: JSON.parse(JSON.stringify(b.intervals)),
    intervalsDiatonic: b.intervalsDiatonic,
    figures: JSON.parse(JSON.stringify(b.figures)),
    figureTime: b.figureTime,
    figureDurs: [...b.figureDurs],
    figureVel: b.figureVel,
    intervalVel: b.intervalVel,
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

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNoteVal = (x: unknown): boolean => isNum(x) || (Array.isArray(x) && x.length > 0 && x.every(isNoteVal));
/** The list if it's a non-empty list of what it should be; else the fallback */
function listOf<T>(x: unknown, ok: (v: unknown) => boolean, fallback: T[]): T[] {
  return Array.isArray(x) && x.length > 0 && x.every(ok) ? (x as T[]) : fallback;
}

export function bloomFromJSON(json: BloomJSON): Bloom {
  const b = new Bloom();
  b.notes = listOf(json.notes, isNoteVal, [60]) as Bloom['notes'];
  b.velocities = listOf(json.velocities, isNum, [60]);
  b.timeIntervals = listOf(json.timeIntervals, v => isNum(v) && (v as number) > 0, [0.25]);
  b.chans = listOf(json.chans, isNum, [0]);
  if (Array.isArray(json.intervals) && json.intervals.length > 0) {
    b.intervals = json.intervals as Bloom['intervals'];
  }
  b.adoptLegacyIntervals(json.intervalsDiatonic ?? false);
  if (Array.isArray(json.figures) && json.figures.length > 0) b.figures = json.figures as Bloom['figures'];   // older saves: one unit for every interval
  if (json.figureTime === 'insert' || json.figureTime === 'superimpose' || json.figureTime === 'divide') b.figureTime = json.figureTime;
  // saved before figures chose their time: garden figures were superimposed, runs divided
  else if (b.figures.some(f => typeof f === 'object' && f !== null && !Array.isArray(f)) && !b.figures.some(Array.isArray)) b.figureTime = 'superimpose';
  if (Array.isArray(json.figureDurs) && json.figureDurs.length && json.figureDurs.every(x => typeof x === 'number' && x > 0)) b.figureDurs = json.figureDurs;
  if (typeof json.figureVel === 'number') b.figureVel = json.figureVel;
  if (typeof json.intervalVel === 'number') b.intervalVel = json.intervalVel;
  const num = (x: unknown, d: number) => (isNum(x) ? x : d);
  b.lowestPossibleNote = num(json.lowestPossibleNote, b.lowestPossibleNote);
  b.highestPossibleNote = num(json.highestPossibleNote, b.highestPossibleNote);
  b.lowestSeedNote = num(json.lowestSeedNote, b.lowestSeedNote);
  b.highestSeedNote = num(json.highestSeedNote, b.highestSeedNote);
  b.timeRangeLow = num(json.timeRangeLow, b.timeRangeLow);
  b.timeRangeHi = num(json.timeRangeHi, b.timeRangeHi);
  b.legato = num(json.legato, b.legato);
  b.sustain = json.sustain === null ? null : num(json.sustain, b.sustain ?? 4);
  b.appliedScale = json.appliedScale && Array.isArray(json.appliedScale.degrees) ? json.appliedScale : null;
  b.keyRoot = num(json.keyRoot, 0);
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

// ─── The session, set aside while a take plays and put back after ────────────

export function sessionNow(bloom: Bloom, garden: Garden): string {
  return JSON.stringify(toGardenFile(bloom, garden));
}
export function restoreSession(raw: string, bloom: Bloom, garden: Garden): void {
  applyGardenFile(JSON.parse(raw) as GardenFile, bloom, garden);
}

// ─── Autosave (localStorage) ──────────────────────────────────────────────────

let _autosavePaused = false;
/** A take playing back moves the blooms about; autosave keeps the session as it was */
export function pauseAutosave(on: boolean): void { _autosavePaused = on; }

const AUTOSAVE_KEY = 'bloom-garden-autosave';
let _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Mirror the current state to localStorage, debounced. Best-effort — never throws. */
export function autosaveGarden(bloom: Bloom, garden: Garden): void {
  if (_autosavePaused) return;
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
