// A selection: some of a bloom's events, worked on as if they were the whole bloom.
// The selected events are lifted out into a bloom of their own, a key acts on
// that, and the result goes back into their places. The rest stay as they were.

import { Bloom } from '../core/Bloom';

type Field = 'notes' | 'timeIntervals' | 'velocities' | 'chans' | 'intervals';
const FIELDS: Field[] = ['notes', 'timeIntervals', 'velocities', 'chans', 'intervals'];

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Each event's value: a shorter list wraps, as at playback */
const atEvent = <T>(list: T[], i: number): T => copy(list[i % list.length]);

/** The selected events (indices into the bloom's notes) as a bloom of their own */
export function extractSelection(full: Bloom, sel: number[]): Bloom {
  const sub = full.clone();
  sub.stack = [];
  for (const f of FIELDS) {
    const list = full[f] as unknown[];
    // a single value stays single: the selection shares it
    (sub as unknown as Record<Field, unknown[]>)[f] =
      list.length <= 1 ? copy(list) : sel.map(i => atEvent(list, i));
  }
  return sub;
}

/**
 * Put a worked-on selection back. Lists the key didn't touch keep their own
 * shape (while the number of events holds); a changed list is spelled out per event, the selected slots take the
 * new values in order, and if the selection grew or shrank, events are added
 * after its last slot or its last slots are dropped. Returns the new bloom and
 * where the selected events now are.
 */
export function mergeSelection(full: Bloom, sel: number[], extracted: Bloom, worked: Bloom)
  : { bloom: Bloom; sel: number[] } {
  const out = full.clone();
  out.stack = full.stack;
  // settings a key may change (scale, ranges, legato …) come from the worked bloom
  const settings = worked.clone();
  settings.notes = out.notes; settings.timeIntervals = out.timeIntervals;
  settings.velocities = out.velocities; settings.chans = out.chans; settings.intervals = out.intervals;
  out.import(settings);

  const n = full.notes.length;
  const k = sel.length;
  const kNew = worked.notes.length;
  const order = [...sel].sort((a, b) => a - b);
  const slotOf = new Map(order.map((s, j) => [s, j]));
  const last = order[order.length - 1] ?? n - 1;

  // where each event of the new bloom comes from: [from the full bloom, i] or [from the selection, j]
  const plan: Array<['full' | 'sel', number]> = [];
  for (let i = 0; i < n; i++) {
    const j = slotOf.get(i);
    if (j === undefined) plan.push(['full', i]);
    else if (j < kNew) plan.push(['sel', j]);
    if (i === last) for (let x = k; x < kNew; x++) plan.push(['sel', x]);
  }

  const lengthChanged = kNew !== k;
  for (const f of FIELDS) {
    const after = worked[f] as unknown[];
    const fullList = full[f] as unknown[];
    const same = JSON.stringify(after) === JSON.stringify(extracted[f]);
    // untouched lists keep their shape, unless events came or went around them
    if (same && (!lengthChanged || fullList.length <= 1)) continue;
    if (after.length === 0 || fullList.length === 0) continue;
    (out as unknown as Record<Field, unknown[]>)[f] =
      plan.map(([src, i]) => (src === 'full' ? atEvent(fullList, i) : atEvent(after, i)));
  }

  const newSel: number[] = [];
  plan.forEach(([src], i) => { if (src === 'sel') newSel.push(i); });
  return { bloom: out, sel: newSel };
}
