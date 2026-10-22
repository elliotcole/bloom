// Tunings: twelve notes to the period, read from Scala (.scl) files, laid on a
// key root, and turned into a frequency for each of the 128 MIDI notes.

export interface Tuning {
  name: string;
  /** cents above the root for each of the twelve degrees; cents[0] is 0 */
  cents: number[];
  /** the period in cents (1200 for an octave) */
  period: number;
  description?: string;
}

/** 12-TET: the tuning a bloom has when it has none */
export const EQUAL: Tuning = { name: '12-TET', cents: Array.from({ length: 12 }, (_, i) => i * 100), period: 1200 };

const ratioCents = (r: number) => 1200 * Math.log2(r);

/** One pitch line of a .scl file: cents if it has a dot, otherwise a ratio or a whole number */
function parsePitch(s: string): number | null {
  const tok = s.trim().split(/\s+/)[0] ?? '';
  if (tok.includes('.')) {
    const c = Number(tok);
    return Number.isFinite(c) ? c : null;
  }
  const m = tok.match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const r = Number(m[1]) / (m[2] ? Number(m[2]) : 1);
  return r > 0 ? ratioCents(r) : null;
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
  const pitches: number[] = [];
  for (const l of lines.slice(2)) {
    if (pitches.length === count) break;
    if (!l.trim()) continue;
    const c = parsePitch(l);
    if (c === null) return `can't read "${l.trim()}"`;
    pitches.push(c);
  }
  if (pitches.length < count) return `${pitches.length} of ${count} notes`;
  if (count !== 12) return `${count} notes to the period (12 for now)`;
  const name = fileName.replace(/\.scl$/i, '');
  return { name, cents: [0, ...pitches.slice(0, 11)], period: pitches[11], description };
}

/**
 * The key a pitch-class set implies, as a key signature names it: two fifths
 * below the middle of the shortest arc of fifths that holds the set. C major and
 * C major pentatonic give C, A minor gives C too, and a move to one more sharp
 * moves it a fifth up. null when the set is too spread to have one (whole tone,
 * chromatic).
 */
export function keyRootOf(pcs: number[]): number | null {
  const set = [...new Set(pcs.map(p => ((Math.round(p) % 12) + 12) % 12))];
  if (set.length === 0) return null;
  const pos = (pc: number) => (pc * 7) % 12;   // place on the circle of fifths, C = 0
  let start = 0, span = 12;
  for (let st = 0; st < 12; st++) {
    const w = Math.max(...set.map(pc => (pos(pc) - st + 12) % 12));
    if (w < span) { span = w; start = st; }
  }
  if (span >= 9) return null;
  const at = Math.round(start + span / 2 - 2);   // a place on the circle of fifths
  return (((at * 7) % 12) + 12) % 12;            // back to a pitch class
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
