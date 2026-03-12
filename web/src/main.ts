// Bloom Web — entry point

import './style.css';
import { Bloom, BloomDefaults } from './core/Bloom';
import { Garden } from './garden';
import { initMidi, allNotesOff, onMidiMessage } from './audio/midi';
import { stopAll, setBpm, getBpm } from './audio/scheduler';
import { saveGarden, loadGarden } from './io/garden-io';
import { BloomVisualization } from './ui/visualization';
import { GardenVisualization } from './ui/gardenVisualization';
import type { VizMode, ThemeId } from './ui/theme';
import { Display } from './ui/display';
import type { KeyHandlerState } from './ui/keys';
import { createKeyHandler } from './ui/keys';
import { BloomEditor } from './ui/bloomEditor';
import { CommandPalette } from './ui/commandPalette';

async function main() {
  // ─── DOM refs ───────────────────────────────────────────────────────────────
  const canvas = document.getElementById('bloom-canvas') as HTMLCanvasElement;
  const displayEl = document.getElementById('console-overlay') as HTMLElement;
  const midiStatusEl = document.getElementById('midi-status') as HTMLElement;
  const midiSelectEl = document.getElementById('midi-select') as HTMLSelectElement;
  const vizArea = document.getElementById('viz-area') as HTMLElement;
  const gardenArea = document.getElementById('garden-area') as HTMLElement;
  const consoleToggleBtn = document.getElementById('console-toggle') as HTMLButtonElement;

  // ─── Core state ─────────────────────────────────────────────────────────────
  const bloom = new Bloom().seed();
  const garden = new Garden();

  // ─── UI ─────────────────────────────────────────────────────────────────────
  const viz = new BloomVisualization(canvas);
  const gardenViz = new GardenVisualization(gardenArea, vizArea);
  const display = new Display(displayEl);

  viz.setBloom(bloom);
  gardenViz.setMode(viz.getMode());
  gardenViz.update(garden);
  display.update(bloom, garden);

  // ─── MIDI ────────────────────────────────────────────────────────────────────
  const midiState = await initMidi();

  function updateMidiUi() {
    if (!midiState.available) {
      midiStatusEl.textContent = midiState.error ?? 'MIDI unavailable';
      midiStatusEl.className = 'midi-status error';
      return;
    }
    midiSelectEl.innerHTML = '';
    midiState.outputs.forEach(out => {
      const opt = document.createElement('option');
      opt.value = out.name;
      opt.textContent = out.name;
      if (midiState.selectedOutput?.name === out.name) opt.selected = true;
      midiSelectEl.appendChild(opt);
    });
    midiStatusEl.textContent = midiState.selectedOutput
      ? `MIDI: ${midiState.selectedOutput.name}`
      : 'No MIDI outputs';
    midiStatusEl.className = midiState.selectedOutput ? 'midi-status ok' : 'midi-status';
  }

  updateMidiUi();

  midiSelectEl.addEventListener('change', () => {
    const name = midiSelectEl.value;
    const found = midiState.outputs.find(o => o.name === name);
    if (found) midiState.selectedOutput = found;
    updateMidiUi();
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
  }

  const bloomEditor = new BloomEditor((b) => refreshAll(b, 'edited'));

  // ─── Command palette ──────────────────────────────────────────────────────────
  const commandPalette = new CommandPalette(
    () => bloom,
    (b) => refreshAll(b, ''),
  );

  // Register commands
  (function registerCommands() {
    const reg = commandPalette.register.bind(commandPalette);

    // Mutation
    reg('mutate',    'mutate notes (diatonic)',   b => b.mutateNotesD());
    reg('mutateC',   'mutate notes (chromatic)',  b => b.mutateNotes());
    reg('mutateT',   'mutate time',               b => b.mutateTime());
    reg('mutateV',   'mutate velocities',         b => b.mutateVelocities());

    // Randomize
    reg('scramble',  'scramble note order',       b => b.scramble());
    reg('shuffle',   'perfect shuffle',           b => b.shuffle());

    // Density
    reg('thicken',   'add similar notes',         b => b.thicken(0.3));
    reg('thin',      'remove random notes',       b => b.thin());
    reg(['gap', 'addgap'],    'insert time gap',  b => b.gap());
    reg('ungap',     'remove time gap',           b => b.unGap());

    // Tempo / dynamics
    reg(['slower', 'slow'], 'stretch time intervals', b => b.slower());
    reg(['faster', 'fast'], 'compress time intervals', b => b.faster());
    reg(['softer', 'soft'], 'reduce velocities',   b => b.softer());
    reg(['louder', 'loud'], 'increase velocities', b => b.louder());
    reg(['avgtime', 'even'], 'even out time intervals', b => b.avgTime());

    // Extend / contract
    reg('droplast',  'drop last note',            b => b.dropLast());
    reg('addone',    'add one random note',       b => b.addOne());
    reg(['addinscale', 'adddiatonic'], 'add note in scale', b => b.addOneInScale());

    // Rotate
    reg('rotatenotes', 'rotate notes array',      b => b.rotateNotes(1));
    reg('rotatevel',   'rotate velocities',       b => b.rotateVelocities(1));
    reg('rotatetime',  'rotate time intervals',   b => b.rotateTime(1));
    reg('rotatechan',  'rotate channels',         b => b.rotateChans(1));

    // Patterning
    reg('stutter',   'stutter pattern',           b => b.stutter());
    reg('sputter',   'sputter pattern',           b => b.sputter());
    reg('spray',     'spray pattern',             b => b.spray());
    reg('ratchet',   'ratchet rhythm',            b => b.ratchet());
    reg('mirror',    'mirror notes',              b => b.mirror());
    reg('braid',     'braid pattern',             b => b.braid());
    reg('pyramid',   'pyramid pattern',           b => b.pyramid());
    reg('quantize',  'quantize to grid (4)',      b => b.quantize(4));
    reg('shear',     'shear pitches',             b => b.shear());
    reg('removedoubles', 'remove double notes',   b => b.removeDoubles());
    reg('drawcurves', 'draw curves diatonic',     b => b.drawCurvesD(10));

    // Pitch
    reg(['invert', 'inv'],     'invert pitches',       b => b.invert());
    reg(['invertmean', 'invm'], 'invert around mean',  b => b.invertMean());
    reg('up1',   'transpose up 1 semitone',            b => b.transpose(1));
    reg('down1', 'transpose down 1 semitone',          b => b.transpose(-1));
    reg('up12',  'transpose up 1 octave',              b => b.transpose(12));
    reg('down12', 'transpose down 1 octave',           b => b.transpose(-12));
    reg('step+', 'diatonic step up',                   b => b.dTranspose(1));
    reg('step-', 'diatonic step down',                 b => b.dTranspose(-1));
    reg('pivot',  'pivot to highest note',             b => b.pivot());
    reg('pivotL', 'pivot to loudest note',             b => b.pivotLoudest());

    // Scale
    reg(['choosescale', 'scale'], 'snap to nearest scale', b => b.chooseScale());
    reg('slant',   'slant scale',                     b => b.slantScale());
    reg('reduce',  'reduce scale degrees',            b => b.reduceScale());

    // Chords
    reg(['chords', 'clump'],    'clump into chords',  b => b.chordsRandShorten());
    reg(['flattenchords', 'flatten'], 'flatten chords', b => b.flattenChords());

    // Shape
    reg(['newshape', 'shape'], 'new bloom shape',     b => b.newShape());
    reg('push',    'push bloom to stack',             b => b.push());
    reg('pop',     'pop bloom from stack',            b => b.pop());
  })();

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

  const { onKey } = createKeyHandler(keyState);

  window.addEventListener('keydown', (e) => {
    // Don't send keystrokes to bloom when editor or palette is open
    if (bloomEditor.isOpen() || commandPalette.isOpen()) return;
    keyState.out = midiState.selectedOutput;
    _pendingDemoKey = formatDemoKey(e);
    _demoShownThisKey = false;
    onKey(e);
    _pendingDemoKey = '';
  });

  window.addEventListener('beforeunload', () => {
    stopAll();
    allNotesOff(midiState.selectedOutput);
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
  });

  resetCameraBtn?.addEventListener('click', () => { viz.resetCamera(); });
  updateResetCameraVisibility(viz.getMode());

  vizThemeSelect?.addEventListener('change', () => {
    const themeId = vizThemeSelect.value as ThemeId;
    viz.setTheme(themeId);
    gardenViz.setTheme(themeId);
    document.body.dataset.theme = themeId === 'dark' ? '' : themeId;
  });

  document.getElementById('help-toggle')?.addEventListener('click', toggleFullHelp);

  // ─── Settings bar ─────────────────────────────────────────────────────────────
  const settingsToggleBtn = document.getElementById('settings-toggle') as HTMLButtonElement;
  const settingsBar = document.getElementById('settings-bar') as HTMLElement;
  settingsToggleBtn?.addEventListener('click', () => {
    const visible = settingsBar.classList.toggle('visible');
    settingsToggleBtn.classList.toggle('active', visible);
  });

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

  // MIDI clock sync (0xF8 = 248 = timing clock, 24 per beat)
  const clockStatus = document.getElementById('clock-sync-status') as HTMLElement;
  let _clockPulses: number[] = [];
  let _clockSynced = false;
  onMidiMessage((data, atMs) => {
    if (data[0] !== 0xf8) return;
    _clockPulses.push(atMs);
    if (_clockPulses.length > 25) _clockPulses.shift();
    if (_clockPulses.length >= 3) {
      const span = _clockPulses[_clockPulses.length - 1] - _clockPulses[0];
      const pulseCount = _clockPulses.length - 1;
      const bpm = Math.round(60_000 / ((span / pulseCount) * 24));
      if (bpm >= 20 && bpm <= 300) {
        setBpm(bpm);
        if (bpmInput) bpmInput.value = String(bpm);
        if (!_clockSynced) {
          _clockSynced = true;
          if (clockStatus) { clockStatus.textContent = 'clk: sync'; clockStatus.classList.add('synced'); }
        }
      }
    }
  });
  // Clear sync indicator if no clock pulse for 1s
  setInterval(() => {
    const last = _clockPulses[_clockPulses.length - 1] ?? 0;
    if (_clockSynced && performance.now() - last > 1000) {
      _clockSynced = false;
      _clockPulses = [];
      if (clockStatus) { clockStatus.textContent = 'clk: free'; clockStatus.classList.remove('synced'); }
    }
  }, 500);

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

  // Fixed scale
  const fixedScaleEnabledCb = document.getElementById('fixed-scale-enabled') as HTMLInputElement;
  fixedScaleEnabledCb?.addEventListener('change', () => {
    bloom.fixedScale = fixedScaleEnabledCb.checked ? bloom.scale : false;
  });

  // ─── Demo mode ────────────────────────────────────────────────────────────────
  const demoToastEl   = document.getElementById('demo-toast')     as HTMLElement;
  const demoToastKey  = document.getElementById('demo-toast-key') as HTMLElement;
  const demoToastCmd  = document.getElementById('demo-toast-cmd') as HTMLElement;
  let _demoMode = false;
  let _demoFadeTimer:  ReturnType<typeof setTimeout> | null = null;
  let _demoHideTimer:  ReturnType<typeof setTimeout> | null = null;

  function showDemoToast(key: string, cmd: string) {
    if (_demoFadeTimer !== null) { clearTimeout(_demoFadeTimer); _demoFadeTimer = null; }
    if (_demoHideTimer !== null) { clearTimeout(_demoHideTimer); _demoHideTimer = null; }
    demoToastKey.textContent = key;
    demoToastCmd.textContent = cmd;
    demoToastEl.style.transition = 'none';
    demoToastEl.style.opacity = '1';
    demoToastEl.style.display = 'block';
    _demoFadeTimer = setTimeout(() => {
      demoToastEl.style.transition = 'opacity 0.3s ease-out';
      demoToastEl.style.opacity = '0';
      _demoHideTimer = setTimeout(() => { demoToastEl.style.display = 'none'; }, 350);
    }, 1500);
  }

  function formatDemoKey(e: KeyboardEvent): string {
    const alt = e.altKey;
    const shift = e.shiftKey;
    if (e.code === 'Space')    return shift ? 'shift-space' : 'space';
    if (e.code === 'ArrowUp')  return '↑';
    if (e.code === 'ArrowDown')  return shift ? 'shift-↓' : '↓';
    if (e.code === 'ArrowLeft')  return shift ? 'shift-←' : '←';
    if (e.code === 'ArrowRight') return shift ? 'shift-→' : '→';
    if (e.code === 'Enter')    return '↵';
    if (e.code === 'Backspace' || e.code === 'Delete') return 'del';
    if (e.code === 'Escape')   return 'esc';
    if (e.code === 'KeyT' && alt)       return 'opt-t';
    if (e.code === 'KeyW' && alt)       return 'opt-w';
    if (e.code === 'KeyE' && alt)       return 'opt-e';
    if (e.code === 'Comma' && alt)      return 'opt-,';
    if (e.code === 'Slash' && alt)      return 'opt-/';
    if (e.code === 'Backslash' && alt && shift) return 'opt-|';
    return e.key;
  }

  // Fire demo toast on first status message per keypress
  let _pendingDemoKey = '';
  let _demoShownThisKey = false;
  display.onStatus = (msg) => {
    if (_demoMode && _pendingDemoKey && !_demoShownThisKey) {
      _demoShownThisKey = true;
      showDemoToast(_pendingDemoKey, msg);
    }
  };

  const demoModeCb = document.getElementById('demo-mode') as HTMLInputElement;
  demoModeCb?.addEventListener('change', () => {
    _demoMode = demoModeCb.checked;
    if (!_demoMode) {
      if (_demoFadeTimer !== null) { clearTimeout(_demoFadeTimer); _demoFadeTimer = null; }
      if (_demoHideTimer !== null) { clearTimeout(_demoHideTimer); _demoHideTimer = null; }
      demoToastEl.style.display = 'none';
    }
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

  // Max channels
  const maxChanInput = document.getElementById('max-chan-input') as HTMLInputElement;
  maxChanInput?.addEventListener('change', () => {
    const v = parseInt(maxChanInput.value);
    if (!isNaN(v) && v >= 0 && v <= 15) {
      Bloom.maxChan = v;
    }
  });

  // ─── Save / load garden ───────────────────────────────────────────────────────
  function doSave() {
    saveGarden(bloom, garden);
    display.setStatus('saved');
  }

  function doLoad() {
    loadGarden(bloom, garden, (err) => {
      if (err) { display.setStatus(err); return; }
      if (viz) viz.setBloom(bloom);
      if (gardenViz) gardenViz.update(garden);
      display.update(bloom, garden, 'loaded');
    });
  }

  document.getElementById('save-garden')?.addEventListener('click', doSave);
  document.getElementById('load-garden')?.addEventListener('click', doLoad);

  window.addEventListener('keydown', (e) => {
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
