// Tunings: twelve notes to the period, read from Scala (.scl) files, laid on a
// key root, and turned into a frequency for each of the 128 MIDI notes.

export interface Tuning {
  name: string;
  /** cents above the root for each of the twelve degrees; cents[0] is 0 */
  cents: number[];
  /** the period in cents (1200 for an octave) */
  period: number;
  description?: string;
  /** each degree's exact ratio ("5/4"), or null when it's only known in cents */
  ratios?: (string | null)[];
  /** the commas each degree has been moved by since it was last set ("+81/80") */
  marks?: string[][];
  /** a root chosen by hand (0–11); absent or null: the root follows the key */
  root?: number | null;
  /** changed since it came from the library */
  edited?: boolean;
}

/** 12-TET: the tuning a bloom has when it has none */
export const EQUAL: Tuning = { name: '12-TET', cents: Array.from({ length: 12 }, (_, i) => i * 100), period: 1200 };

// ─── Exact ratios ─────────────────────────────────────────────────────────────
// Kept as BigInt fractions so a run of comma moves stays exact (81/64, not 407.82¢)

export interface Ratio { n: bigint; d: bigint }

const gcd = (a: bigint, b: bigint): bigint => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
function reduce(r: Ratio): Ratio { const g = gcd(r.n, r.d) || 1n; return { n: r.n / g, d: r.d / g }; }
export const ratioMul = (a: Ratio, b: Ratio): Ratio => reduce({ n: a.n * b.n, d: a.d * b.d });
export const ratioDiv = (a: Ratio, b: Ratio): Ratio => reduce({ n: a.n * b.d, d: a.d * b.n });
export const ratioStr = (r: Ratio): string => `${r.n}/${r.d}`;
export const centsOfRatio = (r: Ratio): number => 1200 * Math.log2(Number(r.n) / Number(r.d));

/** "5/4" or "3" → a ratio; anything else (cents, junk) → null */
export function parseRatio(s: string): Ratio | null {
  const m = s.trim().match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const n = BigInt(m[1]), d = BigInt(m[2] ?? '1');
  return n > 0n && d > 0n ? reduce({ n, d }) : null;
}

/** Into the octave [1, 2) — only for tunings whose period is the octave */
function octaveReduce(r: Ratio): Ratio {
  let { n, d } = r;
  while (n >= 2n * d) d *= 2n;
  while (n < d) n *= 2n;
  return reduce({ n, d });
}

/** A ratio worth showing: small enough to read */
export const readable = (r: string | null | undefined): r is string => !!r && r.length <= 15;

/** One pitch: a ratio or whole number, or cents if it has a dot */
function parseValue(tok: string): { cents: number; ratio: string | null } | null {
  tok = tok.trim().split(/\s+/)[0] ?? '';
  if (tok.includes('.')) {
    const c = Number(tok);
    return Number.isFinite(c) ? { cents: c, ratio: null } : null;
  }
  const r = parseRatio(tok);
  return r ? { cents: centsOfRatio(r), ratio: ratioStr(r) } : null;
}

/**
 * Read a .scl file. Returns the tuning, or a reason it can't be used: only
 * scales of exactly twelve notes to the period fit Bloom for now.
 */
export function parseScala(text: string, fileName: string): Tuning | string {
  const lines = text.split(/\r?\n/).filter(l => !l.startsWith('!'));
  if (lines.length < 2) return 'not a Scala file';
  const description = lines[0].trim();
  const count = parseInt(lines[1].trim(), 10);
  if (!Number.isFinite(count)) return 'no note count';
  const pitches: { cents: number; ratio: string | null }[] = [];
  for (const l of lines.slice(2)) {
    if (pitches.length === count) break;
    if (!l.trim()) continue;
    const v = parseValue(l);
    if (v === null) return `can't read "${l.trim()}"`;
    pitches.push(v);
  }
  if (pitches.length < count) return `${pitches.length} of ${count} notes`;
  if (count !== 12) return `${count} notes to the period (12 for now)`;
  const name = fileName.replace(/\.scl$/i, '');
  return {
    name, description,
    cents: [0, ...pitches.slice(0, 11).map(p => p.cents)],
    ratios: ['1/1', ...pitches.slice(0, 11).map(p => p.ratio)],
    period: pitches[11].cents,
  };
}

/**
 * The key a pitch-class set implies, as a key signature names it: the major
 * scale that holds all its notes, or all but one (harmonic minor's raised
 * seventh); when several do (a pentatonic), the one nearest the middle of the
 * set on the circle of fifths. C major, C major
 * pentatonic and A minor give C; A harmonic minor gives C, F harmonic minor
 * A♭; a move to one more sharp moves it a fifth up. null when no key signature
 * comes that close (whole tone, Bhairav, chromatic).
 */
export function keyRootOf(pcs: number[]): number | null {
  const set = [...new Set(pcs.map(p => ((Math.round(p) % 12) + 12) % 12))];
  if (set.length === 0) return null;
  // where the set sits on the circle of fifths: two fifths below the middle of
  // the shortest arc that holds it (breaks ties, so pentatonics move with ] too)
  const pos = (pc: number) => (pc * 7) % 12;   // C = 0, G = 1 …
  let start = 0, span = 12;
  for (let st = 0; st < 12; st++) {
    const w = Math.max(...set.map(pc => (pos(pc) - st + 12) % 12));
    if (w < span) { span = w; start = st; }
  }
  const centre = start + span / 2 - 2;
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  let best: { root: number; held: number; off: number } | null = null;
  for (let fifths = -6; fifths <= 5; fifths++) {   // G♭ … B
    const root = ((fifths * 7) % 12 + 12) % 12;
    const scale = new Set(MAJOR.map(d => (d + root) % 12));
    const held = set.filter(pc => scale.has(pc)).length;
    const d = Math.abs(((fifths - centre) % 12 + 18) % 12 - 6);   // fifths from the centre
    const off = d + Math.abs(fifths) * 0.01;                      // then fewer accidentals
    if (!best || held > best.held || (held === best.held && off < best.off)) best = { root, held, off };
  }
  return best && best.held >= set.length - 1 && best.held >= Math.min(set.length, 2) ? best.root : null;
}

const etFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * Frequencies for MIDI notes 0–127: degree 0 on the root, and the root keeps its
 * equal-tempered pitch (in the octave from middle C up).
 */
export function freqTable(t: Tuning | null, root: number): number[] {
  const tun = t ?? EQUAL;
  const rootMidi = 60 + (((root % 12) + 12) % 12);
  const base = etFreq(rootMidi);
  return Array.from({ length: 128 }, (_, m) => {
    const d = m - rootMidi;
    const oct = Math.floor(d / 12);
    const deg = d - 12 * oct;
    return base * 2 ** ((oct * tun.period + tun.cents[deg]) / 1200);
  });
}

/** How far each pitch class sits from 12-TET, in cents, with the tuning on that root */
export function deviations(t: Tuning | null, root: number): number[] {
  const f = freqTable(t, root);
  return Array.from({ length: 12 }, (_, pc) => 1200 * Math.log2(f[60 + pc] / etFreq(60 + pc)));
}

// ─── MIDI Tuning Standard ─────────────────────────────────────────────────────

/** A frequency as MTS three bytes: semitone, then 14 bits of fraction */
function mtsBytes(freq: number): [number, number, number] {
  let semis = 69 + 12 * Math.log2(freq / 440);
  semis = Math.max(0, Math.min(127.9998, semis));
  let xx = Math.floor(semis);
  let frac = Math.round((semis - xx) * 16384);
  if (frac >= 16384) { xx += 1; frac = 0; }
  if (xx > 127) { xx = 127; frac = 16382; }
  if (xx === 127 && frac === 16383) frac = 16382;   // 7F 7F 7F means "no change"
  return [xx, frac >> 7, frac & 0x7f];
}

/** Real-time single note tuning change messages for all 128 notes (two messages of 64) */
export function mtsMessages(freqs: number[]): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < 128; start += 64) {
    const msg = [0xf0, 0x7f, 0x7f, 0x08, 0x02, 0x00, 64];
    for (let k = start; k < start + 64; k++) msg.push(k, ...mtsBytes(freqs[k]));
    msg.push(0xf7);
    out.push(msg);
  }
  return out;
}

/** The tuning's name for the helper to pass on (non-commercial ID 7D, then "blm") */
export function nameMessage(name: string): number[] {
  const bytes = [...name].map(c => c.charCodeAt(0)).filter(c => c >= 0x20 && c < 0x7f).slice(0, 64);
  return [0xf0, 0x7d, 0x62, 0x6c, 0x6d, ...bytes, 0xf7];
}

// ─── Editing ──────────────────────────────────────────────────────────────────

/** A working copy to edit (12-TET when the bloom has none) */
export function editable(t: Tuning | null): Tuning {
  const src = t ?? EQUAL;
  return {
    ...src,
    cents: [...src.cents],
    ratios: src.ratios ? [...src.ratios] : src === EQUAL || !t ? ['1/1', ...Array(11).fill(null)] : Array(12).fill(null),
    marks: src.marks ? src.marks.map(m => [...m]) : Array.from({ length: 12 }, () => []),
  };
}

const isOctave = (t: Tuning) => Math.abs(t.period - 1200) < 1e-6;

/** Move one degree by a comma, up (dir 1) or down (−1); its exact ratio follows when it has one */
export function shiftDegree(t: Tuning, deg: number, comma: Ratio, dir: 1 | -1): Tuning {
  const out = editable(t);
  out.cents[deg] += dir * centsOfRatio(comma);
  const r = out.ratios![deg] ? parseRatio(out.ratios![deg]!) : null;
  out.ratios![deg] = r ? ratioStr(dir === 1 ? ratioMul(r, comma) : ratioDiv(r, comma)) : null;
  const mark = `${dir === 1 ? '+' : '−'}${ratioStr(comma)}`;
  const undoMark = `${dir === 1 ? '−' : '+'}${ratioStr(comma)}`;
  const m = out.marks![deg];
  const k = m.lastIndexOf(undoMark);
  if (k >= 0) m.splice(k, 1); else m.push(mark);   // a move back cancels the last one
  out.edited = true;
  return out;
}

/** Set one degree to a ratio ("7/4") or cents ("968.8"), above the root */
export function setDegree(t: Tuning, deg: number, value: string): Tuning | string {
  const v = parseValue(value);
  if (!v) return `can't read "${value}"`;
  const out = editable(t);
  out.cents[deg] = v.cents;
  out.ratios![deg] = v.ratio;
  out.marks![deg] = [];
  out.edited = true;
  return out;
}

/**
 * Make the interval from degree a up to degree b a given ratio or cents, by
 * moving b (kept in the octave nearest where it was).
 */
export function setInterval(t: Tuning, a: number, b: number, value: string): Tuning | string {
  const v = parseValue(value);
  if (!v) return `can't read "${value}"`;
  const out = editable(t);
  let target = out.cents[a] + v.cents;
  const shift = Math.round((target - out.cents[b]) / out.period);
  target -= shift * out.period;
  out.cents[b] = target;
  const ra = out.ratios![a] ? parseRatio(out.ratios![a]!) : null;
  const rv = v.ratio ? parseRatio(v.ratio) : null;
  if (ra && rv && isOctave(out)) {
    let r = ratioMul(ra, rv);
    for (let i = 0; i < Math.abs(shift); i++) r = shift > 0 ? ratioDiv(r, { n: 2n, d: 1n }) : ratioMul(r, { n: 2n, d: 1n });
    out.ratios![b] = ratioStr(reduce(r));
  } else out.ratios![b] = null;
  out.marks![b] = [];
  out.edited = true;
  return out;
}

/**
 * A whole scale pasted in: ratios or cents (a dot, or a whole number above
 * 8), separated by spaces, commas or lines. 11 values are degrees 1–11 (1/1 implied); 12 starting with 1/1 or 0
 * are degrees 0–11; 12 otherwise, or 13 starting with 1/1, end with the period,
 * as in a .scl file. A whole .scl file can be pasted too.
 */
export function fromList(text: string, name: string): Tuning | string {
  if (/^\s*!/m.test(text)) return parseScala(text, name);
  const toks = text.split(/[\s,;]+/).filter(Boolean);
  // a whole number above 8 can't be a ratio in one octave: it's cents (100 200 …)
  const vals = toks.map(tk => (/^\d+$/.test(tk) && Number(tk) > 8 ? parseValue(`${tk}.0`) : parseValue(tk)));
  const bad = toks.find((_, i) => !vals[i]);
  if (bad) return `can't read "${bad}"`;
  let v = vals as { cents: number; ratio: string | null }[];
  let period = { cents: 1200, ratio: '2/1' as string | null };   // as a .scl's last line
  const startsAtRoot = v.length > 0 && Math.abs(v[0].cents) < 1e-9;
  if (v.length === 13 && startsAtRoot) { period = v[12]; v = v.slice(0, 12); }
  else if (v.length === 12 && !startsAtRoot) { period = v[11]; v = [{ cents: 0, ratio: '1/1' }, ...v.slice(0, 11)]; }
  else if (v.length === 11) v = [{ cents: 0, ratio: '1/1' }, ...v];
  if (v.length !== 12) return `${toks.length} values: give 11 (1/1 implied), 12, or 12 and the period`;
  return {
    name, cents: v.map(x => x.cents), ratios: v.map(x => x.ratio), period: period.cents,
    marks: Array.from({ length: 12 }, () => []), edited: true,
  };
}

/** The tuning as a .scl file: exact ratios where known, cents otherwise */
export function toScala(t: Tuning): string {
  const val = (d: number) => (t.ratios?.[d] ?? null) || t.cents[d].toFixed(5);
  const period = isOctave(t) ? '2/1' : t.period.toFixed(5);
  return [`! ${t.name}.scl`, '!', t.description || t.name, ' 12', '!',
    ...Array.from({ length: 11 }, (_, i) => ` ${val(i + 1)}`), ` ${period}`, ''].join('\n');
}

/** A degree's distance from the root, octave-reduced, as an exact ratio when known */
export function degreeRatio(t: Tuning, deg: number): string | null {
  const r = t.ratios?.[deg] ? parseRatio(t.ratios[deg]!) : null;
  return r && isOctave(t) ? ratioStr(octaveReduce(r)) : t.ratios?.[deg] ?? null;
}

/** The interval from degree a up to degree b: an exact ratio when both are known, else cents */
export function intervalBetween(t: Tuning, a: number, b: number): { cents: number; ratio: string | null } {
  let c = t.cents[b] - t.cents[a];
  c = ((c % t.period) + t.period) % t.period;
  const ra = t.ratios?.[a] ? parseRatio(t.ratios[a]!) : null;
  const rb = t.ratios?.[b] ? parseRatio(t.ratios[b]!) : null;
  return { cents: c, ratio: ra && rb && isOctave(t) ? ratioStr(octaveReduce(ratioDiv(rb, ra))) : null };
}

/** Named commas (as in the tuning lattice), smallest first */
export const COMMAS: { name: string; ratio: Ratio }[] = ([
  ['schisma', 32805, 32768], ['septimal kleisma', 225, 224], ['19-limit schisma', 513, 512],
  ['diaschisma', 2048, 2025], ['syntonic comma', 81, 80], ['pythagorean comma', 531441, 524288],
  ['septimal comma', 64, 63], ['septimal quartertone', 36, 35], ['lesser diesis', 128, 125],
  ['undecimal quartertone', 33, 32], ['greater diesis', 648, 625], ['tridecimal thirdtone', 27, 26],
  ['minor 5-limit half step', 25, 24], ['septimal semitone', 21, 20], ['limma', 256, 243],
  ['apotome', 2187, 2048],
] as [string, number, number][]).map(([name, n, d]) => ({ name, ratio: { n: BigInt(n), d: BigInt(d) } }));
