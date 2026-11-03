// Patterns: a window read, moved, read again. Braid (123 234 345) and pyramid
// (1 12 123) are one machine; they differ only in how the window's edges move.
//
// Written as the first window, then how its edges move each round, then flags:
//   123 +1        braid: both edges up one
//   1 0,+1        pyramid: the left edge stays, the right grows
//   1..n +1,-1    wedge: closing in from both ends (n is the last index)
//   13 +1         a motif: at a fixed width the window's shape travels with it
// Indices count from 1. A single word is read digit by digit (123); with spaces
// each word is one index (1 10 11). `*` is a random note in the window, `**`
// one from anywhere. No movement plays the window once (53124 reorders).
// Flags: a (alternate direction each round), r (every window backward),
// | (there and back), ~ (wrap round the end instead of stopping), x2 (each
// window twice). A window whose width changes reads a run, at the first
// window's stride and direction (135 0,+2 → 135 1357 …), so a motif needs a
// fixed width. The run stops when a window would run off the list.

/** One step of a pattern: an index (from 0), or a random one in a window or anywhere */
export type Step = number | { any: 'window'; lo: number; hi: number } | { any: 'all' };

type End = number | 'n';
type SeedTok = { at: End } | { from: End; to: End } | '*' | '**';

export interface Pattern {
  seed: SeedTok[];
  left: number;
  right: number;
  alt: boolean;
  rev: boolean;
  back: boolean;
  wrap: boolean;
  times: number;
}

export interface Expanded {
  rounds: Step[][];
  length: number;
  capped: boolean;
}

/** Past this the palette warns; at the cap the pattern is cut, whole windows at a time */
export const PATTERN_WARN = 200;
export const PATTERN_CAP = 500;

/** Suggestions for the palette, each a spec in the syntax above */
export const PATTERN_PRESETS: { name: string; spec: string }[] = [
  { name: 'braid', spec: '123 +1' },
  { name: 'pyramid', spec: '1 0,+1' },
  { name: 'climb and return', spec: '1 0,+1 |' },
  { name: 'subtract', spec: '1..n +1,0' },
  { name: 'from the top', spec: 'n -1,0' },
  { name: 'wedge', spec: '1..n +1,-1' },
  { name: 'thirds', spec: '13 +1' },
  { name: 'sequence', spec: '1213 +1' },
  { name: 'falling figures', spec: '321 +1' },
  { name: 'zigzag', spec: '123 +1 a' },
  { name: 'stutter', spec: '11 +1' },
  { name: 'mirror', spec: '1 +1 |' },
  { name: 'braid, one loose', spec: '12* +1' },
];

const RULE = /^(?:([+-]\d+|0)|([+-]?\d+),([+-]?\d+))$/;
const SEED_WORD = /^[\d*n.]+$/;
const FLAGS = /^(?:a|r|\||~|x\d+)+$/;

function end(s: string): End | string {
  if (s === 'n') return 'n';
  const v = Number(s);
  if (!Number.isInteger(v)) return `${s} isn't an index`;
  return v < 1 ? 'indices start at 1' : v;
}

/** One word of the seed: an index, a range a..b, n, * or ** */
function seedWord(w: string): SeedTok | string {
  if (w === '*' || w === '**') return w;
  const range = w.split('..');
  if (range.length === 2) {
    const from = end(range[0]), to = end(range[1]);
    if (typeof from === 'string' && from !== 'n') return from;
    if (typeof to === 'string' && to !== 'n') return to;
    return { from: from as End, to: to as End };
  }
  const at = end(w);
  return typeof at === 'string' && at !== 'n' ? at : { at: at as End };
}

/** A single word read character by character: 123, 12*, 1**3, 1..n */
function compactSeed(w: string): SeedTok[] | string {
  const out: SeedTok[] = [];
  for (let i = 0; i < w.length;) {
    if (w.startsWith('..', i)) {
      const prev = out.pop();
      const next = w[i + 2];
      if (!prev || typeof prev === 'string' || !('at' in prev) || next === undefined) return 'a range is a..b';
      const to = end(next);
      if (typeof to === 'string' && to !== 'n') return to;
      out.push({ from: prev.at, to: to as End });
      i += 3;
    } else if (w.startsWith('**', i)) { out.push('**'); i += 2; }
    else if (w[i] === '*') { out.push('*'); i += 1; }
    else {
      const at = end(w[i]);
      if (typeof at === 'string' && at !== 'n') return at;
      out.push({ at: at as End });
      i += 1;
    }
  }
  return out;
}

/** Read a pattern, or say what's wrong with it */
export function parsePattern(text: string): Pattern | string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'type a first window, like 123 +1';
  const seedWords: string[] = [];
  let k = 0;
  while (k < words.length && SEED_WORD.test(words[k]) && !RULE.test(words[k])) seedWords.push(words[k++]);
  if (!seedWords.length) return 'start with the first window, like 123';
  let left = 0, right = 0;
  const rule = words[k] !== undefined ? RULE.exec(words[k]) : null;
  if (rule) {
    if (rule[1] !== undefined) left = right = Number(rule[1]);
    else { left = Number(rule[2]); right = Number(rule[3]); }
    k++;
  }
  const flags = words.slice(k).join('');
  if (flags && !FLAGS.test(flags)) return `${words.slice(k).join(' ')}: the flags are a r | ~ x2`;
  const times = Number(/x(\d+)/.exec(flags)?.[1] ?? 1);
  if (times < 1) return 'x needs a count of 1 or more';

  let seed: SeedTok[];
  if (seedWords.length === 1) {
    const s = compactSeed(seedWords[0]);
    if (typeof s === 'string') return s;
    seed = s;
  } else {
    seed = [];
    for (const w of seedWords) {
      const t = seedWord(w);
      if (typeof t === 'string') return t;
      seed.push(t);
    }
  }
  return {
    seed, left, right, times,
    alt: flags.includes('a'), rev: flags.includes('r'), back: flags.includes('|'), wrap: flags.includes('~'),
  };
}

type Item = number | '*' | '**';

/** The seed for a list of `n`: indices from 0, ranges spelled out */
function seedItems(seed: SeedTok[], n: number): Item[] {
  const at = (e: End) => (e === 'n' ? n - 1 : e - 1);
  return seed.flatMap((t): Item[] => {
    if (t === '*' || t === '**') return [t];
    if ('at' in t) return [at(t.at)];
    const a = at(t.from), b = at(t.to), d = b >= a ? 1 : -1;
    return Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + i * d);
  });
}

/**
 * The pattern over a list of `n`: its windows in order, each a list of steps.
 * A window that would leave the list ends the run (with ~, it wraps instead,
 * until the window has gone once round). Cut at `cap` steps, whole windows.
 */
export function expandPattern(p: Pattern, n: number, cap = PATTERN_CAP): Expanded | string {
  if (n < 1) return 'the list is empty';
  const items = seedItems(p.seed, n);
  const nums = items.filter((x): x is number => typeof x === 'number');
  const outside = nums.find(i => i < 0 || i >= n);
  if (outside !== undefined) return `the list has ${n}: there's no ${outside + 1}`;
  const star = items.includes('*');
  const lo0 = nums.length ? Math.min(...nums) : 0;
  const hi0 = nums.length ? Math.max(...nums) : star ? n - 1 : items.length - 1;
  const fixed = p.left === p.right;
  // a * picks from the window the first one spans, its own place included (12* → from 1 2 3); ** from anywhere
  const span = star ? Math.max(hi0, lo0 + items.length - 1) - lo0 : hi0 - lo0;

  // a window whose width changes reads a run, at the first window's stride and direction
  let stride = 1, down = false;
  if (!fixed) {
    if (nums.length !== items.length) return 'a window that changes width takes no * (keep one number, like +1)';
    const diffs = nums.slice(1).map((x, i) => x - nums[i]);
    if (diffs.some(d => d !== diffs[0] || d === 0)) return 'a motif needs a window that keeps its width (one number, like +1)';
    if (diffs.length) { stride = Math.abs(diffs[0]); down = diffs[0] < 0; }
  }

  const raw: Step[][] = [];
  const wrapAt = (i: number) => ((i % n) + n) % n;
  const still = p.left === 0 && p.right === 0;
  const RAW_LIMIT = cap * 4;
  let total = 0;
  for (let r = 0; total < RAW_LIMIT; r++) {
    if (r > 0 && still) break;
    if (p.wrap && r > 0 && (p.left !== 0 ? Math.abs(r * p.left) >= n : false)) break;
    const lo = lo0 + r * p.left, hi = hi0 + r * p.right;
    if (hi < lo) break;
    if (p.wrap && p.left === 0 && hi - lo + 1 > n) break;
    let idx: Item[];
    if (fixed) idx = items.map(x => (typeof x === 'number' ? x + r * p.left : x));
    else {
      const run: number[] = [];
      for (let i = lo; i <= hi; i += stride) run.push(i);
      idx = down ? run.reverse() : run;
    }
    if (!p.wrap && (idx.some(x => typeof x === 'number' && (x < 0 || x >= n)) || (fixed && (lo < 0 || lo + span >= n)))) break;
    let win: Step[] = idx.map((x): Step => (x === '*' ? { any: 'window', lo: Math.max(0, lo), hi: Math.min(n - 1, lo + span) }
      : x === '**' ? { any: 'all' } : p.wrap ? wrapAt(x) : x));
    if (p.rev !== (p.alt && r % 2 === 1)) win = win.reverse();
    raw.push(win);
    total += win.length;
  }

  let rounds = p.back ? [...raw, ...raw.slice(0, -1).reverse()] : raw;
  if (p.times > 1) rounds = rounds.flatMap(w => Array.from({ length: p.times }, () => w));
  const kept: Step[][] = [];
  let length = 0, capped = false;
  for (const w of rounds) {
    if (length + w.length > cap) {
      capped = true;
      if (!kept.length) { kept.push(w.slice(0, cap)); length = cap; }
      break;
    }
    kept.push(w);
    length += w.length;
  }
  if (!kept.length) return `the first window doesn't fit a list of ${n}`;
  return { rounds: kept, length, capped };
}

/** The index a step plays this time (a wildcard picks anew each call) */
export function resolveStep(s: Step, n: number, rng: () => number = Math.random): number {
  if (typeof s === 'number') return s;
  if (s.any === 'all') return Math.floor(rng() * n);
  return s.lo + Math.floor(rng() * (s.hi - s.lo + 1));
}

/** The windows as indices from 1, as typed: 123 234 345, or 1 2 10 · 2 3 11 for a long list */
export function formatPattern(rounds: Step[][], n: number): string {
  const wide = n > 9;
  const tok = (s: Step) => (typeof s === 'number' ? String(s + 1) : s.any === 'all' ? '**' : '*');
  return rounds.map(w => w.map(tok).join(wide ? ' ' : '')).join(wide ? ' · ' : ' ');
}

/** A list written out by a pattern (wildcards rolled once), or what's wrong */
export function bakePattern<T>(arr: T[], text: string, rng: () => number = Math.random): { values: T[]; length: number; capped: boolean } | string {
  const p = parsePattern(text);
  if (typeof p === 'string') return p;
  const e = expandPattern(p, arr.length);
  if (typeof e === 'string') return e;
  const values = e.rounds.flat().map(s => arr[resolveStep(s, arr.length, rng)]);
  return { values, length: e.length, capped: e.capped };
}
