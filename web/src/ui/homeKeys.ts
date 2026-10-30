// The home keys as a table: what's pressed, what it's called, what it does.
// keys.ts routes a key here once the modes (freeze menu, tuning, list modes)
// have had their say. One entry per key, so the docs can be checked against
// it (ui/__tests__/homeKeys.test.ts) and a key's behaviour is in one place.

import { Bloom } from '../core/Bloom';
import type { Tuning } from '../lib/tuning';
import type { Garden } from '../garden';
import type { PatternOp } from '../core/Bloom';
import type { VizMode } from './theme';
import type { KeyHandlerState } from './keys';
import type { IntervalVal } from '../core/Bloom';
import type { Figure } from '../lib/figures';
import { formatIntervals } from '../lib/intervals';
import { controlChange } from '../audio/midi';
import { startRecording, stopRecording, isRecording } from '../audio/recorder';
import {
  startLooper, stopLooper, isLooping, updateLooper,
  startPulsar, stopPulsar, isPulsing, updatePulsar,
  setPulsarRate, getPulsarRate, silence,
  startGardenLooper, stopGardenLooper, isGardenLooping,
  startGardenPulsar, stopGardenPulsar, isGardenPulsing,
} from '../audio/scheduler';

/** The key as typed, caps lock seen through: a letter's case follows shift alone */
export function keyChar(e: KeyboardEvent): string {
  const k = e.key;
  if (k.length === 1 && /[a-z]/i.test(k) && e.getModifierState?.('CapsLock')) return e.shiftKey ? k.toUpperCase() : k.toLowerCase();
  return k;
}

/** What a key's action can reach: the bloom and garden, and the handler's own ways of saying and settling things */
export interface HomeCtx {
  e: KeyboardEvent;
  ch: string;
  shift: boolean;
  alt: boolean;
  b: Bloom;
  g: Garden;
  state: KeyHandlerState;
  status(msg: string): void;
  refresh(msg?: string, hold?: boolean): void;
  /** say it, do it, settle it */
  verb(label: string, fn: () => void, said?: string): void;
  /** the same with the selected garden slot, or "no bloom in slot" */
  withSlot(label: string, fn: (src: Bloom) => void, said?: string): void;
  play(bloom: Bloom, msg?: string): void;
  /** play the slot, the picture showing it meanwhile */
  previewSlot(src: Bloom): void;
  /** ask how many (2 to max), then act; false when there's no line to ask on */
  askCount(label: string, last: number, act: (n: number) => string, max?: number): boolean;
  /** what the asking keys offered last time */
  memo: { splitSlices: number; repeatTimes: number; chunks: number };
  /** the loop's display: each cycle's lists, as they phase */
  onLoopCycle(vel: number[], time: number[], chan: number[], iv: IntervalVal[], fig: Figure[]): void;
  leaveListMode(): void;
  toggleHold(): void;
  setClean(on: boolean): void;
  newBloomTuning(b: Bloom, own: Tuning | null): void;
  selection(): number[];
  pins(): Set<number>;
  select(indices: number[]): void;
  clearSelection(): void;
  clearPins(forget?: boolean): void;
  invertPins(): void;
}

/** One home key */
export interface HomeKey {
  /** e.key (caps lock seen through); shift is implied by the character */
  key?: string | string[];
  /** e.code, for keys named by position (arrows, space, opt-letters) */
  code?: string | string[];
  /** opt held (default: not) */
  alt?: boolean;
  /** shift held; only checked when given (a `key` carries its own case) */
  shift?: boolean;
  /** sees the whole bloom even with a selection or pins: playing, viewing, the garden, modes */
  whole?: boolean;
  /** what the docs call it, when the key and modifiers don't say it (see keyName) */
  name?: string;
  label: string;
  act: (c: HomeCtx) => void;
}

const VIZ_ORDER: VizMode[] = ['deep', 'field', 'orbit', 'score', 'tonal', 'set', 'spiral', 'helix', 'flower'];

// opt + an order key: the pitches alone, over the rhythm, dynamics and channels that stay put
const PITCH_ONLY: Record<string, [PatternOp, PatternOp]> = {
  KeyS: ['scramble', 'shuffle'],
  KeyR: ['mirror', 'mirror'],
  KeyU: ['stutter', 'sputter'],
  KeyD: ['braid', 'pyramid'],
};

const v = (key: string | string[], label: string, fn: (b: Bloom, c: HomeCtx) => void, said?: string): HomeKey =>
  ({ key, label, act: c => c.verb(label, () => fn(c.b, c), said) });
const slot = (key: string, label: string, fn: (b: Bloom, src: Bloom) => void, said?: string): HomeKey =>
  ({ key, label, act: c => c.withSlot(label, src => fn(c.b, src), said) });

export const HOME_KEYS: HomeKey[] = [
  // ─── View and modes (opt) ──────────────────────────────────────────────────
  {
    code: Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`), alt: true, shift: false, whole: true, name: 'opt-1 … 9',
    label: 'change the view',
    act: c => { const mode = VIZ_ORDER[parseInt(c.e.code.slice(5), 10) - 1]; c.state.setVizModeFn?.(mode); c.status(`view: ${mode}`); },
  },
  { code: 'KeyT', alt: true, shift: false, whole: true, label: 'hold the tuning over every bloom', act: c => c.toggleHold() },
  { code: 'KeyC', alt: true, shift: false, whole: true, label: 'clean view', act: c => c.setClean(!document.body.classList.contains('clean')) },
  { code: 'KeyE', alt: true, whole: true, label: 'edit the bloom', act: c => c.state.editorOpenFn?.() },
  {
    code: Object.keys(PITCH_ONLY), alt: true, name: 'opt + s S R u U d D', label: 'order the pitches alone',
    act: c => { const op = PITCH_ONLY[c.e.code][c.shift ? 1 : 0]; c.verb(`${op} pitches`, () => c.b.patternList('notes', op)); },
  },
  {
    code: 'KeyP', alt: true, whole: true, name: 'opt-p', label: 'push a save point (shift: pop)',
    act: c => {
      if (c.shift) c.verb('pop', () => c.b.pop());
      else c.verb(`push (${c.b.stack.length + 1} saved)`, () => c.b.push(), 'push');
    },
  },
  {
    code: 'KeyW', alt: true, shift: false, label: 'wheels within wheels',
    act: c => c.verb('wheels within wheels', () => { c.b.velocities = [100, ...Array(c.b.notes.length).fill(30)]; }),   // N+1 vels for N notes → accent shifts each cycle
  },

  // ─── Storage ───────────────────────────────────────────────────────────────
  {
    key: 'n', label: 'new bloom (same scale)',
    act: c => c.verb('new bloom (same scale)', () => {
      const scale = c.b.scale, tuning = c.b.tuning;
      c.b.import(new Bloom().seed().applyScale(scale));
      c.newBloomTuning(c.b, tuning);
    }),
  },
  { key: 'N', label: 'new bloom', act: c => c.verb('new bloom', () => { c.b.import(new Bloom().seed()); c.newBloomTuning(c.b, null); }) },
  { key: 'T', whole: true, label: 'tuning mode', act: c => { c.leaveListMode(); c.state.tuningView?.toggle(); } },
  {
    code: 'KeyL', label: 'tilt down (shift: up)', name: 'l L',
    act: c => { const tilt = c.shift ? 'tiltUp' : 'tiltDown'; c.verb(c.shift ? 'tilt up' : 'tilt down', () => { c.b.shapeList('notes', tilt); }); },
  },
  {
    key: '`', whole: true, label: 'record from MIDI / stop',
    act: c => {
      if (isRecording()) {
        stopRecording(c.b);
        c.state.recordDotEl?.classList.remove('active');
        c.refresh('recorded');
      } else {
        startRecording();
        c.state.recordDotEl?.classList.add('active');
        c.status('recording… (` to stop)');
      }
    },
  },

  // ─── Shaping ───────────────────────────────────────────────────────────────
  v('m', 'mutate notes (diatonic)', b => b.mutateNotesD(), 'mutateD'),
  v('M', 'mutate notes', b => b.mutateNotes(), 'mutate'),
  v('s', 'scramble', b => b.scramble()),
  {
    key: 'S', label: 'scramble in chunks (asks how many)',
    act: c => c.askCount('scramble in chunks, how many:', c.memo.chunks, n => {
      c.memo.chunks = n;
      return c.b.scrambleChunks(n) ? `scramble in ${n} chunks` : 'nothing to reorder';
    }, c.b.notes.length),
  },
  v('H', 'thicken', b => b.thicken(0.3)),
  v('h', 'thin', b => b.thin()),
  v('g', 'gap', b => b.gap()),
  v('G', 'unGap', b => b.unGap()),

  // ─── Gestures (whole bloom) ────────────────────────────────────────────────
  v('-', 'calm', b => b.calm()),
  v(['=', '+'], 'intensify', b => b.intensify()),
  v("'", 'vary', b => b.vary()),
  v('{', 'merge two notes', b => b.mergeNote(), 'merge'),
  {
    key: '}', label: 'split a note (asks into how many)',
    act: c => c.askCount('split a note into:', c.memo.splitSlices, n => {
      c.memo.splitSlices = n;
      return c.b.splitNote(n) ? `split a note into ${n}` : `no note is long enough for ${n} slices`;
    }),
  },
  {
    key: '"', label: 'repeat every list (asks how many times)',
    act: c => c.askCount('repeat every list, times:', c.memo.repeatTimes, n => {
      c.memo.repeatTimes = n;
      c.b.repeatLists(n);
      return `every list repeated ${n} times: ${c.b.notes.length} notes`;
    }),
  },
  {
    key: 'Z', label: 'trim every list to the notes',
    act: c => {
      const cut = c.b.trimLists();
      const msg = cut ? `${cut} list${cut === 1 ? '' : 's'} trimmed to the ${c.b.notes.length} notes` : 'no list is longer than the notes';
      c.status(msg);
      c.refresh(msg);
    },
  },

  // ─── Blending with the garden slot ─────────────────────────────────────────
  slot('x', 'interlace', (b, src) => b.interlace(src)),
  slot('X', 'blend', (b, src) => b.blend(src)),
  slot('f', 'lift shape', (b, src) => b.applyShape(src)),
  slot('C', 'cast', (b, src) => b.cast(src)),

  // ─── Expanding / contracting ───────────────────────────────────────────────
  v('z', 'drop last', b => b.dropLast()),
  v('A', 'add one', b => b.addOne()),
  v('a', 'add one in scale', b => b.addOneInScale()),
  v('9', 'rotate notes <<', b => b.rotate(-1), 'rotate <<'),
  v('0', 'rotate notes >>', b => b.rotate(1), 'rotate >>'),

  // ─── Patterning ────────────────────────────────────────────────────────────
  v('u', 'stutter', b => b.stutter()),
  v('U', 'sputter', b => b.sputter()),
  v('Y', 'spray', b => b.spray()),
  v('R', 'mirror', b => b.mirror()),
  v('d', 'braid', b => b.braid()),
  v('D', 'pyramid', b => b.pyramid()),
  v('o', 'sort pitches up', b => b.sortNotes()),
  v('O', 'sort pitches down', b => b.sortNotes(true)),

  // ─── Pitch ─────────────────────────────────────────────────────────────────
  v('e', 'shear: some an octave outward', b => b.shear(), 'shear'),
  v('E', 'center range', b => b.compass(48, 72), 'compass 48-72'),
  v('i', 'invert', b => b.invert()),
  v('I', 'invert around mean', b => b.invertMean(), 'invertMean'),
  v('1', 'down semitone', b => b.transpose(-1), 'transpose -1'),
  v('2', 'up semitone', b => b.transpose(1), 'transpose +1'),
  v('!', 'down octave', b => b.transpose(-12), 'transpose -12'),
  v('@', 'up octave', b => b.transpose(12), 'transpose +12'),
  v('3', 'down step', b => b.dTranspose(-1), 'dTranspose -1'),
  v('4', 'up step', b => b.dTranspose(1), 'dTranspose +1'),
  v('#', 'breeze: some notes a step down', b => b.breeze(-1), 'breeze -1'),
  v('$', 'breeze: some notes a step up', b => b.breeze(1), 'breeze +1'),
  v('(', 'pivot (highest)', b => b.pivot(), 'pivot'),
  v(')', 'pivot (loudest)', b => b.pivotLoudest(), 'pivotLoudest'),
  {
    key: ['[', ']'], label: 'step the scale flatward / sharpward',
    act: c => {
      const name = c.ch === ']' ? 'sharpward' : 'flatward';
      const moved = c.b.fifthsward(c.ch === ']' ? 1 : -1);
      if (moved) { c.status(`${name}: ${moved}`); c.refresh(name); }
      else c.status(`no ${name} step from here`);
    },
  },
  v('w', 'draw curves (diatonic)', b => b.drawCurvesD(b.notes.length * 2), 'drawCurvesD'),
  v('W', 'remove doubles', b => b.removeDoubles()),

  // ─── Chords ────────────────────────────────────────────────────────────────
  v(';', 'clump chords', b => b.chordsRandShorten(), 'chordsRand'),
  v(':', 'flatten chords', b => b.flattenChords(), 'flattenChords'),

  // ─── Scale ─────────────────────────────────────────────────────────────────
  v('k', 'choose nearest scale', b => b.chooseScale(), 'chooseScale'),
  v('K', 'slant scale', b => b.slantScale(), 'slantScale'),
  slot('j', 'lift scale', (b, src) => b.applyScale(src.scale)),
  v('J', 'reduce scale', b => b.reduceScale(), 'reduceScale'),

  // ─── Figures and intervals ─────────────────────────────────────────────────
  // What a note plays instead of itself (b is figures mode; B clears them), and
  // the notes added at playback (5 is intervals mode); the notes themselves are untouched
  {
    key: 'B', label: 'clear the figures',
    act: c => { const had = c.b.hasFigures(); c.b.figures = [0]; const msg = had ? 'figures cleared' : 'no figures to clear'; c.status(msg); c.refresh(msg); },
  },
  intervalKey('6', 'widen intervals', b => (b.hasIntervals() ? b.incrementIntervals(1) : (b.startIntervals(), 'intervals: a fifth below every 4th note'))),
  intervalKey('^', 'narrow intervals', b => b.incrementIntervals(-1)),
  intervalKey('7', 'intervals sparser', b => b.spaceIntervals(true)),
  intervalKey('&', 'intervals denser', b => b.spaceIntervals(false)),
  { key: '8', label: 'reset intervals', act: c => { c.b.resetIntervals(); c.status('reset intervals'); c.refresh('reset intervals'); } },
  {
    key: '*', label: 'bake into the notes',
    act: c => {
      const b = c.b;
      const raga = b.bakeRaga();
      const ivs = b.hasIntervals();
      const figs = b.bakeFigures();   // the intervals go in with them
      b.bakeIntervals();
      const what = [raga && 'the raga', figs && 'the figures', ivs && 'the intervals'].filter(Boolean) as string[];
      const kept = b.hasFigures() ? ' (figures from the garden stay)' : '';
      const msg = what.length ? `bake ${what.join(' and ').replace(/ and (?=.* and )/, ', ')} into the notes${kept}` : `nothing to bake${kept}`;
      c.status(msg);
      c.refresh(msg);
    },
  },

  // ─── Playback ──────────────────────────────────────────────────────────────
  { code: 'Space', shift: false, whole: true, label: 'play', act: c => c.play(c.b, 'play') },
  {
    code: 'Space', shift: true, whole: true, label: 'play the garden slot',
    act: c => { const src = c.g.current; if (src) c.previewSlot(src); else c.status('nothing in slot'); },
  },
  {
    key: ',', whole: true, label: 'loop',
    act: c => {
      c.b.resolveFixed();
      if (!isLooping()) {
        startLooper(c.b, c.state.out!, (idx, tick) => c.state.viz?.activateNote(idx, tick), c.onLoopCycle);
      }
      updateLooper(c.b);
      c.status('looping');
    },
  },
  {
    code: 'Comma', alt: true, shift: false, whole: true, label: 'loop the garden',
    act: c => {
      if (!c.state.out) { c.status('No MIDI output'); return; }
      if (isGardenLooping()) { stopGardenLooper(); c.status('garden loop stopped'); }
      else { startGardenLooper(c.g.slots, c.state.out, idx => c.state.viz?.activateNote(idx)); c.status('loop garden'); }
    },
  },
  {
    // nothing more starts, what sounds ends in its own time; with nothing running, a panic: everything off now
    key: '.', whole: true, label: 'stop',
    act: c => {
      const wasActive = isLooping() || isPulsing() || isGardenLooping() || isGardenPulsing();
      stopLooper(); stopPulsar(); stopGardenLooper(); stopGardenPulsar();
      if (!wasActive) { c.state.cancelLastPlay?.(); c.state.cancelLastPlay = null; silence(c.state.out); }
      c.state.viz?.deactivateAll();
      c.status(wasActive ? 'stopped' : 'all notes off');
    },
  },
  {
    key: '/', whole: true, label: 'pulsar',
    act: c => {
      c.b.resolveFixed();
      if (!isPulsing()) startPulsar(c.b, c.state.out!, getPulsarRate(), (idx, tick) => c.state.viz?.activateNote(idx, tick));
      updatePulsar(c.b);
      c.status(`pulsar [${getPulsarRate()}b]`);
    },
  },
  {
    code: 'Slash', alt: true, shift: false, whole: true, label: 'pulse the garden',
    act: c => {
      if (!c.state.out) { c.status('No MIDI output'); return; }
      if (isGardenPulsing()) { stopGardenPulsar(); c.status('garden pulsar stopped'); }
      else { startGardenPulsar(c.g.slots, c.state.out, getPulsarRate(), idx => c.state.viz?.activateNote(idx)); c.status(`pulse garden [${getPulsarRate()}b]`); }
    },
  },
  { key: '<', whole: true, label: 'slower pulse', act: c => { const r = Math.max(1, getPulsarRate() - 1); setPulsarRate(r); c.status(`pulse rate ${r}b`); } },
  { key: '>', whole: true, label: 'faster pulse', act: c => { const r = getPulsarRate() + 1; setPulsarRate(r); c.status(`pulse rate ${r}b`); } },
  {
    key: '~', whole: true, label: 'sustain pedal',
    act: c => {
      if (!c.state.out) { c.status('No MIDI output'); return; }
      c.state.pedalDown = !c.state.pedalDown;
      for (let ch = 0; ch <= Bloom.maxChan; ch++) controlChange(c.state.out, ch, 64, c.state.pedalDown ? 127 : 0);
      c.status(c.state.pedalDown ? 'pedal ▼' : 'pedal ▲');
    },
  },

  // ─── Garden ────────────────────────────────────────────────────────────────
  { code: 'ArrowDown', shift: false, whole: true, label: 'save into the slot', act: c => saveSlot(c, false) },
  { code: 'ArrowDown', alt: true, shift: false, whole: true, label: 'insert before the slot', act: c => saveSlot(c, true) },
  {
    code: 'ArrowDown', shift: true, whole: true, label: 'insert an empty slot',
    act: c => { c.g.insertEmpty(); c.status(`inserted slot [${c.g.index}]`); c.refresh(`inserted [${c.g.index}]`); },
  },
  {
    code: 'ArrowUp', whole: true, label: 'lift the slot into the bloom',
    act: c => {
      const lifted = c.g.lift();
      if (!lifted) { c.status('nothing here'); return; }
      c.state.gardenViz?.animateRestore(lifted, document.getElementById('bloom-canvas') as HTMLCanvasElement);
      c.b.import(lifted);
      if (isLooping()) updateLooper(c.b);
      if (isPulsing()) updatePulsar(c.b);
      c.clearPins(false);   // the pins and selection belonged to the bloom that was replaced (undo brings them back)
      c.clearSelection();
      c.status(`lifted [${c.g.index}]`);
      c.refresh(`lifted [${c.g.index}]`, false);
    },
  },
  {
    code: 'ArrowLeft', whole: true, label: 'previous slot (shift: and play it)',
    act: c => {
      if (c.g.cursor > 0) c.state.gardenViz?.animateSlide('left');
      const had = c.g.back();
      if (c.shift && had) c.play(c.g.current!, `play [${c.g.index}]`);
      else c.refresh(`[${c.g.index}]`);
    },
  },
  {
    code: 'ArrowRight', whole: true, label: 'next slot (shift: and play it)',
    act: c => {
      c.state.gardenViz?.animateSlide('right');
      c.g.forward();
      if (c.shift && c.g.current) c.play(c.g.current, `play [${c.g.index}]`);
      else c.refresh(`[${c.g.index}]`);
    },
  },
  { code: 'Enter', whole: true, label: 'a new slot at the end', act: c => { c.g.jumpToEnd(); c.status(`new entry [${c.g.index}]`); } },
  { code: ['Backspace', 'Delete'], whole: true, name: 'del', label: 'delete the slot', act: c => { c.g.clear(); c.refresh(`deleted [${c.g.index}]`); } },

  // ─── View ──────────────────────────────────────────────────────────────────
  {
    code: 'Backslash', shift: true, whole: true, name: '|', label: 'note labels',
    act: c => {
      const next = c.state.viz?.toggleNoteLabels() ?? false;
      const cb = document.getElementById('show-note-labels') as HTMLInputElement | null;
      if (cb) cb.checked = next;
      c.status(next ? 'labels on' : 'labels off');
    },
  },
  {
    code: 'Backslash', alt: true, shift: false, whole: true, label: 'lanes',
    act: c => {
      const on = c.state.viz?.toggleLanes() ?? false;
      try { localStorage.setItem('bloom.lanes', on ? '1' : '0'); } catch { /* private window */ }
      c.status(on ? 'lanes on' : 'lanes off');
    },
  },
  { code: 'Backslash', shift: false, whole: true, label: 'console', act: c => c.state.consoleToggleFn?.() },
  { key: '?', whole: true, label: 'all the keys', act: c => c.state.fullHelpToggleFn?.() },
  {
    // esc: clean view off; else clear what's marked (shift: invert it), the selection if there is one, otherwise the pins (the help, when open, closes first); else close the help, clear and show the console
    code: 'Escape', whole: true, name: 'esc', label: 'leave: clean view, the selection or pins, the help',
    act: c => {
      if (document.body.classList.contains('clean')) { c.setClean(false); return; }
      const helpOpen = document.getElementById('help-full')?.style.display === 'block';
      const sel = c.selection(), pins = c.pins();
      if (!helpOpen && (sel.length || pins.size || c.shift)) {
        if (sel.length) {
          if (c.shift) {
            const chosen = new Set(sel);
            c.select(Array.from({ length: c.b.notes.length }, (_, i) => i).filter(i => !chosen.has(i)));
          } else c.clearSelection();
        } else if (c.shift) c.invertPins();
        else {
          const n = pins.size;
          c.clearPins();
          c.status(`${n} event${n === 1 ? '' : 's'} unpinned`);
        }
        return;
      }
      c.state.fullHelpCloseFn?.();
      c.state.consoleClearFn?.();
      c.state.consoleShowFn?.();
    },
  },
];

/** ↓ saves over the slot; opt-↓ inserts before it */
function saveSlot(c: HomeCtx, insert: boolean): void {
  if (insert) c.g.insert(c.b); else c.g.save(c.b);
  // the garden is shown before the animation measures it (it may have been hidden until the first save)
  c.state.gardenViz?.update(c.state.garden);
  c.state.gardenViz?.animateSave(c.b, document.getElementById('bloom-canvas') as HTMLCanvasElement);
  const verb = insert ? 'inserted' : 'saved';
  c.status(`${verb} [${c.g.index}]`);
  c.refresh(`${verb} [${c.g.index}]`);
}

/** An interval key says what the intervals now are, by name, unless the verb says something itself */
function intervalKey(key: string, label: string, fn: (b: Bloom) => unknown): HomeKey {
  return {
    key, label,
    act: c => {
      const said = fn(c.b);
      const msg = typeof said === 'string' ? said : `${label}: ${formatIntervals(c.b.intervals)}`;
      c.status(msg);
      c.refresh(msg);
    },
  };
}

const asList = (x: string | string[] | undefined): string[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** Does this key match what was pressed? */
export function matches(k: HomeKey, e: KeyboardEvent, ch = keyChar(e)): boolean {
  if (!!k.alt !== e.altKey) return false;
  if (k.shift !== undefined && k.shift !== e.shiftKey) return false;
  if (k.code !== undefined) return asList(k.code).includes(e.code);
  return asList(k.key).includes(ch);
}

/** The first home key for what was pressed, if any */
export function findHome(e: KeyboardEvent, ch = keyChar(e)): HomeKey | undefined {
  return HOME_KEYS.find(k => matches(k, e, ch));
}

const GLYPH: Record<string, string> = {
  ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Backspace: 'del', Delete: 'del',
  Escape: 'esc', Space: 'space', Comma: ',', Slash: '/', Backslash: '\\', Backquote: '`',
};

/** The names the docs give a key's variants: 's', 'opt-↓', 'shift-space' … (`name` wins when set) */
export function keyNames(k: HomeKey): string[] {
  if (k.name) return [k.name];
  const base = k.code !== undefined
    ? asList(k.code).map(code => GLYPH[code] ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code))
    : asList(k.key);
  const mod = `${k.alt ? 'opt-' : ''}${k.shift && k.code !== undefined ? 'shift-' : ''}`;
  return base.map(b => `${mod}${b}`);
}
