// HEJI (Helmholtz-Ellis just intonation) accidentals for a note's alterations,
// from the Bravura font (SMuFL; SIL Open Font License, in public/fonts). The
// syntonic comma is arrows on the note's own accidental; the septimal comma and
// the undecimal quartertone are signs to its left. HEJI has no sign for the
// Pythagorean comma (it respells the note), nor for the other commas in the
// palette (lib/tuning ALTERATIONS), so those are written as their letters.

import { ALTERATIONS } from '../lib/tuning';
import type { Alteration, CommaId } from '../lib/tuning';

export const HEJI_FONT = 'Bravura';

let _loaded: Promise<void> | null = null;
/** Load the font once; the pie and the palette redraw when it arrives */
export function loadHeji(): Promise<void> {
  if (_loaded) return _loaded;
  _loaded = (async () => {
    try {
      const face = new FontFace(HEJI_FONT, `url(${import.meta.env.BASE_URL}fonts/Bravura.woff2)`);
      document.fonts.add(await face.load());
    } catch { /* letters still say it */ }
  })();
  return _loaded;
}

const ch = (cp: number) => String.fromCodePoint(cp);
// column within each SMuFL row of five: double flat, flat, natural, sharp, double sharp
const COL = { flat: 1, natural: 2, sharp: 3 } as const;
// the first glyph of each row: one / two / three arrows, down then up
const ARROWS: Record<number, number> = { [-1]: 0xe2c0, 1: 0xe2c5, [-2]: 0xe2ca, 2: 0xe2cf, [-3]: 0xe2d4, 3: 0xe2d9 };
const PLAIN = { flat: 0xe260, natural: 0xe261, sharp: 0xe262 } as const;

const repeat = (n: number, one: number, two?: number) => {
  let out = '';
  let k = Math.abs(n);
  while (two && k >= 2) { out += ch(two); k -= 2; }
  while (k-- > 0) out += ch(one);
  return out;
};

/**
 * The accidental for a note spelled `name` ("E", "Eb", "F#") with these
 * alterations: `glyphs` in the HEJI font ('' when there's nothing to add to a
 * natural), and `text` for what HEJI has no sign for: the commas written as
 * letters ("+p", "−2p", "+n−h") and more than three syntonic ones.
 */
export function hejiAccidental(name: string, a: Alteration | undefined): { glyphs: string; text: string } {
  const kind = name.includes('b') ? 'flat' : name.includes('#') ? 'sharp' : 'natural';
  const s = a?.s ?? 0, z = a?.z ?? 0, u = a?.u ?? 0;
  const count = (id: CommaId) => { const k = a?.[id] ?? 0; return k ? `${k > 0 ? '+' : '−'}${Math.abs(k) > 1 ? Math.abs(k) : ''}${id}` : ''; };
  let glyphs = '', text = ALTERATIONS.filter(c => LETTER_COMMAS.has(c.id)).map(c => count(c.id)).join('');
  if (u) glyphs += u > 0 ? repeat(u, 0xe2e3) : repeat(u, 0xe2e2);
  if (z) glyphs += z > 0 ? repeat(z, 0xe2df, 0xe2e1) : repeat(z, 0xe2de, 0xe2e0);
  if (s && Math.abs(s) <= 3) glyphs += ch(ARROWS[s] + COL[kind]);
  else {
    if (kind !== 'natural') glyphs += ch(PLAIN[kind]);
    if (s) text = `${s > 0 ? '+' : '−'}${Math.abs(s)}s${text}`;   // beyond HEJI's three arrows: the count
  }
  return { glyphs, text };
}

const HEJI_SIGN: Partial<Record<CommaId, string>> = { s: ch(0xe2c7), z: ch(0xe2df), u: ch(0xe2e3) };
/** The commas written as a letter, HEJI having no sign for them */
export const LETTER_COMMAS = new Set<CommaId>(ALTERATIONS.map(c => c.id).filter(id => !HEJI_SIGN[id]));
/** A palette swatch for raising by one of each comma: its HEJI sign, or its letter */
export const PALETTE_GLYPH = Object.fromEntries(ALTERATIONS.map(c => [c.id, HEJI_SIGN[c.id] ?? c.id])) as Record<CommaId, string>;
