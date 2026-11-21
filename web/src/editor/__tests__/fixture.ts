// A take to edit, made up: the editor's tests share it.
import type { TakeEvent, TakeFile } from '../../audio/take';

const bloom = (notes: number[]) => ({ notes, velocities: notes.map(() => 80), timeIntervals: notes.map(() => 0.25), chans: notes.map(() => 0) });

/**
 * A take of `passes` passes of a bloom (a new bloom every `change` passes), a
 * note every 250 ms, each ringing 400. The light comes 3 ms before its note.
 * With `other`, a second voice plays its own three notes, a third of a second apart.
 */
export function take(passes: number, opts: { notes?: number[]; change?: number; other?: boolean } = {}): TakeFile {
  const notes = opts.notes ?? [60, 64, 67, 72], change = opts.change ?? 2;
  const blooms = Array.from({ length: Math.ceil(passes / change) }, (_, i) => bloom(notes.map(n => n + i)));
  const events: TakeEvent[] = [[0, 'm', [0xb0, 64, 127], 0], [0, 'p', -1], [0, 'g', 0], [0, 'b', 0, 1, 1], [0, 'v', opts.other ? blooms.length : -1]];
  let t = 10, tick = 0;
  for (let p = 0; p < passes; p++) {
    const b = Math.floor(p / change);
    if (p && p % change === 0) events.push([t - 5, 'b', b, 1, 1]);
    notes.forEach((n, i) => {
      events.push([t - 3, 'n', i, tick++]);
      events.push([t - 1, 'm', [0x90, n + b, 80 + i], 1]);
      events.push([t + 400, 'm', [0x80, n + b, 0], 0]);
      t += 250;
    });
  }
  if (opts.other) {
    const mine = [36, 43, 48];
    blooms.push(bloom(mine));
    let u = 10, k = 0;
    while (u < t - 1000) {
      mine.forEach((n, i) => {
        events.push([u - 3, 'w', i, k++]);
        events.push([u, 'm', [0x91, n, 60], 0]);
        events.push([u + 300, 'm', [0x81, n, 0], 0]);
        u += 1000 / 3;
      });
    }
  }
  events.sort((a, b) => a[0] - b[0]);
  return {
    kind: 'bloom-take', version: 1, recordedAt: 1, length: t + 1000, ended: true,
    blooms: blooms as unknown as TakeFile['blooms'], gardens: [{ cursor: 0, slots: [0] }], sysex: [], tables: [], events,
  };
}
