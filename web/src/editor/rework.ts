// Bloom's own verbs on passes of a take: each pass made into a bloom from what
// sounds in it (its own bloom's scale, key and ranges carried over), the verbs
// run on that, and the lists read back into notes in place of the pass. Passes
// that sound the same are worked once and get the same result, so a run of
// them can be changed as one, even by a verb that throws dice.

import { Bloom } from '../core/Bloom';
import type { NoteArray } from '../lib/arrays';
import { bloomFromJSON, bloomToJSON } from '../io/garden-io';
import type { BloomJSON } from '../io/garden-io';
import { clipBloom, clipOf, onsetsOf } from './ops';
import type { Clip } from './ops';
import type { Op, Pass, Perf, Voice } from './perf';

/** Onsets this close (ms) in time count as the same when passes are compared */
const SAME_MS = 10;

type ClipNote = Clip['notes'][number];

/** A clip's onsets, each chord's notes from the lowest up */
function onsetNotes(c: Clip): ClipNote[][] {
  return onsetsOf(c.notes).map(o => o.map(i => c.notes[i]).sort((a, b) => a.pitch - b.pitch));
}

/** When an onset starts: its first note */
const startOf = (o: ClipNote[]) => Math.min(...o.map(n => n.at));

/**
 * What sounds in a clip of one pass, as a bloom: `json` (the bloom the pass
 * played) for its scale, key and ranges, and the clip's onsets for its lists.
 * Intervals and figures are none, being in the notes already. Null with no notes.
 */
export function bloomOfClip(json: BloomJSON | undefined, c: Clip): Bloom | null {
  const os = onsetNotes(c);
  if (!os.length) return null;
  const b = json ? bloomFromJSON(json) : new Bloom();
  const at = os.map(startOf);
  b.notes = os.map(o => (o.length === 1 ? o[0].pitch : o.map(n => n.pitch))) as NoteArray;
  b.velocities = os.map(o => Math.max(...o.map(n => n.vel)));
  b.timeIntervals = at.map((t, k) => ((k + 1 < at.length ? at[k + 1] : c.length) - t) / 1000);
  b.chans = os.map(o => o[0].chan);
  b.intervals = [0];
  b.figures = [0];
  b.gates = [1];
  return b;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 250; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * A bloom's lists back as notes, in place of the clip `was` of the pass numbered `id`:
 * the first onset where it was, the rest by the time list (the pass ends at its
 * sum); each note as long as the note at its place was (else the pass's usual
 * length); a chord that kept its size keeps its proportions of loudness. The
 * pass names the bloom, which comes with the clip.
 */
export function clipOfBloom(b: Bloom, was: Clip, id: number, timesWere?: number[]): Clip {
  const old = onsetNotes(was);
  const lead = old.length ? startOf(old[0]) : 0;
  const usual = median(was.notes.map(n => n.dur));
  const vl = b.velocities.length, tl = b.timeIntervals.length, cl = b.chans.length;
  const notes: ClipNote[] = [];
  // a time the verbs left alone keeps its onset exactly as this pass had it: a bloom's times are
  // seconds, and rounded, and passes worked as one differ by a few ms. `timesWere`: the bloom's
  // times before the verbs (absent: this pass's own gaps).
  const was0 = old.map(startOf);
  const gapWas = (k: number) => (timesWere ? timesWere[k] * 1000 : (k + 1 < was0.length ? was0[k + 1] : was.length) - was0[k]);
  let t = lead, untouched = true;
  b.notes.forEach((v, k) => {
    if (untouched && k < was0.length) t = was0[k];
    const ps = (Array.isArray(v) ? (v as unknown[]).flat(Infinity) as number[] : [v as number]).map(p => clamp(p, 0, 127)).sort((x, y) => x - y);
    const vel = clamp(vl ? b.velocities[k % vl] : 80, 1, 127);
    const chan = cl ? b.chans[k % cl] : old[k]?.[0].chan ?? 0;
    const then = old[k], top = then ? Math.max(...then.map(n => n.vel), 1) : 1;
    const kept = then && then.length === ps.length;
    ps.forEach((pitch, i) => {
      const like = then?.[Math.min(i, then.length - 1)];
      notes.push({
        at: t, dur: like ? like.dur : usual, pitch, chan, ix: k, pass: id,
        vel: kept && ps.length > 1 ? clamp((vel * then[i].vel) / top, 1, 127) : vel,
      });
    });
    const gap = Math.max(0, (tl ? b.timeIntervals[k % tl] : 0.25) * 1000);
    if (untouched && !(k < was0.length && k < (timesWere?.length ?? Infinity) && Math.abs(gap - gapWas(k)) < 0.01)) untouched = false;
    t += gap;
  });
  const length = untouched && b.notes.length === was0.length ? was.length : t > 0 ? t : was.length;
  return { length, notes, passes: [{ id, at: 0, end: length, bloom: clipBloom(0) }], blooms: [bloomToJSON(b)] };
}

/** What makes two passes the same: their bloom and their onsets, near enough in time */
function sameness(bloom: number, c: Clip): string {
  const r = (ms: number) => Math.round(ms / SAME_MS);
  return JSON.stringify([bloom, r(c.length), onsetNotes(c).map(o => [r(startOf(o)), ...o.map(n => [n.pitch, n.vel])])]);
}

/**
 * Verbs (`run`) on passes of a voice, as one op: each pass replaced by what
 * they make of it, the last first so the earlier ones are still where they
 * were. `blooms` is every bloom a pass can name; `voice`, the op's (none: every
 * voice and the clock). Null if no pass has notes.
 */
export function rework(p: Perf, blooms: BloomJSON[], passes: Pass[], run: (b: Bloom) => void, label: string, voice?: Voice): { op: Op; kinds: number } | null {
  // each kind of pass worked once: the bloom the verbs made of it, and its times before them
  const made = new Map<string, { b: Bloom; times: number[] } | null>();
  const ops: Op[] = [];
  for (const s of [...passes].sort((a, b) => b.at - a.at)) {
    const was = clipOf(p, s.at, s.end, s.voice);
    const key = sameness(s.bloom, was);
    let kind = made.get(key);
    if (kind === undefined) {
      const b = bloomOfClip(blooms[s.bloom], was);
      const times = b ? [...b.timeIntervals] : [];
      if (b) run(b);
      kind = b ? { b, times } : null;
      made.set(key, kind);
    }
    if (!kind) continue;
    // the same result for each, on its own timing where the verbs left the times alone
    const clip = clipOfBloom(kind.b, was, s.id, kind.times);
    ops.push({ op: 'insert', at: s.at, to: s.end, clip, ...(voice === undefined ? {} : { voice }) });
  }
  if (!ops.length) return null;
  return { op: { op: 'group', ops, label }, kinds: [...made.values()].filter(Boolean).length };
}
