// Paste a figure: the copied notes, moved so they start on a chosen note. That
// note becomes the figure's first, and the rest follow it, each as far from
// the first as it was: in steps of the scale when one is attached (so the
// figure stays in the key), in semitones when none is.
import { flatNotes, type NoteVal } from '../lib/arrays';
import { keyToDegree, degreeToKey } from '../lib/numbers';

const mapNote = (v: NoteVal, fn: (n: number) => number): NoteVal =>
  (Array.isArray(v) ? v.map(x => mapNote(x as NoteVal, fn)) as NoteVal : fn(v as number));

/** The first pitch of a note (the first of a chord's) */
export const firstPitch = (v: NoteVal): number | undefined => (flatNotes([v]) as number[])[0];

/**
 * The figure's events after its first, moved to start on `dest`. `degrees` is
 * the attached scale's pitch classes (null or empty: semitones).
 */
export function figureOn<E extends { note: NoteVal }>(figure: readonly E[], dest: number, degrees: number[] | null, ppo = 12): E[] {
  const from = figure.length ? firstPitch(figure[0].note) : undefined;
  if (from === undefined) return [];
  const move = degrees && degrees.length
    ? (n: number) => degreeToKey(Math.round(keyToDegree(dest, degrees, ppo)) + Math.round(keyToDegree(n, degrees, ppo)) - Math.round(keyToDegree(from, degrees, ppo)), degrees, ppo)
    : (n: number) => n + dest - from;
  return figure.slice(1).map(e => ({ ...(JSON.parse(JSON.stringify(e)) as E), note: mapNote(e.note, move) }));
}
