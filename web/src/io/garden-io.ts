// Garden save / load — serialises current bloom + all garden slots to JSON

import { Bloom } from '../core/Bloom';
import { Garden } from '../garden';
import type { Scale } from '../lib/scales';

// ─── JSON types ───────────────────────────────────────────────────────────────

interface BloomJSON {
  notes: unknown;           // NoteArray — may be nested
  velocities: number[];
  timeIntervals: number[];
  chans: number[];
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
}

interface GardenFile {
  version: 1;
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
  };
}

function bloomFromJSON(json: BloomJSON): Bloom {
  const b = new Bloom();
  b.notes = json.notes as Bloom['notes'];
  b.velocities = json.velocities;
  b.timeIntervals = json.timeIntervals;
  b.chans = json.chans;
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
  return b;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function saveGarden(bloom: Bloom, garden: Garden): void {
  const file: GardenFile = {
    version: 1,
    bloom: bloomToJSON(bloom),
    garden: {
      cursor: garden.cursor,
      slots: garden.slots.map(s => (s ? bloomToJSON(s) : null)),
    },
  };

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
        const data = JSON.parse(reader.result as string) as GardenFile;
        if (data.version !== 1) throw new Error(`unknown version ${data.version}`);

        bloom.import(bloomFromJSON(data.bloom));
        garden.slots = data.garden.slots.map(s => (s ? bloomFromJSON(s) : null));
        garden.cursor = Math.max(0, Math.min(data.garden.cursor, garden.slots.length - 1));

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
