// A take written as a score: durations from the take's exact times, a unit per
// stretch written as eighths, a tempo mark where the time list changes speed.
import { describe, expect, it } from 'vitest';
import type { TakeEvent, TakeFile } from '../../audio/take';
import { barsOf, fifthsFor, fits, ledgers, onGrid, onsetsOf, ottavaFor, ottavas, pieces, spell, takeToMusicXML, timeOnsets, timeSig } from '../musicxml';

const MAJOR_EB = [0, 2, 3, 5, 7, 8, 10];

/** A take of a line: gaps in ms, pitches cycling, a new pass every `pass` notes */
function take(gaps: number[], opts: { pitches?: number[]; pass?: number; pcs?: number[] } = {}): TakeFile {
  const pitches = opts.pitches ?? [72], pass = opts.pass ?? 4;
  const events: TakeEvent[] = [[0, 'b', 0, 1, 1]];
  let t = 10;
  for (let i = 0; i <= gaps.length; i++) {
    events.push([t, 'n', i % pass, i]);
    events.push([t - 2, 'm', [0x90, pitches[i % pitches.length], 80], 2]);   // sent 2 ms ahead
    if (i < gaps.length) t += gaps[i];
  }
  const bloom = { appliedScale: { degrees: opts.pcs ?? [0, 2, 4, 5, 7, 9, 11], pitchesPerOctave: 12, name: '' } };
  return {
    kind: 'bloom-take', version: 1, recordedAt: 0, length: t, ended: true,
    blooms: [bloom as unknown as TakeFile['blooms'][0]], gardens: [], sysex: [], tables: [], events,
  };
}
const at = (gaps: number[]) => gaps.reduce((a, g) => [...a, a[a.length - 1] + g], [0]);
const marks = (gaps: number[]) => timeOnsets(at(gaps)).flatMap((t, i) => t.tempo && !t.quiet ? [[i, Math.round(t.tempo * 10) / 10]] : []);

describe('onsets', () => {
  it('a note sounds when it was sent plus how far ahead; notes together are a chord', () => {
    const t = take([250, 250]);
    t.events.push([258, 'm', [0x90, 48, 70], 2]);   // with the second note
    const o = onsetsOf(t);
    expect(o.map(x => x.at)).toEqual([10, 260, 510]);
    expect(o[1].pitches).toEqual([48, 72]);
    expect(o[0].pass).toBe(true);
    expect(o[1].pass).toBe(false);
  });
});

describe('durations', () => {
  it('a steady line: its value as an eighth, one tempo', () => {
    const tm = timeOnsets(at([250, 250, 250, 250]));
    expect(tm.map(t => t.divs)).toEqual([24, 24, 24, 24, 24]);
    expect(marks([250, 250, 250, 250])).toEqual([[0, 120]]);
  });
  it('halves and doubles of it stay in the tempo, as sixteenths and quarters', () => {
    const g = [500, 500, 250, 250, 500, 1000, 500, 250, 250, 500];
    expect(timeOnsets(at(g)).slice(0, -1).map(t => t.divs)).toEqual([24, 24, 12, 12, 24, 48, 24, 12, 12, 24]);
    expect(marks(g)).toEqual([[0, 60]]);
  });
  it('a quarter past 170 is written in sixteenths', () => {
    expect(marks([130, 130, 130, 130])).toEqual([[0, 115.4]]);
    expect(timeOnsets(at([130, 130]))[0].divs).toBe(12);
  });
  it('5:6 is a new tempo, not quintuplets', () => {
    const g = [...Array(8).fill(500), ...Array(8).fill(416.7)];
    expect(marks(g)).toEqual([[0, 60], [8, 72]]);
  });
  it('a time list sped up by a little is a new tempo too', () => {
    const g = [...Array(8).fill(220), ...Array(8).fill(215)];
    expect(marks(g)).toEqual([[0, 136.4], [8, 139.5]]);
  });
  it('one step cut short is written to its nearest value, the tempo kept', () => {
    const g = [250, 250, 250, 180, 250, 250, 250, 250];
    expect(marks(g)).toEqual([[0, 120]]);
    expect(timeOnsets(at(g))[3].divs).toBe(18);
  });
  it('a played-in take wobbles a few ms and keeps its tempo', () => {
    const g = [250, 251.1, 249.2, 250.4, 248.8, 250, 251, 249.5, 250.2, 249];
    expect(marks(g)).toEqual([[0, 120]]);
  });
  it('a glide is shown as accel. from where it starts to the tempo it reaches', () => {
    const g = [...Array(8).fill(220), ...Array.from({ length: 60 }, (_, i) => 220 * 0.995 ** i), ...Array(8).fill(220 * 0.995 ** 60)];
    const tm = timeOnsets(at(g));
    const shown = tm.filter(t => t.tempo && !t.quiet);
    expect(tm.some(t => t.gradual === 'accel.')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(4);
    expect(tm.filter(t => t.quiet).length).toBeGreaterThan(3);   // played, not shown
  });
  it('a long silence is a fermata with its seconds', () => {
    const tm = timeOnsets(at([250, 250, 7600, 250, 250]));
    expect(tm[2].silence).toBe(7600);
    expect(tm[2].divs).toBe(24);
    expect(tm.filter(t => t.tempo).length).toBe(1);
  });
  it('fits: plain values only', () => {
    expect(fits(375, 250)).toBe(36);
    expect(fits(166.7, 250)).toBe(16);   // a triplet eighth
    expect(fits(416.7, 250)).toBe(0);    // five triplet sixteenths: no
  });
});

describe('written values', () => {
  it('a length as tied values, largest first', () => {
    expect(pieces(24).map(v => v.type)).toEqual(['eighth']);
    expect(pieces(36).map(v => [v.type, v.dots])).toEqual([['eighth', 1]]);
    expect(pieces(60).map(v => v.divs)).toEqual([48, 12]);
    expect(pieces(20).map(v => [v.divs, v.triplet])).toEqual([[8, true], [12, false]]);
  });
  it('a bar is as long as its pass', () => {
    expect(timeSig(24 * 7)).toEqual([7, 8]);
    expect(timeSig(12 * 13)).toEqual([13, 16]);
  });
});

describe('pitch', () => {
  it('the key signature that holds the scale', () => {
    expect(fifthsFor(MAJOR_EB)).toBe(-3);
    expect(fifthsFor([0, 2, 4, 5, 7, 9, 11])).toBe(0);
    expect(fifthsFor([1, 3, 6, 8, 10])).toBe(-5);   // the black keys: in Db (or F#); five flats
  });
  it('spelled from the key', () => {
    expect(spell(63, -3)).toEqual({ step: 'E', alter: -1, octave: 4 });
    expect(spell(66, 0)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(60, 0)).toEqual({ step: 'C', alter: 0, octave: 4 });
    expect(spell(64, -4)).toEqual({ step: 'E', alter: 0, octave: 4 });   // E natural in Ab, not Fb
  });
});

describe('the score', () => {
  it('a bar a pass, the time signature its length', () => {
    const bars = barsOf(take(Array(11).fill(250), { pass: 4 }));
    expect(bars.length).toBe(3);
    expect(bars[0].evs.map(e => e.divs)).toEqual([24, 24, 24, 24]);
  });
  it('the first N bars', () => {
    expect(barsOf(take(Array(40).fill(250), { pass: 4 }), { bars: 5 }).length).toBe(5);
  });
  it('every note on one staff, whatever its channel, the key from the scale', () => {
    const t = take([250, 250, 250], { pitches: [75, 43], pcs: MAJOR_EB });
    t.events.push([258, 'm', [0x93, 55, 70], 2]);   // another channel, with the second note
    const xml = takeToMusicXML(t);
    expect(xml).not.toContain('<staves>');
    expect(xml).not.toContain('<backup>');
    expect(xml).toContain('<fifths>-3</fifths>');
    expect(xml).toContain('<time><beats>4</beats><beat-type>8</beat-type></time>');
    expect(xml).toMatch(/<step>E<\/step><alter>-1<\/alter><octave>5<\/octave>/);
    expect(xml).toMatch(/<chord\/><pitch><step>G<\/step><octave>3<\/octave>/);
    expect(xml).toContain('<per-minute>120</per-minute>');
    expect(xml).toContain('<sound tempo="120.00"/>');
  });
});

describe('every bar exactly its time signature', () => {
  const ev = (divs: number) => ({ divs, pitches: [72], vel: 80 });
  it('whole triplet groups stay triplets', () => {
    const evs = [ev(24), ev(8), ev(8), ev(8), ev(16), ev(8), ev(24)];
    onGrid(evs);
    expect(evs.map(e => e.divs)).toEqual([24, 8, 8, 8, 16, 8, 24]);
    expect(evs.map(e => !!(e as { tuplet?: boolean }).tuplet)).toEqual([false, true, true, true, true, true, false]);
  });
  it('a group cut by the bar line goes on the 32nd grid, the bar kept to a 32nd', () => {
    const evs = [ev(24), ev(8), ev(8)];
    onGrid(evs);
    expect(evs.every(e => e.divs % 6 === 0)).toBe(true);
    expect(evs.reduce((a, e) => a + e.divs, 0)).toBe(42);   // 40, to the nearest 32nd
  });
  it('a 64th or a dotted 32nd goes on the grid too', () => {
    const evs = [ev(33), ev(24), ev(15)];
    onGrid(evs);
    expect(evs.map(e => e.divs)).toEqual([36, 24, 12]);
  });
});

describe('ottavas', () => {
  it('four ledger lines or more', () => {
    expect(ledgers(88, 0)).toBe(3);   // E6
    expect(ledgers(91, 0)).toBe(4);   // G6
    expect(ledgers(50, 0)).toBe(4);   // D3
    expect(ottavaFor([88], 0)).toBe(0);
    expect(ottavaFor([91], 0)).toBe(1);
    expect(ottavaFor([103], 0)).toBe(2);   // G7: 15ma
    expect(ottavaFor([50], 0)).toBe(-1);
    expect(ottavaFor([29], 0)).toBe(-2);   // F1: 15mb
  });
  it('a line runs on through notes that read under it, to the last that needs it', () => {
    const c = (p: number) => ({ pitches: [p], fifths: 0 });
    expect(ottavas([c(72), c(91), c(84), c(93), c(72), c(60), c(40)])).toEqual([
      { start: 1, end: 3, shift: 1 },
      { start: 6, end: 6, shift: -1 },
    ]);
  });
  it('written as octave-shift lines, the notes at their true pitch', () => {
    const xml = takeToMusicXML(take([250, 250, 250], { pitches: [72, 93, 72] }));
    expect(xml).toContain('<octave-shift type="down" size="8"/>');
    expect(xml).toContain('<octave-shift type="stop" size="8"/>');
    expect(xml).toMatch(/<step>A<\/step><octave>6<\/octave>/);
  });
});
