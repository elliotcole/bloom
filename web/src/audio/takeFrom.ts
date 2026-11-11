// Playing a take from part way in: what's in force at that moment is sent
// first (each channel's pedal and controllers, its program and bend, the
// tuning, what the picture shows), then the take goes on from there. Notes
// already sounding then aren't struck; everything due from then on is.

import type { TakeEvent, TakeFile } from './take';
import { cueMessage, nameMessage } from '../lib/tuning';

const NAME_TAG = nameMessage('x').slice(0, 5).join(',');
const CUE_TAG = cueMessage(null, 0).slice(0, 5).join(',');
const tag = (m: number[]) => m.slice(0, 5).join(',');

export interface TakeFrom {
  /** where the take goes on: the first event at or after the moment */
  index: number;
  /** each channel's controllers (not the channel-mode ones, 120 and up), program, pressure and bend, as they stood */
  midi: number[][];
  /** the tuning the helper was last sent (its name and tables, not the cues), and the piano's: -1 12-TET, undefined untouched */
  helper: number[][];
  piano: number | undefined;
  /** what the picture showed: the bloom (index, traced, the session's own), the garden, the other voice */
  shown: [number, 0 | 1, 0 | 1] | null;
  garden: number | null;
  other: number | null;
}

const due = (e: TakeEvent) => e[0] + (e[1] === 'm' ? e[3] : 0);

/** Where the take stands at `ms` (events in time order, as a take keeps them) */
export function takeFrom(take: TakeFile, ms: number): TakeFrom {
  const ctl = new Map<number, number[]>();   // a key per channel and kind (and controller)
  let helper: number[][] = [];
  const r: TakeFrom = { index: take.events.length, midi: [], helper, piano: undefined, shown: null, garden: null, other: null };
  for (let i = 0; i < take.events.length; i++) {
    const e = take.events[i];
    if (e[0] >= ms) { r.index = i; break; }
    switch (e[1]) {
      case 'm': {
        if (due(e) >= ms) break;   // sent ahead, due later: it plays as the take goes on
        const m = e[2], st = m[0] & 0xf0, ch = m[0] & 0x0f;
        if (st === 0xb0 && m[1] < 120) ctl.set(ch * 1000 + m[1], m);
        else if (st === 0xc0 || st === 0xd0 || st === 0xe0) ctl.set(ch * 1000 + 200 + (st >> 4), m);
        break;
      }
      case 'h': {
        const m = take.sysex[e[2]];
        if (tag(m) === CUE_TAG) break;
        if (tag(m) === NAME_TAG) helper = [];
        helper.push(m);
        break;
      }
      case 'p': r.piano = e[2]; break;
      case 'b': r.shown = [e[2], e[3], e[4]]; break;
      case 'g': r.garden = e[2]; break;
      case 'v': r.other = e[2]; break;
    }
  }
  r.midi = [...ctl.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => [...m]);
  r.helper = helper;
  return r;
}

/** MIDI sent ahead from before the moment but due after it: still to play */
export function dueAfter(take: TakeFile, from: TakeFrom, ms: number): number[] {
  const out: number[] = [];
  for (let i = from.index - 1; i >= 0 && take.events[i][0] > ms - 5000; i--) {
    const e = take.events[i];
    if (e[1] === 'm' && due(e) >= ms) out.unshift(i);
  }
  return out;
}

/** "1:44:00", "44:00", "90" (s) → ms; null if it isn't a time */
export function parseClock(s: string): number | null {
  const parts = s.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
  return Math.round(parts.reduce((t, p) => t * 60 + Number(p), 0) * 1000);
}
