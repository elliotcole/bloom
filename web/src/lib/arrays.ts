// Array utility functions — ported from SuperCollider's Array/SequenceableCollection

export type NoteVal = number | NoteVal[];
export type NoteArray = NoteVal[];

// ─── Basic helpers ────────────────────────────────────────────────────────────

export function wrapAt<T>(arr: T[], index: number): T {
  const n = arr.length;
  if (n === 0) throw new Error('wrapAt on empty array');
  return arr[((index % n) + n) % n];
}

export function wrapExtend<T>(arr: T[], length: number): T[] {
  return Array.from({ length }, (_, i) => wrapAt(arr, i));
}

export function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

export function coin(prob: number): boolean {
  return Math.random() < prob;
}

export function exprand(lo: number, hi: number): number {
  if (lo <= 0) lo = 0.001;
  return lo * Math.pow(hi / lo, Math.random());
}

export function rrand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function flatNotes(notes: NoteArray): number[] {
  return (notes as any[]).flat(Infinity) as number[];
}

export function normalizeSum(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum === 0) return arr.map(() => 0);
  return arr.map(x => x / sum);
}

// ─── Searching ────────────────────────────────────────────────────────────────

/** Binary search: index of element closest to val in a sorted array */
export function indexIn(arr: number[], val: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  if (hi === n) return n - 1;
  if (hi === 0) return 0;
  return (val - arr[hi - 1]) <= (arr[hi] - val) ? hi - 1 : hi;
}

/** Linearly interpolated index in sorted array */
export function indexInBetween(arr: number[], val: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  if (hi === n) return n - 1;
  if (hi === 0) return 0;
  const a = arr[hi - 1], b = arr[hi];
  return b === a ? hi - 1 : (hi - 1) + (val - a) / (b - a);
}

export function nearestInList(val: number, list: number[]): number {
  return list[indexIn(list, val)];
}

// ─── Resampling ───────────────────────────────────────────────────────────────

/** Linear interpolation resampling (SC's resamp1) */
export function resamp1(arr: number[], newSize: number): number[] {
  if (arr.length === 0) return [];
  if (newSize === 1) return [arr[0]];
  const result: number[] = [];
  for (let i = 0; i < newSize; i++) {
    const pos = (i / (newSize - 1)) * (arr.length - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    if (idx >= arr.length - 1) result.push(arr[arr.length - 1]);
    else result.push(arr[idx] * (1 - frac) + arr[idx + 1] * frac);
  }
  return result;
}

// ─── Ordering / permutation ───────────────────────────────────────────────────

export function rotate<T>(arr: T[], n: number = 1): T[] {
  if (arr.length === 0) return [];
  const len = arr.length;
  // n=1 → last element to front (right rotation)
  const offset = (((-n) % len) + len) % len;
  return [...arr.slice(offset), ...arr.slice(0, offset)];
}

export function scramble<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Riffle / dovetail shuffle. Interleaves first and second halves. */
export function perfectShuffle<T>(arr: T[]): T[] {
  if (arr.length < 2) return [...arr];
  const half = Math.floor(arr.length / 2);
  const offset = Math.floor((arr.length + 1) / 2);
  const indices: number[] = [];
  for (let i = 0; i < half; i++) {
    indices.push(i);
    indices.push(i + offset);
  }
  return indices.map(i => arr[i]);
}

/** Palindrome: [a,b,c,d] → [a,b,c,d,c,b,a] */
export function mirror<T>(arr: T[]): T[] {
  if (arr.length <= 1) return [...arr];
  return [...arr, ...arr.slice(0, -1).reverse()];
}

export function permute<T>(arr: T[], n: number): T[] {
  // nth lexicographic permutation
  const a = [...arr];
  const factoriadic: number[] = [];
  let m = n;
  for (let i = 1; i <= a.length; i++) {
    factoriadic.unshift(m % i);
    m = Math.floor(m / i);
  }
  const result: T[] = [];
  const pool = [...a];
  for (const f of factoriadic) {
    result.push(pool.splice(f, 1)[0]);
  }
  return result;
}

// ─── Pattern operations ───────────────────────────────────────────────────────

/** Repeat each element n times: [a,b,c] → [a,a,b,b,c,c] */
export function stutter<T>(arr: T[], n: number = 2): T[] {
  return arr.flatMap(item => Array(Math.max(1, Math.round(n))).fill(item));
}

/**
 * SC's sputter: probability = chance of REPEATING (not advancing).
 * prob=0.25 → 25% repeat, 75% advance.
 */
export function sputter<T>(arr: T[], probability: number = 0.25, maxLen: number = 100): T[] {
  const result: T[] = [];
  const advanceProbability = 1 - probability;
  let i = 0;
  while (i < arr.length && result.length < maxLen) {
    result.push(arr[i]);
    if (Math.random() < advanceProbability) i++;
  }
  return result;
}

/** Randomly group elements into sub-arrays (probability = chance of starting new group) */
export function curdle<T>(arr: T[], probability: number): T[][] {
  const result: T[][] = [];
  arr.forEach(item => {
    if (result.length === 0 || Math.random() < probability) {
      result.push([]);
    }
    result[result.length - 1].push(item);
  });
  return result;
}

/** Interleave sub-arrays round-robin up to length */
export function lace<T>(arrays: T[][], length: number): T[] {
  if (arrays.length === 0) return [];
  const result: T[] = [];
  for (let i = 0; i < length; i++) {
    const arr = arrays[i % arrays.length];
    if (arr.length === 0) continue;
    result.push(arr[Math.floor(i / arrays.length) % arr.length]);
  }
  return result;
}

/** Overlapping windows: [a,b,c,d] with window=3 → [a,b,c,b,c,d] */
export function slide<T>(arr: T[], windowLength: number = 3, stepSize: number = 1): T[] {
  const result: T[] = [];
  const extended = arr.length < windowLength ? wrapExtend(arr, windowLength) : arr;
  for (let i = 0; i <= extended.length - windowLength; i += stepSize) {
    for (let j = 0; j < windowLength; j++) {
      result.push(extended[i + j]);
    }
  }
  return result;
}

/** SC's pyramid patterns (type 1-10) */
export function pyramid<T>(arr: T[], patternType: number = 1): T[] {
  const n = arr.length;
  const result: T[] = [];
  switch (patternType) {
    case 1: for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) result.push(arr[j]); break;
    case 2: for (let i = 0; i < n; i++) for (let j = n - 1 - i; j < n; j++) result.push(arr[j]); break;
    case 3: for (let i = n - 1; i >= 0; i--) for (let j = 0; j <= i; j++) result.push(arr[j]); break;
    case 4: for (let i = 0; i < n; i++) for (let j = i; j < n; j++) result.push(arr[j]); break;
    case 5:
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) result.push(arr[j]);
      for (let i = n - 2; i >= 0; i--) for (let j = 0; j <= i; j++) result.push(arr[j]);
      break;
    case 6:
      for (let i = 0; i < n; i++) for (let j = n - 1 - i; j < n; j++) result.push(arr[j]);
      for (let i = 1; i < n; i++) for (let j = n - 1 - i; j < n; j++) result.push(arr[j]);
      break;
    case 7:
      for (let i = n - 1; i >= 0; i--) for (let j = 0; j <= i; j++) result.push(arr[j]);
      for (let i = 1; i < n; i++) for (let j = 0; j <= i; j++) result.push(arr[j]);
      break;
    case 8:
      for (let i = 0; i < n; i++) for (let j = i; j < n; j++) result.push(arr[j]);
      for (let i = n - 2; i >= 0; i--) for (let j = i; j < n; j++) result.push(arr[j]);
      break;
    case 9:
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) result.push(arr[j]);
      for (let i = 1; i < n; i++) for (let j = i; j < n; j++) result.push(arr[j]);
      break;
    case 10:
      for (let i = 0; i < n; i++) for (let j = n - 1 - i; j < n; j++) result.push(arr[j]);
      for (let i = n - 2; i >= 0; i--) for (let j = 0; j <= i; j++) result.push(arr[j]);
      break;
    default: for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) result.push(arr[j]);
  }
  return result;
}

// ─── Nesting ──────────────────────────────────────────────────────────────────

/** Re-nest a flat array to match the structure of a nested template */
export function matchNesting(sourceArray: number[], template: NoteArray): NoteArray {
  const templateFlat = flatNotes(template);
  const wrapped = templateFlat.map((_, i) => sourceArray[i % sourceArray.length]);
  const pool = [...wrapped];
  function nest(tmpl: NoteArray): NoteArray {
    return tmpl.map(item => {
      if (Array.isArray(item)) return nest(item as NoteArray) as any;
      return pool.shift()!;
    });
  }
  return nest(template);
}

export function flattenSingletons(arr: any[]): any[] {
  return arr.map(item => {
    if (!Array.isArray(item)) return item;
    if (item.length === 0) return undefined;
    if (item.length === 1) return item[0];
    return item;
  }).filter(x => x !== undefined);
}

/** Flatten only below a certain depth */
export function flatBelow(arr: any[], depth: number): any[] {
  if (depth <= 0) return arr;
  return arr.map(item => Array.isArray(item) && depth === 1 ? item : item);
  // Used in chords: flatBelow(1) means keep outer array, flatten one level of inner
}

// ─── Doubles ─────────────────────────────────────────────────────────────────

export function indexOfDoubles(arr: number[]): number[][] {
  const seen = new Map<number, number[]>();
  arr.forEach((v, i) => {
    if (!seen.has(v)) seen.set(v, []);
    seen.get(v)!.push(i);
  });
  return Array.from(seen.values()).filter(indices => indices.length > 1);
}

export function removeDoubles(arr: number[]): number[] {
  const doubles = indexOfDoubles(arr);
  const toRemove = new Set<number>();
  doubles.forEach(set => set.slice(1).forEach(i => toRemove.add(i)));
  return arr.filter((_, i) => !toRemove.has(i));
}

export function moveDoublesUpOctave(arr: number[]): number[] {
  const result = [...arr];
  const doubles = indexOfDoubles(result);
  doubles.forEach(set => {
    set.forEach((idx, i) => {
      if (i > 0) result[idx] = result[idx] + 12 * i;
    });
  });
  return result;
}

// ─── All tuples (Cartesian product) ──────────────────────────────────────────

export function allTuples<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap(combo => arr.map(item => [...combo, item])),
    [[]]
  );
}
