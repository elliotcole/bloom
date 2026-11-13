// The piece player pausing or jumping: every note handed to the piano is
// released (a jump used to drop the releases and play on, the notes ringing).

import { describe, expect, it } from 'vitest';
import { offsAtPause } from '../pieceOffs';

describe('the releases when the player stops', () => {
  it('a sounding note now, one handed over ahead as it starts, none later than its own end', () => {
    const pending = [
      { onMs: 900, atMs: 1500, pitch: 60 },    // sounding
      { onMs: 1100, atMs: 1800, pitch: 62 },   // handed over, to start in 100 ms
      { onMs: 800, atMs: 1000, pitch: 64 },    // ending now anyway
      { onMs: 990, atMs: 995, pitch: 65 },     // already over
    ];
    expect(offsAtPause(pending, 1000)).toEqual([
      { pitch: 60, atMs: 1000 }, { pitch: 62, atMs: 1101 }, { pitch: 64, atMs: 1000 }, { pitch: 65, atMs: 995 },
    ]);
  });
});
