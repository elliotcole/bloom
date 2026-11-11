// Playing a take from part way in: what's in force then is sent first (the
// pedal down since 0:00, the tuning, the picture), and it goes on from there.

import { describe, expect, it } from 'vitest';
import { takeFrom, dueAfter, parseClock } from '../takeFrom';
import type { TakeEvent, TakeFile } from '../take';
import { cueMessage, nameMessage } from '../../lib/tuning';

function take(events: TakeEvent[], sysex: number[][] = []): TakeFile {
  return { kind: 'bloom-take', version: 1, recordedAt: 0, length: 100_000, ended: true, blooms: [], gardens: [], sysex, tables: [], events };
}

describe('a take from part way in', () => {
  it("sends each channel's pedal and controllers as they stood, the latest of each", () => {
    const t = take([
      [0, 'm', [0xb0, 64, 127], 0], [0, 'm', [0xb1, 64, 127], 0],
      [100, 'm', [0xb0, 7, 90], 0], [200, 'm', [0xb0, 7, 60], 0],
      [300, 'm', [0xc2, 5], 0], [400, 'm', [0xe3, 0, 70], 0],
      [500, 'm', [0xb0, 123, 0], 0],             // all notes off: not a state to restore
      [600, 'm', [0x90, 60, 80], 0], [700, 'm', [0x80, 60, 0], 0],   // notes aren't struck again
      [5000, 'm', [0xb1, 64, 0], 0],             // after the moment
    ]);
    const at = takeFrom(t, 1000);
    expect(at.midi).toEqual([[0xb0, 7, 60], [0xb0, 64, 127], [0xb1, 64, 127], [0xc2, 5], [0xe3, 0, 70]]);
    expect(t.events[at.index][0]).toBe(5000);
  });

  it('goes on from the first event at the moment, and plays what was sent ahead of it', () => {
    const t = take([
      [900, 'm', [0x90, 60, 80], 50],   // sent before, due at 950: past
      [960, 'm', [0x90, 62, 80], 90],   // sent before, due at 1050: still to play
      [960, 'm', [0xb0, 64, 0], 90],    // a pedal due after the moment isn't in force yet
      [1000, 'n', 0, 0],
    ]);
    const at = takeFrom(t, 1000);
    expect(at.index).toBe(3);
    expect(at.midi).toEqual([]);
    expect(dueAfter(t, at, 1000)).toEqual([1, 2]);
  });

  it("sends the helper's last tuning (its name and tables, not the cues), and the piano's", () => {
    const n1 = nameMessage('first'), n2 = nameMessage('second'), tab = [0xf0, 0x7e, 1, 0xf7], cue = cueMessage(null, 0);
    const t = take([
      [0, 'h', 0], [0, 'h', 2], [0, 'p', 0],
      [500, 'h', 1], [500, 'h', 2], [600, 'h', 3], [600, 'p', -1],
      [2000, 'h', 0],
    ], [n1, n2, tab, cue]);
    const at = takeFrom(t, 1000);
    expect(at.helper).toEqual([n2, tab]);
    expect(at.piano).toBe(-1);
    expect(takeFrom(take([[0, 'n', 0, 0]]), 1000).piano).toBeUndefined();
  });

  it('shows the bloom, garden and other voice that were on screen', () => {
    const t = take([
      [0, 'b', 0, 1, 1], [0, 'g', 0], [0, 'v', -1],
      [400, 'b', 3, 0, 1], [500, 'g', 2], [600, 'v', 4],
      [1500, 'b', 5, 1, 1],
    ]);
    const at = takeFrom(t, 1000);
    expect(at.shown).toEqual([3, 0, 1]);
    expect(at.garden).toBe(2);
    expect(at.other).toBe(4);
  });

  it('from the start, nothing to catch up', () => {
    const at = takeFrom(take([[0, 'm', [0xb0, 64, 127], 0]]), 0);
    expect(at.index).toBe(0);
    expect(at.midi).toEqual([]);
  });
});

describe('times typed', () => {
  it('reads h:mm:ss, m:ss and seconds', () => {
    expect(parseClock('1:44:00')).toBe(6_240_000);
    expect(parseClock('44:30')).toBe(2_670_000);
    expect(parseClock('90')).toBe(90_000);
    expect(parseClock(' 2:05.5 ')).toBe(125_500);
    expect(parseClock('')).toBeNull();
    expect(parseClock('1:x')).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
  });
});
