// Figures: little tunes a note can play instead of itself. A list like the
// velocities, one entry per note and cycling at its own length: 0 is no figure.
//
// A run, written in brackets: (1 2 3) plays do re mi from the note itself. Numbers count steps of the bloom's scale as
// musicians name them (1 the note, 2 a step up, -2 a step down, 5 a fifth up);
// chromatic intervals go by name (+P5, -m2); a dot is a rest. (1 1 1) is a
// ratchet, (1 -2 1) a lower neighbour.
//
// A garden slot, written @3: slot 3, a tiny bloom with its own times,
// velocities and channels, played from the note. It's read live, so changing
// the slot changes every figure that uses it. Its first note lands on the note
// (moved in the scale, when the bloom has one), and it plays only its own notes.
//
// How they take their time is one choice for the bloom (Bloom.figureTime):
// divide shares out the note's time, insert plays in the flow and the notes
// after wait, superimpose plays on a timeline of its own. A run takes its
// times from Bloom.figureDurs for the last two; a slot brings its own.
//
// Stored as plain JSON: a subdivided figure is a list of intervals (lib/
// intervals; 0 is the note itself, null a rest), a superimposed one { slot }.

import type { Bloom } from '../core/Bloom';
import { isDiatonic, countOf, makeIv, ivName, parseInterval } from './intervals';

export type FigureStep = number | null;
export type FigureTime = 'divide' | 'insert' | 'superimpose';
export const FIGURE_TIMES: FigureTime[] = ['divide', 'insert', 'superimpose'];
export type Figure = 0 | FigureStep[] | { slot: number };

export const isSlotFigure = (f: Figure): f is { slot: number } => typeof f === 'object' && f !== null && !Array.isArray(f);
export const isRunFigure = (f: Figure): f is FigureStep[] => Array.isArray(f);
export const isFigure = (f: Figure): boolean => isSlotFigure(f) || (isRunFigure(f) && f.length > 0);

/** One step of a run as written: 1 2 -2 by scale steps, +P5 -m2 by name, · a rest */
function stepText(s: FigureStep): string {
  if (s === null) return '·';
  if (s === 0) return '1';
  if (isDiatonic(s)) { const k = countOf(s); return `${k < 0 ? '-' : ''}${Math.abs(k) + 1}`; }
  return ivName(s);
}

export function formatFigure(f: Figure): string {
  if (isSlotFigure(f)) return `@${f.slot}`;
  if (isRunFigure(f) && f.length) return `(${f.map(stepText).join(' ')})`;
  return '0';
}

export const formatFigures = (list: Figure[]): string => list.map(formatFigure).join(' ');

/** One step of a run: a signed scale-step number (1 the note), a signed interval name, or a dot */
function parseStep(word: string): FigureStep | undefined {
  if (['.', '·', '_'].includes(word)) return null;
  const m = word.match(/^([+-]?)(\d+)$/);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n < 1 || n > 15) return undefined;
    return n === 1 ? 0 : makeIv(true, (m[1] === '-' ? -1 : 1) * (n - 1));
  }
  const sign = word.startsWith('-') ? -1 : 1;
  const iv = parseInterval(word.replace(/^[+-]/, ''));
  return iv === null ? undefined : sign * iv;
}

/**
 * Read a list as written: entries separated by spaces, each 0 (no figure),
 * (…) a run in the note's time, or @N garden slot N.
 */
export function parseFigures(text: string): { list: Figure[]; error: string | null } {
  const list: Figure[] = [];
  // brackets may touch their neighbours: (1 2)(3) 0
  const tokens = text.replace(/[()[\]]/g, m => ` ${m === '[' ? '(' : m === ']' ? ')' : m} `).trim().split(/\s+/).filter(Boolean);
  let run: FigureStep[] | null = null;
  for (const t of tokens) {
    if (t === '(') {
      if (run) return { list: [], error: 'one figure inside another: close it with )' };
      run = [];
    } else if (t === ')') {
      if (!run) return { list: [], error: 'a ) without its (' };
      if (!run.length) return { list: [], error: '() is empty: write 0 for no figure' };
      if (run.length > 32) return { list: [], error: 'a figure of 32 steps at most' };
      list.push(run);
      run = null;
    } else if (run) {
      const s = parseStep(t);
      if (s === undefined) return { list: [], error: `"${t}" isn't a step (1 2 -2 by the scale, +P5 -m2 by name, · a rest)` };
      run.push(s);
    } else if (['0', '.', '·', '_'].includes(t)) list.push(0);
    else if (/^@\d+$/.test(t)) list.push({ slot: parseInt(t.slice(1), 10) });
    else return { list: [], error: `"${t}": write 0, a figure in ( ), or @ and a garden slot` };
  }
  if (run) return { list: [], error: 'a ( without its )' };
  return { list: list.length ? list : [0], error: null };
}

// The garden, for @N: the app says where to find a slot, so a bloom needn't know the garden
let _slot: (i: number) => Bloom | null = () => null;
export function setFigureSlots(get: (i: number) => Bloom | null): void { _slot = get; }
export function figureSlot(i: number): Bloom | null { return _slot(i); }
