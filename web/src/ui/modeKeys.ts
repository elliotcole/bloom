// The keys of the modes as tables: the list modes (p t v c 5 b), tuning mode
// (T) and the freeze menu (F). keys.ts routes a key through the mode that's
// open before home hears it. One entry per key, as in homeKeys.ts, so a key's
// behaviour is in one place and the docs can be checked against it
// (ui/__tests__/docs.test.ts).
//
// A mode takes every key. What it doesn't use itself either keeps its home
// meaning (PASS: playing, the garden, the display toggles, help, tab) or is
// held with a hint, so home habits can't change the notes by accident.

import type { Bloom, ListKey, ListVerb, PatternOp } from '../core/Bloom';
import type { Garden } from '../garden';
import { formatIntervals } from '../lib/intervals';
import { formatFigures } from '../lib/figures';
import { keyChar } from './homeKeys';
import { DURATION_PALETTES, ratioText } from '../lib/rhythms';
import { everyNth, fewer, invert, mirror, more, rotate, samePitchClasses, scramble, slice } from './selectVerbs';

// ─── The list modes ──────────────────────────────────────────────────────────

export type ListMode = 'pitch' | 'time' | 'vel' | 'chan' | 'iv' | 'fig';

export const MODE_KEYS: Record<string, ListMode> = { p: 'pitch', t: 'time', v: 'vel', c: 'chan', '5': 'iv', b: 'fig' };
export const KEY_OF_MODE: Record<ListMode, string> = { pitch: 'p', time: 't', vel: 'v', chan: 'c', iv: '5', fig: 'b' };
export const MODE_TAG: Record<ListMode, string> = { pitch: 'P', time: 'T', vel: 'V', chan: 'CH', iv: 'IV', fig: 'FIG' };
export const MODE_NAME: Record<ListMode, string> = { pitch: 'pitch', time: 'time', vel: 'velocity', chan: 'channel', iv: 'intervals', fig: 'figures' };
export const LIST_OF_MODE: Record<ListMode, ListKey> = { pitch: 'notes', time: 'time', vel: 'vel', chan: 'chan', iv: 'iv', fig: 'fig' };
export const LIST_MODES = Object.values(MODE_KEYS);

export function own<T extends object>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ─── Quantize cycle (q applies, Q chooses) ───────────────────────────────────

const QUANTIZE_OPTIONS = [4, 3, 2, 1, 8, 7, 6, 5];
let _quantizeIdx = 4; // starts at 8
export function currentQuantize(): number { return QUANTIZE_OPTIONS[_quantizeIdx]; }
export function nextQuantize(): number {
  _quantizeIdx = (_quantizeIdx + 1) % QUANTIZE_OPTIONS.length;
  return currentQuantize();
}

// ─── One key of a mode ───────────────────────────────────────────────────────

export interface ModeKey<C> {
  /** e.key (caps lock seen through); shift is implied by the character */
  key?: string | string[];
  /** e.code, for keys named by position (esc, ↵, opt-letters) */
  code?: string | string[];
  /** opt held (default: not) */
  alt?: boolean;
  /** shift held; only checked when given */
  shift?: boolean;
  /** the list modes it belongs to (default: all of them) */
  modes?: ListMode[];
  /** what the docs call it, when the key and modifiers don't say it */
  name?: string;
  label: string;
  /** it keeps its home meaning here (the entry is the record that it does) */
  home?: true;
  /** do it; false: not taken after all, home hears the key */
  act?: (c: C) => boolean | void;
}

const asList = (x: string | string[] | undefined): string[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** The first entry of a mode's table for what was pressed (in list mode `m`, when given) */
export function findModeKey<C>(table: ModeKey<C>[], e: KeyboardEvent, ch = keyChar(e), m?: ListMode): ModeKey<C> | undefined {
  return table.find(k => {
    if (m && k.modes && !k.modes.includes(m)) return false;
    if (!!k.alt !== e.altKey) return false;
    if (k.shift !== undefined && k.shift !== e.shiftKey) return false;
    return k.code !== undefined ? asList(k.code).includes(e.code) : asList(k.key).includes(ch);
  });
}

/** The names the docs give a mode key's variants (`name` wins when set) */
export function modeKeyNames<C>(k: ModeKey<C>): string[] {
  if (k.name) return [k.name];
  return k.code !== undefined ? asList(k.code) : asList(k.key);
}

/** The keys that mean in every mode what they mean at home: playing, the garden, the display toggles, help, the other voice */
export const PASS_KEYS = [' ', ',', '.', '/', '<', '>', '~', '`', '\\', '|', '?'];
export const PASS_CODES = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Delete', 'Tab'];
export function passesHome(e: KeyboardEvent, ch = keyChar(e)): boolean {
  return PASS_KEYS.includes(ch) || PASS_CODES.includes(e.code);
}

// ─── List modes: one key, one verb, in every list ────────────────────────────

/** `labels` names what the verb does to a particular list */
export type ListAction = { label: string; labels?: Partial<Record<ListMode, string>> } &
  ({ pattern: PatternOp } | { verb: ListVerb });

export const LIST_VERBS: Record<string, ListAction> = {
  // order and length
  s: { pattern: 'scramble', label: 'scramble' },
  R: { pattern: 'mirror', label: 'mirror' },
  '9': { pattern: 'rotate<', label: 'rotate <<' },
  '0': { pattern: 'rotate>', label: 'rotate >>' },
  u: { pattern: 'stutter', label: 'stutter' },
  U: { pattern: 'sputter', label: 'sputter' },
  o: { verb: 'sortUp', label: 'sort up', labels: { pitch: 'sort low → high', time: 'sort short → long', vel: 'crescendo', fig: 'shorter figures first' } },
  O: { verb: 'sortDown', label: 'sort down', labels: { pitch: 'sort high → low', time: 'sort long → short', vel: 'decrescendo', fig: 'longer figures first' } },
  z: { verb: 'dropLast', label: 'drop last' },
  a: { verb: 'addFromPalette', label: 'add one (palette)', labels: { pitch: 'add one in scale', fig: 'add one (a figure in use)' } },
  A: { verb: 'addRandom', label: 'add one (any)', labels: { pitch: 'add one (any pitch)', fig: 'add one (a new figure)' } },
  // values
  '1': { verb: 'nudgeDown', label: 'down', labels: { pitch: 'semitone down', time: 'a little faster', vel: 'a little softer', chan: 'shift −1', iv: 'all one lower', fig: 'every step a scale step lower' } },
  '2': { verb: 'nudgeUp', label: 'up', labels: { pitch: 'semitone up', time: 'a little slower', vel: 'a little louder', chan: 'shift +1', iv: 'all one higher', fig: 'every step a scale step higher' } },
  '!': { verb: 'octaveDown', label: 'octave down', labels: { time: 'double time', vel: 'much softer', iv: 'an octave lower' } },
  '@': { verb: 'octaveUp', label: 'octave up', labels: { time: 'half time', vel: 'much louder', iv: 'an octave higher' } },
  '3': { verb: 'stepDown', label: 'palette step down', labels: { pitch: 'scale step down' } },
  '4': { verb: 'stepUp', label: 'palette step up', labels: { pitch: 'scale step up' } },
  '#': { verb: 'breezeDown', label: 'breeze: some a step down' },
  '$': { verb: 'breezeUp', label: 'breeze: some a step up' },
  '-': { verb: 'converge', label: 'converge', labels: { pitch: 'narrower range', time: 'evener', vel: 'flatter dynamics', iv: 'evener spacing' } },
  '=': { verb: 'diverge', label: 'diverge', labels: { pitch: 'wider range', time: 'more uneven', vel: 'wider dynamics', iv: 'more uneven spacing' } },
  '+': { verb: 'diverge', label: 'diverge', labels: { pitch: 'wider range', time: 'more uneven', vel: 'wider dynamics', iv: 'more uneven spacing' } },
  y: { verb: 'unify', label: 'unify', labels: { pitch: 'unify (all the commonest pitch)', fig: 'unify (every figure the commonest)' } },
  i: { verb: 'invert', label: 'invert', labels: { pitch: 'invert high ↔ low', time: 'invert long ↔ short', vel: 'invert loud ↔ quiet', iv: 'invert above ↔ below', fig: 'invert up ↔ down' } },
  I: { verb: 'invertMid', label: 'invert around middle', labels: { pitch: 'invert around the mean', iv: 'invert wide ↔ close' } },
  w: { verb: 'curve', label: 'curve', labels: { pitch: 'contour', time: 'rubato curve', vel: 'hairpins', iv: 'swell of widths' } },
  // vocabulary
  m: { verb: 'mutate', label: 'mutate (palette)', labels: { pitch: 'mutate (scale steps)', fig: 'mutate (a step in a few)' } },
  M: { verb: 'mutateWild', label: 'mutate (wild)', labels: { pitch: 'mutate (chromatic)', fig: 'mutate (a few new figures)' } },
  h: { verb: 'fewer', label: 'fewer distinct values', labels: { pitch: 'one pitch class fewer', fig: 'one kind of figure fewer' } },
  H: { verb: 'more', label: 'more distinct values', labels: { pitch: 'one pitch class more', fig: 'one kind of figure more' } },
  n: { verb: 'renew', label: 'new list', labels: { pitch: 'new pitches in scale', chan: 'new channels (the ones in use)', iv: 'new chords, same places', fig: 'new figures, same places' } },
  N: { verb: 'renewWild', label: 'new list', labels: { pitch: 'new pitches (any)', chan: 'new channels (any)', iv: 'new chords and places', fig: 'new figures and places' } },
};

// l tilts down and L up, in every list but the figures
const TILT_LABELS: Record<'tiltDown' | 'tiltUp', Record<ListMode, string>> = {
  tiltDown: { pitch: 'tilt down', time: 'accelerando', vel: 'decrescendo', chan: 'drift down', iv: 'closing in', fig: 'tilt' },
  tiltUp: { pitch: 'tilt up', time: 'ritardando', vel: 'crescendo', chan: 'drift up', iv: 'opening out', fig: 'tilt' },
};

/** What a list-mode key's action can reach */
export interface ListCtx {
  e: KeyboardEvent;
  ch: string;
  m: ListMode;
  /** the mode's list */
  k: ListKey;
  /** what starts everything said here: [t], [iv] … */
  tag: string;
  /** the mode's name: time, intervals … */
  name: string;
  b: Bloom;
  g: Garden;
  status(msg: string): void;
  /** say it (under the tag) and settle the change */
  say(msg: string): void;
  /** say it, do it, settle it */
  apply(msg: string, fn: () => void): void;
  /** ask how many, then act; false when there's no line to ask on */
  askCount(label: string, last: number, act: (n: number) => string, max?: number, min?: number): boolean;
  /** ask a length in beats (offering `now`), then act on it */
  askBeats(label: string, now: number, act: (beats: number) => string): boolean;
  memo: { splitSlices: number; repeatTimes: number; chunks: number; fitTo: number };
  /** two voices: the other one, or null */
  other(): { bloom: Bloom; name: string } | null;
  /** d: the pattern palette over this list; again: the last pattern, without it */
  pattern(again: boolean): void;
  /** ↵: type the list over; false when there's no line to type on */
  type(): boolean;
  /** the list as text */
  text(): string;
  leave(): void;
  /** esc means leave: not while the help or clean view have first call on it */
  leaving(): boolean;
  /** k in time mode: the rhythm picker; false when there's none to open */
  pickRhythm(): boolean;
}

/** K in time mode: which palette it's on */
let _palette = 0;

/** opt-z: the longest a list can be cut or looped to */
export const FIT_MAX = 512;

type ListModeKey = ModeKey<ListCtx>;

const tilt = (shift: boolean): ListModeKey => ({
  code: 'KeyL', shift, name: shift ? 'L' : 'l', label: shift ? 'tilt up' : 'tilt down',
  act: c => {
    if (c.m === 'fig') { c.status(`${c.tag} no figures version of tilt`); return; }
    const verb = shift ? 'tiltUp' : 'tiltDown';
    c.b.shapeList(c.k, verb);
    c.say(TILT_LABELS[verb][c.m]);
  },
});

/** opt-f copies, opt-x laces this list from the other voice (f / x take it from the garden slot) */
const fromOther = (lace: boolean): ListModeKey => ({
  code: lace ? 'KeyX' : 'KeyF', alt: true, shift: false, name: lace ? 'opt-x' : 'opt-f',
  label: lace ? "lace with the other voice's list" : "copy the other voice's list",
  act: c => {
    const o = c.other();
    if (!o) { c.status(`${c.tag} opt-${lace ? 'x' : 'f'} takes from the other voice: opt-tab brings one in`); return; }
    if (!o.bloom.getList(c.k).length) { c.status(`${c.tag} ${o.name} has no ${c.name} list`); return; }
    if (lace) c.b.laceList(c.k, o.bloom); else c.b.copyList(c.k, o.bloom);
    c.say(lace ? `laced with ${o.name}'s ${c.name}` : `${o.name}'s ${c.name}`);
  },
});

/** q where the list is made of scale things: snap them into the scale; Q only says so */
const snapToScale = (m: 'iv' | 'fig', hint: string): ListModeKey => ({
  key: ['q', 'Q'], modes: [m], label: 'snap to the scale',
  act: c => {
    if (c.ch === 'Q') c.status(`${c.tag} ${hint}`);
    else if (c.b.shapeList(m, 'quantize')) c.say(`snap to the scale: ${c.text()}`);
    else c.status(`${c.tag} already in the scale`);
  },
});

/**
 * The list-mode keys that aren't one verb for every list (those are
 * LIST_VERBS): the mode's own doings, the keys one or two lists have, and the
 * home keys that carry on meaning here what they mean there (`home`).
 */
export const LIST_MODE_KEYS: ListModeKey[] = [
  tilt(false), tilt(true),
  fromOther(false), fromOther(true),
  {
    code: 'KeyZ', alt: true, shift: false, name: 'opt-z', label: 'cut or loop this list to a length (asks)',
    act: c => {
      if (c.k === 'notes') { c.status(`${c.tag} opt-z fits the other lists to a length; the notes are what they fit against`); return; }
      c.askCount(`${c.name} list, how long:`, c.memo.fitTo, n => {
        c.memo.fitTo = n;
        const { cut, looped } = c.b.fitListsTo(n, [c.k]);
        return `${c.tag} ${cut ? 'cut' : looped ? 'looped round' : 'already'} to ${n}: ${c.text()}`;
      }, FIT_MAX, 1);
    },
  },
  {
    code: 'KeyD', alt: true, shift: false, name: 'opt-d', modes: ['time'], label: 'cut the time list to a length in beats (asks): looped round and cut there, the notes untouched',
    act: c => c.askBeats('time list, cut to how long (beats):', c.b.timeIntervals.reduce((a, t) => a + t, 0), d => {
      c.b.cutTimesTo(d);
      return `${c.tag} cut to ${ratioText(d)} beats, ${c.b.timeIntervals.length} long: ${c.text()}`;
    }),
  },
  {
    code: 'KeyS', alt: true, shift: false, name: 'opt-s', modes: ['time'], label: 'squeeze the time list to a length in beats (asks): every time scaled alike',
    act: c => c.askBeats('time list, squeeze to how long (beats):', c.b.timeIntervals.reduce((a, t) => a + t, 0), d => {
      c.b.squeezeTo(d, true);
      return `${c.tag} squeezed to ${ratioText(d)} beats: ${c.text()}`;
    }),
  },
  { code: 'Escape', shift: false, name: 'esc', label: 'back home', act: c => { if (!c.leaving()) return false; c.leave(); c.status(`${c.name} mode off`); } },
  { code: 'Enter', name: '↵', label: 'type the list (shift: looped round to the notes)', act: c => c.type() },
  { key: 'T', label: 'tuning mode', home: true },

  // pitch keys that live at home too: scales, shear and gather, the intervals
  { key: ['k', 'K', 'j', 'J', 'e', 'E'], modes: ['pitch'], label: 'scales, shear and gather: as at home', home: true },
  { key: ['6', '^', '7', '&', '8', '*', '%'], modes: ['pitch', 'iv'], label: 'the interval keys: as at home', home: true },
  { key: ['*', 'B'], modes: ['fig'], label: 'bake / clear the figures: as at home', home: true },
  {
    key: ['(', ')'], modes: ['pitch'], label: 'pivot on the highest / loudest note',
    act: c => c.apply(c.ch === '(' ? 'pivot (highest)' : 'pivot (loudest)', () => (c.ch === '(' ? c.b.pivot() : c.b.pivotLoudest())),
  },
  {
    key: ['[', ']'], modes: ['pitch'], label: 'the scale a step flatward / sharpward',
    act: c => {
      const dir = c.ch === ']' ? 1 : -1;
      const name = dir === 1 ? 'sharpward' : 'flatward';
      const moved = c.b.fifthsward(dir);
      if (moved) { c.status(`${c.tag} ${name}: ${moved}`); c.say(name); }
      else c.status(`${c.tag} no ${name} step from here`);
    },
  },
  {
    key: ['q', 'Q'], modes: ['pitch'], label: 'snap to the scale',
    act: c => {
      if (c.ch === 'q') c.apply('snap to the scale', () => c.b.shapeList('notes', 'quantize'));
      else c.status(`${c.tag} q snaps to the scale; k K j J choose it`);
    },
  },
  {
    // as k chooses the scale in pitch mode: the scale is pitch's palette
    key: 'k', modes: ['time'], label: 'choose a duration palette or a rhythm cell',
    act: c => {
      c.e.preventDefault();   // the k mustn't land in the picker's filter
      if (!c.pickRhythm()) c.status(`${c.tag} no picker here`);
    },
  },
  {
    // as K slants to a neighbouring scale
    key: 'K', modes: ['time'], label: 'the next duration palette',
    act: c => {
      const at = DURATION_PALETTES.findIndex(p => p.name === c.b.frozen.rhythm?.name);
      _palette = ((at >= 0 ? at : _palette) + 1) % DURATION_PALETTES.length;
      const p = DURATION_PALETTES[_palette];
      c.apply(`${p.name}: ${p.ratios.map(ratioText).join(' ')} · the times stay in it (F t lets go)`, () => c.b.snapTimes(p.ratios, p.name, c.b.lockedBasis() ?? c.other()?.bloom.lockedBasis() ?? undefined));
    },
  },
  snapToScale('iv', 'q snaps the intervals to the scale (m3 → 3rd)'),
  snapToScale('fig', "q snaps the figures' steps to the scale (+M2 → 2)"),
  {
    key: ';', modes: ['chan'], label: 'every channel one up',
    act: c => { c.b.cycleChans(); c.say(`every channel one up: ${c.b.chans.join(' ')}`); },
  },
  {
    key: "'", modes: ['chan'], label: 'one channel changed at random',
    act: c => { c.b.oneRandChan(); c.say(`one channel changed: ${c.b.chans.join(' ')}`); },
  },
  {
    // as ; : clump and flatten chords at home
    key: [';', ':'], modes: ['iv'], label: 'thicker / thinner chords',
    act: c => {
      const more = c.ch === ';';
      if (c.b.thickenIntervals(more)) c.say(`${more ? 'thicker' : 'thinner'} chords: ${formatIntervals(c.b.intervals)}`);
      else c.status(`${c.tag} ${more ? 'no voice left to add' : 'every chord is one interval already'}`);
    },
  },
  {
    key: [';', ':'], modes: ['fig'], label: 'longer / shorter figures',
    act: c => {
      const more = c.ch === ';';
      if (c.b.lengthenFigures(more)) c.say(`${more ? 'longer' : 'shorter'} figures: ${formatFigures(c.b.figures)}`);
      else c.status(`${c.tag} ${c.b.figures.some(f => Array.isArray(f)) ? (more ? 'the figures are as long as they go' : 'every figure is two steps already') : 'no figures to lengthen: n makes some'}`);
    },
  },
  {
    // as it merges two notes at home
    key: '{', label: 'merge two neighbours',
    act: c => c.say(c.b.mergeList(c.k) ? `merge: two become one, ${c.b.getList(c.k).length} long` : 'nothing to merge'),
  },
  {
    // as it splits a note at home
    key: '}', modes: ['time'], label: 'divide long durations (asks into how many)',
    act: c => c.askCount('divide long durations into:', c.memo.splitSlices, n => {
      c.memo.splitSlices = n;
      return c.b.divideTimes(n) ? `${c.tag} divide: a few long durations into ${n} (no notes added)` : `${c.tag} no duration is long enough for ${n} parts`;
    }),
  },
  {
    key: '"', label: 'repeat this list (asks how many times)',
    act: c => c.askCount(`repeat the ${c.name} list, times:`, c.memo.repeatTimes, n => {
      c.memo.repeatTimes = n;
      c.b.repeatLists(n, [c.k]);
      return `${c.tag} repeated ${n} times: ${c.b.getList(c.k).length} long`;
    }),
  },
  {
    key: 'Z', label: 'fit this list to the notes',
    act: c => {
      if (c.k === 'notes') { c.status(`${c.tag} Z fits the other lists to the notes (at home)`); return; }
      const fit = c.b.fitLists([c.k]);
      c.say(fit.cut ? `cut to the ${c.b.notes.length} notes` : fit.looped ? `looped round to the ${c.b.notes.length} notes` : "already the notes' length");
    },
  },
  {
    key: 'q', modes: ['time', 'vel', 'chan'], label: 'quantize: to the grid, or to at most N levels',
    act: c => {
      const q = currentQuantize();
      c.apply(c.m === 'time' ? `quantize [1/${q}]` : `≤ ${q} levels`, () => c.b.shapeList(c.k, 'quantize', q));
    },
  },
  {
    key: 'Q', modes: ['time', 'vel', 'chan'], label: 'choose the grid or N',
    act: c => {
      const q = nextQuantize();
      c.status(`${c.tag} (q to apply) ${c.m === 'time' ? `quantize [1/${q}]` : `≤ ${q} levels`}`);
    },
  },
  {
    key: 'x', label: "lace this list with the garden slot's",
    act: c => {
      const src = c.g.current;
      if (!src) { c.status('no bloom in slot'); return; }
      c.apply('lace with slot', () => c.b.laceList(c.k, src));
    },
  },
  {
    // the lift, by mode: at home opt-↑ lifts the slot's notes alone; in a list mode, that mode's list alone
    code: 'ArrowUp', alt: true, shift: false, name: 'opt-↑', label: "lift this list alone from the garden slot (the others play on, in place)",
    act: c => {
      const src = c.g.current;
      if (!src) { c.status('no bloom in slot'); return; }
      if (!src.getList(c.k).length) { c.status(`${c.tag} the slot has no ${c.name} list`); return; }
      if (c.k === 'notes') c.apply(`lifted the notes of [${c.g.index}]`, () => c.b.liftNotes(src));
      else c.apply(`lifted the ${c.name} list of [${c.g.index}]`, () => c.b.copyList(c.k, src));
    },
  },
  {
    // as it does the notes at home
    key: 'S', label: 'scramble in chunks (asks how many)',
    act: c => c.askCount(`scramble the ${c.name} list in chunks, how many:`, c.memo.chunks, n => {
      c.memo.chunks = n;
      return c.b.scrambleChunksList(c.k, n) ? `${c.tag} scrambled in ${n} chunks` : `${c.tag} nothing to reorder`;
    }, c.b.getList(c.k).length),
  },
  { key: ['d', 'D'], label: 'patterns over this list / the last pattern again', act: c => c.pattern(c.ch === 'D') },
];

// ─── Select mode ─────────────────────────────────────────────────────────────
// r. The selection is a list of its own, one on/off per event, and the list
// verbs mean on it what they mean everywhere (selectVerbs.ts). Nothing here
// changes a note: a list-mode key (p t v c 5 b) goes straight across with the
// selection kept, and the keys there act on it.

/** What a select-mode key's action can reach */
export interface SelectCtx {
  e: KeyboardEvent;
  ch: string;
  /** how many events there are */
  n: number;
  sel(): number[];
  /** the pinned events: nothing selects them */
  fixed(): number[];
  /** each event's loudness, its highest and lowest pitch, its duration */
  values(of: 'vel' | 'high' | 'low' | 'time'): number[];
  /** each event's pitch classes */
  pcs(): number[][];
  /** the new selection, and what to say */
  set(sel: number[], msg: string): void;
  /** the selection becomes pins (and empties) / the pins become the selection */
  toPins(): void;
  fromPins(): void;
  askCount(label: string, last: number, act: (n: number) => string, max?: number, min?: number): boolean;
  memo: { every: number };
  status(msg: string): void;
  leave(): void;
  /** esc means leave: not while the help or clean view have first call on it */
  leaving(): boolean;
}

const deepen = (key: [string, string], of: ['vel' | 'high' | 'low' | 'time', 'vel' | 'high' | 'low' | 'time'], names: [string, string]): ModeKey<SelectCtx> => ({
  key, label: `the ${names[0]} / ${names[1]}, each press a level deeper`,
  act: c => {
    const most = c.ch === key[0];
    const sel = slice(c.values(of[most ? 0 : 1]), c.sel(), most, c.fixed(), of[0] === 'vel' ? v => v <= 0 : undefined);   // a rest is not the softest note
    c.set(sel, most ? names[0] : names[1]);
  },
});

export const SELECT_KEYS: ModeKey<SelectCtx>[] = [
  { code: 'Escape', shift: false, name: 'esc', label: 'back home, the selection kept', act: c => { if (!c.leaving()) return false; c.leave(); c.status('select mode off (the selection stays: esc again clears it)'); } },
  { key: 'r', label: 'back home, the selection kept', act: c => { c.leave(); c.status('select mode off (the selection stays: esc clears it)'); } },
  { key: ['=', '+'], label: 'a few more, at random', act: c => c.set(more(c.sel(), c.n, c.fixed()), 'more') },
  { key: '-', label: 'a few fewer, at random', act: c => c.set(fewer(c.sel(), c.n), 'fewer') },
  { key: ['9', '0'], label: 'rotate the selection', act: c => c.set(rotate(c.sel(), c.n, c.ch === '0' ? 1 : -1), c.ch === '0' ? 'rotate >>' : 'rotate <<') },
  { key: ['s', 'n'], label: 'as many, in new places', act: c => c.set(scramble(c.sel(), c.n, c.fixed()), 'new places') },
  { key: 'R', label: 'mirror', act: c => c.set(mirror(c.sel(), c.n), 'mirror') },
  { key: 'i', label: 'invert: the others', act: c => c.set(invert(c.sel(), c.n, c.fixed()), 'invert') },
  { key: 'a', label: 'all', act: c => c.set(invert([], c.n, c.fixed()), 'all') },
  { key: 'z', label: 'none', act: c => c.set([], 'none') },
  {
    key: 'e', label: 'every Nth event (asks N; 9 0 then move it along)',
    act: c => c.askCount('select every:', c.memo.every, n => {
      c.memo.every = n;
      c.set(everyNth(c.n, n, 0, c.fixed()), `every ${n}`);
      return `[select] every ${n}: 9 0 move it along`;
    }, Math.max(2, c.n), 2),
  },
  {
    key: 'o', label: 'every note of the selected pitch classes, in any octave',
    act: c => {
      if (!c.sel().length) { c.status('[select] select a note or two first: o finds every other of their pitch classes'); return; }
      c.set(samePitchClasses(c.pcs(), c.sel(), c.fixed()), 'the same pitch classes');
    },
  },
  deepen(['l', 'L'], ['vel', 'vel'], ['loudest', 'softest']),
  deepen(['h', 'H'], ['high', 'low'], ['highest', 'lowest']),
  deepen(['d', 'D'], ['time', 'time'], ['longest', 'shortest']),
  { key: 'x', label: 'the selection becomes pins, ready for another', act: c => c.toPins() },
  { key: 'X', label: 'the pins become the selection', act: c => c.fromPins() },
  // the list modes are where the selection gets changed: straight across, the selection kept
  { key: Object.keys(MODE_KEYS), label: 'straight across to that list mode: its keys act on the selection', act: c => { c.leave(); return false; } },
];

export const SELECT_HINT = 'select mode: = - more / fewer · 9 0 rotate · s new places · i invert · a z all / none · e every Nth · o same pitch classes · l L loud / soft · h H high / low · d D long / short · x X to / from pins · p t v c 5 b act on these · r or esc home';

// ─── Tuning mode ─────────────────────────────────────────────────────────────

/** What a tuning-mode key's action can reach */
export interface TuningCtx {
  e: KeyboardEvent;
  ch: string;
  status(msg: string): void;
  /** esc means leave: not shift-esc, and not while the help or clean view have first call on it */
  leaving(): boolean;
  picked(): number[];
  clearPick(): void;
  close(): void;
  stepTuning(dir: 1 | -1): void;
  /** the tuning menu; false when there's nothing to choose from */
  pick(): boolean;
  /** 1 2 9 0 3 4 # $ on the alterations */
  alter(ch: string): void;
  recentre(shift: boolean): void;
}

export const TUNING_KEYS: ModeKey<TuningCtx>[] = [
  { code: 'KeyK', alt: true, name: 'opt-k', label: 'the selected slice becomes 1/1 (none: the next up; shift: the one below)', act: c => c.recentre(c.e.shiftKey) },
  {
    code: 'Escape', shift: false, name: 'esc', label: 'let go of the selected slices, then leave',
    act: c => {
      if (!c.leaving()) return false;
      if (c.picked().length) { c.clearPick(); c.status('slices unselected'); return; }
      c.close();
      c.status('tuning mode off');
    },
  },
  { key: 'T', label: 'leave tuning mode', act: c => { c.close(); c.status('tuning mode off'); } },
  { key: [']', '['], label: 'step through the loaded tunings', act: c => c.stepTuning(c.ch === ']' ? 1 : -1) },
  {
    // a tuning chosen on purpose, nothing on the way sounding
    key: 'l', label: 'the tuning menu',
    act: c => {
      c.e.preventDefault();   // the l mustn't land in the menu's filter
      if (!c.pick()) c.status('no tunings loaded — load .scl (here, or bloom ▾ → tuning)');
    },
  },
  { key: '1', label: 'alterations on / off', act: c => c.alter(c.ch) },
  { key: '2', label: 'clear the alterations (of the selected slices)', act: c => c.alter(c.ch) },
  { key: ['9', '0'], label: 'rotate the alterations', act: c => c.alter(c.ch) },
  { key: ['3', '4'], label: 'a comma down / up', act: c => c.alter(c.ch) },
  { key: ['#', '$'], label: 'breeze: some notes a comma down / up', act: c => c.alter(c.ch) },
  // the list mode keys switch straight across, as they do between list modes
  { key: Object.keys(MODE_KEYS), label: 'straight across to that list mode', act: c => { c.close(); return false; } },
];

export const TUNING_HINT = 'tuning mode: ] [ base · l menu · 1 on/off · 2 clear · 9 0 rotate · 3 4 comma · # $ breeze · click slices · opt-k 1/1 here · opt-t holds · T or esc leaves';

// ─── The freeze menu ─────────────────────────────────────────────────────────

export interface FreezeItem { key: string; alias?: string; name: string; selector: string; /** two voices linked (key, centre, basis, tuning in common), not a freeze */ link?: true }

/** F, then one of these. Keys match the list modes where there is one (t, v, c). */
export const FREEZE_ITEMS: FreezeItem[] = [
  { key: 'p', name: 'pitch', selector: '.freeze-palette[data-list="pitch"]' },
  { key: 't', alias: 'r', name: 'rhythm', selector: '.freeze-palette[data-list="time"]' },
  { key: 'v', name: 'dynamics', selector: '.freeze-palette[data-list="vel"]' },
  { key: 'c', name: 'channels', selector: '.freeze-palette[data-list="chan"]' },
  { key: 'd', name: 'duration', selector: '#fixed-dur-enabled' },
  { key: '5', name: 'intervals', selector: '.freeze-palette[data-list="iv"]' },
  { key: 'g', name: 'grid', selector: '#fixed-grid-enabled' },
  { key: 'l', name: "the other voice's length", selector: '#voice-lock' },
  // two voices, linked: key, centre, time basis and tuning in common; change one in either and both change
  { key: 'k', name: 'the two voices linked', selector: '#voice-link', link: true },
];

/** What a freeze-menu key's action can reach */
export interface FreezeCtx {
  status(msg: string): void;
  close(): void;
  /** esc means close: not while the help or clean view have first call on it */
  leaving(): boolean;
  /** unpin every event; how many there were */
  unpin(): number;
  /** switch the item's freeze (d cycles off → trim → stretch) */
  toggle(f: FreezeItem): void;
}

export const FREEZE_KEYS: ModeKey<FreezeCtx>[] = [
  { code: 'Escape', name: 'esc', label: 'close the menu', act: c => { if (!c.leaving()) return false; c.close(); } },
  { key: 'F', label: 'close the menu', act: c => c.close() },
  {
    key: 'e', label: 'unpin the pinned events',
    act: c => {
      const n = c.unpin();
      c.status(n ? `${n} event${n === 1 ? '' : 's'} unpinned` : 'no pinned events — click a node to pin it');
    },
  },
  ...FREEZE_ITEMS.map((f): ModeKey<FreezeCtx> => ({
    key: f.alias ? [f.key, f.alias] : f.key,
    label: f.key === 'd' ? 'duration: off → trim → stretch' : f.link ? 'link the two voices: key, centre, time basis, tuning (either changes both)' : `freeze ${f.name}`,
    act: c => c.toggle(f),
  })),
];
