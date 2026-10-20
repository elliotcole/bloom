// Full keyboard handler — mirrors bloom keystroke controller.scd

import { Bloom } from '../core/Bloom';
import type { ListKey, ListVerb, PatternOp } from '../core/Bloom';
import { Garden } from '../garden';
import type { MidiOutput } from '../audio/midi';
import {
  playOnce, startLooper, stopLooper, isLooping, updateLooper,
  startPulsar, stopPulsar, isPulsing, updatePulsar,
  setPulsarRate, getPulsarRate, beatsToMs,
  startGardenLooper, stopGardenLooper, isGardenLooping,
  startGardenPulsar, stopGardenPulsar, isGardenPulsing,
} from '../audio/scheduler';
import { controlChange } from '../audio/midi';
import { startRecording, stopRecording, isRecording } from '../audio/recorder';
import { autosaveGarden } from '../io/garden-io';
import { BloomVisualization } from './visualization';
import { GardenVisualization } from './gardenVisualization';
import { Display } from './display';
import type { VizMode } from './theme';

// ─── Quantize cycle ───────────────────────────────────────────────────────────

const QUANTIZE_OPTIONS = [4, 3, 2, 1, 8, 7, 6, 5];
let _quantizeIdx = 4; // starts at 8
function currentQuantize(): number { return QUANTIZE_OPTIONS[_quantizeIdx]; }
function nextQuantize(): number {
  _quantizeIdx = (_quantizeIdx + 1) % QUANTIZE_OPTIONS.length;
  return currentQuantize();
}

// ─── List modes ───────────────────────────────────────────────────────────────

type ListMode = 'time' | 'vel' | 'chan';

const MODE_KEYS: Record<string, ListMode> = { t: 'time', v: 'vel', c: 'chan' };
const MODE_TAG: Record<ListMode, string> = { time: 'T', vel: 'V', chan: 'CH' };
const MODE_NAME: Record<ListMode, string> = { time: 'time', vel: 'velocity', chan: 'channel' };
const LIST_OF_MODE: Record<ListMode, ListKey> = { time: 'time', vel: 'vel', chan: 'chan' };

/** One key, one verb, in every list mode. `labels` names what the verb does to a particular list. */
type ListAction = { label: string; labels?: Partial<Record<ListMode, string>> } &
  ({ pattern: PatternOp } | { verb: ListVerb });

const LIST_KEYS: Record<string, ListAction> = {
  // order and length
  s: { pattern: 'scramble', label: 'scramble' },
  S: { pattern: 'shuffle', label: 'shuffle' },
  R: { pattern: 'mirror', label: 'mirror' },
  '9': { pattern: 'rotate<', label: 'rotate <<' },
  '0': { pattern: 'rotate>', label: 'rotate >>' },
  u: { pattern: 'stutter', label: 'stutter' },
  U: { pattern: 'sputter', label: 'sputter' },
  d: { pattern: 'braid', label: 'braid' },
  D: { pattern: 'pyramid', label: 'pyramid' },
  o: { verb: 'sortUp', label: 'sort up', labels: { time: 'sort short → long', vel: 'crescendo' } },
  O: { verb: 'sortDown', label: 'sort down', labels: { time: 'sort long → short', vel: 'decrescendo' } },
  z: { verb: 'dropLast', label: 'drop last' },
  a: { verb: 'addFromPalette', label: 'add one (palette)' },
  A: { verb: 'addRandom', label: 'add one (any)' },
  // values
  '1': { verb: 'nudgeDown', label: 'down', labels: { time: 'faster', vel: 'softer', chan: 'shift −1' } },
  '2': { verb: 'nudgeUp', label: 'up', labels: { time: 'slower', vel: 'louder', chan: 'shift +1' } },
  '!': { verb: 'octaveDown', label: 'octave down', labels: { time: 'double time', vel: 'much softer' } },
  '@': { verb: 'octaveUp', label: 'octave up', labels: { time: 'half time', vel: 'much louder' } },
  '3': { verb: 'stepDown', label: 'palette step down' },
  '4': { verb: 'stepUp', label: 'palette step up' },
  '#': { verb: 'breezeDown', label: 'breeze: some a step down' },
  '$': { verb: 'breezeUp', label: 'breeze: some a step up' },
  '-': { verb: 'converge', label: 'converge', labels: { time: 'evener', vel: 'flatter dynamics' } },
  '=': { verb: 'diverge', label: 'diverge', labels: { time: 'more uneven', vel: 'wider dynamics' } },
  '+': { verb: 'diverge', label: 'diverge', labels: { time: 'more uneven', vel: 'wider dynamics' } },
  y: { verb: 'unify', label: 'unify' },
  i: { verb: 'invert', label: 'invert', labels: { time: 'invert long ↔ short', vel: 'invert loud ↔ quiet' } },
  I: { verb: 'invertMid', label: 'invert around middle' },
  e: { verb: 'shear', label: 'shear', labels: { time: 'accel / rit', vel: 'dynamic ramp' } },
  w: { verb: 'curve', label: 'curve', labels: { time: 'rubato curve', vel: 'hairpins' } },
  // vocabulary
  m: { verb: 'mutate', label: 'mutate (palette)' },
  M: { verb: 'mutateWild', label: 'mutate (wild)' },
  h: { verb: 'fewer', label: 'fewer distinct values' },
  H: { verb: 'more', label: 'more distinct values' },
  n: { verb: 'renew', label: 'new list' },
};

function own<T extends object>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ─── Freeze menu ──────────────────────────────────────────────────────────────

interface FreezeItem { key: string; alias?: string; name: string; selector: string }

/** F, then one of these. Keys match the list modes where there is one (t, v, c). */
const FREEZE_ITEMS: FreezeItem[] = [
  { key: 'p', name: 'pitch', selector: '.freeze-palette[data-list="pitch"]' },
  { key: 't', alias: 'r', name: 'rhythm', selector: '.freeze-palette[data-list="time"]' },
  { key: 'v', name: 'dynamics', selector: '.freeze-palette[data-list="vel"]' },
  { key: 'c', name: 'channels', selector: '.freeze-palette[data-list="chan"]' },
  { key: 'd', name: 'duration', selector: '#fixed-dur-enabled' },
  { key: 'g', name: 'grid', selector: '#fixed-grid-enabled' },
];

// ─── Pitches only (opt + an order key at home) ────────────────────────────────

const PITCH_ONLY: Record<string, [PatternOp, PatternOp]> = {
  // e.code: [plain, shift]
  KeyS: ['scramble', 'shuffle'],
  KeyR: ['mirror', 'mirror'],
  KeyU: ['stutter', 'sputter'],
  KeyD: ['braid', 'pyramid'],
};

// ─── App state ────────────────────────────────────────────────────────────────

export interface KeyHandlerState {
  bloom: Bloom;
  garden: Garden;
  out: MidiOutput | null;
  viz: BloomVisualization | null;
  gardenViz: GardenVisualization | null;
  display: Display | null;
  cancelLastPlay: (() => void) | null;
  fullHelpToggleFn: (() => void) | null;
  fullHelpCloseFn: (() => void) | null;
  consoleToggleFn: (() => void) | null;
  consoleShowFn: (() => void) | null;
  consoleClearFn: (() => void) | null;
  pedalDown: boolean;
  recordDotEl: HTMLElement | null;
  editorOpenFn: (() => void) | null;
  paletteOpenFn: (() => void) | null;
  /** Called when opt+1–9 changes the visualization mode. */
  setVizModeFn: ((mode: VizMode) => void) | null;
}

export function createKeyHandler(state: KeyHandlerState) {
  let _previewResetId: ReturnType<typeof setTimeout> | null = null;
  /** Temporary bloom used for loop-cycle display; reused across cycles to avoid allocation */
  let _loopDisplayBloom: Bloom | null = null;

  function setClean(on: boolean) {
    document.body.classList.toggle('clean', on);
    state.viz?.setClean(on);
    if (!on) status('clean view off');
  }

  function refresh(msg = '') {
    // Cancel any in-progress garden preview
    if (_previewResetId !== null) { clearTimeout(_previewResetId); _previewResetId = null; }
    // While a loop or the pulsar runs, every change passes through the freezes,
    // just as space-play does — the loop never hears an unfrozen bloom
    if (isLooping() || isPulsing()) state.bloom.resolveFixed();
    if (state.viz) state.viz.setBloom(state.bloom);
    if (state.gardenViz) state.gardenViz.update(state.garden);
    if (state.display) state.display.update(state.bloom, state.garden, msg);
    updateLooper(state.bloom);
    updatePulsar(state.bloom);
    autosaveGarden(state.bloom, state.garden);
  }

  function play(bloom: Bloom, msg?: string) {
    if (!state.out) { refresh('No MIDI output'); return; }
    state.cancelLastPlay?.();
    bloom.resolveFixed();
    const onNoteOn = (idx: number, tick: number) => state.viz?.activateNote(idx, tick);
    const cancel = playOnce(bloom, state.out, undefined, undefined, onNoteOn);
    state.cancelLastPlay = cancel;
    refresh(msg ?? '');
  }

  function status(msg: string) {
    if (state.display) state.display.setStatus(msg);
  }

  // ─── List modes ─────────────────────────────────────────────────────────────
  // t, v and c enter time, velocity and channel mode. Each key means the same
  // verb in every mode, applied to that list alone. The mode's own key or esc
  // goes back home; the other mode keys switch straight across. Playback, garden,
  // view and push/pop pass through. Never persisted — always starts at home.
  let _mode: ListMode | null = null;

  function setListMode(m: ListMode | null) {
    _mode = m;
    state.viz?.setChanStrip(m === 'chan');
    state.viz?.setListMode(m);
    document.body.classList.toggle('list-mode', m !== null);   // swaps the help overlay view
    const badge = document.getElementById('list-mode-badge');
    if (badge) {
      badge.textContent = m ? MODE_TAG[m] : '';
      badge.classList.toggle('active', m !== null);
    }
    const name = document.getElementById('hf-list-mode-name');
    if (name) name.textContent = m ? MODE_NAME[m] : '';
  }

  // ─── Freeze menu ────────────────────────────────────────────────────────────
  // F opens it; the next key toggles one freeze and closes it. The settings bar
  // checkboxes are the source of truth, so mouse and keys stay in step.
  let _freezeMenu = false;

  function freezeBox(f: FreezeItem): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(f.selector);
  }

  function isFrozen(f: FreezeItem): boolean {
    return freezeBox(f)?.checked ?? false;
  }

  /** Show what's frozen in the header, e.g. ❄ p t g */
  function updateFreezeBadge() {
    const badge = document.getElementById('freeze-badge');
    if (!badge) return;
    const on = FREEZE_ITEMS.filter(isFrozen).map(f => f.key === 'd' ? `d:${durMode() === 'scale' ? 'stretch' : 'trim'}` : f.key);
    // in the menu: F, then what's frozen so far (or a ? when nothing is)
    badge.textContent = _freezeMenu ? `F ❄ ${on.length ? on.join(' ') : '?'}` : on.length ? `❄ ${on.join(' ')}` : '';
    badge.classList.toggle('active', on.length > 0);
    badge.classList.toggle('menu', _freezeMenu);
  }

  function setFreezeMenu(open: boolean) {
    _freezeMenu = open;
    updateFreezeBadge();
    status(open
      ? `freeze: ${FREEZE_ITEMS.map(f => `${f.key} ${f.name}${isFrozen(f) ? ' ❄' : ''}`).join(' · ')}  (F or esc closes)`
      : 'freeze menu closed');
  }

  /**
   * The freeze menu is sticky, like the list modes: each key toggles its
   * freeze and the menu stays open until F or esc. Playback, garden, view and
   * opt keys pass through (returns false); anything else is held with a hint.
   */
  function onFreezeKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' || (e.key === 'F' && !e.altKey)) { setFreezeMenu(false); return true; }
    if (e.altKey || e.metaKey || e.ctrlKey) return false;
    const f = FREEZE_ITEMS.find(item => item.key === e.key || item.alias === e.key);
    if (!f) {
      const PASS = new Set([' ', ',', '.', '/', '<', '>', '~', '|', '`', 'p', 'P', 'l', 'L', '\\', '?']);
      if (PASS.has(e.key)) return false;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Delete'].includes(e.code)) return false;
      status(`[freeze] nothing on ${e.key}: ${FREEZE_ITEMS.map(i => i.key).join(' ')}, F or esc closes`);
      return true;
    }
    const box = freezeBox(f);
    if (!box) return true;
    if (f.key === 'd') { cycleDuration(box); return true; }
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));   // main.ts applies it, as for a click
    updateFreezeBadge();
    refresh(`${f.name} ${box.checked ? 'frozen' : 'unfrozen'}`);
    status(`${f.name} ${box.checked ? 'frozen ❄' : 'unfrozen'}`);
    return true;
  }

  function durMode(): string {
    return (document.getElementById('fixed-dur-mode') as HTMLSelectElement | null)?.value ?? 'trim';
  }

  /** F d cycles: off → trim to duration → stretch to duration → off */
  function cycleDuration(box: HTMLInputElement) {
    const sel = document.getElementById('fixed-dur-mode') as HTMLSelectElement | null;
    const setMode = (m: 'trim' | 'scale') => {
      if (sel) { sel.value = m; sel.dispatchEvent(new Event('change')); }
    };
    let msg: string;
    if (!box.checked) {
      setMode('trim');
      box.checked = true; box.dispatchEvent(new Event('change'));
      msg = 'duration frozen ❄ trim to duration';
    } else if (durMode() === 'trim') {
      setMode('scale');
      msg = 'duration frozen ❄ stretch to duration';
    } else {
      box.checked = false; box.dispatchEvent(new Event('change'));
      msg = 'duration unfrozen';
    }
    updateFreezeBadge();
    refresh(msg);
    status(msg);
  }

  // Clicks in the settings bar update the badge too
  document.querySelectorAll('.freeze-palette, #fixed-dur-enabled, #fixed-dur-mode, #fixed-grid-enabled')
    .forEach(el => el.addEventListener('change', updateFreezeBadge));

  /** Handle a key in a list mode. Returns true if the key was consumed. */
  function onListKey(e: KeyboardEvent, m: ListMode): boolean {
    if (e.altKey) return false;   // all opt combos keep their home meaning
    const ch = e.key;
    const b = state.bloom;
    const g = state.garden;
    const tag = `[${MODE_TAG[m].toLowerCase()}]`;

    if (e.code === 'Escape') {
      setListMode(null);
      status(`${MODE_NAME[m]} mode off`);
      return true;
    }

    const PASS = new Set([' ', ',', '.', '/', '<', '>', '~', '|', '`', 'p', 'P', 'l', 'L', '\\', '?', 'F']);
    if (PASS.has(ch)) return false;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Delete'].includes(e.code)) {
      return false;
    }

    const apply = (msg: string, fn: () => void) => {
      status(`${tag} ${msg}`);
      fn();
      refresh(`${tag} ${msg}`);
    };

    if (ch === 'q') {
      const q = currentQuantize();
      apply(m === 'time' ? `quantize [1/${q}]` : `≤ ${q} levels`, () => b.shapeList(m, 'quantize', q));
      return true;
    }
    if (ch === 'Q') {
      const q = nextQuantize();
      status(`${tag} (q to apply) ${m === 'time' ? `quantize [1/${q}]` : `≤ ${q} levels`}`);
      return true;
    }
    if (ch === 'x' || ch === 'f') {
      const src = g.current;
      if (!src) { status('no bloom in slot'); return true; }
      const k = LIST_OF_MODE[m];
      if (ch === 'x') apply('lace with slot', () => b.laceList(k, src));
      else apply('copy from slot', () => b.copyList(k, src));
      return true;
    }

    const action = own(LIST_KEYS, ch) ? LIST_KEYS[ch] : undefined;
    if (action) {
      const label = action.labels?.[m] ?? action.label;
      if ('pattern' in action) {
        apply(label, () => b.patternList(LIST_OF_MODE[m], action.pattern));
      } else if (b.shapeList(m, action.verb)) {
        refresh(`${tag} ${label}`);
        status(`${tag} ${label}`);
      } else {
        status(`${tag} no ${MODE_NAME[m]} version of ${label}`);
      }
      return true;
    }

    // Everything else is consumed with a hint, so home-mode muscle memory
    // can't accidentally change the notes while sculpting one list
    status(`${tag} no ${MODE_NAME[m]} version — ${m === 'time' ? 't' : m === 'vel' ? 'v' : 'c'} or esc goes home`);
    return true;
  }

  function onKey(e: KeyboardEvent): void {
    // Ignore if modifier keys other than shift/option are active (e.g. Ctrl+R)
    if (e.ctrlKey || e.metaKey) return;
    // A modifier pressed on its own is only the start of a chord (shift for F)
    if (['Shift', 'Alt', 'Meta', 'Control', 'CapsLock'].includes(e.key)) return;

    const ch = e.key;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const b = state.bloom;
    const g = state.garden;

    // ─── Freeze menu: F, then the key for what to freeze ──────────────────────
    if (_freezeMenu && onFreezeKey(e)) return;
    if (ch === 'F' && !alt && !_freezeMenu) {
      setFreezeMenu(true);
      return;
    }

    // ─── List mode toggle + dispatch ──────────────────────────────────────────
    if (!alt && own(MODE_KEYS, ch)) {
      const m = MODE_KEYS[ch];
      setListMode(_mode === m ? null : m);
      if (_mode === 'chan' && Bloom.maxChan === 0) {
        status('channel mode — maxChan is 0, raise it in settings to hear channels');
      } else {
        status(_mode ? `${MODE_NAME[m]} mode (${ch} or esc goes home)` : `${MODE_NAME[m]} mode off`);
      }
      return;
    }
    if (_mode && onListKey(e, _mode)) return;

    // ─── Visualization mode  (opt+1 … opt+9) ─────────────────────────────────
    if (alt && !shift && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);   // 'Digit3' → 3
      if (n >= 1 && n <= 9) {
        e.preventDefault();
        const VIZ_ORDER: VizMode[] = [
          'deep', 'field', 'orbit', 'score',
          'tonal', 'set', 'spiral', 'helix', 'flower',
        ];
        const mode = VIZ_ORDER[n - 1];
        state.setVizModeFn?.(mode);
        status(`view: ${mode}`);
        return;
      }
    }

    // ─── Clean view (opt+c): the picture alone, for recording ────────────────
    if (alt && !shift && e.code === 'KeyC') {
      e.preventDefault();
      setClean(!document.body.classList.contains('clean'));
      return;
    }

    // ─── Editor / Palette ─────────────────────────────────────────────────────
    if (alt && e.code === 'KeyE') {
      e.preventDefault();
      state.editorOpenFn?.();
      return;
    }

    // ─── Pitches only: opt + an order key ─────────────────────────────────────
    // At home the order keys move whole notes; with opt they move only the
    // pitches over the rhythm, dynamics and channels that stay put
    if (alt && own(PITCH_ONLY, e.code)) {
      e.preventDefault();
      const op = PITCH_ONLY[e.code][shift ? 1 : 0];
      status(`${op} pitches`);
      b.patternList('notes', op);
      refresh(`${op} pitches`);
      return;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────
    if (ch === 'n' && !shift && !alt) {
      status('new bloom');
      b.import(new Bloom().seed());
      refresh('new bloom');
      return;
    }
    if (ch === 'N' && shift) {
      status('new bloom (same scale)');
      const scale = b.scale;
      b.import(new Bloom().seed().applyScale(scale));
      refresh('new bloom (same scale)');
      return;
    }
    if (ch === 'B' && shift) {
      status('new bloom, same scale + shape');
      const scale = b.scale;
      const times = [...b.timeIntervals];
      const vels = [...b.velocities];
      const chans = [...b.chans];
      b.import(new Bloom().seed(times.length).applyScale(scale));
      b.timeIntervals = times;
      b.velocities = vels;
      b.chans = chans;
      refresh('new bloom, same scale + shape');
      return;
    }
    if (ch === 'b' && !alt) {
      status('new bloom shape');
      b.newShape();
      refresh('new bloom shape');
      return;
    }
    if (ch === 'p' && !shift) {
      status('push');
      b.push();
      refresh('push');
      return;
    }
    if (ch === 'P' && shift) {
      status('pop');
      b.pop();
      refresh('pop');
      return;
    }
    if (ch === '`') {
      if (isRecording()) {
        stopRecording(b);
        if (state.recordDotEl) state.recordDotEl.classList.remove('active');
        refresh('recorded');
      } else {
        startRecording();
        if (state.recordDotEl) state.recordDotEl.classList.add('active');
        status('recording… (` to stop)');
      }
      return;
    }

    // ─── Shaping ─────────────────────────────────────────────────────────────
    if (ch === 'm' && !shift) {
      status('mutate notes (diatonic)');
      b.mutateNotesD();
      refresh('mutateD');
      return;
    }
    if (ch === 'M' && shift) {
      status('mutate notes');
      b.mutateNotes();
      refresh('mutate');
      return;
    }
    if (ch === 's' && !shift) {
      status('scramble');
      b.scramble();
      refresh('scramble');
      return;
    }
    if (ch === 'S' && shift) {
      status('shuffle');
      b.shuffle();
      refresh('shuffle');
      return;
    }
    if (ch === 'H' && shift) {
      status('thicken');
      b.thicken(0.3);
      refresh('thicken');
      return;
    }
    if (ch === 'h' && !shift) {
      status('thin');
      b.thin();
      refresh('thin');
      return;
    }
    if (ch === 'g' && !shift) {
      status('gap');
      b.gap();
      refresh('gap');
      return;
    }
    if (ch === 'G' && shift) {
      status('unGap');
      b.unGap();
      refresh('unGap');
      return;
    }
    // ─── Gestures (whole bloom) ───────────────────────────────────────────────
    if (ch === '-') {
      status('calm');
      b.calm();
      refresh('calm');
      return;
    }
    if (ch === '=' || ch === '+') {
      status('intensify');
      b.intensify();
      refresh('intensify');
      return;
    }
    if (ch === "'") {
      status('vary');
      b.vary();
      refresh('vary');
      return;
    }
    if (ch === '{') {
      status('merge two notes');
      b.mergeNote();
      refresh('merge');
      return;
    }
    if (ch === '}') {
      status('split a note');
      b.splitNote();
      refresh('split');
      return;
    }

    // ─── Blending ─────────────────────────────────────────────────────────────
    if (ch === 'x' && !shift) {
      status('interlace');
      const src = g.current;
      if (src) { b.interlace(src); refresh('interlace'); }
      else state.display?.setStatus('no bloom in slot');
      return;
    }
    if (ch === 'X' && shift) {
      status('blend');
      const src = g.current;
      if (src) { b.blend(src); refresh('blend'); }
      else state.display?.setStatus('no bloom in slot');
      return;
    }
    if (ch === 'f' && !shift) {
      status('lift shape');
      const src = g.current;
      if (src) { b.applyShape(src); refresh('lift shape'); }
      else state.display?.setStatus('no bloom in slot');
      return;
    }
    if (ch === 'C' && shift) {
      status('cast');
      const src = g.current;
      if (src) { b.cast(src); refresh('cast'); }
      else state.display?.setStatus('no bloom in slot');
      return;
    }

    // ─── Expanding/contracting ────────────────────────────────────────────────
    if (ch === 'z' && !shift) {
      status('drop last');
      b.dropLast();
      refresh('drop last');
      return;
    }
    if (ch === 'A' && shift) {
      status('add one');
      b.addOne();
      refresh('add one');
      return;
    }
    if (ch === 'a' && !shift) {
      status('add one in scale');
      b.addOneInScale();
      refresh('add one in scale');
      return;
    }
    if (ch === '9') {
      status('rotate notes <<');
      b.rotate(-1);
      refresh('rotate <<');
      return;
    }
    if (ch === '(') {
      status('rotate pitches <<');
      b.rotateNotes(-1);
      refresh('rotate pitches <<');
      return;
    }
    if (ch === '0') {
      status('rotate notes >>');
      b.rotate(1);
      refresh('rotate >>');
      return;
    }
    if (ch === ')') {
      status('rotate pitches >>');
      b.rotateNotes(1);
      refresh('rotate pitches >>');
      return;
    }

    // ─── Patterning ───────────────────────────────────────────────────────────
    if (ch === 'u' && !shift) {
      status('stutter');
      b.stutter();
      refresh('stutter');
      return;
    }
    if (ch === 'U' && shift) {
      status('sputter');
      b.sputter();
      refresh('sputter');
      return;
    }
    if (ch === 'Y' && shift) {
      status('spray');
      b.spray();
      refresh('spray');
      return;
    }
    if (ch === 'r' && !shift) {
      status('ratchet');
      b.ratchet();
      refresh('ratchet');
      return;
    }
    if (ch === 'R' && shift) {
      status('mirror');
      b.mirror();
      refresh('mirror');
      return;
    }
    if (ch === 'd' && !shift) {
      status('braid');
      b.braid();
      refresh('braid');
      return;
    }
    if (ch === 'D' && shift) {
      status('pyramid');
      b.pyramid();
      refresh('pyramid');
      return;
    }
    if (ch === 'o') {
      status('sort pitches up');
      b.sortNotes();
      refresh('sort pitches up');
      return;
    }
    if (ch === 'O') {
      status('sort pitches down');
      b.sortNotes(true);
      refresh('sort pitches down');
      return;
    }

    // ─── Pitch ────────────────────────────────────────────────────────────────
    if (ch === 'e' && !shift) {
      status('shear');
      b.shear();
      refresh('shear');
      return;
    }
    if (ch === 'E' && shift) {
      status('center range');
      b.compass(48, 72);
      refresh('compass 48-72');
      return;
    }
    if (ch === 'i' && !shift) {
      status('invert');
      b.invert();
      refresh('invert');
      return;
    }
    if (ch === 'I' && shift) {
      status('invert around mean');
      b.invertMean();
      refresh('invertMean');
      return;
    }
    if (ch === '1' && !shift) {
      status('down semitone');
      b.transpose(-1);
      refresh('transpose -1');
      return;
    }
    if (ch === '2' && !shift) {
      status('up semitone');
      b.transpose(1);
      refresh('transpose +1');
      return;
    }
    if (ch === '!') {
      status('down octave');
      b.transpose(-12);
      refresh('transpose -12');
      return;
    }
    if (ch === '@') {
      status('up octave');
      b.transpose(12);
      refresh('transpose +12');
      return;
    }
    if (ch === '3' && !shift) {
      status('down step');
      b.dTranspose(-1);
      refresh('dTranspose -1');
      return;
    }
    if (ch === '4' && !shift) {
      status('up step');
      b.dTranspose(1);
      refresh('dTranspose +1');
      return;
    }
    if (ch === '#') {
      status('breeze: some notes a step down');
      b.breeze(-1);
      refresh('breeze -1');
      return;
    }
    if (ch === '$') {
      status('breeze: some notes a step up');
      b.breeze(1);
      refresh('breeze +1');
      return;
    }
    if (ch === '[') {
      status('pivot (highest)');
      b.pivot();
      refresh('pivot');
      return;
    }
    if (ch === ']') {
      status('pivot (loudest)');
      b.pivotLoudest();
      refresh('pivotLoudest');
      return;
    }
    if (ch === 'w' && !shift && !alt) {
      status('draw curves (diatonic)');
      b.drawCurvesD(b.notes.length * 2);
      refresh('drawCurvesD');
      return;
    }
    if (e.code === 'KeyW' && !shift && alt) {
      status('wheels within wheels');
      b.velocities = [100, ...Array(b.notes.length).fill(30)];  // N+1 vels for N notes → accent shifts each cycle
      refresh('wheels within wheels');
      return;
    }
    if (ch === 'W' && shift) {
      status('remove doubles');
      b.removeDoubles();
      refresh('remove doubles');
      return;
    }

    // ─── Chords ───────────────────────────────────────────────────────────────
    if (ch === ';') {
      status('clump chords');
      b.chordsRandShorten();
      refresh('chordsRand');
      return;
    }
    if (ch === ':') {
      status('flatten chords');
      b.flattenChords();
      refresh('flattenChords');
      return;
    }

    // ─── Diatonicism ──────────────────────────────────────────────────────────
    if (ch === 'k' && !shift) {
      status('choose nearest scale');
      b.chooseScale();
      refresh('chooseScale');
      return;
    }
    if (ch === 'K' && shift) {
      status('slant scale');
      b.slantScale();
      refresh('slantScale');
      return;
    }
    if (ch === 'j' && !shift) {
      status('lift scale');
      const src = g.current;
      if (src) { b.applyScale(src.scale); refresh('lift scale'); }
      else state.display?.setStatus('no bloom in slot');
      return;
    }
    if (ch === 'J' && shift) {
      status('reduce scale');
      b.reduceScale();
      refresh('reduceScale');
      return;
    }

    // ─── Intervals ────────────────────────────────────────────────────────────
    // Notes added at playback; the bloom's own notes are untouched
    if (!alt) {
      const intervalKeys: Record<string, [string, () => void]> = {
        '5': ['randomize intervals', () => b.randIntervals()],
        '6': ['widen intervals', () => b.incrementIntervals(1)],
        '^': ['narrow intervals', () => b.incrementIntervals(-1)],
        '7': ['add interval', () => b.addInterval()],
        '&': ['drop interval', () => b.dropInterval()],
        '8': ['reset intervals', () => b.resetIntervals()],
        '*': ['bake intervals into notes', () => b.bakeIntervals()],
        '%': ['intervals', () => b.toggleIntervalsDiatonic()],
      };
      const hit = intervalKeys[ch];
      if (hit) {
        hit[1]();
        const msg = ch === '%'
          ? `intervals in ${b.intervalsDiatonic ? 'scale steps' : 'semitones'}`
          : hit[0];
        status(msg);
        refresh(msg);
        return;
      }
    }

    // ─── Fission / Fusion ─────────────────────────────────────────────────────
    if (ch === '|' && !alt) {
      status('merge garden >> b');
      b.fromListOfBlooms(state.garden.slots);
      refresh('fromListOfBlooms');
      return;
    }
    if (e.code === 'Backslash' && shift && alt) {
      status('curdle b >> garden');
      const pieces = b.curdle(0.2);
      pieces.forEach((piece, i) => {
        g.slots.splice(g.cursor + 1 + i, 0, piece);
      });
      refresh('curdle');
      return;
    }

    // ─── Playback ─────────────────────────────────────────────────────────────
    if (ch === ' ' && !shift && !alt) {
      e.preventDefault();
      play(b, 'play');
      return;
    }
    if (ch === ' ' && shift) {
      e.preventDefault();
      const src = g.current;
      if (src) {
        // play() calls refresh() internally which resets viz to state.bloom,
        // so set the preview AFTER play() returns (JS is single-threaded).
        if (_previewResetId !== null) clearTimeout(_previewResetId);
        play(src, `play slot [${g.index}]`);
        state.viz?.setBloom(src, false);
        const durationMs = beatsToMs(src.timeIntervals.reduce((a, t) => a + t, 0));
        _previewResetId = setTimeout(() => {
          _previewResetId = null;
          state.viz?.setBloom(state.bloom);
        }, durationMs + 200);
      } else {
        status('nothing in slot');
      }
      return;
    }
    if (ch === ',' && !alt) {
      b.resolveFixed();
      if (!isLooping()) {
        startLooper(
          b,
          state.out!,
          (idx, tick) => state.viz?.activateNote(idx, tick),
          (vel, time, chan, intervals) => {
            // Reuse a single display bloom; import notes/scale from the live bloom each cycle
            if (!_loopDisplayBloom) _loopDisplayBloom = new Bloom();
            _loopDisplayBloom.import(state.bloom);
            _loopDisplayBloom.velocities    = vel;
            _loopDisplayBloom.timeIntervals = time;
            _loopDisplayBloom.chans         = chan;
            _loopDisplayBloom.intervals     = intervals;
            state.viz?.setBloom(_loopDisplayBloom, false);
          },
        );
      }
      updateLooper(b);
      status('looping');
      return;
    }
    if (e.code === 'Comma' && !shift && alt) {
      e.preventDefault();
      if (!state.out) { status('No MIDI output'); return; }
      if (isGardenLooping()) {
        stopGardenLooper();
        status('garden loop stopped');
      } else {
        startGardenLooper(g.slots, state.out, idx => state.viz?.activateNote(idx));
        status('loop garden');
      }
      return;
    }
    if (ch === '.') {
      const wasActive = isLooping() || isPulsing() || isGardenLooping() || isGardenPulsing();
      stopLooper(); stopPulsar(); stopGardenLooper(); stopGardenPulsar();
      state.viz?.deactivateAll();
      status(wasActive ? 'stopped' : 'stopped');
      return;
    }
    if (ch === '/' && !alt) {
      b.resolveFixed();
      if (!isPulsing()) startPulsar(b, state.out!, getPulsarRate(), (idx, tick) => state.viz?.activateNote(idx, tick));
      updatePulsar(b);
      status(`pulsar [${getPulsarRate()}b]`);
      return;
    }
    if (e.code === 'Slash' && !shift && alt) {
      e.preventDefault();
      if (!state.out) { status('No MIDI output'); return; }
      if (isGardenPulsing()) {
        stopGardenPulsar();
        status('garden pulsar stopped');
      } else {
        startGardenPulsar(g.slots, state.out, getPulsarRate(), idx => state.viz?.activateNote(idx));
        status(`pulse garden [${getPulsarRate()}b]`);
      }
      return;
    }
    if (ch === '<') {
      const r = Math.max(1, getPulsarRate() - 1);
      setPulsarRate(r);
      status(`pulse rate ${r}b`);
      return;
    }
    if (ch === '>') {
      const r = getPulsarRate() + 1;
      setPulsarRate(r);
      status(`pulse rate ${r}b`);
      return;
    }

    // ─── Sustain pedal ────────────────────────────────────────────────────────
    if (ch === '~') {
      if (!state.out) { status('No MIDI output'); return; }
      state.pedalDown = !state.pedalDown;
      const val = state.pedalDown ? 127 : 0;
      for (let c = 0; c <= Bloom.maxChan; c++) {
        controlChange(state.out, c, 64, val);
      }
      status(state.pedalDown ? 'pedal ▼' : 'pedal ▲');
      return;
    }

    // ─── Garden navigation ────────────────────────────────────────────────────
    if (e.code === 'ArrowDown' && !shift) {
      e.preventDefault();
      g.save(b);
      // Update garden visibility BEFORE animateSave so getBoundingClientRect()
      // returns real geometry (garden may have been hidden on first save).
      state.gardenViz?.update(state.garden);
      const mc = document.getElementById('bloom-canvas') as HTMLCanvasElement;
      state.gardenViz?.animateSave(b, mc);
      status(`saved [${g.index}]`);
      refresh(`saved [${g.index}]`);
      return;
    }
    if (e.code === 'ArrowDown' && shift) {
      e.preventDefault();
      g.insertEmpty();
      status(`inserted slot [${g.index}]`);
      refresh(`inserted [${g.index}]`);
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      const lifted = g.lift();
      if (lifted) {
        const mc = document.getElementById('bloom-canvas') as HTMLCanvasElement;
        state.gardenViz?.animateRestore(lifted, mc);
        b.import(lifted);
        if (isLooping()) updateLooper(b);
        if (isPulsing()) updatePulsar(b);
        status(`lifted [${g.index}]`);
        refresh(`lifted [${g.index}]`);
      } else {
        status('nothing here');
      }
      return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      state.gardenViz?.animateSlide('left');
      const had = g.back();
      if (shift && had) play(g.current!, `play [${g.index}]`);
      else refresh(`[${g.index}]`);
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      state.gardenViz?.animateSlide('right');
      g.forward();
      if (shift && g.current) play(g.current, `play [${g.index}]`);
      else refresh(`[${g.index}]`);
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      g.jumpToEnd();
      status(`new entry [${g.index}]`);
      return;
    }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      e.preventDefault();
      g.clear();
      refresh(`deleted [${g.index}]`);
      return;
    }

    // ─── View ─────────────────────────────────────────────────────────────────
    if (ch === 'l' && !shift && !alt) {
      const next = state.viz?.toggleNoteLabels() ?? false;
      const cb = document.getElementById('show-note-labels') as HTMLInputElement | null;
      if (cb) cb.checked = next;
      status(next ? 'labels on' : 'labels off');
      return;
    }

    if (ch === 'L' && !alt) {
      const on = state.viz?.toggleLanes() ?? false;
      try { localStorage.setItem('bloom.lanes', on ? '1' : '0'); } catch { /* private window */ }
      status(on ? 'lanes on' : 'lanes off');
      return;
    }

    if (ch === '\\') {
      state.consoleToggleFn?.();
      return;
    }

    // ─── Help ─────────────────────────────────────────────────────────────────
    if (ch === '?') {
      state.fullHelpToggleFn?.();
      return;
    }
    if (e.code === 'Escape' && document.body.classList.contains('clean')) {
      setClean(false);
      return;
    }
    if (e.code === 'Escape') {
      state.fullHelpCloseFn?.();
      state.consoleClearFn?.();
      state.consoleShowFn?.();
      return;
    }
  }

  return { onKey };
}
