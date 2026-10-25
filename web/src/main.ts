// Bloom Web — entry point

import './style.css';
import { Bloom, BloomDefaults } from './core/Bloom';
import type { ListKey, ListVerb, PatternOp } from './core/Bloom';
import { Garden } from './garden';
import { initMidi, allNotesOff, onMidiMessage } from './audio/midi';
import { stopAll, setBpm, getBpm } from './audio/scheduler';
import { ClockFollower, setTimebase } from './audio/clockSync';
import { loadSynth, pianoOutput, setVelocityCeiling, setReverbMix, setReverbDecay } from './audio/synth';
import { saveGarden, loadGarden, autosaveGarden, peekAutosave, restoreAutosave } from './io/garden-io';
import { askRestore } from './ui/restorePrompt';
import {
  tuningLibrary, loadScalaFiles, clearLibrary, connectHelper, onHelperStatus, helperStatus, saveToLibrary,
  heldForBloom, isHeld, setHeldTuning, soundingTuning,
} from './audio/tuningOut';
import { TuningEditor } from './ui/tuningEditor';
import { rebase } from './lib/tuning';
import { ScalePicker } from './ui/scalePicker';
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
import { cueFor } from './ui/cues';
import { setNoticeKey } from './ui/notice';
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
  // A past session is offered, not assumed: restore it or start fresh
  const saved = peekAutosave();
  const restored = saved !== null && await askRestore(saved) && restoreAutosave(saved.raw, bloom, garden);
  if (saved && !restored) autosaveGarden(bloom, garden);   // the fresh start replaces it

  // ─── UI ─────────────────────────────────────────────────────────────────────
  const viz = new BloomVisualization(canvas);
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

  const midiState = await initMidi();

  // Insert the built-in piano as the first available output
  midiState.outputs.unshift(pianoOutput);
  // Default to built-in piano if no output was auto-selected, or always on first load
  if (!midiState.selectedOutput || midiState.selectedOutput !== pianoOutput) {
    midiState.selectedOutput = pianoOutput;
  }

  function updateMidiUi() {
    midiSelectEl.innerHTML = '';
    // Always include the built-in piano + any hardware MIDI outputs
    const allOutputs = [pianoOutput, ...midiState.outputs.filter(o => o !== pianoOutput)];
    allOutputs.forEach(out => {
      const opt = document.createElement('option');
      opt.value = out.name;
      opt.textContent = out.name;
      if (midiState.selectedOutput?.name === out.name) opt.selected = true;
      midiSelectEl.appendChild(opt);
    });
    midiStatusEl.textContent = midiState.selectedOutput
      ? midiState.selectedOutput.name
      : 'No outputs';
    midiStatusEl.className = midiState.selectedOutput ? 'midi-status ok' : 'midi-status';
  }

  updateMidiUi();

  midiSelectEl.addEventListener('change', () => {
    const name = midiSelectEl.value;
    if (name === pianoOutput.name) {
      midiState.selectedOutput = pianoOutput;
    } else {
      const found = midiState.outputs.find(o => o.name === name);
      if (found) midiState.selectedOutput = found;
    }
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

  // Register commands
  (function registerCommands() {
    const reg = commandPalette.register.bind(commandPalette);

    // Mutation
    reg('mutate',    'mutate notes (diatonic)',   b => b.mutateNotesD());
    reg('mutateC',   'mutate notes (chromatic)',  b => b.mutateNotes());

    // Randomize
    reg('scramble',  'scramble whole notes',      b => b.scramble());
    reg('shuffle',   'perfect shuffle (whole notes)', b => b.shuffle());

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

    // Extend / contract
    reg('droplast',  'drop last note',            b => b.dropLast());
    reg('addone',    'add one random note',       b => b.addOne());
    reg(['addinscale', 'adddiatonic'], 'add note in scale', b => b.addOneInScale());

    // Rotate
    reg('rotatenotes', 'rotate notes array',      b => b.rotateNotes(1));
    reg('rotate',      'rotate whole notes',      b => b.rotate(1));
    reg('rotateintervals', 'rotate intervals',    b => b.rotateIntervals(1));

    // Intervals
    reg('randintervals',  'randomize intervals',        b => b.randIntervals());
    reg('addinterval',    'add an interval step',       b => b.addInterval());
    reg('dropinterval',   'drop last interval step',    b => b.dropInterval());
    reg('widenintervals', 'widen intervals by one',     b => b.incrementIntervals(1));
    reg('narrowintervals', 'narrow intervals by one',   b => b.incrementIntervals(-1));
    reg('resetintervals', 'reset intervals (none)',     b => b.resetIntervals());
    reg('bakeintervals',  'bake intervals into notes',  b => b.bakeIntervals());
    reg('sparserintervals', 'intervals further apart (one more rest after each)', b => b.spaceIntervals(true));
    reg('denserintervals', 'intervals closer together (one rest fewer after each)', b => b.spaceIntervals(false));

    // Patterning
    reg('stutter',   'stutter pattern',           b => b.stutter());
    reg('sputter',   'sputter pattern',           b => b.sputter());
    reg('spray',     'spray pattern',             b => b.spray());
    reg('ratchet',   'ratchet rhythm',            b => b.ratchet());
    reg('mirror',    'mirror whole notes',        b => b.mirror());
    reg('braid',     'braid pattern',             b => b.braid());
    reg('pyramid',   'pyramid pattern',           b => b.pyramid());
    reg('quantize',  'quantize to grid (4)',      b => b.quantize(4));
    reg('shear',     'shear: some notes an octave outward', b => b.shear());
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

    // Gestures (whole bloom) and groove-safe rhythm
    reg('calm',      'calm: sparser, softer, narrower',  b => b.calm());
    reg('intensify', 'intensify: busier, louder, wider', b => b.intensify());
    reg('vary',      'small variations all through',     b => b.vary());
    reg('split',     'split a note into two halves',     b => b.splitNote());
    reg('merge',     'merge a note with the next',       b => b.mergeNote());
    reg(['breeze+', 'breeze'], 'some notes up a scale step', b => b.breeze(1));
    reg('breeze-',   'some notes down a scale step',     b => b.breeze(-1));
    reg('breezeup1', 'some notes up a semitone',         b => b.breeze(1, 'semitone'));
    reg('breezedown1', 'some notes down a semitone',     b => b.breeze(-1, 'semitone'));
    reg('breezeup12', 'some notes up an octave',         b => b.breeze(1, 'octave'));
    reg('breezedown12', 'some notes down an octave',     b => b.breeze(-1, 'octave'));
    reg(['sortpitch', 'sortp'], 'sort pitches up',       b => b.sortNotes());

    // One list at a time: <verb><list>, e.g. scrambleP (pitches), invertT, curveV, unifyC
    const PATTERN_NAMES: PatternOp[] = ['scramble', 'shuffle', 'mirror', 'stutter', 'sputter', 'braid', 'pyramid'];
    const LIST_SUFFIX: Array<[ListKey, string, string]> = [
      ['notes', 'P', 'pitches'], ['time', 'T', 'times'], ['vel', 'V', 'velocities'], ['chan', 'C', 'channels'],
      ['iv', 'I', 'intervals'],
    ];
    LIST_SUFFIX.forEach(([k, suffix, name]) => {
      PATTERN_NAMES.forEach(op => reg(`${op}${suffix}`, `${op} ${name} only`, b => b.patternList(k, op)));
      const VERBS: ListVerb[] = [
        'mutate', 'mutateWild', 'nudgeDown', 'nudgeUp', 'octaveDown', 'octaveUp', 'stepDown', 'stepUp',
        'breezeDown', 'breezeUp',
        'converge', 'diverge', 'unify', 'invert', 'invertMid', 'tiltDown', 'tiltUp', 'curve', 'sortUp', 'sortDown',
        'fewer', 'more', 'renew', 'renewWild',
      ];
      VERBS.forEach(verb => reg(`${verb}${suffix}`, `${verb} ${name}`, b => { b.shapeList(k, verb); }));
    });
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

  const { cueContext, onKey, togglePin, clearPins, select, clearSelection, refresh: keysRefresh, mergeGarden, curdle, setClean, syncTuning, toggleHold, leaveListMode } = createKeyHandler(keyState);

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
    const off = !(cueToggle?.checked ?? true) || !!document.getElementById('console-overlay')?.classList.contains('visible');
    cueEl.classList.toggle('off', off);
    if (off) return;
    const { text, tip } = cueFor(ctx);
    if (cueEl.textContent !== text) cueEl.textContent = text;
    cueEl.classList.toggle('tip', tip);
  }
  setInterval(updateCue, 250);   // modes, selections and playback all show within a moment
  updateCue();
  // blur after a click so a later space plays rather than pressing the button again
  document.getElementById('merge-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); mergeGarden(); });
  document.getElementById('curdle-bloom')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); curdle(); });
  keyRefresh = keysRefresh;
  viz.onNodeClick = togglePin;
  viz.onSelect = select;

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
  keyState.typeList = (label, text, commit) => listTyper.open(label, text, commit);

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
  document.getElementById('tuning-load')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.scl';
    input.onchange = async () => {
      if (!input.files) return;
      const { added, skipped } = await loadScalaFiles(input.files);
      fillTuningSelect();
      const note = `${added} tuning${added === 1 ? '' : 's'} loaded`
        + (skipped.length ? ` · ${skipped.length} skipped (${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ' …' : ''})` : '');
      display.setStatus(note);
      if (tuningStatus) tuningStatus.textContent = helperStatus();
    };
    input.click();
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
  viz.onTuningClick = (d, shift) => tuningEditor.pick(d, shift);
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
    // Don't send keystrokes to bloom when editor or palette is open
    if (bloomEditor.isOpen() || commandPalette.isOpen() || scalePicker.isOpen() || listTyper.isOpen()) return;
    // ...or while typing in a text field (the tuning editor, settings numbers)
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA'
      || (target.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((target as HTMLInputElement).type)))) {
      if (e.key === 'Escape') target.blur();
      return;
    }
    keyState.out = midiState.selectedOutput;
    // demo mode: the notice also shows the key, large, for recordings
    setNoticeKey(_demoMode ? formatDemoKey(e) : '');
    onKey(e);
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
    if (e.metaKey || e.ctrlKey || ['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return;
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
      clearPins();
      clearSelection();
      keysRefresh('loaded', false);
    });
  }

  // blur after a click so a later space plays rather than pressing the button again
  document.getElementById('save-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doSave(); });
  document.getElementById('load-garden')?.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doLoad(); });

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
