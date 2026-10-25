// Intervals as musicians name them. Each interval carries its own kind:
// chromatic (m3, P5, … counted in semitones) or diatonic (3rd, 5th, … counted
// in steps of the bloom's scale). A step of the intervals list is a chord: its
// intervals written one after another, the sign of each saying above (+) or
// below (−): -P5-P8, +3rd+5th, -P5+M3. A step adding nothing is a dot.
//
// Stored as plain numbers so lists stay JSON and the list verbs stay simple: a
// chromatic interval is its semitones (±1…24), a diatonic one its scale steps
// plus 100 (±101…114), so 3rd above is 102 and 5th below −104.

export const DIA = 100;
export const MAX_CHROMATIC = 24;
export const MAX_DIATONIC = 14;

export const isDiatonic = (iv: number): boolean => Math.abs(iv) > DIA;
/** The signed count in its own unit: semitones, or scale steps */
export const countOf = (iv: number): number => (isDiatonic(iv) ? Math.sign(iv) * (Math.abs(iv) - DIA) : iv);
/** An interval of this kind and signed count (0 for none), kept within two octaves */
export function makeIv(diatonic: boolean, n: number): number {
  if (n === 0) return 0;
  const m = Math.min(Math.abs(Math.round(n)), diatonic ? MAX_DIATONIC : MAX_CHROMATIC);
  return Math.sign(n) * (diatonic ? DIA + m : m);
}
/** The same interval with its count changed by fn (its kind kept) */
export const mapCount = (iv: number, fn: (n: number) => number): number => makeIv(isDiatonic(iv), fn(countOf(iv)));
export const octaveOf = (iv: number): number => (isDiatonic(iv) ? 7 : 12);
/** Roughly how wide, in semitones, for comparing intervals of either kind */
export const widthOf = (iv: number): number => (isDiatonic(iv) ? countOf(iv) * 12 / 7 : iv);
/** A chord's order: closest to the note first, above before below at the same width */
export const chordOrder = (a: number, b: number): number => Math.abs(widthOf(a)) - Math.abs(widthOf(b)) || b - a;

const CHROMATIC_NAMES = ['', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8',
  'm9', 'M9', 'm10', 'M10', 'P11', 'A11', 'P12', 'm13', 'M13', 'm14', 'M14', 'P15'];
const ordinal = (n: number) => `${n}${n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const DIATONIC_NAMES = Array.from({ length: MAX_DIATONIC + 1 }, (_, k) => (k === 0 ? '' : k === 7 ? '8ve' : ordinal(k + 1)));

/** One interval by name, with its sign: +P5, -3rd */
export function ivName(iv: number): string {
  if (iv === 0) return '·';
  const n = Math.abs(countOf(iv));
  return `${iv < 0 ? '-' : '+'}${isDiatonic(iv) ? DIATONIC_NAMES[n] : CHROMATIC_NAMES[n]}`;
}

/** A step: its intervals together (-P5-P8), or a dot */
export function stepName(step: number | number[]): string {
  const ivs = (Array.isArray(step) ? step : [step]).filter(x => x !== 0);
  return ivs.length ? ivs.map(ivName).join('') : '·';
}

/** A list as written: each chord with the rests after it folded into /N when that's shorter */
export function formatIntervals(list: (number | number[])[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    const name = stepName(list[i]);
    let j = i + 1;
    while (j < list.length && stepName(list[j]) === '·') j++;
    const n = j - i;
    if (n >= 3) { out.push(`${name}/${n}`); i = j; }
    else { out.push(name); i++; }
  }
  return out.join(' ');
}

/** One interval written without its sign: P5, m3, 3rd, 8ve, or a number of semitones */
function parseOne(word: string): number | null {
  const w = word.trim();
  if (/^\d+$/.test(w)) { const n = parseInt(w, 10); return n >= 1 && n <= MAX_CHROMATIC ? n : null; }
  const c = CHROMATIC_NAMES.indexOf(w) > 0 ? CHROMATIC_NAMES.indexOf(w)
    : CHROMATIC_NAMES.findIndex((x, i) => i > 0 && x.toLowerCase() === w.toLowerCase() && !/^[mM]/.test(w));
  if (c > 0) return c;
  const low = w.toLowerCase();
  if (low === '8ve' || low === 'oct' || low === '8th') return DIA + 7;
  const m = low.match(/^(\d+)(st|nd|rd|th)$/);
  if (m) { const k = parseInt(m[1], 10) - 1; return k >= 1 && k <= MAX_DIATONIC ? DIA + k : null; }
  return null;
}

/**
 * Read a list as written: steps separated by spaces; a step is intervals each
 * with its sign (the first may go without, meaning above), or `.` / `·` / `0`
 * for nothing; `/N` after a step fills with rests until that step's group is N
 * steps long. "-P5/10" is a fifth below every tenth note.
 */
export function parseIntervals(text: string): { list: (number | number[])[]; error: string | null } {
  const list: (number | number[])[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { list: [0], error: null };
  for (const raw of words) {
    const [stepText, every, ...extra] = raw.split('/');
    if (extra.length) return { list: [], error: `"${raw}": one /N per step` };
    let step: number | number[];
    if (stepText === '' && every !== undefined) {   // a lone "/N" applies to the step before
      if (!list.length) return { list: [], error: `"${raw}": /N goes after a step` };
      step = list.pop()!;
    } else if (['.', '·', '0', '_'].includes(stepText)) step = 0;
    else {
      const parts = stepText.match(/[+-]?[^+-]+/g);
      if (!parts) return { list: [], error: `"${raw}" isn't an interval` };
      const ivs: number[] = [];
      for (const p of parts) {
        const sign = p.startsWith('-') ? -1 : 1;
        const iv = parseOne(p.replace(/^[+-]/, ''));
        if (iv === null) return { list: [], error: `"${p}" isn't an interval (try P5, m3, 3rd, 8ve)` };
        ivs.push(sign * iv);
      }
      step = ivs.length === 1 ? ivs[0] : [...new Set(ivs)].sort(chordOrder);
    }
    list.push(step);
    if (every !== undefined) {
      const n = parseInt(every, 10);
      if (!(n >= 1 && n <= 64)) return { list: [], error: `"/${every}": every 1 to 64 notes` };
      for (let k = 1; k < n; k++) list.push(0);
    }
  }
  return { list, error: null };
}
