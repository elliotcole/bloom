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
  /**
   * The tuning before its alterations (cents and ratios above are worked out
   * from the two). Absent: the cents and ratios are the base, unaltered.
   */
  base?: { cents: number[]; ratios: (string | null)[] };
  /** Each degree's alterations: how many of each comma, up or down (HEJI-style) */
  alter?: Alteration[];
  /** The alterations switched off (kept, not heard): the base sounds */
  alterOff?: boolean;
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

// ─── Tuning cues ──────────────────────────────────────────────────────────────
// The sounding tuning written as notes, so a DAW records it with the take
// (Ableton records neither SysEx nor CC order faithfully, but keeps notes'
// pitches and velocities exactly). The helper plays them out of its "Bloom
// Tuning Cues" port and, given them back, retunes as at the time. Each cue is
// the whole tuning, as a chord; the pitch says what a note holds and its
// velocity the value, so the order they arrive in doesn't matter:
//   0       format, velocity 1
//   1       the root's pitch class + 1
//   2–4     the period, cents − 1200
//   5–40    degree d (0–11) at 5 + 3d: its cents from the root − 100·d
//   64–95   the name, one ASCII character each (as many as it has, up to 32)
// A value in cents is three notes, most significant first: n = round(value ×
// 1000) + 1 000 000 (so ±1000 cents, to a thousandth), written in base 127,
// each digit's velocity being the digit + 1. Key m then sounds at
// f(60 + root) · 2^((o · period + cents[d]) / 1200), where m − (60 + root) =
// 12o + d and f is 12-TET at A = 440 — the same table Bloom sends.

export const CUE = { format: 0, root: 1, period: 2, degrees: 5, name: 64, nameLen: 32 } as const;

function cueValue(at: number, cents: number): [number, number][] {
  const n = Math.max(0, Math.min(2_000_000, Math.round(cents * 1000) + 1_000_000));
  return [[at, Math.floor(n / 16129) + 1], [at + 1, Math.floor(n / 127) % 127 + 1], [at + 2, n % 127 + 1]];
}

/** A tuning on its root as cue notes, [pitch, velocity] */
export function cueNotes(t: Tuning | null, root: number): [number, number][] {
  const tun = t ?? EQUAL;
  const out: [number, number][] = [[CUE.format, 1], [CUE.root, (((root % 12) + 12) % 12) + 1]];
  out.push(...cueValue(CUE.period, tun.period - 1200));
  tun.cents.forEach((c, d) => out.push(...cueValue(CUE.degrees + 3 * d, c - 100 * d)));
  [...tun.name].map(c => c.charCodeAt(0)).filter(c => c >= 0x20 && c < 0x7f).slice(0, CUE.nameLen)
    .forEach((c, i) => out.push([CUE.name + i, c]));
  return out;
}

/** The cue for the helper to play out (non-commercial ID 7D, "blc"), the notes as pairs */
export function cueMessage(t: Tuning | null, root: number): number[] {
  return [0xf0, 0x7d, 0x62, 0x6c, 0x63, ...cueNotes(t, root).flat(), 0xf7];
}

/** Read a cue back (velocity by pitch, 0 for none): the tuning and its root, or null if incomplete */
export function readCue(vel: number[]): { tuning: Tuning; root: number } | null {
  if (vel[CUE.format] !== 1 || !vel[CUE.root]) return null;
  const value = (at: number) => {
    if (!vel[at] || !vel[at + 1] || !vel[at + 2]) return null;
    return ((vel[at] - 1) * 16129 + (vel[at + 1] - 1) * 127 + (vel[at + 2] - 1) - 1_000_000) / 1000;
  };
  const period = value(CUE.period);
  const cents = Array.from({ length: 12 }, (_, d) => value(CUE.degrees + 3 * d));
  if (period === null || cents.some(c => c === null)) return null;
  let name = '';
  for (let i = 0; i < CUE.nameLen && vel[CUE.name + i]; i++) name += String.fromCharCode(vel[CUE.name + i]);
  return { tuning: { name, cents: cents.map((c, d) => c! + 100 * d), period: period + 1200 }, root: vel[CUE.root] - 1 };
}

// ─── Editing ──────────────────────────────────────────────────────────────────

// ─── Alterations ──────────────────────────────────────────────────────────────
// A tuning is a base (12-TET, a .scl, a pasted scale) and twelve alterations:
// for each degree, counts of the commas it has been raised or lowered by, as
// HEJI writes them. Moves by the same comma cancel; different commas stay side
// by side (+p −s), so the drift stays readable. ] / [ swap the base and keep
// the alterations; setting a note or pasting a scale makes a new base.

export type CommaId = 'p' | 's' | 'z' | 'u';
export type Alteration = Partial<Record<CommaId, number>>;

/** The commas a note can be altered by: HEJI's through the 11-limit, and the Pythagorean comma */
export const ALTERATIONS: { id: CommaId; name: string; ratio: Ratio }[] = ([
  ['p', 'pythagorean comma', 531441, 524288],
  ['s', 'syntonic comma', 81, 80],
  ['z', 'septimal comma', 64, 63],
  ['u', 'undecimal quartertone', 33, 32],
] as [CommaId, string, number, number][]).map(([id, name, n, d]) => ({ id, name, ratio: { n: BigInt(n), d: BigInt(d) } }));
export const commaOf = (id: CommaId) => ALTERATIONS.find(c => c.id === id)!;

/** "+p−s", "+2s", or "" when unaltered */
export function alterText(a: Alteration | undefined): string {
  if (!a) return '';
  return ALTERATIONS.map(({ id }) => {
    const n = a[id] ?? 0;
    return n === 0 ? '' : `${n > 0 ? '+' : '−'}${Math.abs(n) > 1 ? Math.abs(n) : ''}${id}`;
  }).join('');
}
const noAlter = (): Alteration[] => Array.from({ length: 12 }, () => ({}));
const isUnaltered = (a: Alteration) => ALTERATIONS.every(({ id }) => !a[id]);

/** A working copy to edit (12-TET when the bloom has none), its base and alterations filled in */
export function editable(t: Tuning | null): Tuning {
  const src = t ?? EQUAL;
  const ratios = src.ratios ? [...src.ratios] : src === EQUAL || !t ? ['1/1', ...Array(11).fill(null)] : Array(12).fill(null);
  const base = src.base && src.alter
    ? { cents: [...src.base.cents], ratios: [...src.base.ratios] }
    : { cents: [...src.cents], ratios: [...ratios] };   // older tunings (and their comma marks): what they sound is the base
  const out: Tuning = { ...src, cents: [...src.cents], ratios, base, alter: src.base && src.alter ? src.alter.map(a => ({ ...a })) : noAlter() };
  delete (out as { marks?: unknown }).marks;
  return out;
}

/** Work out the cents and exact ratios from the base and the alterations */
function resolve(t: Tuning): Tuning {
  const base = t.base!, alter = t.alter!;
  for (let d = 0; d < 12; d++) {
    let c = base.cents[d];
    let r = base.ratios[d] ? parseRatio(base.ratios[d]!) : null;
    for (const { id, ratio } of ALTERATIONS) {
      const n = t.alterOff ? 0 : alter[d][id] ?? 0;
      c += n * centsOfRatio(ratio);
      for (let k = 0; k < Math.abs(n) && r; k++) r = n > 0 ? ratioMul(r, ratio) : ratioDiv(r, ratio);
    }
    t.cents[d] = c;
    t.ratios![d] = r ? ratioStr(r) : null;
  }
  return t;
}

/** Replace the alterations (the base stays) */
export function withAlterations(t: Tuning, alter: Alteration[]): Tuning {
  const out = editable(t);
  out.alter = alter.map(a => {
    const c: Alteration = {};
    for (const { id } of ALTERATIONS) if (a[id]) c[id] = a[id];
    return c;
  });
  out.edited = true;
  delete out.alterOff;   // a change to them is heard
  return resolve(out);
}

/** 1: switch the alterations off (the base sounds) or back on; they're kept either way */
export function toggleAlterations(t: Tuning): Tuning {
  const out = editable(t);
  if (out.alterOff) delete out.alterOff; else out.alterOff = true;
  return resolve(out);
}

/** A tuning's alterations, twelve of them */
export const alterationsOf = (t: Tuning | null): Alteration[] => editable(t).alter!;
export const isAltered = (t: Tuning | null): boolean => !!t?.alter && !t.alter.every(isUnaltered);

/** A new base (a tuning from the library) under the same alterations */
export function rebase(t: Tuning | null, base: Tuning | null): Tuning | null {
  if (!isAltered(t)) return base;
  const b = editable(base);
  const flat: Tuning = { ...b, base: { cents: [...b.cents], ratios: [...b.ratios!] }, alter: noAlter() };
  return withAlterations(flat, alterationsOf(t));
}

/** Move one degree by a comma, up (dir 1) or down (−1) */
export function shiftDegree(t: Tuning, deg: number, comma: CommaId, dir: 1 | -1): Tuning {
  return stepAlterations(t, [deg], comma, dir);
}

/** 3 / 4: these degrees each a comma down or up */
export function stepAlterations(t: Tuning, degs: number[], comma: CommaId, dir: 1 | -1): Tuning {
  const alter = alterationsOf(t);
  for (const d of degs) alter[d][comma] = (alter[d][comma] ?? 0) + dir;
  return withAlterations(t, alter);
}

/**
 * 2: these degrees unaltered. Given the tuning as it first came (the
 * library's copy), their base goes back to it too, undoing "= one comma"
 * and set values: the notes sound as the tuning has them.
 */
export function clearAlterations(t: Tuning, degs: number[], original?: Tuning | null): Tuning {
  const alter = alterationsOf(t);
  for (const d of degs) alter[d] = {};
  if (original === undefined) return withAlterations(t, alter);
  const out = editable(t), from = editable(original).base!;
  for (const d of degs) { out.base!.cents[d] = from.cents[d]; out.base!.ratios[d] = from.ratios[d]; }
  return withAlterations(out, alter);
}

/** 1 / 2: every alteration moves to the degree a semitone down (−1) or up (1) */
export function rotateAlterations(t: Tuning, dir: 1 | -1): Tuning {
  const alter = alterationsOf(t);
  return withAlterations(t, alter.map((_, i) => alter[(i - dir + 12) % 12]));
}

/** # / $: a few of these degrees (about a quarter, at least one) a comma down or up */
export function breezeAlterations(t: Tuning, degs: number[], comma: CommaId, dir: 1 | -1, rand = Math.random): Tuning {
  const pool = [...degs];
  const k = Math.max(1, Math.round(pool.length / 4));
  const chosen: number[] = [];
  while (chosen.length < k && pool.length) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return stepAlterations(t, chosen, comma, dir);
}

/** "= one comma": degree b becomes degree a raised by a comma (a's base and alterations, and one more) */
export function commaAbove(t: Tuning, a: number, b: number, comma: CommaId): Tuning {
  const out = editable(t);
  const base = out.base!;
  // b keeps its octave: a's base, moved by whole periods to sit nearest b
  const shift = Math.round((base.cents[b] - base.cents[a]) / out.period);
  base.cents[b] = base.cents[a] + shift * out.period;
  const ra = base.ratios[a] ? parseRatio(base.ratios[a]!) : null;
  let rb = ra && isOctave(out) ? ra : null;
  for (let i = 0; i < Math.abs(shift) && rb; i++) rb = shift > 0 ? ratioMul(rb, { n: 2n, d: 1n }) : ratioDiv(rb, { n: 2n, d: 1n });
  base.ratios[b] = rb ? ratioStr(rb) : null;
  const alter = out.alter!;
  alter[b] = { ...alter[a] };
  alter[b][comma] = (alter[b][comma] ?? 0) + 1;
  return withAlterations(out, alter);
}

const isOctave = (t: Tuning) => Math.abs(t.period - 1200) < 1e-6;

/** Set one degree to a ratio ("7/4") or cents ("968.8"), above the root: a new base for it, unaltered */
export function setDegree(t: Tuning, deg: number, value: string): Tuning | string {
  const v = parseValue(value);
  if (!v) return `can't read "${value}"`;
  const out = editable(t);
  out.base!.cents[deg] = v.cents;
  out.base!.ratios[deg] = v.ratio;
  out.alter![deg] = {};
  out.edited = true;
  return resolve(out);
}

/**
 * Make the interval from degree a up to degree b a given ratio or cents, by
 * moving b (kept in the octave nearest where it was): a new base for b, unaltered.
 */
export function setInterval(t: Tuning, a: number, b: number, value: string): Tuning | string {
  const v = parseValue(value);
  if (!v) return `can't read "${value}"`;
  const out = editable(t);
  let target = out.cents[a] + v.cents;
  const shift = Math.round((target - out.cents[b]) / out.period);
  target -= shift * out.period;
  out.base!.cents[b] = target;
  const ra = out.ratios![a] ? parseRatio(out.ratios![a]!) : null;
  const rv = v.ratio ? parseRatio(v.ratio) : null;
  if (ra && rv && isOctave(out)) {
    let r = ratioMul(ra, rv);
    for (let i = 0; i < Math.abs(shift); i++) r = shift > 0 ? ratioDiv(r, { n: 2n, d: 1n }) : ratioMul(r, { n: 2n, d: 1n });
    out.base!.ratios[b] = ratioStr(reduce(r));
  } else out.base!.ratios[b] = null;
  out.alter![b] = {};
  out.edited = true;
  return resolve(out);
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
    name, cents: v.map(x => x.cents), ratios: v.map(x => x.ratio), period: period.cents, edited: true,
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
