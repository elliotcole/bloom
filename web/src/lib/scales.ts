// Scale library and operations — ported from Scale.sc and Bloom.sc's Scale extensions

import { indexInBetween, allTuples } from './arrays';
import { keyToDegree, degreeToKey, nearestInScale } from './numbers';

export interface Scale {
  degrees: number[];
  pitchesPerOctave: number;
  name: string;
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
};

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

/** Find scales with the second-most pitch classes in common */
export function slantMatch(targetDegrees: number[]): Scale[] {
  const candidates = ALL_SCALES.filter(s => s.pitchesPerOctave === 12 && s.degrees.length <= 10);
  const targetSet = new Set(targetDegrees.map(d => d % 12));

  const buckets: Scale[][] = Array.from({ length: 13 }, () => []);
  candidates.forEach(s => {
    const overlap = s.degrees.filter(d => targetSet.has(d % 12)).length;
    buckets[overlap].push(s);
  });

  const nonEmpty = buckets.filter(b => b.length > 0);
  if (nonEmpty.length < 2) return nonEmpty[0] ?? [SCALES.major];
  return nonEmpty[nonEmpty.length - 2];
}

/** Transpose scale degrees by t semitones (mod 12, sorted) */
export function scaleTranspose(s: Scale, t: number): Scale {
  return {
    degrees: s.degrees.map(d => (d + t) % 12).sort((a, b) => a - b),
    pitchesPerOctave: s.pitchesPerOctave,
    name: s.name,
  };
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

/** Snap array of notes to scale, preferring unique pitch classes */
export function nearestInScaleUniqueArr(
  notes: number[],
  scaleDegrees: number[],
  stepsPerOctave: number = 12
): number[] {
  // For each note, get nearest scale tone options (possibly 2 if equidistant)
  const octaves = notes.map(n => Math.floor(n / stepsPerOctave) * stepsPerOctave);
  const pcs = notes.map(n => n % stepsPerOctave);

  const options = pcs.map(pc => {
    const idx = indexInBetween(scaleDegrees, pc);
    const frac = idx % 1;
    if (Math.abs(frac - 0.5) < 0.001 && Math.floor(idx) < scaleDegrees.length - 1) {
      return [scaleDegrees[Math.floor(idx)], scaleDegrees[Math.ceil(idx)]];
    }
    return [scaleDegrees[Math.round(idx) % scaleDegrees.length]];
  });

  // If only 1 option per note, skip allTuples (performance)
  const hasTies = options.some(o => o.length > 1);
  if (!hasTies) {
    return options.map((opt, i) => opt[0] + octaves[i]);
  }

  // Cap at 12 notes to avoid exponential blowup
  const capped = options.slice(0, 12);
  const combos = allTuples(capped);
  const withOctaves = combos.map(combo => combo.map((pc, i) => pc + octaves[i]));

  // Sort by most unique pitch classes
  withOctaves.sort((a, b) => new Set(b).size - new Set(a).size);
  const best = withOctaves[0];

  // If notes were capped, append remaining with simple nearest
  if (notes.length > 12) {
    const tail = notes.slice(12).map(n => nearestInScale(n, scaleDegrees, stepsPerOctave));
    return [...best, ...tail];
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
