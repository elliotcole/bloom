// What every view draws with: the theme's ink at an opacity, a channel's hue,
// a pitch's class. Pitch names are lib/numbers' (spell, spellOctave), so the
// picture, the lanes and the console spell a note the same way.

import type { Rgb, Theme } from './theme';

const clamp01 = (a: number) => Math.max(0, Math.min(1, a));
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a)})`;

/** The theme's ink (lines and lettering over the picture) at opacity `a` */
export function ink(theme: Theme, a: number): string { return rgba(theme.ink, a); }

/** The theme's mark (the lanes' active list, a cell just changed) at opacity `a` */
export function mark(theme: Theme, a: number): string { return rgba(theme.mark, a); }

/** A channel's hue, the sixteen spread round the wheel */
export function chanHue(c: number): number { return (c * 360) / 16; }

/** A note's pitch class, 0–11 */
export function pc(note: number): number { return ((Math.round(note) % 12) + 12) % 12; }
