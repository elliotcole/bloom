// Select mode's verbs (r): the selection as a list of its own, one on/off per
// event, moved with the keys that move every other list. Each takes the
// selection (sorted indices) and gives the new one; `fixed` are the pinned
// events, which nothing selects (a key can't change them).

type Rng = () => number;

const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);
const free = (n: number, fixed: number[]) => Array.from({ length: n }, (_, i) => i).filter(i => !fixed.includes(i));

/** `k` of `from`, at random */
function draw(from: number[], k: number, rng: Rng): number[] {
  const pool = [...from], out: number[] = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** How many events = and - add or take per press: about an eighth, at least one */
export const increment = (n: number) => Math.max(1, Math.round(n / 8));

/** = : a few more, at random */
export function more(sel: number[], n: number, fixed: number[] = [], rng: Rng = Math.random): number[] {
  return sorted([...sel, ...draw(free(n, fixed).filter(i => !sel.includes(i)), increment(n), rng)]);
}

/** - : a few fewer, at random */
export function fewer(sel: number[], n: number, rng: Rng = Math.random): number[] {
  const gone = draw(sel, increment(n), rng);
  return sel.filter(i => !gone.includes(i));
}

/** 9 0 : every selected place one along, round the end */
export function rotate(sel: number[], n: number, dir: 1 | -1): number[] {
  return n ? sorted(sel.map(i => (((i + dir) % n) + n) % n)) : [];
}

/** R : back to front */
export function mirror(sel: number[], n: number): number[] {
  return sorted(sel.map(i => n - 1 - i));
}

/** i : the others */
export function invert(sel: number[], n: number, fixed: number[] = []): number[] {
  return free(n, fixed).filter(i => !sel.includes(i));
}

/** s, n : as many, in new places */
export function scramble(sel: number[], n: number, fixed: number[] = [], rng: Rng = Math.random): number[] {
  return sorted(draw(free(n, fixed), sel.length || increment(n), rng));
}

/** e : every `every`th event, from `offset` */
export function everyNth(n: number, every: number, offset = 0, fixed: number[] = []): number[] {
  return free(n, fixed).filter(i => (((i - offset) % every) + every) % every === 0);
}

/**
 * l L h H d D : the events with the most (or least) of something. The first
 * press takes every event at the extreme value; pressed again, the next value
 * in as well, and so on: the slice deepens. Any other selection starts it
 * afresh. `skip` leaves a value out altogether (a rest is not the softest note).
 */
export function slice(values: number[], sel: number[], most: boolean, fixed: number[] = [], skip?: (v: number) => boolean): number[] {
  const idx = values.map((_, i) => i).filter(i => !fixed.includes(i) && !skip?.(values[i]));
  const levels = [...new Set(idx.map(i => values[i]))].sort((a, b) => (most ? b - a : a - b));
  const upTo = (depth: number) => idx.filter(i => levels.indexOf(values[i]) < depth);
  let depth = 0;
  for (let d = 1; d <= levels.length; d++) {
    const s = upTo(d);
    if (s.length === sel.length && s.every((x, j) => x === sel[j])) { depth = d; break; }
  }
  return upTo(Math.min(levels.length, depth + 1));
}
