// The picture waits for the sound: measured for the piano, set by hand for MIDI
import { describe, expect, it } from 'vitest';
import { midiLag, pictureLag, setMidiLag, setPianoLag } from '../lag';

describe('picture lag', () => {
  it('MIDI waits what was set, kept within 0–500 ms', () => {
    setMidiLag(40);
    expect(pictureLag({ name: 'IAC' })).toBe(40);
    setMidiLag(-3); expect(midiLag()).toBe(0);
    setMidiLag(900); expect(midiLag()).toBe(500);
    setMidiLag(NaN); expect(midiLag()).toBe(0);
  });
  it('the piano waits what its audio device says', () => {
    const piano = { name: 'piano' };
    setPianoLag(o => o === piano, () => 23);
    setMidiLag(40);
    expect(pictureLag(piano)).toBe(23);
    expect(pictureLag({ name: 'IAC' })).toBe(40);
  });
});
