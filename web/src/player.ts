// Bloom Player — plays back a recorded piece, bloom by bloom
//
//   player.html?piece=flow&mode=deep&theme=dark
//
// The piece file (see scripts/midi_to_piece.py) holds the recorded notes plus an
// annotation saying which bloom each note belongs to and its position in it.

import './style.css';
import * as Tone from 'tone';
import { Bloom } from './core/Bloom';
import { noteOn, noteOff, allNotesOff } from './audio/midi';
import { loadSynth, pianoOutput } from './audio/synth';
import { BloomVisualization } from './ui/visualization';
import type { VizMode, ThemeId } from './ui/theme';

// ─── Piece file ───────────────────────────────────────────────────────────────

interface PieceBloom {
  notes: number[];
  velocities: number[];
  timeIntervals: number[];
  /** Number of the stable loop this state belongs to; null for a fragment */
  loop: number | null;
}

/** [start s, duration s, pitch, velocity, bloom index, position in bloom] */
type PieceEvent = [number, number, number, number, number, number];

interface Piece {
  version: 1;
  title: string;
  duration: number;
  blooms: PieceBloom[];
  events: PieceEvent[];
}

const MODES: VizMode[] = ['deep', 'flower', 'field', 'orbit', 'tonal', 'spiral', 'set', 'helix', 'score'];
const THEME_IDS: ThemeId[] = ['dark', 'phosphor', 'ember', 'arctic', 'solar', 'uv', 'minimal'];

const TICK_MS = 25;
const LOOKAHEAD_MS = 200;
// Hidden tabs only get a timer tick about once a second
const LOOKAHEAD_HIDDEN_MS = 1500;

function formatTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const pieceName = (params.get('piece') ?? 'flow').replace(/[^a-z0-9_-]/gi, '');
  const mode = MODES.find(m => m === params.get('mode')) ?? 'deep';
  const themeId = THEME_IDS.find(t => t === params.get('theme')) ?? 'dark';

  // ─── DOM refs ───────────────────────────────────────────────────────────────
  const canvas = document.getElementById('bloom-canvas') as HTMLCanvasElement;
  const startEl = document.getElementById('start') as HTMLElement;
  const startButton = document.getElementById('start-button') as HTMLButtonElement;
  const startTitle = document.getElementById('start-title') as HTMLElement;
  const startStatus = document.getElementById('start-status') as HTMLElement;
  const transport = document.getElementById('transport') as HTMLElement;
  const playButton = document.getElementById('play') as HTMLButtonElement;
  const bar = document.getElementById('bar') as HTMLElement;
  const barFill = document.getElementById('bar-fill') as HTMLElement;
  const timeEl = document.getElementById('time') as HTMLElement;
  const labelEl = document.getElementById('label') as HTMLElement;

  const viz = new BloomVisualization(canvas);
  viz.setMode(mode);
  viz.setTheme(themeId);

  // ─── Load ───────────────────────────────────────────────────────────────────
  let piece: Piece;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}pieces/${pieceName}.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    piece = await res.json() as Piece;
    if (piece.version !== 1) throw new Error(`unknown version ${piece.version}`);
  } catch (err) {
    startStatus.textContent = `could not load "${pieceName}": ${err instanceof Error ? err.message : err}`;
    return;
  }

  const { events, blooms, duration } = piece;
  const loopCount = blooms.reduce((n, b) => (b.loop !== null ? Math.max(n, b.loop + 1) : n), 0);
  startTitle.textContent = piece.title;
  document.title = piece.title;
  bar.setAttribute('aria-valuemax', String(Math.round(duration)));

  // A marker on the bar wherever a new loop enters
  let lastLoop: number | null = null;
  for (const ev of events) {
    const loop = blooms[ev[4]].loop;
    if (loop !== null && loop !== lastLoop) {
      const m = document.createElement('div');
      m.className = 'marker';
      m.style.left = `${(ev[0] / duration) * 100}%`;
      bar.appendChild(m);
    }
    if (loop !== null) lastLoop = loop;
  }

  // ─── Bloom display ──────────────────────────────────────────────────────────
  let shownIndex = -1;
  let shown: Bloom | null = null;

  function showBloom(index: number): void {
    if (index === shownIndex) return;
    const next = blooms[index];
    const prev = shownIndex >= 0 ? blooms[shownIndex] : null;
    shownIndex = index;

    const samePitches = shown !== null && prev !== null
      && prev.loop !== null && prev.loop === next.loop;
    if (samePitches) {
      // Same bloom, new cycle — velocities and timing moved, the notes did not
      shown!.velocities = [...next.velocities];
      shown!.timeIntervals = [...next.timeIntervals];
    } else {
      shown = new Bloom([...next.notes], [...next.velocities], [...next.timeIntervals], 0);
      viz.setBloom(shown);
    }
    labelEl.textContent = next.loop !== null ? `${next.loop + 1} / ${loopCount}` : '~';
  }

  showBloom(0);

  // ─── Playback ───────────────────────────────────────────────────────────────
  let playing = false;
  let position = 0;            // seconds into the piece, valid while paused
  let startedAtMs = 0;         // performance.now() that corresponds to position 0
  let nextEvent = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let visualTimers: ReturnType<typeof setTimeout>[] = [];
  let pendingOffs: { atMs: number; pitch: number }[] = [];

  function now(): number {
    return playing ? (performance.now() - startedAtMs) / 1000 : position;
  }

  function indexAt(seconds: number): number {
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid][0] < seconds) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function tick(): void {
    const horizon = performance.now() + (document.hidden ? LOOKAHEAD_HIDDEN_MS : LOOKAHEAD_MS);

    // Releases first: the sampler can only release a note whose attack it has
    // already registered, and those queued here were attacked on an earlier tick
    pendingOffs = pendingOffs.filter(off => {
      if (off.atMs >= horizon) return true;
      noteOff(pianoOutput, 0, off.pitch, off.atMs);
      return false;
    });

    while (nextEvent < events.length) {
      const [start, dur, pitch, vel, bloomIndex, pos] = events[nextEvent];
      const atMs = startedAtMs + start * 1000;
      if (atMs >= horizon) break;

      noteOn(pianoOutput, 0, pitch, vel, atMs);
      pendingOffs.push({ atMs: atMs + dur * 1000, pitch });
      visualTimers.push(setTimeout(() => {
        showBloom(bloomIndex);
        viz.activateNote(pos);
      }, Math.max(0, atMs - performance.now())));
      nextEvent++;
    }

    if (visualTimers.length > 256) visualTimers = visualTimers.slice(-64);
    if (nextEvent >= events.length && now() >= duration) finish();
  }

  function silence(): void {
    visualTimers.forEach(clearTimeout);
    visualTimers = [];
    pendingOffs = [];
    allNotesOff(pianoOutput);
    // Notes already handed to the sampler inside the lookahead still sound; catch them
    setTimeout(() => { if (!playing) allNotesOff(pianoOutput); }, LOOKAHEAD_MS + 50);
  }

  function play(): void {
    if (playing) return;
    if (position >= duration) {
      position = 0;
      showBloom(events[0][4]);
    }
    startedAtMs = performance.now() - position * 1000;
    nextEvent = indexAt(position);
    playing = true;
    timer = setInterval(tick, TICK_MS);
    tick();
    updateTransport();
  }

  function pause(): void {
    if (!playing) return;
    position = now();
    playing = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    silence();
    updateTransport();
  }

  function finish(): void {
    pause();
    position = duration;
    viz.deactivateAll();
  }

  function seek(seconds: number): void {
    const wasPlaying = playing;
    pause();
    position = Math.max(0, Math.min(duration, seconds));
    const i = Math.min(indexAt(position), events.length - 1);
    showBloom(events[i][4]);
    viz.deactivateAll();
    if (wasPlaying) play();
    updateProgress();
  }

  // ─── Transport ──────────────────────────────────────────────────────────────
  function updateTransport(): void {
    playButton.innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    transport.classList.toggle('paused', !playing);
  }

  function updateProgress(): void {
    const t = Math.min(now(), duration);
    barFill.style.width = `${(t / duration) * 100}%`;
    timeEl.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    bar.setAttribute('aria-valuenow', String(Math.round(t)));
  }

  function frame(): void {
    updateProgress();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  playButton.addEventListener('click', () => (playing ? pause() : play()));

  bar.addEventListener('click', (e) => {
    const rect = bar.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  });

  document.addEventListener('keydown', (e) => {
    if (!startEl.classList.contains('hidden')) return;
    if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else play(); }
    if (e.code === 'ArrowRight') seek(now() + 10);
    if (e.code === 'ArrowLeft') seek(now() - 10);
  });

  // ─── Start ──────────────────────────────────────────────────────────────────
  try {
    startStatus.textContent = 'loading piano…';
    await loadSynth();
  } catch (err) {
    startStatus.textContent = `piano failed to load: ${err instanceof Error ? err.message : err}`;
    return;
  }
  startStatus.textContent = '';
  startButton.disabled = false;

  startEl.addEventListener('click', async () => {
    if (startButton.disabled) return;
    await Tone.start();
    startEl.classList.add('hidden');
    play();
  });
}

main();
