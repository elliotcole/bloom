// Two voices linked: what changes in the focused voice is carried to the other
import { describe, expect, it } from 'vitest';
import { Bloom } from '../Bloom';
import { SCALES } from '../../lib/scales';
import { carryLinks, linkNow, linkState, shiftBetween } from '../voiceLinks';
import type { LinkKey } from '../voiceLinks';

const major = () => { const b = new Bloom([60, 62, 64, 65, 67], [80], [0.25], [0]); b.applyScale(SCALES.major ?? [0, 2, 4, 5, 7, 9, 11]); return b; };
const links = (...k: LinkKey[]) => new Set<LinkKey>(k);

describe('voice links', () => {
  it('a set moved by semitones', () => {
    expect(shiftBetween([0, 2, 4, 5, 7, 9, 11], [1, 3, 5, 6, 8, 10, 0])).toBe(1);
    expect(shiftBetween([0, 2, 4], [0, 3, 4])).toBeNull();
  });

  it('key: a transposed voice transposes the other', () => {
    const a = major(), b = major();
    b.notes = [48, 50, 52];
    const before = linkState(a);
    a.transpose(2);
    expect(carryLinks(a, before, b, links('key'))).toEqual(['key']);
    expect(b.notes).toEqual([50, 52, 54]);
    expect(linkState(b).degrees).toEqual(linkState(a).degrees);
  });

  it('key: a new scale is applied to the other, its notes moved into it', () => {
    const a = major(), b = major();
    const before = linkState(a);
    a.applyScale([0, 2, 3, 5, 7, 8, 10]);   // C minor
    carryLinks(a, before, b, links('key'));
    expect(linkState(b).degrees).toEqual([0, 2, 3, 5, 7, 8, 10]);
    for (const n of b.notes as number[]) expect([0, 2, 3, 5, 7, 8, 10]).toContain(n % 12);
  });

  it('not linked: nothing carried', () => {
    const a = major(), b = major();
    const before = linkState(a);
    a.transpose(2);
    expect(carryLinks(a, before, b, links('tuning'))).toEqual([]);
    expect(b.notes).toEqual([60, 62, 64, 65, 67]);
  });

  it('key centre: copied when it is a note of the other scale', () => {
    const a = major(), b = major();
    const before = linkState(a);
    a.centreOn(9);   // A, in C major's notes: A minor
    expect(carryLinks(a, before, b, links('root'))).toEqual(['key centre']);
    expect(linkState(b).root).toBe(9);
  });

  it('time basis: moved in one, the other\'s palette moves the same', () => {
    const a = new Bloom([60], [80], [0.25], [0]), b = new Bloom([60, 62], [80], [0.25, 0.5], [0]);
    a.snapTimes([1, 3 / 2], 'aksak', 0.25);
    b.snapTimes([1, 2], 'long short', 0.25);
    const before = linkState(a);
    a.scaleTimes(0.8);   // basis 1/5
    carryLinks(a, before, b, links('basis'));
    expect(b.lockedBasis()).toBe(0.2);
    expect(b.timeIntervals).toEqual([0.2, 0.4]);
  });

  it('linking: the other takes this one\'s basis and tuning', () => {
    const a = new Bloom([60], [80], [0.2], [0]), b = new Bloom([60], [80], [0.25], [0]);
    a.snapTimes([1], 'even', 0.2);
    b.snapTimes([1], 'even', 0.25);
    expect(linkNow(a, b, 'basis')).toBe(true);
    expect(b.lockedBasis()).toBe(0.2);
    a.tuning = { name: 'just', cents: [0, 112, 204, 316, 386, 498, 590, 702, 814, 884, 996, 1088], period: 1200 };
    linkNow(a, b, 'tuning');
    expect(b.tuning?.name).toBe('just');
    expect(b.tuning).not.toBe(a.tuning);
  });
});
