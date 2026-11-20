// Where copied notes land when pasted. A copy remembers its shape: the runs of
// adjacent notes, and how far each run sat from the first. A paste puts the
// first run right after the anchor and each later run as far along as it was,
// so pasting over the selection it was copied from gives every run its copy
// straight after it, and pasting elsewhere keeps the spacing.

/** A copy: runs of adjacent items, and where each run ended, counted from the end of the first */
export interface Clip<T> { runs: T[][]; offsets: number[] }

/** Sorted indices as runs of adjacent ones: [3, 4, 7] → [[3, 4], [7]] */
export function runsOf(sel: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const i of [...new Set(sel)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i); else runs.push([i]);
  }
  return runs;
}

/** Copy the selected items (all of them, as one run, with nothing selected) */
export function clipOf<T>(items: readonly T[], sel: readonly number[]): Clip<T> {
  const runs = sel.length ? runsOf(sel) : items.length ? [items.map((_, i) => i)] : [];
  if (!runs.length) return { runs: [], offsets: [] };
  const end = (r: number[]) => r[r.length - 1];
  return { runs: runs.map(r => r.map(i => items[i])), offsets: runs.map(r => end(r) - end(runs[0])) };
}

/** The place to paste from: the end of the first selected run, or the last item with nothing selected */
export function anchorOf(sel: readonly number[], len: number): number {
  const first = runsOf(sel)[0];
  return first ? first[first.length - 1] : len - 1;
}

/** The index each run goes in after (as the list stands before the paste). Runs that would fall off the end go at the end, in order. */
export function placesOf(offsets: readonly number[], anchor: number, len: number): number[] {
  return offsets.map(o => Math.min(len - 1, anchor + o));
}

/** Where index i ends up once the runs are in */
export function shifted(i: number, places: readonly number[], sizes: readonly number[]): number {
  return i + places.reduce((n, p, k) => n + (p < i ? sizes[k] : 0), 0);
}

/** The indices the pasted items end up at */
export function pastedAt(places: readonly number[], sizes: readonly number[]): number[] {
  const out: number[] = [];
  let before = 0;
  places.forEach((p, k) => {
    for (let j = 0; j < sizes[k]; j++) out.push(p + 1 + before + j);
    before += sizes[k];
  });
  return out;
}
