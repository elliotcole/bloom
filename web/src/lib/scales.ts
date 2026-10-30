// Scale library and operations — ported from Scale.sc and Bloom.sc's Scale extensions

import { allTuples, flatNotes } from './arrays';
import type { NoteVal } from './arrays';
import { keyToDegree, degreeToKey, nearestInScale } from './numbers';
import { RAGAS } from './ragas';

export interface Scale {
  /** every pitch class it uses (a raga's: both its forms together) */
  degrees: number[];
  pitchesPerOctave: number;
  name: string;
  /** a raga whose arohana and avarohana differ: the pitch classes it rises and falls by (see fitByDirection) */
  up?: number[];
  down?: number[];
  /** a raga's Sa: the key it sets */
  root?: number;
}

function scale(degrees: number[], name: string, ppo: number = 12): Scale {
  return { degrees, pitchesPerOctave: ppo, name };
}

// ─── Scale library (12-tone ET only for v1) ───────────────────────────────────

export const SCALES: Record<string, Scale> = {
  // 5-note
  minorPentatonic: scale([0, 3, 5, 7, 10], 'Minor Pentatonic'),
  majorPentatonic: scale([0, 2, 4, 7, 9], 'Major Pentatonic'),
  ritusen:         scale([0, 2, 5, 7, 9], 'Ritusen'),
  egyptian:        scale([0, 2, 5, 7, 10], 'Egyptian'),
  kumoi:           scale([0, 2, 3, 7, 9], 'Kumoi'),
  hirajoshi:       scale([0, 2, 3, 7, 8], 'Hirajoshi'),
  iwato:           scale([0, 1, 5, 6, 10], 'Iwato'),
  chinese:         scale([0, 4, 6, 7, 11], 'Chinese'),
  indian:          scale([0, 4, 5, 7, 10], 'Indian'),
  pelog:           scale([0, 1, 3, 7, 8], 'Pelog'),
  prometheus:      scale([0, 2, 4, 6, 11], 'Prometheus'),
  scriabin:        scale([0, 1, 4, 7, 9], 'Scriabin'),
  gong:            scale([0, 2, 4, 7, 9], 'Gong'),
  shang:           scale([0, 2, 5, 7, 10], 'Shang'),
  jiao:            scale([0, 3, 5, 8, 10], 'Jiao'),
  zhi:             scale([0, 2, 5, 7, 9], 'Zhi'),
  yu:              scale([0, 3, 5, 7, 10], 'Yu'),
  // 6-note
  whole:           scale([0, 2, 4, 6, 8, 10], 'Whole Tone'),
  augmented:       scale([0, 3, 4, 7, 8, 11], 'Augmented'),
  augmented2:      scale([0, 1, 4, 5, 8, 9], 'Augmented 2'),
  hexMajor7:       scale([0, 2, 4, 7, 9, 11], 'Hex Major 7'),
  hexDorian:       scale([0, 2, 3, 5, 7, 10], 'Hex Dorian'),
  hexPhrygian:     scale([0, 1, 3, 5, 8, 10], 'Hex Phrygian'),
  hexSus:          scale([0, 2, 5, 7, 9, 10], 'Hex Sus'),
  hexMajor6:       scale([0, 2, 4, 5, 7, 9], 'Hex Major 6'),
  hexAeolian:      scale([0, 3, 5, 7, 8, 10], 'Hex Aeolian'),
  // 7-note
  major:           scale([0, 2, 4, 5, 7, 9, 11], 'Major'),
  ionian:          scale([0, 2, 4, 5, 7, 9, 11], 'Ionian'),
  dorian:          scale([0, 2, 3, 5, 7, 9, 10], 'Dorian'),
  phrygian:        scale([0, 1, 3, 5, 7, 8, 10], 'Phrygian'),
  lydian:          scale([0, 2, 4, 6, 7, 9, 11], 'Lydian'),
  mixolydian:      scale([0, 2, 4, 5, 7, 9, 10], 'Mixolydian'),
  aeolian:         scale([0, 2, 3, 5, 7, 8, 10], 'Aeolian'),
  minor:           scale([0, 2, 3, 5, 7, 8, 10], 'Natural Minor'),
  locrian:         scale([0, 1, 3, 5, 6, 8, 10], 'Locrian'),
  harmonicMinor:   scale([0, 2, 3, 5, 7, 8, 11], 'Harmonic Minor'),
  harmonicMajor:   scale([0, 2, 4, 5, 7, 8, 11], 'Harmonic Major'),
  melodicMinor:    scale([0, 2, 3, 5, 7, 9, 11], 'Melodic Minor'),
  melodicMajor:    scale([0, 2, 4, 5, 7, 8, 10], 'Melodic Major'),
  bartok:          scale([0, 2, 4, 5, 7, 8, 10], 'Bartok'),
  hindu:           scale([0, 2, 4, 5, 7, 8, 10], 'Hindu'),
  todi:            scale([0, 1, 3, 6, 7, 8, 11], 'Todi'),
  purvi:           scale([0, 1, 4, 6, 7, 8, 11], 'Purvi'),
  marva:           scale([0, 1, 4, 6, 7, 9, 11], 'Marva'),
  bhairav:         scale([0, 1, 4, 5, 7, 8, 11], 'Bhairav'),
  ahirbhairav:     scale([0, 1, 4, 5, 7, 9, 10], 'Ahirbhairav'),
  superLocrian:    scale([0, 1, 3, 4, 6, 8, 10], 'Super Locrian'),
  romanianMinor:   scale([0, 2, 3, 6, 7, 9, 10], 'Romanian Minor'),
  hungarianMinor:  scale([0, 2, 3, 6, 7, 8, 11], 'Hungarian Minor'),
  neapolitanMinor: scale([0, 1, 3, 5, 7, 8, 11], 'Neapolitan Minor'),
  enigmatic:       scale([0, 1, 4, 6, 8, 10, 11], 'Enigmatic'),
  spanish:         scale([0, 1, 4, 5, 7, 8, 10], 'Spanish'),
  leadingWhole:    scale([0, 2, 4, 6, 8, 10, 11], 'Leading Whole Tone'),
  lydianMinor:     scale([0, 2, 4, 6, 7, 8, 10], 'Lydian Minor'),
  neapolitanMajor: scale([0, 1, 3, 5, 7, 9, 11], 'Neapolitan Major'),
  locrianMajor:    scale([0, 2, 4, 5, 6, 8, 10], 'Locrian Major'),
  // 8-note
  diminished:      scale([0, 1, 3, 4, 6, 7, 9, 10], 'Diminished'),
  diminished2:     scale([0, 2, 3, 5, 6, 8, 9, 11], 'Diminished 2'),
  // 12-note
  chromatic:       scale([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'Chromatic'),
  // ragas, on C, after the scales so a pitch set is named after a scale first
  ...Object.fromEntries(RAGAS.map(r => [r.id, ragaScale(r.name, r.up, r.down)])),
};

function ragaScale(name: string, up: number[], down: number[]): Scale {
  const s: Scale = { ...scale([...new Set([...up, ...down])].sort((a, b) => a - b), name), root: 0 };
  if (up.join() !== down.join()) { s.up = up; s.down = down; }
  return s;
}

export const RAGA_SCALES: Scale[] = RAGAS.map(r => SCALES[r.id]);

export const ALL_SCALES = Object.values(SCALES);

// ─── Scale operations ─────────────────────────────────────────────────────────

export function scaleChoose(size: number = 7): Scale {
  const candidates = ALL_SCALES.filter(s => s.degrees.length === size && s.pitchesPerOctave === 12);
  if (candidates.length === 0) return SCALES.major;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Find scales with the most pitch classes in common with targetDegrees */
export function mostSimilarTo(targetDegrees: number[]): Scale[] {
  // Only look at 12-tone scales, exclude chromatic
  const candidates = ALL_SCALES.filter(s => s.pitchesPerOctave === 12 && s.degrees.length <= 10);
  const targetSet = new Set(targetDegrees.map(d => d % 12));

  const buckets: Scale[][] = Array.from({ length: 13 }, () => []);
  candidates.forEach(s => {
    const overlap = s.degrees.filter(d => targetSet.has(d % 12)).length;
    buckets[overlap].push(s);
  });

  // Return scales with most overlap
  for (let i = 12; i >= 0; i--) {
    if (buckets[i].length > 0) return buckets[i];
  }
  return [SCALES.chromatic];
}

const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** A pitch-class set as a comparable key, e.g. "0,2,4,5,7,9,11" */
export const pcsKey = (pcs: number[]): string =>
  [...new Set(pcs.map(d => ((d % 12) + 12) % 12))].sort((a, b) => a - b).join(',');

// Every catalogue scale on every root, one entry per distinct pitch-class set
// (named after the first template that makes it). Built once: ~700 sets.
let _rooted: { scale: Scale; key: string; set: Set<number> }[] | null = null;
function rootedScales() {
  if (_rooted) return _rooted;
  const seen = new Set<string>();
  _rooted = [];
  for (const sc of ALL_SCALES) {
    if (sc.pitchesPerOctave !== 12 || sc.degrees.length > 10) continue;
    for (let root = 0; root < 12; root++) {
      const moved = scaleTranspose(sc, root);
      const key = moved.degrees.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      _rooted.push({ scale: { ...moved, name: `${PC_NAMES[root]} ${sc.name}` }, key, set: new Set(moved.degrees) });
    }
  }
  return _rooted;
}

/**
 * The near neighbours of a pitch-class set, on any root: the scales sharing
 * the second-most pitch classes with it (the most is the set itself and its
 * supersets). Sets in `avoid` are left out while anything else is left, so a
 * walk of slants keeps moving outward instead of circling back.
 */
export function slantMatch(targetDegrees: number[], avoid: Set<string> = new Set()): Scale[] {
  const target = new Set(targetDegrees.map(d => ((d % 12) + 12) % 12));
  const buckets: { scale: Scale; key: string }[][] = Array.from({ length: 13 }, () => []);
  for (const r of rootedScales()) {
    let overlap = 0;
    r.set.forEach(d => { if (target.has(d)) overlap++; });
    buckets[overlap].push(r);
  }
  const nonEmpty = buckets.filter(b => b.length > 0);
  const near = nonEmpty.length < 2 ? (nonEmpty[0] ?? []) : nonEmpty[nonEmpty.length - 2];
  const fresh = near.filter(r => !avoid.has(r.key));
  const out = (fresh.length ? fresh : near).map(r => r.scale);
  return out.length ? out : [SCALES.major];
}

/**
 * Name a set of pitch classes after a catalogue scale it matches on some root,
 * e.g. [2, 4, 5, 7, 9, 11, 0] → "D Dorian". Empty string when nothing matches.
 */
export function nameScaleDegrees(pcs: number[]): string {
  const set = [...new Set(pcs.map(d => ((d % 12) + 12) % 12))].sort((a, b) => a - b);
  const key = set.join(',');
  for (const sc of ALL_SCALES) {
    if (sc.pitchesPerOctave !== 12 || sc.degrees.length !== set.length) continue;
    for (let root = 0; root < 12; root++) {
      const t = sc.degrees.map(d => (d + root) % 12).sort((a, b) => a - b).join(',');
      if (t === key) return `${PC_NAMES[root]} ${sc.name}`;
    }
  }
  return '';
}

/** Transpose scale degrees by t semitones (mod 12, sorted); a raga's forms and Sa go with them */
export function scaleTranspose(s: Scale, t: number): Scale {
  const move = (pcs: number[]) => pcs.map(d => (((d + t) % 12) + 12) % 12).sort((a, b) => a - b);
  const out: Scale = { degrees: move(s.degrees), pitchesPerOctave: s.pitchesPerOctave, name: s.name };
  if (s.up && s.down) { out.up = move(s.up); out.down = move(s.down); }
  if (s.root !== undefined) out.root = (((s.root + t) % 12) + 12) % 12;
  return out;
}

/**
 * A raga's notes as they sound: each takes the form of the step it goes on to.
 * A note followed by a higher one must be in the arohana, one followed by a
 * lower one in the avarohana; a repeat looks on to the next different note,
 * and the last note (or one before only rests) is free. So Yaman can rise to
 * Pa, but not rise from it. A note outside its form moves to the nearest note
 * of the form, the way the line is going (down on a tie when rising, up when
 * falling). The direction is read from the notes as written, before any move.
 * Chords and rests are left as they are; so is a scale whose forms are one.
 */
export function fitByDirection(notes: NoteVal[], sounding: (i: number) => boolean, s: Scale): NoteVal[] {
  if (!s.up || !s.down) return notes;
  const up = new Set(s.up), down = new Set(s.down);
  const pc = (m: number) => ((Math.round(m) % 12) + 12) % 12;
  const height = (v: NoteVal) => Array.isArray(v) ? Math.max(...(flatNotes([v]) as number[])) : v;
  return notes.map((v, i) => {
    if (Array.isArray(v) || !sounding(i)) return v;
    let next: number | null = null;
    for (let j = i + 1; j < notes.length && next === null; j++) {
      if (sounding(j) && height(notes[j]) !== v) next = height(notes[j]);
    }
    if (next === null) return v;
    const rising = next > v;
    const form = rising ? up : down;
    if (form.has(pc(v))) return v;
    for (let k = 1; k <= 6; k++) {
      const [first, second] = rising ? [v - k, v + k] : [v + k, v - k];
      if (form.has(pc(first))) return first;
      if (form.has(pc(second))) return second;
    }
    return v;
  });
}

/** Extract pitch class set from a set of MIDI notes */
export function notesToScale(notes: number[], ppo: number = 12): Scale {
  const pcs = [...new Set(notes.map(n => ((Math.round(n) % ppo) + ppo) % ppo))].sort((a, b) => a - b);
  return { degrees: pcs, pitchesPerOctave: ppo, name: '' };
}

// ─── Per-note scale operations (applied to arrays) ────────────────────────────

export function applyScaleToDegrees(
  notes: number[],
  scaleDegrees: number[],
  stepsPerOctave: number = 12
): number[] {
  return nearestInScaleUniqueArr(notes, scaleDegrees, stepsPerOctave);
}

export function keyToDegreeArr(notes: number[], scaleDegrees: number[], stepsPerOctave: number = 12): number[] {
  return notes.map(n => keyToDegree(n, scaleDegrees, stepsPerOctave));
}

export function degreeToKeyArr(degrees: number[], scaleDegrees: number[], stepsPerOctave: number = 12): number[] {
  return degrees.map(d => degreeToKey(d, scaleDegrees, stepsPerOctave));
}

/**
 * Snap notes to the scale. A note midway between two degrees takes whichever
 * leaves the most distinct pitch classes, so a cluster snaps to a chord rather
 * than a unison. Nearness wraps round the octave (lib/numbers keyToDegree).
 */
export function nearestInScaleUniqueArr(
  notes: number[],
  scaleDegrees: number[],
  stepsPerOctave: number = 12
): number[] {
  if (scaleDegrees.length === 0) return [...notes];
  const options = notes.map(n => {
    const d = keyToDegree(n, scaleDegrees, stepsPerOctave);
    const lo = Math.floor(d);
    if (Math.abs(d - lo - 0.5) < 0.001) {
      return [degreeToKey(lo, scaleDegrees, stepsPerOctave), degreeToKey(lo + 1, scaleDegrees, stepsPerOctave)];
    }
    return [degreeToKey(Math.round(d), scaleDegrees, stepsPerOctave)];
  });

  // If only 1 option per note, skip allTuples (performance)
  if (!options.some(o => o.length > 1)) return options.map(o => o[0]);

  // Cap at 12 notes to avoid exponential blowup
  const combos = allTuples(options.slice(0, 12));
  combos.sort((a, b) => new Set(b).size - new Set(a).size);
  const best = combos[0];
  if (notes.length > 12) {
    return [...best, ...notes.slice(12).map(n => nearestInScale(n, scaleDegrees, stepsPerOctave))];
  }
  return best;
}

/** Build diatonic chords from a scale */
export function diatonicChords(scaleDegrees: number[], chordTones: number[] = [1, 3, 5]): number[][] {
  const zeroIndexed = chordTones.map(t => t - 1);
  const bigScale = Array.from({ length: 10 }, (_, i) =>
    scaleDegrees.map(d => d + 12 * i)
  ).flat();
  return scaleDegrees.map((_, i) => zeroIndexed.map(t => bigScale[t + i]));
}

/** Get harmonizing chord options for a single note */
export function harmoniesForNote(
  note: number,
  scale: Scale,
  chordTones: number[] = [1, 3, 5],
  root: number = 0,
  depth: number = 0
): number[][] {
  if (depth > 12) return []; // prevent infinite recursion
  const pc = ((Math.round(note) % 12) + 12) % 12;
  const chords = diatonicChords(scale.degrees, chordTones);
  // Add root offset
  const options = chords
    .map(chord => chord.map(d => (d + root) % 12))
    .filter(chord => chord.includes(pc));

  if (options.length === 0) {
    // Try next root
    return harmoniesForNote(note, scale, chordTones, (root + 1) % 12, depth + 1);
  }

  // Move chords to just below the melody note
  return options.map(chord =>
    chord.map(d => {
      const target = note;
      let pitch = d;
      while (pitch > target) pitch -= 12;
      while (pitch < target - 12) pitch += 12;
      return pitch;
    })
  );
}
