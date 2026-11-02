import { afterEach, describe, expect, it } from 'vitest';
import { Bloom } from '../Bloom';
import { SCALES } from '../../lib/scales';
import { flatNotes } from '../../lib/arrays';

const flat = (b: Bloom) => flatNotes(b.notes) as number[];
const finite = (b: Bloom) => flat(b).every(Number.isFinite);
const inCMajor = (b: Bloom) => flat(b).every(n => SCALES.major.degrees.includes(n % 12));

function bloom(notes: Bloom['notes'], vels = [80, 60, 70], times = [0.5, 0.25, 0.25]): Bloom {
  const b = new Bloom(notes, vels, times, 0);
  b.lowestPossibleNote = 20; b.highestPossibleNote = 108;
  return b;
}

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

describe('reduceScale', () => {
  it('never empties the scale or makes NaN notes', () => {
    const b = bloom([60, 72, 60]);
    for (let i = 0; i < 20; i++) b.reduceScale();
    expect(finite(b)).toBe(true);
    expect(b.scale.degrees.length).toBeGreaterThan(0);
  });
  it('reduces the attached scale, not the sounding set', () => {
    const b = bloom([60, 64, 67]).applyScale(SCALES.major);
    b.reduceScale();
    expect(b.appliedScale!.degrees.length).toBe(6);
    expect(finite(b)).toBe(true);
  });
});

describe('pivots', () => {
  it('pivotLoudest works with more velocities than notes', () => {
    const b = bloom([60, 64, 67], [50, 90, 60, 70, 80]);
    b.pivotLoudest();
    expect(finite(b)).toBe(true);
    expect(flat(b)[1]).toBe(64);   // the loudest event keeps its pitch
  });
  it('pivot keeps the highest note and chords', () => {
    const b = bloom([[60, 64, 67], 72]);
    b.pivot();
    expect(Array.isArray(b.notes[0])).toBe(true);
    expect(Math.max(...flat(b))).toBe(72);
    expect(finite(b)).toBe(true);
  });
  it('pivot(i) inverts i times', () => {
    const once = bloom([60, 64, 67]).pivot(1);
    const twice = bloom([60, 64, 67]).pivot(2);
    expect(flat(once)).not.toEqual(flat(twice));
  });
});

describe('thin', () => {
  it('never empties the bloom', () => {
    for (let t = 0; t < 200; t++) {
      const b = bloom([60, 62, 64]);
      b.thin(0.5);
      expect(b.notes.length).toBeGreaterThanOrEqual(2);
      expect(b.velocities.length).toBe(b.notes.length);
    }
  });
  it('drops whole chords and gives their time to the note before', () => {
    Math.random = () => 0;   // every note after the first goes
    const b = bloom([60, [62, 65], 64, 67], [80, 60, 70, 50], [0.5, 0.25, 0.25, 1]);
    Math.random = (() => { let i = 0; return () => (i++ === 1 ? 0 : 1); })();   // only the chord goes
    b.thin(0.5);
    expect(b.notes).toEqual([60, 64, 67]);
    expect(b.timeIntervals).toEqual([0.75, 0.25, 1]);
    expect(b.velocities).toEqual([80, 70, 50]);
  });
});

describe('diatonic steps', () => {
  it('dTranspose moves an off-scale note from its nearest scale note', () => {
    const b = bloom([60, 61, 64]).applyScale(SCALES.major);
    b.notes = [60, 61, 64];   // put the C# back after the snap
    b.dTranspose(1);
    expect(flat(b)).toEqual([62, 64, 65]);
  });
  it('dTranspose keeps chords', () => {
    const b = bloom([[60, 64, 67], 72]).applyScale(SCALES.major);
    b.dTranspose(1);
    expect(b.notes).toEqual([[62, 65, 69], 74]);
  });
  it('mutateNotesD stays in the scale', () => {
    const b = bloom([60, 62, 64, 65, 67, 69, 71]).applyScale(SCALES.major);
    for (let i = 0; i < 30; i++) b.mutateNotesD(0.5);
    expect(inCMajor(b)).toBe(true);
    expect(finite(b)).toBe(true);
  });
});

describe('scale snapping', () => {
  it('snaps B up to C in C pentatonic', () => {
    const b = bloom([71, 60, 67]).applyScale(SCALES.majorPentatonic);
    expect(flat(b)).toEqual([72, 60, 67]);
  });
  it('transpose carries the scale and key', () => {
    const b = bloom([60, 64, 67]).applyScale(SCALES.major, 0);
    b.transpose(1);
    expect(b.appliedScale!.degrees).toEqual([0, 1, 3, 5, 6, 8, 10]);
    expect(b.keyRoot).toBe(1);
    b.dTranspose(1);
    expect(flat(b)).toEqual([63, 66, 70]);
  });
  it('setRoot takes a negative root', () => {
    const b = bloom([60, 64, 67]).applyScale(SCALES.major, 0);
    b.addFlat();
    expect(b.keyRoot).toBe(5);
  });
});

describe('removeDoubles', () => {
  it('drops the later copy of a pitch, with its own time', () => {
    const b = bloom([60, 64, 60, 67], [80, 60, 70, 50], [0.5, 0.25, 0.25, 1]);
    b.removeDoubles();
    expect(b.notes).toEqual([60, 64, 67]);
    expect(b.timeIntervals).toEqual([0.5, 0.25, 1]);
    expect(b.velocities).toEqual([80, 60, 50]);
  });
  it('treats a chord as one event', () => {
    const b = bloom([[60, 64], 67, [60, 64]], [80, 60, 70], [0.5, 0.25, 0.25]);
    b.removeDoubles();
    expect(b.notes).toEqual([[60, 64], 67]);
  });
});

describe('blend / thicken', () => {
  it('never makes a zero duration', () => {
    const b = bloom([60, 62, 64], [80, 80, 80], [0.25, 0.25, 0.25]);
    b.blend(bloom([67, 69], [50, 50], [0.25, 0.25]));
    expect(b.timeIntervals.every(t => t > 0)).toBe(true);
    for (let i = 0; i < 20; i++) {
      const c = bloom([60, 62, 64, 65], [80, 80, 80, 80], [0.25, 0.25, 0.25, 0.25]);
      c.thicken();
      expect(c.timeIntervals.every(t => t > 0)).toBe(true);
    }
  });
  it('keeps the total duration', () => {
    const b = bloom([60, 62, 64], [80, 80, 80], [0.5, 0.5, 0.5]);
    b.blend(bloom([67, 69], [50, 50], [0.25, 0.75]));
    expect(b.timeIntervals.reduce((a, x) => a + x, 0)).toBeCloseTo(1.5, 6);
  });
});

describe('fixed duration, stretch mode', () => {
  it('keeps every note when the time list phases', () => {
    const b = bloom([60, 62, 64, 65, 67], [80], [0.5, 0.25]);
    b.fixedDur = 4; b.fixedDurMode = 'scale';
    b.resolveFixed();
    expect(b.notes.length).toBe(5);
    expect(b.timeIntervals.length).toBe(5);
    expect(b.dur()).toBeCloseTo(4, 3);
  });
});

describe('order', () => {
  it('shuffle keeps the length on an odd bloom', () => {
    const b = bloom([60, 62, 64, 65, 67], [80, 70, 60, 50, 40], [0.5, 0.5, 0.5, 0.5, 0.5]);
    b.shuffle();
    expect(b.notes).toEqual([60, 65, 62, 67, 64]);
    expect(b.velocities).toEqual([80, 50, 70, 40, 60]);
  });
  it('scrambleChunks keeps runs together', () => {
    const notes = [60, 61, 62, 63, 64, 65];
    const b = bloom(notes, [80, 70, 60, 50, 40, 30], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(b.scrambleChunks(3)).toBe(true);
    const out = flat(b);
    expect(out.length).toBe(6);
    for (let i = 0; i < 6; i += 2) expect(out[i + 1] - out[i]).toBe(1);   // each pair survives
    expect(out).not.toEqual(notes);
    // each note keeps its velocity
    out.forEach((n, i) => expect(b.velocities[i]).toBe(80 - (n - 60) * 10));
  });
  it('scrambleChunks with as many chunks as notes is a scramble; fewer than two does nothing', () => {
    const b = bloom([60, 62, 64]);
    expect(b.scrambleChunks(1)).toBe(false);
    expect(b.scrambleChunks(99)).toBe(true);
    expect(flat(b).sort()).toEqual([60, 62, 64]);
  });
});

describe('velocities', () => {
  it('mutateVelocities keeps rests', () => {
    const b = bloom([60, 62, 64], [80, 0, 70]);
    for (let i = 0; i < 20; i++) b.mutateVelocities();
    expect(b.velocities[1]).toBe(0);
    expect(b.velocities[0]).toBeGreaterThan(0);
  });
});

describe('thicken', () => {
  it('adds a few notes inside the longest durations and keeps the total time', () => {
    for (let i = 0; i < 30; i++) {
      const b = bloom([60, 62, 64, 65, 67, 69], [80, 80, 80, 80, 80, 80], [1, 0.25, 0.25, 0.25, 0.25, 0.25]);
      b.thicken();
      expect(b.notes.length).toBe(7);                    // the 1 is the only note ≥ half the longest
      expect(b.timeIntervals.reduce((a, x) => a + x, 0)).toBeCloseTo(2.25, 6);
      expect(b.timeIntervals[0]).toBeCloseTo(0.5, 6);
      expect(b.timeIntervals[1]).toBeCloseTo(0.5, 6);
      expect(b.notes[1]).not.toBe(60);                   // a scale neighbour, never the same note
      expect(b.velocities[1]).toBeLessThan(80);
    }
  });
  it('adds at most three notes however long the bloom', () => {
    const b = bloom(Array.from({ length: 40 }, (_, i) => 60 + (i % 7)), [80], [0.5]);
    b.thicken();
    expect(b.notes.length).toBe(43);
  });
  it('leaves rests alone and says so when nothing is long enough', () => {
    const r = bloom([60, 62, 64], [0, 80, 80], [1, 0.25, 0.25]);
    r.thicken();
    expect(r.velocities[0]).toBe(0);
    expect(r.timeIntervals[0]).toBeCloseTo(1, 6);       // the rest wasn't halved: the 0.25s were
    const tiny = bloom([60, 62], [80, 80], [0.03, 0.03]);
    expect(tiny.thicken()).toBe(false);
    expect(tiny.notes.length).toBe(2);
  });
});

describe('fitLists', () => {
  it('cuts the longer lists and loops the shorter ones round to the notes', () => {
    const b = bloom([60, 62, 64, 65, 67], [80, 40], [0.25, 0.25, 0.5, 0.5, 0.25, 0.25, 1]);
    b.chans = [1];
    expect(b.fitLists()).toEqual({ cut: 1, looped: 2 });
    expect(b.velocities).toEqual([80, 40, 80, 40, 80]);
    expect(b.timeIntervals).toEqual([0.25, 0.25, 0.5, 0.5, 0.25]);
    expect(b.chans).toEqual([1, 1, 1, 1, 1]);
    expect(b.fitLists()).toEqual({ cut: 0, looped: 0 });
  });
});

describe('mergeList', () => {
  it('adds two durations, keeps the first of two velocities, and the lists get one shorter', () => {
    const b = bloom([60, 62, 64], [80, 40, 60], [0.25, 0.25, 0.5]);
    expect(b.mergeList('time')).toBe(true);
    expect(b.timeIntervals.length).toBe(2);
    expect(b.timeIntervals.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
    expect(b.mergeList('vel')).toBe(true);
    expect(b.velocities.length).toBe(2);
    expect(b.velocities.every(v => [80, 40, 60].includes(v))).toBe(true);
    expect(b.notes.length).toBe(3);                      // the notes weren't touched
  });
  it('merges a chord list and refuses a list of one', () => {
    const b = bloom([[60, 64], 67], [80], [0.25]);
    expect(b.mergeList('notes')).toBe(true);
    expect(b.notes).toEqual([[60, 64]]);
    expect(b.mergeList('vel')).toBe(false);
  });
});

describe('lists phasing against the notes stay as they are', () => {
  it('a whole-note move carries the lists in step with the notes and leaves the others', () => {
    const b = bloom([60, 62, 64, 65, 67], [80, 40], [0.25, 0.25, 0.25, 0.25, 0.25]);   // 2 velocities phase, 5 times in step
    b.chans = [0, 1, 2];
    b.rotate(1);
    expect(b.notes).toEqual([67, 60, 62, 64, 65]);
    expect(b.velocities).toEqual([80, 40]);
    expect(b.chans).toEqual([0, 1, 2]);
    expect(b.timeIntervals.length).toBe(5);
  });
  it('thin, thicken, split and merge change the notes without cutting a phasing list', () => {
    for (let i = 0; i < 10; i++) {
      // lists longer than the notes can ever get, so they can't fall into step by chance
      const vels = [80, 40, 60, 70, 50, 30, 20, 90, 100, 110, 45, 55, 65];
      const times = [1, 0.5, 0.25, 0.25, 1, 0.5, 0.25, 0.25, 1, 0.5, 0.25];
      const b = bloom([60, 62, 64, 65, 67, 69], [...vels], [...times]);
      b.thin(0.5); b.thicken(); b.splitNote(); b.mergeNote();
      expect(b.velocities).toEqual(vels);
      expect(b.timeIntervals).toEqual(times);
    }
  });
  it('a adds a note; only the lists in step grow, with one of their own values', () => {
    const b = bloom([60, 62, 64], [80, 40], [0.5, 0.25, 0.25]);
    b.addOneInScale();
    expect(b.notes.length).toBe(4);
    expect(b.velocities).toEqual([80, 40]);
    expect(b.timeIntervals.length).toBe(4);
    expect([0.5, 0.25]).toContain(b.timeIntervals[3]);
    expect(b.chans.length).toBe(4);
  });
  it('removeAt and insertEvents do the same, and the last note stays', () => {
    const b = bloom([60, 62, 64, 65], [80, 40], [0.5, 0.25, 0.25, 1]);
    expect(b.removeAt([1, 3])).toBe(2);
    expect(b.notes).toEqual([60, 64]);
    expect(b.timeIntervals).toEqual([0.5, 0.25]);
    expect(b.velocities).toEqual([80, 40]);
    expect(b.removeAt([0, 1])).toBe(1);
    expect(b.notes.length).toBe(1);
    const c = bloom([60, 62, 64], [80, 40], [0.5, 0.25, 0.25]);
    c.insertEvents(0, [{ note: 70, vel: 99, time: 2, chan: 3, iv: 0 }, { note: 71, vel: 98, time: 3, chan: 3, iv: 0 }]);
    expect(c.notes).toEqual([60, 70, 71, 62, 64]);
    expect(c.timeIntervals).toEqual([0.5, 2, 3, 0.25, 0.25]);
    expect(c.chans).toEqual([0, 3, 3, 0, 0]);
    expect(c.velocities).toEqual([80, 40]);
  });
  it('a new velocity, time or channel list keeps its own length', () => {
    const b = bloom([60, 62, 64, 65], [80, 40], [0.5, 0.25, 0.25]);
    b.chans = [0, 1];
    b.shapeList('vel', 'renew'); b.shapeList('time', 'renew'); b.shapeList('chan', 'renew');
    expect(b.velocities.length).toBe(2);
    expect(b.timeIntervals.length).toBe(3);
    expect(b.chans.length).toBe(2);
  });
});

describe('mergeList merges a few pairs', () => {
  it('about a fifth of the list, never overlapping, the total time kept', () => {
    const b = bloom(Array.from({ length: 10 }, (_, i) => 60 + i), [80], Array(10).fill(0.25));
    expect(b.mergeList('time')).toBe(true);
    expect(b.timeIntervals.length).toBe(8);
    expect(b.timeIntervals.reduce((a, x) => a + x, 0)).toBeCloseTo(2.5, 6);
    expect(b.timeIntervals.every(t => t === 0.25 || t === 0.5)).toBe(true);
  });
});

describe('name and colour', () => {
  it('clone and import carry the name, the colour and how bright it is', () => {
    const b = bloom([60]); b.name = 'anchor'; b.color = 'green'; b.colorLevel = 0.49;
    const c = b.clone();
    expect([c.name, c.color, c.colorLevel]).toEqual(['anchor', 'green', 0.49]);
    const d = new Bloom().import(b);
    expect([d.name, d.color, d.colorLevel]).toEqual(['anchor', 'green', 0.49]);
  });
});

describe('gather (E), the opposite of shear', () => {
  it('brings some outer notes an octave inward, same pitch class, never throwing a central note out', () => {
    for (let run = 0; run < 50; run++) {
      const b = new Bloom();
      b.notes = [36, 50, 60, 62, 70, 84];   // middle 60: 36 and 84 are far out, 60 and 62 central
      const before = b.notes.slice() as number[];
      b.gather(1);
      const after = b.notes as number[];
      after.forEach((n, i) => {
        expect(((n - before[i]) % 12 + 12) % 12).toBe(0);           // same pitch class
        expect(Math.abs(n - 60)).toBeLessThanOrEqual(Math.abs(before[i] - 60));   // never further out
      });
      expect(after[2]).toBe(60);
      expect(after[3]).toBe(62);
      expect(Math.max(...after) - Math.min(...after)).toBeLessThan(48);
    }
  });

  it('always brings the farthest note in, even at a small share, so the range narrows', () => {
    for (let run = 0; run < 200; run++) {
      const b = new Bloom();
      b.notes = [40, 52, 58, 62, 68, 80];   // middle 60: 40 and 80 the farthest
      b.gather(0.05);
      const after = b.notes as number[];
      expect(Math.max(...after) - Math.min(...after)).toBeLessThan(40);
    }
  });

  it('leaves a bloom with nothing far out alone', () => {
    const b = new Bloom();
    b.notes = [58, 60, 62, 64];
    b.gather(1);
    expect(b.notes).toEqual([58, 60, 62, 64]);
  });
});

describe('two voices: the length lock', () => {
  it('passDur sums one pass, reading a time list of another length round', () => {
    const b = new Bloom();
    b.notes = [60, 62, 64, 65, 67];
    b.timeIntervals = [1, 0.5];
    expect(b.passDur()).toBe(4);
    b.timeIntervals = [];
    expect(b.passDur()).toBe(0);
  });

  it('heldDur stretches one pass to the other voice\'s length before play, after the fixed duration', () => {
    const b = new Bloom();
    b.notes = [60, 62, 64];
    b.timeIntervals = [1, 1, 2];
    b.heldDur = 6;
    b.resolveFixed();
    expect(b.passDur()).toBeCloseTo(6, 2);
    expect(b.timeIntervals[2] / b.timeIntervals[0]).toBeCloseTo(2, 1);
    b.fixedDur = 2; b.fixedDurMode = 'trim';
    b.resolveFixed();
    expect(b.passDur()).toBeCloseTo(6, 2);
  });

  it('is off by default and is not carried by import or clone', () => {
    const a = new Bloom();
    expect(a.heldDur).toBe(false);
    a.heldDur = 3;
    expect(new Bloom().import(a).heldDur).toBe(false);
  });
});
