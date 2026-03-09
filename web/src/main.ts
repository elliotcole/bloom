// Bloom Web — entry point

import './style.css';
import { Bloom, BloomDefaults } from './core/Bloom';
import { Garden } from './garden';
import { initMidi, allNotesOff, onMidiMessage } from './audio/midi';
import { stopAll, setBpm, getBpm } from './audio/scheduler';
import { BloomVisualization } from './ui/visualization';
import { GardenVisualization } from './ui/gardenVisualization';
import type { VizMode, ThemeId } from './ui/theme';
import { Display } from './ui/display';
import type { KeyHandlerState } from './ui/keys';
import { createKeyHandler } from './ui/keys';

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
  };

  const { onKey } = createKeyHandler(keyState);

  window.addEventListener('keydown', (e) => {
    keyState.out = midiState.selectedOutput;
    onKey(e);
  });

  window.addEventListener('beforeunload', () => {
    stopAll();
    allNotesOff(midiState.selectedOutput);
  });

  // ─── Viz mode + theme selects ─────────────────────────────────────────────
  const vizModeSelect = document.getElementById('viz-mode-select') as HTMLSelectElement;
  const vizThemeSelect = document.getElementById('viz-theme-select') as HTMLSelectElement;

  vizModeSelect?.addEventListener('change', () => {
    const mode = vizModeSelect.value as VizMode;
    viz.setMode(mode);
    gardenViz.setMode(mode);
  });

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

  // Max channels
  const maxChanInput = document.getElementById('max-chan-input') as HTMLInputElement;
  maxChanInput?.addEventListener('change', () => {
    const v = parseInt(maxChanInput.value);
    if (!isNaN(v) && v >= 0 && v <= 15) {
      Bloom.maxChan = v;
    }
  });

  console.log('Bloom Web ready.');
}

main().catch(err => {
  console.error('Bloom Web init error:', err);
  const el = document.getElementById('console-overlay');
  if (el) el.textContent = `Error: ${err.message}`;
});
