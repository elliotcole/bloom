// Two voices, linked (F k): the key, the key centre, the rhythm
// palette's basis and the tuning held in common. Only the focused voice is
// ever changed by a key, so after each change what moved in it is carried
// to the other: a key moved by transposing transposes the other voice too,
// any other new key is applied to it (its notes moved into it); the centre
// and the tuning are copied; a basis moved scales the other voice's times
// by the same amount, palette and all.

import type { Bloom } from './Bloom';
import { scaleKey } from '../lib/scales';

export type LinkKey = 'key' | 'root' | 'basis' | 'tuning';
export const LINK_KEYS: LinkKey[] = ['key', 'root', 'basis', 'tuning'];

/** What a voice's linkable properties are now (to compare after a key) */
export interface LinkState {
  degrees: number[] | null;   // the attached scale's pitch classes, sorted
  root: number | null;        // its key centre
  basis: number | null;       // a locked palette's basis
  tuning: string;             // the tuning, as JSON ('' for 12-TET)
}

const pcSet = (ds: number[]) => [...new Set(ds.map(d => ((d % 12) + 12) % 12))].sort((a, b) => a - b);

export function linkState(b: Bloom): LinkState {
  const s = b.appliedScale;
  return {
    degrees: s ? pcSet(s.degrees) : null,
    root: s ? scaleKey(s) ?? null : null,
    basis: b.lockedBasis(),
    tuning: b.tuning ? JSON.stringify(b.tuning) : '',
  };
}

/** How far `to` is `from` moved, in semitones (the smallest), or null when it isn't a transposition */
export function shiftBetween(from: number[], to: number[]): number | null {
  if (from.length !== to.length || !from.length) return null;
  const key = pcSet(to).join(',');
  for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    if (pcSet(from.map(x => x + d)).join(',') === key) return d;
  }
  return null;
}

/** The other voice's key made this voice's (its notes moved into it, a frozen scale too) */
function giveKey(from: Bloom, to: Bloom): void {
  if (!from.appliedScale) return;
  to.applyScale({ ...from.appliedScale, degrees: [...from.appliedScale.degrees] });
  if (to.frozen.pitch) to.frozen.pitch = to.appliedScale ?? to.frozen.pitch;
}

function giveRoot(from: Bloom, to: Bloom): void {
  const pc = from.appliedScale ? scaleKey(from.appliedScale) : undefined;
  if (pc === undefined || pc === null || !to.appliedScale) return;
  if (!pcSet(to.appliedScale.degrees).includes(pc)) return;   // not a note of its scale: it can't centre there
  to.centreOn(pc);
  if (to.frozen.pitch) to.frozen.pitch = to.appliedScale ?? to.frozen.pitch;
}

function giveTuning(from: Bloom, to: Bloom): void {
  to.tuning = from.tuning ? JSON.parse(JSON.stringify(from.tuning)) : null;
  to.followTuningRoot();
}

/** Linking: the other voice takes this one's linked properties. Returns what it took */
export function linkNow(from: Bloom, to: Bloom, k: LinkKey): boolean {
  switch (k) {
    case 'key': if (!from.appliedScale) return false; giveKey(from, to); giveRoot(from, to); to.followTuningRoot(); return true;
    case 'root': giveRoot(from, to); to.followTuningRoot(); return true;
    case 'tuning': giveTuning(from, to); return true;
    case 'basis': {
      const want = from.lockedBasis(), have = to.lockedBasis();
      if (want === null || have === null || want === have) return want !== null && have !== null;
      to.scaleTimes(want / have);
      return true;
    }
  }
}

/**
 * After a change to `from` (whose linked properties were `before`), carry
 * what moved to `to`. Returns the names of what was carried.
 */
export function carryLinks(from: Bloom, before: LinkState, to: Bloom, links: ReadonlySet<LinkKey>): string[] {
  if (!links.size) return [];
  const now = linkState(from);
  const moved: string[] = [];
  if (links.has('key') && now.degrees && before.degrees && now.degrees.join(',') !== before.degrees.join(',')) {
    const d = shiftBetween(before.degrees, now.degrees);
    if (d !== null && to.appliedScale) to.transpose(d); else giveKey(from, to);
    moved.push('key');
  } else if (links.has('key') && now.degrees && !before.degrees) {
    giveKey(from, to);
    moved.push('key');
  }
  if (links.has('root') && now.root !== null && now.root !== before.root) {
    giveRoot(from, to);
    moved.push('key centre');
  }
  if (links.has('tuning') && now.tuning !== before.tuning) {
    giveTuning(from, to);
    moved.push('tuning');
  } else if (moved.length) to.followTuningRoot();
  if (links.has('basis') && now.basis !== null && now.basis !== before.basis) {
    const have = to.lockedBasis();
    if (have !== null) to.scaleTimes(now.basis / have);
    else if (before.basis !== null) to.scaleTimes(now.basis / before.basis);   // no palette there: its times move alike
    moved.push('time basis');
  }
  return moved;
}
