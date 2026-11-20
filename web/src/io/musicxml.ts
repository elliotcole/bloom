// A take written out as a score (MusicXML), for solo piano: one grand staff.
//
// The take keeps the exact time each note went out, so nothing is guessed from
// a performance's wobble: the gaps between onsets are the time lists' values.
// What has to be chosen is how to write them. The rule:
//
//   - a stretch of music has one unit, its eighth note; every gap that is a
//     simple multiple of it (thirds and quarters of an eighth up) is written in
//     it, and the tempo mark carries the rest. Bloom's tempo stays put while
//     the time lists speed up, so a tempo change here is a new unit;
//   - a new unit is only taken when the gaps stop fitting the old one (the
//     gap and most of the next few), so a step cut short by a change is
//     written to the nearest value instead of becoming a tempo of its own;
//   - the unit is the value that fits the most gaps ahead (the commonest
//     among equals), written as an eighth, or a sixteenth when the quarter
//     would pass 170;
//   - a bar is one pass of the notes (a note lit as the list's first starts
//     one), its time signature whatever that pass adds up to;
//   - a note is written as lasting until the next one (the line, not how long
//     it rings); a long silence is a fermata rest marked with its seconds;
//   - the key signature follows the scale of the bloom on screen.
//
// Tuning is left out: the piano this is for can't be retuned.

import type { TakeFile } from '../audio/take';

/** Divisions of an eighth: thirds and quarters of a sixteenth both whole */
const DIV = 24;
const QUARTER_DIVS = 2 * DIV;
const MAX_QUARTER_BPM = 170;
const MIN_QUARTER_BPM = 45;
const CHORD_MS = 8;           // onsets closer than this are one chord
const LIT_MS = 40;            // a note lit this close to an onset is that onset's
const SILENCE_MS = 2000;      // a gap longer than this (and many units) is a silence
const LOOK_AHEAD = 24;        // gaps weighed when choosing a new unit

export interface XmlOptions {
  /** at most this many bars (passes) */
  bars?: number;
  /** from this many ms into the take */
  fromMs?: number;
  title?: string;
}

/** One onset: the notes that start together */
export interface Onset {
  at: number;            // ms
  pitches: number[];     // MIDI, ascending
  vel: number;           // the loudest
  pcs: number[] | null;  // the scale of the bloom on screen
  pass: boolean;         // the notes' first: a new pass starts here
}

/** The onsets of a take, in time, each with the scale on screen and whether it starts a pass */
export function onsetsOf(t: TakeFile): Onset[] {
  const ons: { at: number; pitch: number; vel: number }[] = [];
  const shown: { at: number; ix: number }[] = [];
  const lit: { at: number; index: number }[] = [];
  for (const e of t.events) {
    if (e[1] === 'm') {
      const m = e[2];
      if ((m[0] & 0xf0) === 0x90 && m[2] > 0) ons.push({ at: e[0] + e[3], pitch: m[1], vel: m[2] });
    } else if (e[1] === 'b' && e[4] === 1) shown.push({ at: e[0], ix: e[2] });
    else if (e[1] === 'n') lit.push({ at: e[0], index: e[2] });
  }
  ons.sort((a, b) => a.at - b.at);
  shown.sort((a, b) => a.at - b.at);
  lit.sort((a, b) => a.at - b.at);

  const out: Onset[] = [];
  let s = -1, l = 0;
  for (const o of ons) {
    const last = out.at(-1);
    if (last && o.at - last.at < CHORD_MS) {
      if (!last.pitches.includes(o.pitch)) last.pitches.push(o.pitch);
      last.vel = Math.max(last.vel, o.vel);
      continue;
    }
    while (s + 1 < shown.length && shown[s + 1].at <= o.at + LIT_MS) s++;
    const scale = s >= 0 ? t.blooms[shown[s].ix]?.appliedScale : null;
    while (l < lit.length && lit[l].at < o.at - LIT_MS) l++;
    let pass = false;
    for (let j = l; j < lit.length && lit[j].at <= o.at + LIT_MS; j++) if (lit[j].index === 0) pass = true;
    out.push({ at: o.at, pitches: [o.pitch], vel: o.vel, pcs: scale ? [...scale.degrees] : null, pass });
  }
  for (const o of out) o.pitches.sort((a, b) => a - b);
  return out;
}

// ─── Durations ──────────────────────────────────────────────────────────────

const writable = (k: number) => k >= 3 && (k % 3 === 0 || k % 4 === 0);

/** The nearest writable number of divisions to x */
export function nearestDivs(x: number): number {
  let best = 3;
  for (let k = Math.max(3, Math.floor(x) - 4); k <= Math.ceil(x) + 4; k++)
    if (writable(k) && Math.abs(k - x) < Math.abs(best - x)) best = k;
  return best;
}

/** How far a gap may sit from its value and still be it: a played-in take wobbles a few ms */
const LOOSE = 0.03;
/** How far the gaps must move, together, for the unit to move with them (a time list sped up a little) */
const DRIFT = 0.004;
const tol = (g: number) => Math.max(1, g * LOOSE);

/** Fits a unit: a whole number of 32nds, or one triplet value (not five triplet 16ths, a 5:6 change of tempo) */
const plain = (k: number) => k > 0 && (k % 6 === 0 || [4, 8, 16, 32, 64].includes(k));

/** The divisions a gap is in a unit, or 0 when it isn't a plain multiple of it */
export function fits(g: number, eighth: number): number {
  const x = g / eighth * DIV;
  let best = 0;
  for (const k of [Math.floor(x), Math.ceil(x)])
    if (plain(k) && Math.abs(g - k * eighth / DIV) <= tol(g) && (!best || Math.abs(k - x) < Math.abs(best - x))) best = k;
  return best;
}

/** How far a gap sits from its value in a unit, as a ratio (1: exactly) */
const ratio = (g: number, eighth: number, k: number) => g / (k * eighth / DIV);

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The written length of each onset, in divisions, and where the tempo changes */
export interface Timed {
  divs: number;
  /** a new unit starts here: the quarter's tempo */
  tempo?: number;
  /** the tempo changes too often here to mark each: played, not shown */
  quiet?: boolean;
  /** an accelerando or ritardando starts here */
  gradual?: 'accel.' | 'rit.';
  /** a silence follows: its ms */
  silence?: number;
}

const isSilence = (g: number, eighth: number) => g > SILENCE_MS && g > 12 * eighth;

/** How well a unit writes some gaps: how many fit it exactly, then at all, then how few as triplets, then how many are the unit itself */
function score(gaps: number[], e: number): [number, number, number, number] {
  let exact = 0, fit = 0, plainOnes = 0, unit = 0;
  for (const g of gaps) {
    const k = fits(g, e);
    if (!k) continue;
    fit++;
    if (Math.abs(ratio(g, e, k) - 1) <= DRIFT) exact++;
    if (k % 6 === 0) plainOnes++;
    if (k === DIV || k === DIV / 2) unit++;
  }
  return [exact, fit, plainOnes, unit];
}
const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

/** The unit for the gaps from here: the one that writes them best, the commonest among equals */
function unitFrom(gaps: number[]): number {
  const count = new Map<number, number>();
  for (const g of gaps) count.set(Math.round(g * 2) / 2, (count.get(Math.round(g * 2) / 2) ?? 0) + 1);
  let best = 0, bestScore = [-1, -1, -1, -1, -1];
  for (const [v, c] of count) {
    const exact = octave(median(gaps.filter(g => Math.abs(g - v) <= Math.max(1, g * 0.01))));
    const sc = [...score(gaps, exact), c];
    if (better(sc, bestScore)) { best = exact; bestScore = sc; }
  }
  return best;
}

/** A unit written as an eighth, or as a sixteenth (or a quarter) to keep the quarter's tempo in reach */
function octave(e: number): number {
  while (30_000 / e > MAX_QUARTER_BPM) e *= 2;
  while (30_000 / e < MIN_QUARTER_BPM) e /= 2;
  return e;
}

/** How each onset is written: its divisions, a tempo where the unit changes, a silence after */
export function timeOnsets(at: number[]): Timed[] {
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  const out: Timed[] = [];
  let eighth = 0;
  const ahead = (i: number, n: number) => {
    const r: number[] = [];
    for (let j = i; j < gaps.length && r.length < n; j++) if (!isSilence(gaps[j], eighth || 500)) r.push(gaps[j]);
    return r;
  };
  /** a gap off the unit, or on it but out by more than a drift */
  const off = (n: number) => { const k = fits(n, eighth); return !k || Math.abs(ratio(n, eighth, k) - 1) > DRIFT; };
  for (let i = 0; i < at.length; i++) {
    const g = gaps[i];
    const timed: Timed = { divs: DIV };
    if (!eighth) { eighth = unitFrom(ahead(i, LOOK_AHEAD).length ? ahead(i, LOOK_AHEAD) : [500]); timed.tempo = 30_000 / eighth; }
    if (g === undefined) { out.push(timed); break; }
    if (isSilence(g, eighth)) { timed.silence = g; out.push(timed); continue; }
    let k = fits(g, eighth);
    if (off(g)) {
      // off the unit, and the next few too: it has moved. Either all together by a little (a time list
      // gliding) or to a new one; whichever writes what's ahead better, the glide among equals.
      // Off alone, it's a step cut short, written to its nearest value.
      const next = ahead(i + 1, 3);
      if (next.length >= 2 && next.filter(off).length >= 2) {
        const look = ahead(i, LOOK_AHEAD);
        const cands: number[] = [];
        const rs = ahead(i, 8).map(n => { const kn = fits(n, eighth); return kn ? ratio(n, eighth, kn) : 0; }).filter(Boolean);
        if (rs.length >= 4) cands.push(octave(eighth * median(rs)));
        cands.push(unitFrom(look));
        let e = cands[0], best = score(look, e);
        for (const c of cands.slice(1)) { const sc = score(look, c); if (better(sc, best)) { e = c; best = sc; } }
        if (Math.abs(e / eighth - 1) > DRIFT && better(best, score(look, eighth))) { timed.tempo = 30_000 / e; eighth = e; }
      }
      k = fits(g, eighth) || nearestDivs(g / eighth * DIV);
    }
    timed.divs = k;
    out.push(timed);
  }
  return gradually(out);
}

const GRADUAL_GAP = 24;   // tempo marks this close (in onsets), three or more one way, are one accel. or rit.

/** A run of tempo changes close together (a time list gliding) shown as accel. or rit. from where it starts to the tempo it reaches; a unit halved or doubled starts a new run, so the change of note value is marked */
function gradually(out: Timed[]): Timed[] {
  const marks = out.flatMap((t, i) => t.tempo !== undefined ? [i] : []);
  let r = 0;
  while (r < marks.length) {
    let e = r;
    // which way the music goes from one mark to the next (a unit halved or doubled is the same speed)
    const step = (j: number) => out[marks[j + 1]].tempo! / out[marks[j]].tempo!;
    const way = (j: number) => Math.sign(step(j) - 1);
    const sameUnit = (j: number) => step(j) > 0.75 && step(j) < 1.5;
    while (e + 1 < marks.length && marks[e + 1] - marks[e] <= GRADUAL_GAP && sameUnit(e) && (e === r || way(e) === way(r))) e++;
    if (e - r >= 2) {
      out[marks[r]].gradual = way(r) > 0 ? 'accel.' : 'rit.';
      for (let j = r + 1; j < e; j++) out[marks[j]].quiet = true;   // shown: where it starts, and the tempo it reaches
    }
    r = e + 1;
  }
  return out;
}

// ─── Written values ─────────────────────────────────────────────────────────

/** A written note value: divisions (a quarter is 48), type, dots, a triplet */
interface Value { divs: number; type: string; dots: number; triplet: boolean }

const PLAIN: Value[] = [
  [192, 'whole', 0], [144, 'half', 1], [96, 'half', 0], [72, 'quarter', 1], [48, 'quarter', 0],
  [36, 'eighth', 1], [24, 'eighth', 0], [18, '16th', 1], [12, '16th', 0], [9, '32nd', 1], [6, '32nd', 0], [3, '64th', 0],
].map(([divs, type, dots]) => ({ divs: divs as number, type: type as string, dots: dots as number, triplet: false }));
const TRIPLET: Value[] = [[64, 'half'], [32, 'quarter'], [16, 'eighth'], [8, '16th'], [4, '32nd']]
  .map(([divs, type]) => ({ divs: divs as number, type: type as string, dots: 0, triplet: true }));

/** A length in divisions as written values, tied: the largest first */
export function pieces(d: number): Value[] {
  const out: Value[] = [];
  while (d > 0) {
    const v = d % 3 === 0
      ? PLAIN.find(p => p.divs <= d)
      : TRIPLET.find(p => p.divs <= d && (d - p.divs) % 3 === 0) ?? TRIPLET.find(p => p.divs <= d);
    if (!v) break;   // under a 64th: dropped
    out.push(v);
    d -= v.divs;
  }
  return out;
}

/** A bar's time signature from its length in divisions */
export function timeSig(d: number): [number, number] {
  if (d % DIV === 0) return [d / DIV, 8];
  if (d % (DIV / 2) === 0) return [d / (DIV / 2), 16];
  if (d % (DIV / 4) === 0) return [d / (DIV / 4), 32];
  return [Math.max(1, Math.round(d / (DIV / 2))), 16];
}

// ─── Pitch ──────────────────────────────────────────────────────────────────

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** The key signature (fifths) that holds most of a scale's pitch classes, the fewer accidentals among equals */
export function fifthsFor(pcs: number[]): number {
  let best = 0, bestScore = -Infinity;
  for (const f of [0, 1, -1, 2, -2, 3, -3, 4, -4, -5, 5, -6, 6]) {
    const key = new Set(MAJOR.map(d => (((7 * f + d) % 12) + 12) % 12));
    const score = pcs.filter(p => key.has(((p % 12) + 12) % 12)).length * 2 - pcs.length;
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return best;
}

/** A MIDI note spelled in a key: the spelling nearest the key on the line of fifths */
export function spell(midi: number, fifths: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const centre = fifths + 2;
  let best = 0, bestDist = Infinity;
  for (let p = -15; p <= 19; p++) {
    if ((((7 * p) % 12) + 12) % 12 !== pc) continue;
    const alter = Math.floor((p + 1) / 7);
    const d = Math.abs(p - centre) + Math.abs(alter) * 0.01;
    if (d < bestDist) { best = p; bestDist = d; }
  }
  const step = 'FCGDAEB'[(((best + 1) % 7) + 7) % 7];
  const alter = Math.floor((best + 1) / 7);
  return { step, alter, octave: Math.floor((midi - alter) / 12) - 1 };
}

// ─── Ottavas ────────────────────────────────────────────────────────────────

const TOP_LINE = 5 * 7 + 3;      // F5, the treble staff's top line, as a diatonic step
const BOTTOM_LINE = 4 * 7 + 2;   // E4, its bottom line
const MAX_LEDGERS = 3;           // four ledger lines or more: an ottava
const OTTAVA_BRIDGE = 4;         // onsets an ottava runs on through, to the next note that needs it

/** Ledger lines a note takes on the treble staff, written `shift` octaves down (8va: 1, 8vb: -1) */
export function ledgers(midi: number, fifths: number, shift = 0): number {
  const s = spell(midi, fifths);
  const d = (s.octave - shift) * 7 + 'CDEFGAB'.indexOf(s.step);
  return d > TOP_LINE ? Math.floor((d - TOP_LINE) / 2) : d < BOTTOM_LINE ? Math.floor((BOTTOM_LINE - d) / 2) : 0;
}

const fitsUnder = (pitches: number[], fifths: number, shift: number) => pitches.every(p => ledgers(p, fifths, shift) <= MAX_LEDGERS);

/** The ottava a chord needs: 0, 8va 1, 15ma 2, 8vb -1, 15mb -2 (the least that does it, or the best there is) */
export function ottavaFor(pitches: number[], fifths: number): number {
  if (!pitches.length || fitsUnder(pitches, fifths, 0)) return 0;
  const high = Math.max(...pitches);
  const ways = ledgers(high, fifths) > MAX_LEDGERS && spell(high, fifths).octave >= 5 ? [1, 2] : [-1, -2];
  return ways.find(w => fitsUnder(pitches, fifths, w)) ?? ways[1];
}

/** Ottava lines over a run of chords: from a note that needs one to the last that does, on through notes that read under it */
export function ottavas(chords: { pitches: number[]; fifths: number }[]): { start: number; end: number; shift: number }[] {
  const need = chords.map(c => ottavaFor(c.pitches, c.fifths));
  const out: { start: number; end: number; shift: number }[] = [];
  let i = 0;
  while (i < chords.length) {
    const shift = need[i];
    if (!shift) { i++; continue; }
    let end = i;
    for (let j = i + 1; j < chords.length && j - end <= OTTAVA_BRIDGE && (need[j] === shift || (need[j] === 0 && fitsUnder(chords[j].pitches, chords[j].fifths, shift))); j++)
      if (need[j] === shift) end = j;
    out.push({ start: i, end, shift });
    i = end + 1;
  }
  return out;
}

// ─── The score ──────────────────────────────────────────────────────────────

interface Ev {
  divs: number; pitches: number[]; vel: number;
  tempo?: number; quiet?: boolean; gradual?: string; fermata?: number;
  tuplet?: boolean;       // in a whole triplet group, written as triplets
  ottava?: number;        // an ottava line starts here: its shift
  ottavaEnd?: number;     // and ends after this one
}
interface Bar { evs: Ev[]; pcs: number[] | null }

/** The take as passes: one bar each */
export function barsOf(t: TakeFile, o: XmlOptions = {}): Bar[] {
  const ons = onsetsOf(t).filter(x => x.at >= (o.fromMs ?? 0));
  const timed = timeOnsets(ons.map(x => x.at));
  const bars: Bar[] = [];
  for (let i = 0; i < ons.length; i++) {
    const x = ons[i], tm = timed[i];
    if (!bars.length || x.pass) {
      if (o.bars !== undefined && bars.length >= o.bars) break;
      bars.push({ evs: [], pcs: x.pcs });
    }
    const bar = bars[bars.length - 1];
    bar.evs.push({ divs: tm.divs, pitches: x.pitches, vel: x.vel, tempo: tm.tempo, quiet: tm.quiet, gradual: tm.gradual });
    if (tm.silence) bar.evs.push({ divs: QUARTER_DIVS, pitches: [], vel: 0, fermata: tm.silence });
  }
  for (const b of bars) onGrid(b.evs);
  return bars;
}

const GRID = DIV / 4;                                     // a 32nd
const TRIPLET_GROUP = DIV;                                // three triplet 16ths (or 8th + 16th, or 3 triplet 8ths over two of these)
const isTriplet = (d: number) => d % GRID !== 0 && d % 4 === 0;

/**
 * A bar made exactly its time signature: a run of triplet values that makes whole
 * groups stays in triplets; anything else is put on the 32nd grid, each note
 * where its place rounds to (so the bar's length is kept to a 32nd).
 */
export function onGrid(evs: Ev[]): void {
  let i = 0, at = 0, written = 0;
  while (i < evs.length) {
    let j = i, sum = 0;
    while (j < evs.length && isTriplet(evs[j].divs)) sum += evs[j++].divs;
    if (j > i && sum % TRIPLET_GROUP === 0 && written % GRID === 0 && Math.abs(at - written) < GRID / 2) {
      for (let k = i; k < j; k++) evs[k].tuplet = true;
      at += sum; written += sum; i = j;
      continue;
    }
    const e = evs[i];
    at += e.divs;
    const d = Math.max(GRID, Math.round(at / GRID) * GRID - written);
    e.divs = d; written += d; i++;
  }
}

/** A length in triplet values only, largest first */
function tripletPieces(d: number): Value[] {
  const out: Value[] = [];
  while (d > 0) {
    const v = TRIPLET.find(p => p.divs <= d);
    if (!v) break;
    out.push(v);
    d -= v.divs;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shown = (bpm: number) => String(Math.round(bpm * 10) / 10);
const ottavaSize = (shift: number) => Math.abs(shift) === 2 ? 15 : 8;

/** A bar's notes (and rests) on the one staff, tied across the pieces of a length */
function barXml(evs: Ev[], fifths: number): string {
  let x = '', inTuplet = 0;
  for (const r of evs) {
    if (r.gradual) {
      x += `<direction placement="above"><direction-type><words font-style="italic">${r.gradual}</words></direction-type></direction>`;
    }
    if (r.tempo !== undefined) {
      const hide = r.quiet ? ' print-object="no"' : '';
      x += `<direction placement="above"><direction-type><metronome${hide}><beat-unit>quarter</beat-unit><per-minute>${shown(r.tempo)}</per-minute></metronome></direction-type>`
        + `<sound tempo="${r.tempo.toFixed(2)}"/></direction>`;
    }
    if (r.fermata !== undefined) {
      x += `<direction placement="above"><direction-type><words>${(r.fermata / 1000).toFixed(1)}″</words></direction-type></direction>`;
    }
    if (r.ottava) {
      // the notes keep their true pitch; the line says they're printed an octave (or two) from it
      x += `<direction placement="${r.ottava > 0 ? 'above' : 'below'}"><direction-type><octave-shift type="${r.ottava > 0 ? 'down' : 'up'}" size="${ottavaSize(r.ottava)}"/></direction-type></direction>`;
    }
    const ps = r.tuplet ? tripletPieces(r.divs) : pieces(r.divs);
    ps.forEach((v, n) => {
      const tieStart = r.pitches.length > 0 && n < ps.length - 1, tieStop = r.pitches.length > 0 && n > 0;
      const opens = v.triplet && inTuplet === 0;
      if (v.triplet) inTuplet += v.divs;
      const closes = v.triplet && inTuplet % TRIPLET_GROUP === 0;
      if (closes) inTuplet = 0;
      const notes = r.pitches.length ? r.pitches : [null];
      notes.forEach((p, c) => {
        const dyn = p === null ? '' : ` dynamics="${Math.round(r.vel / 90 * 100)}"`;
        x += `<note${dyn}>`;
        if (c > 0) x += '<chord/>';
        if (p === null) x += '<rest/>';
        else {
          const s = spell(p, fifths);
          x += `<pitch><step>${s.step}</step>${s.alter ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave}</octave></pitch>`;
        }
        x += `<duration>${v.divs}</duration>`;
        if (tieStop) x += '<tie type="stop"/>';
        if (tieStart) x += '<tie type="start"/>';
        x += `<voice>1</voice><type>${v.type}</type>${'<dot/>'.repeat(v.dots)}`;
        if (v.triplet) x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
        const marks: string[] = [];
        if (tieStop) marks.push('<tied type="stop"/>');
        if (tieStart) marks.push('<tied type="start"/>');
        if (c === 0 && opens) marks.push('<tuplet type="start" bracket="yes"/>');
        if (c === 0 && closes) marks.push('<tuplet type="stop"/>');
        if (p === null && r.fermata !== undefined && n === 0) marks.push('<fermata type="upright"/>');
        if (marks.length) x += `<notations>${marks.join('')}</notations>`;
        x += '</note>';
      });
    });
    if (r.ottavaEnd) x += `<direction><direction-type><octave-shift type="stop" size="${ottavaSize(r.ottavaEnd)}"/></direction-type></direction>`;
  }
  return x;
}

/** The take as a MusicXML score for piano: every note on one staff, to be laid out across two by hand */
export function takeToMusicXML(t: TakeFile, o: XmlOptions = {}): string {
  const bars = barsOf(t, o);
  const title = o.title ?? `Take ${new Date(t.recordedAt).toISOString().slice(0, 10)}`;
  // each bar's key, then the ottavas over every chord in order, bar lines and all
  const keys: number[] = [];
  bars.forEach((b, n) => keys.push(b.pcs ? fifthsFor(b.pcs) : (keys[n - 1] ?? 0)));
  const chords = bars.flatMap((b, n) => b.evs.filter(e => e.pitches.length).map(e => ({ e, pitches: e.pitches, fifths: keys[n] })));
  for (const l of ottavas(chords)) { chords[l.start].e.ottava = l.shift; chords[l.end].e.ottavaEnd = l.shift; }
  let body = '';
  let fifths: number | null = null, sig = '';
  bars.forEach((bar, n) => {
    const total = bar.evs.reduce((a, e) => a + e.divs, 0);
    const f = keys[n];
    const [beats, type] = timeSig(total);
    let attrs = '';
    if (n === 0) attrs += `<divisions>${QUARTER_DIVS}</divisions>`;
    if (f !== fifths) attrs += `<key><fifths>${f}</fifths></key>`;
    if (`${beats}/${type}` !== sig) attrs += `<time><beats>${beats}</beats><beat-type>${type}</beat-type></time>`;
    if (n === 0) attrs += '<clef><sign>G</sign><line>2</line></clef>';
    fifths = f; sig = `${beats}/${type}`;
    body += `<measure number="${n + 1}">`;
    if (attrs) body += `<attributes>${attrs}</attributes>`;
    body += barXml(bar.evs, f);
    body += '</measure>\n';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + `<score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work>`
    + '<identification><encoding><software>Bloom</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>\n'
    + `<part id="P1">\n${body}</part></score-partwise>\n`;
}
