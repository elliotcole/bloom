// Bloom Web — entry point

import { setMidiLag, midiLag } from './audio/lag';
import './style.css';
import './ui/palette.css';
import { Bloom, BloomDefaults } from './core/Bloom';
import { Garden } from './garden';
import { initMidi, getState as midiStateNow, onMidiMessage, onOutputChange, registerVirtualOutput, onInputsChange, onInputActivity, onInputEcho, muteInput } from './audio/midi';
import { inputRole } from './audio/midiInputs';
import { stopAll, setBpm, getBpm, silence } from './audio/scheduler';
import { ClockFollower, setTimebase } from './audio/clockSync';
import { setFigureSlots } from './lib/figures';
import { loadSynth, pianoOutput, setVelocityCeiling, setReverbMix, setReverbDecay } from './audio/synth';
import { saveGarden, loadGarden, autosaveGarden, peekAutosave, restoreAutosave, sessionNow, restoreSession, pauseAutosave } from './io/garden-io';
import {
  initTakes, armTake, stopTake, playTake, seekTake, stopPlaying, takePhase, lastTake, takeElapsed, saveTakeFile, saveTakeScore, loadTakeFile, clock as hms,
  takeShown, takeGarden, takeLit, takeDark, takeAnimate, takeOtherShown, takeOtherLit, takeOtherDark,
} from './audio/take';
import { parseClock } from './audio/takeFrom';
import { askRestore } from './ui/restorePrompt';
import {
  tuningLibrary, loadScalaFiles, clearLibrary, connectHelper, onHelperStatus, helperStatus, saveToLibrary,
  heldForBloom, isHeld, setHeldTuning, soundingTuning,
} from './audio/tuningOut';
import { TuningEditor } from './ui/tuningEditor';
import { rebase } from './lib/tuning';
import { ScalePicker } from './ui/scalePicker';
import { TuningPicker } from './ui/tuningPicker';
import { RhythmPicker } from './ui/rhythmPicker';
import { ratioText } from './lib/rhythms';
import { PatternPicker } from './ui/patternPicker';
import { ListTyper } from './ui/listTyper';
import { spell } from './lib/numbers';
import { noteOn, noteOff } from './audio/midi';
import { BloomVisualization } from './ui/visualization';
import { GardenVisualization } from './ui/gardenVisualization';
import type { VizMode, ThemeId } from './ui/theme';
import type { FrameAspect } from './ui/visualization';
import { Display } from './ui/display';
import type { KeyHandlerState } from './ui/keys';
import { createKeyHandler } from './ui/keys';
import { cueFor, TAKE_CUE } from './ui/cues';
import { isModifierKey, isViewKey, pressName, viewKeyNames } from './ui/homeKeys';
import { setNoticeKey } from './ui/notice';
import { BloomEditor } from './ui/bloomEditor';
import { CommandPalette } from './ui/commandPalette';
import { BLOOM_COMMANDS } from './ui/bloomCommands';
import { Overlay } from './ui/overlay';

async function main() {
  // ─── DOM refs ───────────────────────────────────────────────────────────────
  const canvas = document.getElementById('bloom-canvas') as HTMLCanvasElement;
  const displayEl = document.getElementById('console-overlay') as HTMLElement;
  const midiStatusEl = document.getElementById('midi-status') as HTMLElement;
  const midiSelectEl = document.getElementById('midi-select') as HTMLSelectElement;
  const midiOutSetupEl = document.getElementById('midi-out-setup') as HTMLSelectElement;
  const midiInputsEl = document.getElementById('midi-inputs') as HTMLElement;
  const vizArea = document.getElementById('viz-area') as HTMLElement;
  const gardenArea = document.getElementById('garden-area') as HTMLElement;
  const consoleToggleBtn = document.getElementById('console-toggle') as HTMLButtonElement;

  // ─── Core state ─────────────────────────────────────────────────────────────
  const bloom = new Bloom().seed();
  const garden = new Garden();
  setFigureSlots(i => garden.slots[i] ?? null);   // @3 in the figures list: slot 3, live
  // A past session is offered, not assumed: restore it or start fresh
  const saved = peekAutosave();
  const restored = saved !== null && await askRestore(saved) && restoreAutosave(saved.raw, bloom, garden);
  if (saved && !restored) autosaveGarden(bloom, garden);   // the fresh start replaces it

  // ─── UI ─────────────────────────────────────────────────────────────────────
  const viz = new BloomVisualization(canvas);
  // two voices (opt-tab): the other voice, drawn dimmed over the main view, following its view and camera
  const voiceCanvas = document.getElementById('voice-canvas') as HTMLCanvasElement;
  const ghost = new BloomVisualization(voiceCanvas, viz);
  const gardenViz = new GardenVisualization(gardenArea, vizArea);
  const display = new Display(displayEl);

  viz.setBloom(bloom);
  try { viz.setLanes(localStorage.getItem('bloom.lanes') === '1'); } catch { /* private window */ }
  gardenViz.setMode(viz.getMode());
  gardenViz.update(garden);
  display.update(bloom, garden, restored ? 'restored from autosave' : '');

  // ─── MIDI ────────────────────────────────────────────────────────────────────
  // Start loading piano samples immediately (non-blocking), but surface failures
  loadSynth().catch((err) => {
    display.setStatus(`piano failed to load: ${err instanceof Error ? err.message : err}`);
  });

  // The built-in piano is offered first, beside the MIDI ports, and stays chosen when a port comes or goes.
  // The page doesn't wait for the MIDI permission (a prompt left unanswered would leave it dead): the
  // piano is ready now, and the ports join the list when the browser allows them
  registerVirtualOutput(pianoOutput);
  const midiState = midiStateNow();
  midiState.selectedOutput = pianoOutput;   // always the piano on load
  void initMidi().then(() => { updateMidiUi(); if (midiState.error) display.setStatus(midiState.error); });

  function updateMidiUi() {
    midiSelectEl.innerHTML = '';
    midiState.outputs.forEach(out => {
      const opt = document.createElement('option');
      opt.value = out.name;
      opt.textContent = out.name;
      if (midiState.selectedOutput?.name === out.name) opt.selected = true;
      midiSelectEl.appendChild(opt);
    });
    // ⚙ → midi: the same choice of output, and the inputs, each heard or not
    midiOutSetupEl.innerHTML = midiSelectEl.innerHTML;
    midiOutSetupEl.value = midiSelectEl.value;
    midiInputsEl.innerHTML = '';
    for (const inp of midiState.inputs) {
      const role = inputRole(inp.name, midiState.selectedOutput?.name ?? null);
      const label = document.createElement('label');
      label.className = role;
      label.title = role === 'own' ? 'the bus Bloom plays on: its own notes coming back, never heard' : 'heard: a keyboard played along goes into a take';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = role === 'listening';
      cb.disabled = role === 'own';
      cb.addEventListener('change', () => { muteInput(inp.name, !cb.checked); cb.blur(); updateMidiUi(); });
      const dot = document.createElement('span');
      dot.className = 'in-dot';
      dot.dataset.input = inp.name;
      label.append(cb, inp.name, dot);
      midiInputsEl.appendChild(label);
    }
    midiStatusEl.textContent = midiState.selectedOutput
      ? midiState.selectedOutput.name
      : 'No outputs';
    midiStatusEl.className = midiState.selectedOutput ? 'midi-status ok' : 'midi-status';
  }

  updateMidiUi();
  // a port plugged in or pulled out: the list follows, and so does where the keys play
  onOutputChange(() => { updateMidiUi(); keyState.out = midiState.selectedOutput; });

  for (const sel of [midiSelectEl, midiOutSetupEl]) {
    sel.addEventListener('change', () => {
      const found = midiState.outputs.find(o => o.name === sel.value);
      if (found) { midiState.selectedOutput = found; keyState.out = found; }
      sel.blur();   // keystrokes go back to the bloom
      updateMidiUi();
    });
  }
  onInputsChange(updateMidiUi);
  // an input's dot lights as it sends, muted or not: what's arriving, and where
  const dotTimers = new Map<string, number>();
  onInputActivity(name => {
    const dot = [...midiInputsEl.querySelectorAll<HTMLElement>('.in-dot')].find(d => d.dataset.input === name);
    if (!dot) return;
    dot.classList.add('lit');
    clearTimeout(dotTimers.get(name));
    dotTimers.set(name, window.setTimeout(() => dot.classList.remove('lit'), 80));
  });
  onInputEcho(name => {
    updateMidiUi();
    display.setStatus(`${name} is sending Bloom's own notes back: no longer heard (⚙ → midi to hear it again)`);
  });

  // ─── Console toggle ───────────────────────────────────────────────────────────
  function toggleConsole() {
    const visible = displayEl.classList.toggle('visible');
    consoleToggleBtn.classList.toggle('active', visible);
  }
  consoleToggleBtn?.addEventListener('click', toggleConsole);

  // ─── Bloom editor ────────────────────────────────────────────────────────────
  function refreshAll(b: Bloom, msg = '') {
    viz.setBloom(b);
    gardenViz.update(garden);
    display.update(b, garden, msg);
    autosaveGarden(bloom, garden);
  }

  const bloomEditor = new BloomEditor((b) => (keyRefresh ? keyRefresh('edited', false) : refreshAll(b, 'edited')));

  // ─── Command palette ──────────────────────────────────────────────────────────
  // The key handler's refresh records undo and holds pinned events; it is
  // made further down, so palette and load reach it through this
  let keyRefresh: ((msg?: string, hold?: boolean) => void) | null = null;
  const commandPalette = new CommandPalette(
    () => bloom,
    (b) => (keyRefresh ? keyRefresh('') : refreshAll(b, '')),
  );

  // Register commands: Bloom's own, then those that reach the page
  for (const c of BLOOM_COMMANDS) commandPalette.register(c.names, c.description, c.fn);
  commandPalette.register('launch', 'launch quantize on / off (a lifted bloom waits for the loop to come round)', () => {
    const cb = document.getElementById('launch-quantize') as HTMLInputElement | null;
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  });

  // ─── Key handler ─────────────────────────────────────────────────────────────
  const fullHelpEl = document.getElementById('help-full') as HTMLElement;
  let showFullHelp = false;
  function toggleFullHelp() {
    showFullHelp = !showFullHelp;
    fullHelpEl.style.display = showFullHelp ? 'block' : 'none';
  }
  function closeFullHelp() {
    if (showFullHelp) toggleFullHelp();
  }


  const recordDotEl = document.getElementById('record-dot') as HTMLElement;

  const keyState: KeyHandlerState = {
    bloom,
    garden,
    out: midiState.selectedOutput,
    viz,
    ghost,
    gardenViz,
    display,
    cancelLastPlay: null,
    fullHelpToggleFn: toggleFullHelp,
    fullHelpCloseFn: closeFullHelp,
    consoleToggleFn: toggleConsole,
    consoleShowFn: () => {
      displayEl.classList.add('visible');
      consoleToggleBtn.classList.add('active');
    },
    consoleClearFn: () => display.clear(),
    pedalDown: false,
    recordDotEl,
    editorOpenFn:  () => bloomEditor.open(bloom),
    paletteOpenFn: () => commandPalette.open(),
    setVizModeFn: (mode) => {
      viz.setMode(mode);
      gardenViz.setMode(mode);
      if (vizModeSelect) vizModeSelect.value = mode;
      updateResetCameraVisibility(mode);
    },
  };

  const { voicesShown, otherVoice, cueContext, onKey, togglePin, clearPins, select, clearSelection, refresh: keysRefresh, mergeGarden, curdle, setBaseTuning, setClean, syncTuning, toggleHold, leaveListMode } = createKeyHandler(keyState);

  // ─── Cue line: the keys that belong to where you are ───────────────────────
  const cueEl = document.getElementById('cue-line') as HTMLElement;
  const cueToggle = document.getElementById('show-cues') as HTMLInputElement | null;
  try { if (cueToggle) cueToggle.checked = localStorage.getItem('bloom.cues') !== '0'; } catch { /* private window */ }
  cueToggle?.addEventListener('change', () => {
    try { localStorage.setItem('bloom.cues', cueToggle.checked ? '1' : '0'); } catch { /* best effort */ }
    cueToggle.blur();
    updateCue();
  });
  function updateCue() {
    const ctx = cueContext();
    document.body.classList.toggle('help-tuning', ctx.tuning);   // ? shows the section for where you are
    document.body.classList.toggle('help-freeze', ctx.freezeMenu);
    document.body.classList.toggle('help-select', !!ctx.select && !ctx.freezeMenu && !ctx.tuning);
    const off = !(cueToggle?.checked ?? true) || !!document.getElementById('console-overlay')?.classList.contains('visible');
    cueEl.classList.toggle('off', off);
    if (off) return;
    const { text, tip } = takePhase() === 'playing' ? { text: TAKE_CUE, tip: false } : cueFor(ctx);
    if (cueEl.textContent !== text) cueEl.textContent = text;
    cueEl.classList.toggle('tip', tip);
  }
  setInterval(updateCue, 250);   // modes, selections and playback all show within a moment
  updateCue();
  // blur after a click so a later space plays rather than pressing the button again
  document.getElementById('merge-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); mergeGarden(); });
  document.getElementById('curdle-bloom')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); curdle(); });
  keyRefresh = keysRefresh;
  // while a take plays, clicks on the picture don't change the bloom
  const unlessPlaying = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (takePhase() !== 'playing') f(...a); };
  viz.onNodeClick = unlessPlaying(togglePin);
  viz.onSelect = unlessPlaying(select);

  // ─── Takes: a performance kept as it sounded and looked, played again the same way ──
  // The view tells the take what it shows; a take playing back shows it again
  let _shownNow: { bloom: Bloom; trace: boolean } = { bloom, trace: true };
  {
    const setBloom = viz.setBloom.bind(viz), light = viz.activateNote.bind(viz), dark = viz.deactivateAll.bind(viz);
    viz.setBloom = (b, trace = true) => { _shownNow = { bloom: b, trace }; takeShown(b, trace, b === bloom); setBloom(b, trace); };
    viz.activateNote = (i, tick = i, shift) => { takeLit(i, tick); light(i, tick, shift); };
    viz.deactivateAll = () => { takeDark(); dark(); };
    const gShow = ghost.setBloom.bind(ghost), gClear = ghost.clear.bind(ghost), gLight = ghost.activateNote.bind(ghost), gDark = ghost.deactivateAll.bind(ghost);
    ghost.setBloom = (b, trace = true) => { takeOtherShown(b); gShow(b, trace); };
    ghost.clear = () => { takeOtherShown(null); gClear(); };
    ghost.activateNote = (i, tick = i, shift) => { takeOtherLit(i, tick); gLight(i, tick, shift); };
    ghost.deactivateAll = () => { takeOtherDark(); gDark(); };
    const update = gardenViz.update.bind(gardenViz), slide = gardenViz.animateSlide.bind(gardenViz);
    const save = gardenViz.animateSave.bind(gardenViz), restore = gardenViz.animateRestore.bind(gardenViz);
    gardenViz.update = (g) => { takeGarden(g); update(g); };
    gardenViz.animateSlide = (dir) => { takeAnimate(dir, null); slide(dir); };
    gardenViz.animateSave = (b, c) => { takeAnimate('save', b); save(b, c); };
    gardenViz.animateRestore = (b, c) => { takeAnimate('restore', b); restore(b, c); };
  }
  let _session: string | null = null;   // the session, set aside while a take plays
  initTakes({
    shown: () => _shownNow,
    session: () => ({ bloom, garden }),
    silence: () => {
      stopAll();
      keyState.cancelLastPlay?.();
      keyState.cancelLastPlay = null;
      viz.deactivateAll();
      ghost.deactivateAll();
    },
    out: () => midiState.selectedOutput,
    show: (b, trace, main) => {
      if (main) { bloom.import(b); viz.setBloom(bloom, trace); } else viz.setBloom(b, trace);
    },
    garden: (slots, cursor) => { garden.slots = slots; garden.cursor = cursor; gardenViz.update(garden); },
    light: (i, tick) => viz.activateNote(i, tick),
    dark: () => viz.deactivateAll(),
    animate: (kind, b) => {
      if (kind === 'left' || kind === 'right') gardenViz.animateSlide(kind);
      else if (b) (kind === 'save' ? gardenViz.animateSave : gardenViz.animateRestore)(b, canvas);
    },
    other: {
      // a take of two voices shows the other one dimmed, as it was
      show: b => { document.body.classList.toggle('voices', b !== null); if (b) ghost.setBloom(b); else ghost.clear(); },
      light: (i, tick) => ghost.activateNote(i, tick),
      dark: () => ghost.deactivateAll(),
    },
    otherShown: () => otherVoice(),
    changed: takeUi,
  });

  const takeRecBtn = document.getElementById('take-rec') as HTMLButtonElement | null;
  const takePlayBtn = document.getElementById('take-play') as HTMLButtonElement | null;
  const takeSaveBtn = document.getElementById('take-save') as HTMLButtonElement | null;
  const takeLoadBtn = document.getElementById('take-load') as HTMLButtonElement | null;
  const takeScoreBtn = document.getElementById('take-score') as HTMLButtonElement | null;
  const takeStatus = document.getElementById('take-status');
  const takeFromField = document.getElementById('take-from') as HTMLInputElement | null;
  const takePos = document.getElementById('take-pos') as HTMLInputElement | null;
  // where play take starts, kept for the next time (an audition goes back to it)
  let _from = 0;
  try { _from = Math.max(0, Number(localStorage.getItem('bloom.take.from')) || 0); } catch { /* none kept */ }
  let _dragging = false;
  const setFrom = (ms: number) => {
    const t = lastTake();
    _from = Math.max(0, Math.min(Math.round(ms), t ? t.length : ms));
    try { localStorage.setItem('bloom.take.from', String(_from)); } catch { /* best effort */ }
    if (takeFromField && document.activeElement !== takeFromField) takeFromField.value = hms(_from);
  };
  /** Playing: go to `ms`, within the take */
  const seek = (ms: number) => {
    const t = lastTake();
    if (!t || takePhase() !== 'playing') return;
    const to = Math.max(0, Math.min(ms, t.length - 1000));
    seekTake(to);
    display.setStatus(`take: ${hms(to)}`);
  };
  const takeBadge = document.getElementById('take-badge');
  // what can't be undone asks twice: a second click within a few seconds
  let _asking: { what: 'replace' | 'stop'; until: number } | null = null;
  const asked = (what: 'replace' | 'stop') => _asking?.what === what && performance.now() < _asking.until;
  const ask = (what: 'replace' | 'stop') => { _asking = { what, until: performance.now() + 4000 }; takeUi(); setTimeout(takeUi, 4100); };

  function takeUi() {
    const ph = takePhase(), t = lastTake();
    if (_asking && performance.now() >= _asking.until) _asking = null;
    if (ph !== 'playing' && _session !== null) {   // a take played out: the session comes back as it was
      restoreSession(_session, bloom, garden);
      _session = null;
      pauseAutosave(false);
      clearPins();
      clearSelection();
      keysRefresh('take ended', false);
      voicesShown();   // the session's voices, as they were
    }
    document.body.classList.toggle('take-playing', ph === 'playing');
    if (takeRecBtn) {
      takeRecBtn.textContent = ph === 'armed' ? 'disarm' : ph === 'recording' ? (asked('stop') ? 'really stop?' : 'stop take')
        : ph === 'ending' ? 'holding…' : asked('replace') ? 'replace the last take?' : 'arm take';
      takeRecBtn.disabled = ph === 'playing' || ph === 'ending';
      takeRecBtn.classList.toggle('active', ph === 'armed' || ph === 'recording');
    }
    if (takePlayBtn) {
      takePlayBtn.textContent = ph === 'playing' ? 'stop playing' : 'play take';
      takePlayBtn.disabled = !t || (ph !== 'idle' && ph !== 'playing');
    }
    if (takeSaveBtn) takeSaveBtn.disabled = !t || ph === 'recording' || ph === 'ending';
    if (takeScoreBtn) takeScoreBtn.disabled = !t || ph === 'recording' || ph === 'ending';
    if (takeLoadBtn) takeLoadBtn.disabled = ph !== 'idle';
    if (takePos) {
      takePos.max = String(t ? t.length : 1);
      takePos.disabled = !t || (ph !== 'idle' && ph !== 'playing');
      if (!_dragging) takePos.value = String(ph === 'playing' ? takeElapsed() : _from);
    }
    if (takeFromField) {
      takeFromField.disabled = !t || (ph !== 'idle' && ph !== 'playing');
      if (document.activeElement !== takeFromField && takeFromField.value !== hms(_from)) takeFromField.value = hms(_from);
    }
    const el = hms(takeElapsed());
    const text = ph === 'armed' ? 'armed: starts on the first note'
      : ph === 'recording' ? `● ${el}`
      : ph === 'ending' ? 'stopped: what sounds holds 10 s'
      : ph === 'playing' && t ? `▶ ${el} / ${hms(t.length)}`
      : t ? `last take ${hms(t.length)} · ${new Date(t.recordedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}${t.saved ? '' : ' · not saved to a file'}`
      : 'no take yet';
    if (takeStatus && takeStatus.textContent !== text) takeStatus.textContent = text;
    if (takeBadge) {
      const b = ph === 'idle' ? '' : ph === 'armed' ? '◌ take' : ph === 'recording' ? `● ${el}` : ph === 'ending' ? '● holding' : `▶ ${el}`;
      if (takeBadge.textContent !== b) takeBadge.textContent = b;
      takeBadge.classList.toggle('active', b !== '');
    }
  }
  setInterval(takeUi, 500);
  takeUi();
  takeRecBtn?.addEventListener('click', () => {
    takeRecBtn.blur();
    const ph = takePhase(), t = lastTake();
    if (ph === 'idle') {
      if (t && !t.saved && !asked('replace')) { ask('replace'); return; }
      _asking = null;
      armTake();
      display.setStatus('take armed: it starts on the first note that sounds');
    } else if (ph === 'armed') {
      stopTake();
      display.setStatus('take disarmed');
    } else if (ph === 'recording') {
      if (!asked('stop')) { ask('stop'); return; }
      _asking = null;
      stopTake();
      display.setStatus('take stopped: what sounds holds 10 s, then it ends');
    }
  });
  takePlayBtn?.addEventListener('click', () => {
    takePlayBtn.blur();
    if (takePhase() === 'playing') { stopPlaying(); return; }
    const session = sessionNow(bloom, garden);
    leaveListMode();
    if (playTake(_from)) {
      _session = session;
      pauseAutosave(true);
      openMenu(null);
      display.setStatus(`playing the take${_from ? ` from ${hms(_from)}` : ''}: the view keys are yours; ← → skip; . stops it`);
    }
  });
  takeFromField?.addEventListener('keydown', e => { if (e.key === 'Enter') takeFromField.blur(); });
  takeFromField?.addEventListener('change', () => {
    const ms = parseClock(takeFromField.value);
    if (ms === null) { display.setStatus(`not a time: ${takeFromField.value} (h:mm:ss, m:ss or seconds)`); takeFromField.value = hms(_from); return; }
    setFrom(ms);
    takeFromField.value = hms(_from);
    if (takePhase() === 'playing') seek(_from); else display.setStatus(`play take starts at ${hms(_from)}`);
    takeUi();
  });
  takePos?.addEventListener('input', () => {
    _dragging = true;
    if (takeStatus) takeStatus.textContent = `→ ${hms(Number(takePos.value))}`;
  });
  takePos?.addEventListener('change', () => {
    _dragging = false;
    takePos.blur();
    const ms = Number(takePos.value);
    if (takePhase() === 'playing') seek(ms);
    else { setFrom(ms); display.setStatus(`play take starts at ${hms(_from)}`); }
    takeUi();
  });
  takeSaveBtn?.addEventListener('click', () => { takeSaveBtn.blur(); if (saveTakeFile()) { display.setStatus('take saved'); takeUi(); } });
  takeScoreBtn?.addEventListener('click', () => { takeScoreBtn.blur(); const n = saveTakeScore(); if (n) display.setStatus(`take written as a score: ${n} bars (MusicXML, piano)`); });
  takeLoadBtn?.addEventListener('click', () => {
    takeLoadBtn.blur();
    loadTakeFile(err => display.setStatus(err ?? (lastTake() ? `take loaded: ${hms(lastTake()!.length)}` : '')));
  });

  // ─── Performance: frame, size and drift; previewed while the perform menu is open ──
  const perfFrame = document.getElementById('perf-frame') as HTMLSelectElement | null;
  const perfSize = document.getElementById('perf-size') as HTMLInputElement | null;
  const perfSizeVal = document.getElementById('perf-size-val');
  const perfDrift = document.getElementById('perf-drift') as HTMLInputElement | null;
  if (perfFrame) perfFrame.value = viz.getFrame();
  if (perfSize) perfSize.value = String(viz.getSize());
  if (perfSizeVal) perfSizeVal.textContent = `×${viz.getSize().toFixed(2)}`;
  if (perfDrift) perfDrift.checked = viz.getDrift();
  perfFrame?.addEventListener('change', () => {
    viz.setFrame(perfFrame.value as FrameAspect);
    perfFrame.blur();
    display.setStatus(perfFrame.value === 'off' ? 'frame off' : `frame ${perfFrame.value}: ${viz.frameSize()} px in clean view`);
  });
  perfSize?.addEventListener('input', () => {
    const size = viz.setSize(Number(perfSize.value));
    if (perfSizeVal) perfSizeVal.textContent = `×${size.toFixed(2)}`;
  });
  perfSize?.addEventListener('change', () => perfSize.blur());
  perfDrift?.addEventListener('change', () => { viz.setDrift(perfDrift.checked); perfDrift.blur(); });
  document.getElementById('perf-clean')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    setClean(true);
    display.setStatus('clean view — esc leaves');
  });

  // ─── Typing a list (↵ in a list mode) ────────────────────────────────────────
  const listTyper = new ListTyper(document.getElementById('viz-area') as HTMLElement);
  keyState.typeList = (label, text, commit, fields) => listTyper.open(label, text, commit, fields);

  // ─── Pattern palette (d): presets, or type one, previewed on the list ───────
  const patternPicker = new PatternPicker();
  keyState.pickPattern = (title, n, last, bake) => patternPicker.open(title, n, last, bake);

  // ─── Scale picker: every scale and raga by name, on a chosen root ───────────
  const scalePicker = new ScalePicker({
    current: () => bloom.appliedScale,
    root: () => bloom.keyTuningRoot(),
    apply: (scale, root) => {
      bloom.applyScaleOn(scale, root);
      keysRefresh(`scale: ${scale.name} on ${scale.root !== undefined ? 'Sa ' : ''}${spell(root)}`);
    },
  });
  document.getElementById('scale-pick')?.addEventListener('click', e => { (e.currentTarget as HTMLElement).blur(); scalePicker.open(); });
  document.getElementById('scale-badge')?.addEventListener('click', () => scalePicker.open());

  // ─── Tuning: a library of .scl files; each bloom picks one ──────────────────
  // the menu (l in tuning mode): one chosen on purpose, rather than stepping through the rest
  const tuningPicker = new TuningPicker({
    library: tuningLibrary,
    current: () => soundingTuning(bloom)?.name ?? '12-TET',
    apply: t => setBaseTuning(t.name === '12-TET' ? null : { ...t, cents: [...t.cents] }),
  });
  keyState.pickTuning = () => tuningPicker.open();
  // time mode k: duration palettes (the times snap to one) and rhythm cells (the time list becomes one)
  const rhythmPicker = new RhythmPicker({
    apply: r => {
      // a palette takes the basis already locked here, else the one the other voice is locked to
      const own = bloom.lockedBasis(), theirs = otherVoice()?.lockedBasis() ?? null;
      const basis = own ?? theirs ?? undefined;
      const shared = own === null && theirs !== null ? ', on the other voice\'s basis' : '';
      const pulse = r.kind === 'palette' ? bloom.snapTimes(r.values, r.name, basis) : bloom.setRhythm(r.values);
      const msg = r.kind === 'palette'
        ? `[t] ${r.name}: the times are in ${r.values.map(ratioText).join(' ')} of ${ratioText(pulse)} and stay there${shared} (F t lets go)`
        : `[t] ${r.name}: ${r.values.map(ratioText).join(' ')} on a pulse of ${pulse}, ${r.values.length} long (no palette holds the times now)`;
      display.setStatus(msg);
      keysRefresh(msg);
    },
  });
  keyState.pickRhythm = () => rhythmPicker.open();
  const tuningSelect = document.getElementById('tuning-select') as HTMLSelectElement | null;
  const tuningStatus = document.getElementById('tuning-status');
  const fillTuningSelect = () => {
    if (!tuningSelect) return;
    tuningSelect.innerHTML = '';
    for (const t of tuningLibrary()) {
      const o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      if (t.description) o.title = t.description;
      tuningSelect.appendChild(o);
    }
    tuningSelect.value = soundingTuning(bloom)?.name ?? '12-TET';
  };
  fillTuningSelect();
  tuningSelect?.addEventListener('change', () => {
    const t = tuningLibrary().find(x => x.name === tuningSelect.value);
    const chosen = !t || t.name === '12-TET' ? null : { ...t, cents: [...t.cents] };
    const next = rebase(soundingTuning(bloom), chosen);   // a new base, the same alterations
    if (isHeld()) setHeldTuning(next); else bloom.tuning = next;
    tuningSelect.blur();
    keysRefresh(`tuning: ${tuningSelect.value}`);
  });
  /** Pick .scl files to add to the library; `use`: the first one loaded becomes the sounding tuning */
  const pickScala = (use: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.scl';
    input.onchange = async () => {
      if (!input.files) return;
      const { added, skipped, names } = await loadScalaFiles(input.files);
      fillTuningSelect();
      let note = `${added} tuning${added === 1 ? '' : 's'} loaded`
        + (skipped.length ? ` · ${skipped.length} skipped (${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ' …' : ''})` : '');
      const first = use ? tuningLibrary().find(x => x.name === names[0]) : undefined;
      if (first) {
        const next = rebase(soundingTuning(bloom), { ...first, cents: [...first.cents] });   // a new base, the same alterations
        if (isHeld()) setHeldTuning(next); else bloom.tuning = next;
        fillTuningSelect();
        note += ` · now ${first.name}`;
        keysRefresh(note);
      }
      display.setStatus(note);
      if (tuningStatus) tuningStatus.textContent = helperStatus();
    };
    input.click();
  };
  document.getElementById('tuning-load')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    pickScala(false);
  });
  document.getElementById('tuning-clear')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    clearLibrary();
    fillTuningSelect();
    display.setStatus('tuning library cleared (blooms keep their tunings)');
  });
  // curl, not the browser: a browser download is quarantined and macOS won't run it
  document.getElementById('tuning-helper')?.addEventListener('click', async (e) => {
    (e.currentTarget as HTMLElement).blur();
    const cmd = `curl -fLo ~/bloom-mts ${location.origin}/bloom-mts && chmod +x ~/bloom-mts && ~/bloom-mts`;
    try {
      await navigator.clipboard.writeText(cmd);
      display.setStatus('copied: paste it in Terminal (needs MTS-ESP Mini installed; afterwards just run ~/bloom-mts)');
    } catch {
      display.setStatus(cmd);
    }
  });
  const tuningEditor = new TuningEditor({
    bloom: () => bloom,
    commit: (t, msg) => {
      if (isHeld()) setHeldTuning(t); else bloom.tuning = t;
      display.setStatus(msg);
      keysRefresh(msg);
    },
    audition: (midi) => {
      const out = midiState.selectedOutput;
      if (!out || midi < 0 || midi > 127) return;
      const chan = bloom.chans[0] ?? 0;
      noteOn(out, chan, midi, 90);
      setTimeout(() => noteOff(out, chan, midi), 700);
    },
    libraryTuning: (name) => tuningLibrary().find(t => t.name === name && t.name !== '12-TET'),
    saveToLibrary: (t) => { saveToLibrary(t); fillTuningSelect(); },
    loadScala: () => pickScala(true),
    status: (msg) => display.setStatus(msg),
    show: (on) => {
      if (on) leaveListMode();
      viz.setTuningView(on);
      const badge = document.getElementById('list-mode-badge');
      if (badge) { badge.textContent = on ? 'TUNING' : ''; badge.classList.toggle('active', on); }
    },
    toggleHold,
    keepHeld: () => {
      bloom.tuning = heldForBloom();
      display.setStatus('this bloom keeps the held tuning');
      keysRefresh('this bloom keeps the held tuning');
    },
    retune: () => keysRefresh(''),
    mark: (m) => viz.setPieMarks(m),
  });
  viz.onTuningClick = unlessPlaying((d: number, shift: boolean) => tuningEditor.pick(d, shift));
  viz.onTuningViewClosed = () => tuningEditor.closed();
  keyState.tuningView = tuningEditor;
  keyState.afterRefreshFn = () => tuningEditor.update();
  document.getElementById('tuning-edit')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); tuningEditor.toggle(); });
  document.getElementById('tuning-badge')?.addEventListener('click', () => tuningEditor.toggle());
  onHelperStatus(s => { if (tuningStatus) tuningStatus.textContent = s; });
  if (tuningStatus) tuningStatus.textContent = helperStatus();
  if (tuningLibrary().length > 1 || bloom.tuning) void connectHelper();
  syncTuning();   // a restored bloom's tuning

  window.addEventListener('keydown', (e) => {
    // an overlay has the keyboard (palette, editor, picker, the typing line)
    if (Overlay.anyOpen()) return;
    // ...or while typing in a text field (the tuning editor, settings numbers)
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA'
      || (target.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((target as HTMLInputElement).type)))) {
      if (e.key === 'Escape') target.blur();
      return;
    }
    // a take playing back: the view keys are free, . stops it, the rest wait
    if (takePhase() === 'playing') {
      if (e.key === '.' && !e.altKey && !e.metaKey && !e.ctrlKey) { stopPlaying(); display.setStatus('take stopped'); return; }
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        seek(takeElapsed() + (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 60_000 : 10_000));
        return;
      }
      if (!isViewKey(e)) {
        if (!e.metaKey && !e.ctrlKey && !isModifierKey(e)) display.setStatus(`playing the take: view keys only (${viewKeyNames().join(', ')}); ← → skip 10 s (shift: a minute); . stops it`);
        return;
      }
    }
    keyState.out = midiState.selectedOutput;
    // demo mode: the notice also shows the key, large, for recordings
    setNoticeKey(_demoMode && !isModifierKey(e) ? pressName(e) : '');
    onKey(e);
  });

  window.addEventListener('beforeunload', () => {
    if (takePhase() === 'playing') stopPlaying();
    stopAll();
    silence(midiState.selectedOutput);
  });

  // ─── Viz mode + theme selects ─────────────────────────────────────────────
  const vizModeSelect = document.getElementById('viz-mode-select') as HTMLSelectElement;
  const vizThemeSelect = document.getElementById('viz-theme-select') as HTMLSelectElement;

  const resetCameraBtn = document.getElementById('reset-camera') as HTMLButtonElement;
  const _3dModes = new Set<VizMode>(['deep', 'spiral']);

  function updateResetCameraVisibility(mode: VizMode): void {
    if (resetCameraBtn) resetCameraBtn.style.display = _3dModes.has(mode) ? '' : 'none';
  }

  vizModeSelect?.addEventListener('change', () => {
    const mode = vizModeSelect.value as VizMode;
    viz.setMode(mode);
    gardenViz.setMode(mode);
    updateResetCameraVisibility(mode);
    vizModeSelect.blur();
  });

  resetCameraBtn?.addEventListener('click', () => { viz.resetCamera(); });
  updateResetCameraVisibility(viz.getMode());

  vizThemeSelect?.addEventListener('change', () => {
    const themeId = vizThemeSelect.value as ThemeId;
    viz.setTheme(themeId);
    gardenViz.setTheme(themeId);
    document.body.dataset.theme = themeId === 'dark' ? '' : themeId;
    vizThemeSelect.blur();   // or the next keys pick skins by their first letter
  });

  document.getElementById('help-toggle')?.addEventListener('click', toggleFullHelp);

  // ─── Menus: bloom ▾ play ▾ garden ▾ perform ▾ ⚙ — one panel at a time, in the bar under the header ──
  const settingsBar = document.getElementById('settings-bar') as HTMLElement;
  const menuBtns = [...document.querySelectorAll<HTMLButtonElement>('.menu-btn')];
  const menuPanels = [...settingsBar.querySelectorAll<HTMLElement>('.menu-panel')];
  function openMenu(name: string | null) {
    menuPanels.forEach(p => p.classList.toggle('open', p.dataset.menu === name));
    menuBtns.forEach(b => b.classList.toggle('active', b.dataset.menu === name));
    settingsBar.classList.toggle('visible', name !== null);
    viz.setFramePreview(name === 'perform');   // frame and size show while you set them
  }
  const openMenuName = () => menuPanels.find(p => p.classList.contains('open'))?.dataset.menu ?? null;
  menuBtns.forEach(b => b.addEventListener('click', () => {
    b.blur();
    openMenu(openMenuName() === b.dataset.menu ? null : b.dataset.menu ?? null);
  }));
  // a key played on the bloom closes the menu (typing into one of its fields doesn't)
  document.addEventListener('keydown', e => {
    const t = e.target as HTMLElement | null;
    if (!openMenuName() || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || isModifierKey(e)) return;
    openMenu(null);
  }, true);

  // BPM
  const bpmInput = document.getElementById('bpm-input') as HTMLInputElement;
  bpmInput?.addEventListener('change', () => {
    setBpm(parseFloat(bpmInput.value) || 60);
  });

  // Tap tempo
  let _tapTimes: number[] = [];
  document.getElementById('tap-tempo')?.addEventListener('click', () => {
    const now = Date.now();
    _tapTimes = _tapTimes.filter(t => now - t < 4000);
    _tapTimes.push(now);
    if (_tapTimes.length >= 2) {
      const span = _tapTimes[_tapTimes.length - 1] - _tapTimes[0];
      const intervals = _tapTimes.length - 1;
      const bpm = Math.round(60_000 / (span / intervals));
      setBpm(Math.max(20, Math.min(300, bpm)));
      if (bpmInput) bpmInput.value = String(getBpm());
    }
  });

  // MIDI clock: the tempo, and while the transport plays, the beat (audio/clockSync)
  const clockStatus = document.getElementById('clock-sync-status') as HTMLElement;
  const clock = new ClockFollower();
  setTimebase(() => clock.state(performance.now()).running ? clock : null);
  onMidiMessage((data, atMs) => { clock.message(data, atMs); });
  let _bpmShownAt = 0;
  setInterval(() => {
    const now = performance.now();
    const st = clock.state(now);
    if (st.bpm !== null && st.bpm >= 20 && st.bpm <= 300) {
      setBpm(st.bpm);
      if (bpmInput && document.activeElement !== bpmInput && now - _bpmShownAt > 500) {
        bpmInput.value = st.bpm.toFixed(1);
        _bpmShownAt = now;
      }
    }
    if (!clockStatus) return;
    const beat = st.running ? clock.beatAt(now) : null;
    clockStatus.textContent = !st.synced ? 'clk: free'
      : beat !== null ? `clk ▶ beat ${Math.floor(beat) % 4 + 1}` : 'clk: tempo';
    clockStatus.classList.toggle('synced', st.synced);
    clockStatus.title = !st.synced ? 'no MIDI clock coming in: Bloom keeps its own tempo'
      : st.running ? 'following a MIDI clock: its tempo, and its beat (a loop starts on the next beat and stays locked to it)'
      : 'following a MIDI clock\'s tempo; for its beat too, start the transport (in Live: Song sync on for this port, so it sends Start and Song Position)';
  }, 50);

  // Legato
  const legatoInput = document.getElementById('legato-input') as HTMLInputElement;
  legatoInput?.addEventListener('change', () => {
    const v = parseFloat(legatoInput.value);
    if (!isNaN(v) && v > 0) {
      bloom.legato = v;
      BloomDefaults.legato = v;
    }
  });

  // Sustain
  const sustainEnabledCb = document.getElementById('sustain-enabled') as HTMLInputElement;
  const sustainInput = document.getElementById('sustain-input') as HTMLInputElement;
  sustainEnabledCb?.addEventListener('change', () => {
    if (sustainInput) sustainInput.disabled = !sustainEnabledCb.checked;
    const val = sustainEnabledCb.checked ? parseFloat(sustainInput?.value ?? '0.5') : null;
    bloom.sustain = val;
    BloomDefaults.sustain = val;
  });
  sustainInput?.addEventListener('change', () => {
    if (sustainEnabledCb?.checked) {
      const v = parseFloat(sustainInput.value);
      if (!isNaN(v) && v > 0) { bloom.sustain = v; BloomDefaults.sustain = v; }
    }
  });

  // Compass
  const compassLoInput = document.getElementById('compass-lo') as HTMLInputElement;
  const compassHiInput = document.getElementById('compass-hi') as HTMLInputElement;
  const applyCompass = () => {
    const lo = parseInt(compassLoInput?.value ?? '40');
    const hi = parseInt(compassHiInput?.value ?? '108');
    if (!isNaN(lo) && !isNaN(hi) && hi > lo) {
      bloom.lowestPossibleNote = lo;
      bloom.highestPossibleNote = hi;
      BloomDefaults.lowestPossibleNote = lo;
      BloomDefaults.highestPossibleNote = hi;
      bloom.compass(lo, hi);
    }
  };
  compassLoInput?.addEventListener('change', applyCompass);
  compassHiInput?.addEventListener('change', applyCompass);
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const el = btn as HTMLElement;
    el.addEventListener('click', () => {
      const lo = parseInt(el.dataset.lo ?? '40');
      const hi = parseInt(el.dataset.hi ?? '108');
      if (compassLoInput) compassLoInput.value = String(lo);
      if (compassHiInput) compassHiInput.value = String(hi);
      bloom.lowestPossibleNote = lo; bloom.highestPossibleNote = hi;
      BloomDefaults.lowestPossibleNote = lo; BloomDefaults.highestPossibleNote = hi;
      bloom.compass(lo, hi);
    });
  });

  // Fixed duration
  const fixedDurEnabledCb = document.getElementById('fixed-dur-enabled') as HTMLInputElement;
  const fixedDurAmountInput = document.getElementById('fixed-dur-amount') as HTMLInputElement;
  const fixedDurModeSelect = document.getElementById('fixed-dur-mode') as HTMLSelectElement;
  fixedDurEnabledCb?.addEventListener('change', () => {
    const on = fixedDurEnabledCb.checked;
    if (fixedDurAmountInput) fixedDurAmountInput.disabled = !on;
    if (fixedDurModeSelect) fixedDurModeSelect.disabled = !on;
    bloom.fixedDur = on ? parseFloat(fixedDurAmountInput?.value ?? '4') : false;
  });
  fixedDurAmountInput?.addEventListener('change', () => {
    if (bloom.fixedDur !== false) bloom.fixedDur = parseFloat(fixedDurAmountInput.value);
  });
  fixedDurModeSelect?.addEventListener('change', () => {
    bloom.fixedDurMode = fixedDurModeSelect.value as 'trim' | 'scale';
  });

  // Fixed grid
  const fixedGridEnabledCb = document.getElementById('fixed-grid-enabled') as HTMLInputElement;
  const fixedGridSizeInput = document.getElementById('fixed-grid-size') as HTMLInputElement;
  fixedGridEnabledCb?.addEventListener('change', () => {
    const on = fixedGridEnabledCb.checked;
    if (fixedGridSizeInput) fixedGridSizeInput.disabled = !on;
    bloom.fixedGrid = on ? parseInt(fixedGridSizeInput?.value ?? '8') : false;
  });
  fixedGridSizeInput?.addEventListener('change', () => {
    if (bloom.fixedGrid !== false) bloom.fixedGrid = parseInt(fixedGridSizeInput.value);
  });

  // Palette freezes — one per list, captured from the bloom when ticked
  document.querySelectorAll<HTMLInputElement>('.freeze-palette').forEach(cb => {
    cb.addEventListener('change', () => {
      const list = cb.dataset.list as 'pitch' | 'time' | 'vel' | 'chan' | 'iv';
      bloom.freeze(list, cb.checked);
      cb.blur();   // keep keystrokes going to the bloom
    });
  });

  // Velocity ceiling
  const velCeilingInput = document.getElementById('vel-ceiling') as HTMLInputElement;
  velCeilingInput?.addEventListener('change', () => {
    const v = parseInt(velCeilingInput.value);
    if (!isNaN(v)) setVelocityCeiling(v);
  });

  // Reverb
  const reverbMixInput = document.getElementById('reverb-mix') as HTMLInputElement;
  const reverbMixVal = document.getElementById('reverb-mix-val') as HTMLElement;
  const reverbDecayInput = document.getElementById('reverb-decay') as HTMLInputElement;
  reverbMixInput?.addEventListener('input', () => {
    const v = parseFloat(reverbMixInput.value);
    setReverbMix(v);
    if (reverbMixVal) reverbMixVal.textContent = v.toFixed(2);
  });
  reverbDecayInput?.addEventListener('change', () => {
    const v = parseFloat(reverbDecayInput.value);
    if (!isNaN(v) && v >= 0.1) setReverbDecay(v);
  });

  // ─── Demo mode ────────────────────────────────────────────────────────────────
  // Shows each key, large, in the notice above what it did (see ui/notice.ts)
  let _demoMode = false;

  const demoModeCb = document.getElementById('demo-mode') as HTMLInputElement;
  demoModeCb?.addEventListener('change', () => {
    _demoMode = demoModeCb.checked;
    demoModeCb.blur();
  });

  // Show axis (field / deep)
  const showAxisCb = document.getElementById('show-axis') as HTMLInputElement;
  showAxisCb?.addEventListener('change', () => {
    viz.setShowAxis(showAxisCb.checked);
  });

  // Show note labels (all views)
  const showNoteLabelsCb = document.getElementById('show-note-labels') as HTMLInputElement;
  showNoteLabelsCb?.addEventListener('change', () => {
    viz.setShowNoteLabels(showNoteLabelsCb.checked);
  });

  // Max channels (⚙ → midi), remembered across sessions
  const maxChanInput = document.getElementById('max-chan-input') as HTMLInputElement;
  try {
    const saved = parseInt(localStorage.getItem('bloom.maxChan') ?? '');
    if (!isNaN(saved) && saved >= 0 && saved <= 15) { Bloom.maxChan = saved; if (maxChanInput) maxChanInput.value = String(saved); }
  } catch { /* private window */ }
  maxChanInput?.addEventListener('change', () => {
    const v = parseInt(maxChanInput.value);
    if (!isNaN(v) && v >= 0 && v <= 15) {
      Bloom.maxChan = v;
      try { localStorage.setItem('bloom.maxChan', String(v)); } catch { /* best effort */ }
    }
  });

  // Picture waits (⚙ → midi): the glow held back to land with the sound of a MIDI note, remembered
  const lagInput = document.getElementById('midi-lag-input') as HTMLInputElement | null;
  try {
    const saved = parseInt(localStorage.getItem('bloom.midiLag') ?? '');
    if (!isNaN(saved)) { setMidiLag(saved); if (lagInput) lagInput.value = String(midiLag()); }
  } catch { /* private window */ }
  lagInput?.addEventListener('change', () => {
    setMidiLag(parseInt(lagInput.value));
    lagInput.value = String(midiLag());
    try { localStorage.setItem('bloom.midiLag', String(midiLag())); } catch { /* best effort */ }
    display.setStatus(`the picture waits ${midiLag()} ms for a MIDI note to be heard`);
  });

  // Launch quantize (play ▾): a bloom lifted while the loop runs waits for it to come round
  const launchCb = document.getElementById('launch-quantize') as HTMLInputElement | null;
  try { if (launchCb) launchCb.checked = localStorage.getItem('bloom.launch') === '1'; } catch { /* private window */ }
  launchCb?.addEventListener('change', () => {
    try { localStorage.setItem('bloom.launch', launchCb.checked ? '1' : '0'); } catch { /* best effort */ }
    display.setStatus(`launch quantize ${launchCb.checked ? 'on: a lifted bloom waits for the loop to come round' : 'off'}`);
  });

  // ─── Save / load garden ───────────────────────────────────────────────────────
  function doSave() {
    saveGarden(bloom, garden);
    display.setStatus('saved');
  }

  function doLoad() {
    loadGarden(bloom, garden, (err) => {
      if (err) { display.setStatus(err); return; }
      clearPins();
      clearSelection();
      keysRefresh('loaded', false);
    });
  }

  // blur after a click so a later space plays rather than pressing the button again
  document.getElementById('save-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doSave(); });
  document.getElementById('load-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doLoad(); });

  window.addEventListener('keydown', (e) => {
    if (takePhase() === 'playing') return;   // the session is set aside
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    // not from inside an overlay or a text field: the editor's own cmd-s is the browser's
    if (Overlay.anyOpen()) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); doLoad(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); commandPalette.open(); }
  });

  console.log('Bloom Web ready.');
}

main().catch(err => {
  console.error('Bloom Web init error:', err);
  const el = document.getElementById('console-overlay');
  if (el) el.textContent = `Error: ${err.message}`;
});
