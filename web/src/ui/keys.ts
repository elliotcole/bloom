// Full keyboard handler — mirrors bloom keystroke controller.scd

import { Bloom } from '../core/Bloom';
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
import { BloomVisualization } from './visualization';
import { GardenVisualization } from './gardenVisualization';
import { Display } from './display';

// ─── Quantize cycle ───────────────────────────────────────────────────────────

const QUANTIZE_OPTIONS = [4, 3, 2, 1, 8, 7, 6, 5];
let _quantizeIdx = 4; // starts at 8
function currentQuantize(): number { return QUANTIZE_OPTIONS[_quantizeIdx]; }
function nextQuantize(): number {
  _quantizeIdx = (_quantizeIdx + 1) % QUANTIZE_OPTIONS.length;
  return currentQuantize();
}

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
}

export function createKeyHandler(state: KeyHandlerState) {
  let _previewResetId: ReturnType<typeof setTimeout> | null = null;
  let _lastEscapeTime = 0;
  /** Temporary bloom used for loop-cycle display; reused across cycles to avoid allocation */
  let _loopDisplayBloom: Bloom | null = null;

  function refresh(msg = '') {
    // Cancel any in-progress garden preview
    if (_previewResetId !== null) { clearTimeout(_previewResetId); _previewResetId = null; }
    if (state.viz) state.viz.setBloom(state.bloom);
    if (state.gardenViz) state.gardenViz.update(state.garden);
    if (state.display) state.display.update(state.bloom, state.garden, msg);
    updateLooper(state.bloom);
    updatePulsar(state.bloom);
  }

  function play(bloom: Bloom, msg?: string) {
    if (!state.out) { refresh('No MIDI output'); return; }
    state.cancelLastPlay?.();
    bloom.resolveFixed();
    const onNoteOn = (idx: number) => state.viz?.activateNote(idx);
    const cancel = playOnce(bloom, state.out, undefined, undefined, onNoteOn);
    state.cancelLastPlay = cancel;
    refresh(msg ?? '');
  }

  function status(msg: string) {
    if (state.display) state.display.setStatus(msg);
  }

  function onKey(e: KeyboardEvent): void {
    // Ignore if modifier keys other than shift/option are active (e.g. Ctrl+R)
    if (e.ctrlKey || e.metaKey) return;

    const ch = e.key;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const b = state.bloom;
    const g = state.garden;

    // ─── Editor / Palette ─────────────────────────────────────────────────────
    if (alt && e.code === 'KeyE') {
      e.preventDefault();
      state.editorOpenFn?.();
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
    if (ch === 't' && !shift && !alt) {
      status('mutate time');
      b.mutateTime();
      refresh('mutate time');
      return;
    }
    if (e.code === 'KeyT' && !shift && alt) {
      status('sort time');
      b.timeIntervals = [...b.timeIntervals].sort((a, v) => a - v);
      refresh('sort time');
      return;
    }
    if (ch === 'T' && shift) {
      status('mutate velocities');
      b.mutateVelocities();
      refresh('mutate vel');
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
    if (ch === ']') {
      status('slower');
      b.slower();
      refresh('slower');
      return;
    }
    if (ch === '[') {
      status('faster');
      b.faster();
      refresh('faster');
      return;
    }
    if (ch === '-') {
      status('softer');
      b.softer();
      refresh('softer');
      return;
    }
    if (ch === '=' || ch === '+') {
      status('louder');
      b.louder();
      refresh('louder');
      return;
    }
    if (ch === 'y' && !shift) {
      status('even time');
      b.avgTime();
      refresh('avg time');
      return;
    }

    // ─── Blending ─────────────────────────────────────────────────────────────
    if (ch === 'x' && !shift) {
      const src = g.current;
      if (src) { b.interlace(src); status('interlace'); refresh('interlace'); }
      else status('no bloom in slot');
      return;
    }
    if (ch === 'X' && shift) {
      const src = g.current;
      if (src) { b.blend(src); status('blend'); refresh('blend'); }
      else status('no bloom in slot');
      return;
    }
    if (ch === 'f' && !shift) {
      const src = g.current;
      if (src) { b.applyShape(src); status('lift shape'); refresh('lift shape'); }
      else status('no bloom in slot');
      return;
    }
    if (ch === 'F' && shift) {
      const src = g.current;
      if (src) { b.cast(src); status('cast'); refresh('cast'); }
      else status('no bloom in slot');
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
      status('rotate notes >>');
      b.rotateNotes(1);
      refresh('rotate notes');
      return;
    }
    if (ch === '0') {
      status('rotate velocities >>');
      b.rotateVelocities(1);
      refresh('rotate vel');
      return;
    }
    if (ch === '(') {
      status('rotate times >>');
      b.rotateTime(1);
      refresh('rotate time');
      return;
    }
    if (ch === ')') {
      status('rotate chans >>');
      b.rotateChans(1);
      refresh('rotate chan');
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
    if (ch === 'q' && !shift) {
      status(`quantize [${currentQuantize()}]`);
      b.quantize(currentQuantize());
      refresh(`quantize ${currentQuantize()}`);
      return;
    }
    if (ch === 'Q' && shift) {
      const q = nextQuantize();
      status(`(q to apply) quantize [1/${q}]`);
      if (state.display) state.display.setStatus(`(q to apply) quantize [1/${q}]`);
      return;
    }
    if (ch === '{') {
      status('shorten times');
      b.timeIntervals = b.timeIntervals.slice(0, -1);
      refresh('shorten times');
      return;
    }
    if (ch === '}') {
      status('lengthen times');
      b.timeIntervals.push(b.timeIntervals[Math.floor(Math.random() * b.timeIntervals.length)]);
      refresh('lengthen times');
      return;
    }
    if (ch === '_') {
      status('shorten velocities');
      b.velocities = b.velocities.slice(0, -1);
      refresh('shorten vel');
      return;
    }
    if (ch === '+' && shift) {
      status('lengthen velocities');
      b.velocities.push(b.velocities[Math.floor(Math.random() * b.velocities.length)]);
      refresh('lengthen vel');
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
    if (ch === 'v' && !shift) {
      status('pivot (highest)');
      b.pivot();
      refresh('pivot');
      return;
    }
    if (ch === 'V' && shift) {
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
    if (ch === 'c' && !shift) {
      status('clump chords');
      b.chordsRandShorten();
      refresh('chordsRand');
      return;
    }
    if (ch === 'C' && shift) {
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
      const src = g.current;
      if (src) { b.applyScale(src.scale); status('lift scale'); refresh('lift scale'); }
      else status('no bloom in slot');
      return;
    }
    if (ch === 'J' && shift) {
      status('reduce scale');
      b.reduceScale();
      refresh('reduceScale');
      return;
    }

    // ─── Channels ─────────────────────────────────────────────────────────────
    if (ch === ';') {
      status('randomize channels');
      b.randChans();
      refresh('randChans');
      return;
    }
    if (ch === "'") {
      status('cycle channels');
      b.cycleChans();
      refresh('cycleChans');
      return;
    }
    if (ch === ':') {
      status('drop channel');
      b.dropChan();
      refresh('dropChan');
      return;
    }
    if (ch === '"') {
      status('add channel');
      b.recycleChan();
      refresh('recycleChan');
      return;
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
        state.viz?.setBloom(src);
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
      if (!isLooping()) {
        startLooper(
          b,
          state.out!,
          idx => state.viz?.activateNote(idx),
          (vel, time, chan) => {
            // Reuse a single display bloom; import notes/scale from the live bloom each cycle
            if (!_loopDisplayBloom) _loopDisplayBloom = new Bloom();
            _loopDisplayBloom.import(state.bloom);
            _loopDisplayBloom.velocities    = vel;
            _loopDisplayBloom.timeIntervals = time;
            _loopDisplayBloom.chans         = chan;
            state.viz?.setBloom(_loopDisplayBloom);
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
      if (!isPulsing()) startPulsar(b, state.out!, getPulsarRate(), idx => state.viz?.activateNote(idx));
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

    if (ch === '\\') {
      state.consoleToggleFn?.();
      return;
    }

    // ─── Help ─────────────────────────────────────────────────────────────────
    if (ch === '?') {
      state.fullHelpToggleFn?.();
      return;
    }
    if (e.code === 'Escape') {
      state.fullHelpCloseFn?.();
      const now = Date.now();
      const doubleTap = (now - _lastEscapeTime) < 300;
      _lastEscapeTime = now;
      if (doubleTap) {
        state.consoleClearFn?.();
        state.consoleShowFn?.();
      } else {
        state.consoleToggleFn?.();
      }
      return;
    }
  }

  return { onKey };
}
