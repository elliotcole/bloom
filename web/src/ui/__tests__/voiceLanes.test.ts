// Two voices: A's lanes above B's, whichever has the focus
import { describe, expect, it } from 'vitest';
import { voiceLaneY } from '../visualization';
import { LANES_HEIGHT } from '../lanes';

describe('two voices, the lanes', () => {
  it('A sits above B, and B on the bottom edge', () => {
    expect(voiceLaneY('B', 600)).toBe(600 - LANES_HEIGHT);
    expect(voiceLaneY('A', 600)).toBe(600 - 2 * LANES_HEIGHT);
  });
});
