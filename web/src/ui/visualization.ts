// Bloom visualizer — 9 modes × 5 themes, Canvas 2D

import { Bloom } from '../core/Bloom';
import { wrapAt, flatNotes } from '../lib/arrays';
import { beatsToMs } from '../audio/scheduler';
import { THEMES, getTheme } from './theme';
import type { VizMode, ThemeId, Theme } from './theme';
import { drawNotehead, drawSharp, drawFlat } from './glyphs';
import { Lanes, LANES_HEIGHT } from './lanes';
import type { LaneMode } from './lanes';
import { drawTuningPie, degreeAt } from './tuningPie';
import type { PieMarks } from './tuningPie';

export type { VizMode, ThemeId, Theme };
export { THEMES, getTheme };

// ─── Camera ────────────────────────────────────────────────────────────────────
export interface CameraParams {
  azimuth: number;   // radians, horizontal rotation; default 0
  elevation: number; // radians, vertical tilt; default 0
}
export const DEFAULT_CAMERA: CameraParams = { azimuth: 0, elevation: 0 };

/** Performance frames: aspect ratios a recording is cropped to */
export type FrameAspect = 'off' | '16:9' | '1:1' | '4:5' | '9:16';
const FRAMES: FrameAspect[] = ['off', '16:9', '1:1', '4:5', '9:16'];
const FRAME_RATIO: Record<FrameAspect, number> = { off: 0, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 };

/** The camera after t seconds of drift: two slow sweeps whose periods don't line
 *  up, so the path keeps changing (about ±60° round, ±20° up and down) */
function driftCamera(c: CameraParams, t: number): CameraParams {
  const az = 1.05 * Math.sin((2 * Math.PI * t) / 53) + 0.35 * Math.sin((2 * Math.PI * t) / 23 + 0.7);
  const el = 0.34 * Math.sin((2 * Math.PI * t) / 37 + 1.3);
  const lim = Math.PI / 2 - 0.05;
  return { azimuth: c.azimuth + az, elevation: Math.max(-lim, Math.min(lim, c.elevation + el)) };
}

function loadPref(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function savePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
}

// ─── Node hits ─────────────────────────────────────────────────────────────────
// While the main view draws, each node notes where it went, so a click can
// find its event. Garden thumbnails use the same draw functions with this off.

interface NodeHit { i: number; x: number; y: number; r: number }
let _hits: NodeHit[] | null = null;
function hit(i: number, x: number, y: number, r: number): void { _hits?.push({ i, x, y, r }); }

// ─── Small helpers ─────────────────────────────────────────────────────────────

function pc(note: number): number { return ((Math.round(note) % 12) + 12) % 12; }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

// Extract RGB from a theme css colour string and reapply a specific alpha.
// Handles rgba(r,g,b,a) and rgb(r,g,b) formats used throughout theme.ts.
function withAlpha(cssColor: string, alpha: number): string {
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : cssColor;
}

// ─── Added notes (intervals array) ────────────────────────────────────────────

/**
 * Mark for a note the intervals array adds at playback: an open diamond in the
 * pitch's colour, so it reads as secondary to the bloom's own notes.
 */
function drawAddedMark(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  pitch: number, vel: number, flash: number,
  theme: Theme,
  alphaScale = 1,
): void {
  const [h, s, l, a] = theme.noteHsla(pc(pitch), vel * 0.85, flash);
  const size = r + flash * 3;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  if (flash > 0.02 && !theme.strokeOnly) {
    ctx.fillStyle = `hsla(${h},${s}%,${l}%,${flash * 0.35 * alphaScale})`;
    ctx.fill();
  }
  ctx.strokeStyle = `hsla(${h},${s}%,${clamp(l + 12, 0, 96)}%,${clamp((a + 0.25) * alphaScale, 0, 1)})`;
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

/**
 * Where a raga sounds another note than the one written (Bloom.sounding): a
 * faint dashed ring at the written pitch, so the note drawn is the one heard.
 */
function drawWrittenMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, theme: Theme): void {
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = withAlpha(theme.text, 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Pitch-class circles: a dashed ring on each pitch class written but not sounding there */
function drawWrittenPcMarks(
  ctx: CanvasRenderingContext2D, bloom: Bloom, theme: Theme,
  cx: number, cy: number, outerR: number, nodeR: number, angleOf: (p: number) => number,
): void {
  const done = new Set<number>();
  for (let i = 0; i < bloom.notes.length; i++) {
    const w = bloom.writtenAt(i);
    if (w === null || done.has(pc(w))) continue;
    done.add(pc(w));
    const ang = angleOf(pc(w));
    drawWrittenMark(ctx, cx + Math.cos(ang) * outerR, cy + Math.sin(ang) * outerR, nodeR * 1.4, theme);
  }
}

/**
 * Pitch-class circles (tonal, set): a diamond on each pitch class the intervals
 * add — around the node when the bloom already has that pitch class.
 */
function drawAddedPcMarks(
  ctx: CanvasRenderingContext2D,
  bloom: Bloom, flashValues: number[], theme: Theme,
  cx: number, cy: number, outerR: number, nodeR: number,
  angleOf: (p: number) => number,
  ownCount: Int32Array,
): void {
  if (!bloom.hasExtraNotes()) return;
  const flash = new Float32Array(12);
  const vel = new Float32Array(12);
  const present = new Uint8Array(12);
  for (let i = 0; i < bloom.notes.length; i++) {
    bloom.extraNotesAt(i).forEach(pitch => {
      const p = pc(pitch);
      present[p] = 1;
      flash[p] = Math.max(flash[p], flashValues[i] ?? 0);
      vel[p] = Math.max(vel[p], wrapAt(bloom.velocities, i));
    });
  }
  for (let p = 0; p < 12; p++) {
    if (!present[p]) continue;
    const ang = angleOf(p);
    const r = ownCount[p] > 0 ? nodeR * 1.9 : nodeR * 0.9;
    drawAddedMark(ctx, cx + Math.cos(ang) * outerR, cy + Math.sin(ang) * outerR, r, p, vel[p], flash[p], theme);
  }
}

/** Every pitch the bloom sounds: its own notes plus those the intervals add and the figures play */
function soundingPitches(bloom: Bloom): number[] {
  const own = flatNotes(bloom.notes) as number[];
  if (!bloom.hasExtraNotes()) return own;
  return own.concat(...bloom.notes.map((_, i) => bloom.extraNotesAt(i)));
}

// ─── Note label helpers ───────────────────────────────────────────────────────

const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function pitchName(midi: number): string {
  const n = Math.round(midi);
  return MIDI_NOTE_NAMES[((n % 12) + 12) % 12] + String(Math.floor(n / 12) - 1);
}

type NoteLabel = { x: number; y: number; label: string };

// Renders pitch-name labels radially outward from `center`.
// `offset` = gap in px beyond the dot edge toward the outside of the shape.
// `dotRadius` = radius of the dot at each label position; label is placed dotRadius+offset px from center.
function overlayNoteLabels(
  ctx: CanvasRenderingContext2D,
  labels: NoteLabel[],
  center: { x: number; y: number },
  theme: Theme,
  offset = 14,
  dotRadius = 0,
): void {
  if (labels.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.id === 'phosphor' ? 'rgba(57,255,20,0.55)'
    : theme.id === 'uv'       ? 'rgba(200,100,255,0.55)'
    :                            'rgba(255,255,255,0.40)';
  const dist = dotRadius + offset;
  for (const { x, y, label } of labels) {
    const dx = x - center.x;
    const dy = y - center.y;
    const d = Math.hypot(dx, dy);
    const nx = d > 0.5 ? dx / d : 0;
    const ny = d > 0.5 ? dy / d : -1;
    ctx.fillText(label, x + nx * dist, y + ny * dist);
  }
  ctx.restore();
}

// ─── 1. Radial ────────────────────────────────────────────────────────────────

export function drawRadialAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;
  const times = notes.map((_, i) => wrapAt(bloom.timeIntervals, i));
  const totalTime = times.reduce((s, t) => s + t, 0) || 1;

  // Cumulative-time angles: arc between petals is proportional to each note's time interval
  let cumTime = 0;
  const noteAngles = times.map(t => {
    const a = (cumTime / totalTime) * Math.PI * 2 - Math.PI / 2;
    cumTime += t;
    return a;
  });

  ctx.globalCompositeOperation = theme.blendMode;

  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const flash = flashValues[i] ?? 0;
    const vel = wrapAt(bloom.velocities, i);

    chordNotes.forEach((pitch, ci) => {
      const angle = noteAngles[i] + ci * 0.05;
      const baseLength = (pitch / 127) * radius * 0.8 + radius * 0.08; // pitch → length
      const baseHW = (vel / 127) * 16 + 4;                              // velocity → width
      const length = baseLength + flash * radius * 0.05;                // 5% flash boost
      const halfW = baseHW + flash * 2;
      hit(i, cx - Math.sin(angle) * baseLength * 0.75, cy + Math.cos(angle) * baseLength * 0.75, Math.max(10, halfW));

      const [h, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(halfW, length * 0.3, halfW, length * 0.7, 0, length);
      ctx.bezierCurveTo(-halfW, length * 0.7, -halfW, length * 0.3, 0, 0);
      ctx.closePath();

      if (theme.strokeOnly) {
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, length);
        grad.addColorStop(0, `hsla(${h},${s}%,${l}%,0)`);
        grad.addColorStop(0.25, `hsla(${h},${s}%,${l}%,${a})`);
        grad.addColorStop(1, `hsla(${h},${s}%,${clamp(l + 25, 0, 98)}%,${a * 0.7})`);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      if (flash > 0.1 && theme.glowScale > 0) {
        ctx.strokeStyle = `hsla(${h},100%,92%,${flash * 0.8})`;
        ctx.lineWidth = flash * 1.5;
        ctx.stroke();
      }
      ctx.restore();
    });

    // Added notes sit where their petal's tip would be
    bloom.extraNotesAt(i).forEach((pitch, ai) => {
      const angle = noteAngles[i] + (chordNotes.length + ai) * 0.05;
      const len = (pitch / 127) * radius * 0.8 + radius * 0.08;
      drawAddedMark(ctx, cx - Math.sin(angle) * len, cy + Math.cos(angle) * len, 4.5, pitch, vel, flash, theme);
    });
    const w = bloom.writtenAt(i);
    if (w !== null) {
      const len = (w / 127) * radius * 0.8 + radius * 0.08;
      drawWrittenMark(ctx, cx - Math.sin(noteAngles[i]) * len, cy + Math.cos(noteAngles[i]) * len, 4.5, theme);
    }
  }

  ctx.globalCompositeOperation = 'source-over';

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();

  if (showNoteLabels) {
    const labels: NoteLabel[] = [];
    for (let i = 0; i < n; i++) {
      const nv = notes[i];
      const cns = Array.isArray(nv) ? (nv as number[]) : [nv as number];
      cns.forEach((pitch, ci) => {
        const angle = noteAngles[i] + ci * 0.05;
        const len = (pitch / 127) * radius * 0.8 + radius * 0.08;
        // Petal is drawn along local Y after ctx.rotate(angle), so world tip = (cx - sin*len, cy + cos*len)
        labels.push({ x: cx - Math.sin(angle) * len, y: cy + Math.cos(angle) * len, label: pitchName(pitch) });
      });
    }
    overlayNoteLabels(ctx, labels, { x: cx, y: cy }, theme, 12);
  }
}

// ─── 2. Piano / Field (constellation) ────────────────────────────────────────

export function drawPianoAt(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  flashValues: number[] = [],
  playheadIndex = -1,
  showLabels = true,
  beadProgress = 0,
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;

  const wingW = showLabels ? w * 0.2 : 0;
  const PX = x + wingW;
  const PW = w - wingW * 2;
  const PY = y + h * 0.10;
  const PH = h * 0.78;

  const allPitches = soundingPitches(bloom);
  const rawMin = Math.min(...allPitches);
  const rawMax = Math.max(...allPitches);
  const margin = Math.max(6, Math.round((rawMax - rawMin) * 0.18));
  const minNote = Math.max(0, rawMin - margin);
  const maxNote = Math.min(127, rawMax + margin);
  const noteSpan = maxNote - minNote || 12;
  // Anchor x-axis to note onsets: first note at left, last note at right
  let _tLast = 0;
  for (let i = 0; i < n - 1; i++) _tLast += wrapAt(bloom.timeIntervals, i);
  const timeScale = n > 1 && _tLast > 0 ? _tLast : 1;

  const noteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
  const timeToX = (t: number) => n > 1 ? PX + (t / timeScale) * PW : PX + PW * 0.5;

  // Octave guide lines
  if (showLabels) {
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    for (let note = Math.ceil(minNote / 12) * 12; note <= maxNote; note += 12) {
      const gy = noteToY(note);
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PX, gy);
      ctx.lineTo(PX + PW, gy);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(`C${Math.floor(note / 12) - 1}`, PX - 6, gy + 3);
    }
  }

  // Build centroids
  const centroids: Array<{ x: number; y: number }> = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    centroids.push({ x: timeToX(t), y: noteToY(avgPitch) });
    t += wrapAt(bloom.timeIntervals, i);
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // Polygon fill
  if (n >= 3) {
    const shCx = centroids.reduce((a, c) => a + c.x, 0) / n;
    const shCy = centroids.reduce((a, c) => a + c.y, 0) / n;
    const maxDist = Math.max(...centroids.map(c => Math.hypot(c.x - shCx, c.y - shCy)), 1);
    const avgFlash = flashValues.length ? flashValues.reduce((a, b) => a + b, 0) / flashValues.length : 0;
    const [inner, outer] = theme.polyFill(avgFlash);

    ctx.beginPath();
    ctx.moveTo(centroids[0].x, centroids[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(centroids[i].x, centroids[i].y);
    ctx.closePath();

    const grad = ctx.createRadialGradient(shCx, shCy, 0, shCx, shCy, maxDist);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Connector lines
  ctx.lineWidth = 0.5;
  for (let i = 0; i < n - 1; i++) {
    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha((fa + fb) * 0.5)})`;
    ctx.beginPath();
    ctx.moveTo(centroids[i].x, centroids[i].y);
    ctx.lineTo(centroids[i + 1].x, centroids[i + 1].y);
    ctx.stroke();
  }

  // Note circles
  t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    const nx = timeToX(t);
    const baseR = 4.5;
    const r = baseR + flash * 7;

    chordNotes.forEach(pitch => {
      const ny = noteToY(pitch);
      hit(i, nx, ny, baseR + 5);
      const [h, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);

      if (flash > 0.04 && theme.glowScale > 0) {
        const gr = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 2.8 * theme.glowScale);
        gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
        gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(nx, ny, r * 2.8 * theme.glowScale, 0, Math.PI * 2);
        ctx.fill();
      }

      if (theme.strokeOnly) {
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (flash > 0.01) {
        const ringR = (baseR + 7) + (1 - flash) * 22;
        ctx.strokeStyle = `rgba(255,255,255,${flash * 0.38})`;
        ctx.lineWidth = 1.5 * flash;
        ctx.beginPath();
        ctx.arc(nx, ny, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    bloom.extraNotesAt(i).forEach(pitch =>
      drawAddedMark(ctx, nx, noteToY(pitch), baseR, pitch, vel, flash, theme));
    const written = bloom.writtenAt(i);
    if (written !== null) drawWrittenMark(ctx, nx, noteToY(written), baseR, theme);
    t += wrapAt(bloom.timeIntervals, i);
  }

  // Traveling bead
  if (playheadIndex >= 0 && playheadIndex < n - 1 && beadProgress > 0.01 && beadProgress < 0.99) {
    const from = centroids[playheadIndex];
    const to = centroids[playheadIndex + 1];
    const bx = from.x + (to.x - from.x) * beadProgress;
    const by = from.y + (to.y - from.y) * beadProgress;
    const gr = ctx.createRadialGradient(bx, by, 0, bx, by, 7);
    gr.addColorStop(0, 'rgba(255,255,255,0.13)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';

  if (showNoteLabels) {
    const labels: NoteLabel[] = [];
    let tl = 0;
    for (let i = 0; i < n; i++) {
      const nv = notes[i];
      const ps = Array.isArray(nv) ? (nv as number[]) : [nv as number];
      const lx = timeToX(tl);
      ps.forEach(p => labels.push({ x: lx, y: noteToY(p), label: pitchName(p) }));
      tl += wrapAt(bloom.timeIntervals, i);
    }
    if (labels.length > 0) {
      const shapeCx = labels.reduce((a, l) => a + l.x, 0) / labels.length;
      const shapeCy = labels.reduce((a, l) => a + l.y, 0) / labels.length;
      overlayNoteLabels(ctx, labels, { x: shapeCx, y: shapeCy }, theme, 8, 5);
    }
  }
}

// ─── 2b. Span (Field with absolute pitch axis) ────────────────────────────────
//
// Identical to Field except the Y axis is fixed to bloom.lowestPossibleNote /
// bloom.highestPossibleNote — so transposing visibly moves dots up and down
// within a stable, compass-defined frame of reference.

export function drawFieldAt(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  flashValues: number[] = [],
  playheadIndex = -1,
  beadProgress = 0,
  theme: Theme = THEMES.dark,
  showLabels = true,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;

  const wingW = showLabels ? w * 0.2 : 0;
  const PX = x + wingW;
  const PW = w - wingW * 2;
  const PY = y + h * 0.10;
  const PH = h * 0.78;

  // Fixed axis: compass bounds instead of per-bloom auto-fit
  const minNote = bloom.lowestPossibleNote;
  const maxNote = bloom.highestPossibleNote;
  const noteSpan = maxNote - minNote || 12;
  // Anchor x-axis to note onsets: first note at left, last note at right
  let _tLast = 0;
  for (let i = 0; i < n - 1; i++) _tLast += wrapAt(bloom.timeIntervals, i);
  const timeScale = n > 1 && _tLast > 0 ? _tLast : 1;

  const noteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
  const timeToX = (t: number) => n > 1 ? PX + (t / timeScale) * PW : PX + PW * 0.5;

  // Octave guide lines + labels
  if (showLabels) {
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    for (let note = Math.ceil(minNote / 12) * 12; note <= maxNote; note += 12) {
      const gy = noteToY(note);
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PX, gy);
      ctx.lineTo(PX + PW, gy);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(`C${Math.floor(note / 12) - 1}`, PX - 6, gy + 3);
    }
  }

  // Build centroids
  const centroids: Array<{ x: number; y: number }> = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    centroids.push({ x: timeToX(t), y: noteToY(avgPitch) });
    t += wrapAt(bloom.timeIntervals, i);
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // Polygon fill
  if (n >= 3) {
    const shCx = centroids.reduce((a, c) => a + c.x, 0) / n;
    const shCy = centroids.reduce((a, c) => a + c.y, 0) / n;
    const maxDist = Math.max(...centroids.map(c => Math.hypot(c.x - shCx, c.y - shCy)), 1);
    const avgFlash = flashValues.length ? flashValues.reduce((a, b) => a + b, 0) / flashValues.length : 0;
    const [inner, outer] = theme.polyFill(avgFlash);

    ctx.beginPath();
    ctx.moveTo(centroids[0].x, centroids[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(centroids[i].x, centroids[i].y);
    ctx.closePath();

    const grad = ctx.createRadialGradient(shCx, shCy, 0, shCx, shCy, maxDist);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Connector lines
  ctx.lineWidth = 0.5;
  for (let i = 0; i < n - 1; i++) {
    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha((fa + fb) * 0.5)})`;
    ctx.beginPath();
    ctx.moveTo(centroids[i].x, centroids[i].y);
    ctx.lineTo(centroids[i + 1].x, centroids[i + 1].y);
    ctx.stroke();
  }

  // Note circles
  t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    const nx = timeToX(t);
    const baseR = 4.5;
    const r = baseR + flash * 7;

    chordNotes.forEach(pitch => {
      const ny = noteToY(pitch);
      hit(i, nx, ny, baseR + 5);
      const [h, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);

      if (flash > 0.04 && theme.glowScale > 0) {
        const gr = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 2.8 * theme.glowScale);
        gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
        gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(nx, ny, r * 2.8 * theme.glowScale, 0, Math.PI * 2);
        ctx.fill();
      }

      if (theme.strokeOnly) {
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (flash > 0.01) {
        const ringR = (baseR + 7) + (1 - flash) * 22;
        ctx.strokeStyle = `rgba(255,255,255,${flash * 0.38})`;
        ctx.lineWidth = 1.5 * flash;
        ctx.beginPath();
        ctx.arc(nx, ny, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    bloom.extraNotesAt(i).forEach(pitch =>
      drawAddedMark(ctx, nx, noteToY(pitch), baseR, pitch, vel, flash, theme));
    const written = bloom.writtenAt(i);
    if (written !== null) drawWrittenMark(ctx, nx, noteToY(written), baseR, theme);
    t += wrapAt(bloom.timeIntervals, i);
  }

  // Traveling bead
  if (playheadIndex >= 0 && playheadIndex < n - 1 && beadProgress > 0.01 && beadProgress < 0.99) {
    const from = centroids[playheadIndex];
    const to = centroids[playheadIndex + 1];
    const bx = from.x + (to.x - from.x) * beadProgress;
    const by = from.y + (to.y - from.y) * beadProgress;
    const gr = ctx.createRadialGradient(bx, by, 0, bx, by, 7);
    gr.addColorStop(0, 'rgba(255,255,255,0.13)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';

  if (showNoteLabels) {
    const labels: NoteLabel[] = [];
    let tl = 0;
    for (let i = 0; i < n; i++) {
      const nv = notes[i];
      const ps = Array.isArray(nv) ? (nv as number[]) : [nv as number];
      const lx = timeToX(tl);
      ps.forEach(p => labels.push({ x: lx, y: noteToY(p), label: pitchName(p) }));
      tl += wrapAt(bloom.timeIntervals, i);
    }
    if (labels.length > 0) {
      const shapeCx = labels.reduce((a, l) => a + l.x, 0) / labels.length;
      const shapeCy = labels.reduce((a, l) => a + l.y, 0) / labels.length;
      overlayNoteLabels(ctx, labels, { x: shapeCx, y: shapeCy }, theme, 8, 5);
    }
  }
}

// ─── 2c. Deep (Span + 3D perspective — velocity = Z depth) ───────────────────
//
// Shares Span's fixed Y axis (compass bounds) and X axis (time).
// Velocity maps to Z depth: vel=127 → closest, vel=0 → farthest.
// 3D cues: perspective X convergence, dot size scaling, alpha fading,
// and painter's-algorithm draw order (far → close).

export function drawDeepAt(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  flashValues: number[] = [],
  playheadIndex = -1,
  beadProgress = 0,
  theme: Theme = THEMES.dark,
  showLabels = false,
  showNoteLabels = false,
  camera: CameraParams = DEFAULT_CAMERA,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const wingW = showLabels ? w * 0.2 : 0;
  const PX = x + wingW;
  const PW = w - wingW * 2;
  const PY = y + h * 0.10;
  const PH = h * 0.78;

  // Fixed axis — compass bounds (same as Span)
  const minNote = bloom.lowestPossibleNote;
  const maxNote = bloom.highestPossibleNote;
  const noteSpan = maxNote - minNote || 12;
  // Anchor x-axis to note onsets: first note at left, last note at right
  let _tLast = 0;
  for (let i = 0; i < n - 1; i++) _tLast += wrapAt(bloom.timeIntervals, i);
  const timeScale = n > 1 && _tLast > 0 ? _tLast : 1;

  const midY = PY + PH * 0.5;
  const elevCos = Math.cos(camera.elevation);
  const elevSin = Math.sin(camera.elevation);
  const _baseNoteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
  // pitch contributes cos(elevation) to Y; velocity depth contributes sin(elevation) to Y
  // so top-down view (elevation→π/2) maps Z (vel) onto the screen's Y axis
  const noteToY = (p: number) => midY + (_baseNoteToY(p) - midY) * elevCos;
  const depthToY = (vel: number) => elevSin * (vel / 127 - 0.5) * PH;
  const timeToX = (t: number) => n > 1 ? PX + (t / timeScale) * PW : PX + PW * 0.5;
  const midX = PX + PW * 0.5;
  const vpX = midX + Math.sin(camera.azimuth) * PW * 0.45;

  // 3D perspective helpers
  // vel=127 → zNorm=1 (close), vel=0 → zNorm=0 (far)
  const proj3d = (baseX: number, vel: number) => {
    const zNorm = vel / 127;
    // X converges toward camera vanishing point
    const projX = vpX + (baseX - vpX) * (0.80 + 0.20 * zNorm);
    // Dot scale: far=small, close=large
    const dotScale = 0.70 + zNorm * 0.90;   // 0.70 → 1.60
    // Alpha multiplier: far=faint, close=vivid
    const depthAlpha = 0.45 + zNorm * 0.55; // 0.45 → 1.00
    return { projX, dotScale, depthAlpha, zNorm };
  };

  // Axis labels (optional)
  if (showLabels) {
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    for (let note = Math.ceil(minNote / 12) * 12; note <= maxNote; note += 12) {
      const gy = noteToY(note);
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PX, gy);
      ctx.lineTo(PX + PW, gy);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(`C${Math.floor(note / 12) - 1}`, PX - 6, gy + 3);
    }
  }

  // ── Perspective depth reference box ──────────────────────────────────────────
  // Each face lives at a fixed velocity (depth). depthToY() offsets Y so the box
  // shears correctly when elevation ≠ 0 — matching how note positions are computed.
  {
    const pjX = (bx: number, vel: number) => vpX + (bx - vpX) * (0.80 + 0.20 * (vel / 127));
    const yAt  = (pitch: number, vel: number) => noteToY(pitch) + depthToY(vel);
    const fL = PX, fR = PX + PW;                      // front face (vel=127) X
    const bL = pjX(PX, 0), bR = pjX(PX + PW, 0);     // back face (vel=0) X

    const yTN = yAt(maxNote, 127), yBN = yAt(minNote, 127); // near (front) top/bottom
    const yTF = yAt(maxNote,   0), yBF = yAt(minNote,   0); // far (back)  top/bottom

    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 0.8;

    // Front face (vel=127, nearest)
    ctx.beginPath();
    ctx.moveTo(fL, yTN); ctx.lineTo(fR, yTN); ctx.lineTo(fR, yBN); ctx.lineTo(fL, yBN);
    ctx.closePath(); ctx.stroke();

    // Back face (vel=0, farthest)
    ctx.beginPath();
    ctx.moveTo(bL, yTF); ctx.lineTo(bR, yTF); ctx.lineTo(bR, yBF); ctx.lineTo(bL, yBF);
    ctx.closePath(); ctx.stroke();

    // 4 corner depth rails (near → far)
    ctx.beginPath(); ctx.moveTo(fL, yTN); ctx.lineTo(bL, yTF); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fR, yTN); ctx.lineTo(bR, yTF); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fL, yBN); ctx.lineTo(bL, yBF); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fR, yBN); ctx.lineTo(bR, yBF); ctx.stroke();

    // Intermediate depth planes at vel=42 and vel=85
    for (const vel of [42, 85]) {
      const mL = pjX(fL, vel), mR = pjX(fR, vel);
      const yTM = yAt(maxNote, vel), yBM = yAt(minNote, vel);
      ctx.beginPath(); ctx.moveTo(mL, yTM); ctx.lineTo(mR, yTM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mL, yBM); ctx.lineTo(mR, yBM); ctx.stroke();
    }

    // Vertical time dividers at 1/4, 1/2, 3/4 across each depth face
    for (let d = 1; d <= 3; d++) {
      const tx = fL + (PW / 4) * d;
      const bx = pjX(tx, 0);
      ctx.beginPath(); ctx.moveTo(tx, yTN); ctx.lineTo(tx, yBN); ctx.stroke(); // front
      ctx.beginPath(); ctx.moveTo(bx, yTF); ctx.lineTo(bx, yBF); ctx.stroke(); // back
      ctx.beginPath(); ctx.moveTo(tx, yTN); ctx.lineTo(bx, yTF); ctx.stroke(); // top rail
      ctx.beginPath(); ctx.moveTo(tx, yBN); ctx.lineTo(bx, yBF); ctx.stroke(); // bottom rail
    }
  }

  // Build per-sequence centroids for connector lines + bead
  const centroids: Array<{ x: number; y: number; zNorm: number }> = [];

  // Build flat list of all note instances for depth-sorted drawing
  type Inst = {
    added?: boolean; written?: boolean;
    pitch: number; vel: number; flash: number;
    projX: number; projY: number;
    dotScale: number; depthAlpha: number; zNorm: number;
  };
  const instances: Inst[] = [];

  let t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    const nx = timeToX(t);
    const { projX, dotScale, depthAlpha, zNorm } = proj3d(nx, vel);

    // Centroid at average pitch
    const avgPitch = chordNotes.reduce((a, b) => a + b, 0) / chordNotes.length;
    centroids.push({ x: projX, y: noteToY(avgPitch) + depthToY(vel), zNorm });

    chordNotes.forEach(pitch => {
      instances.push({ pitch, vel, flash, projX, projY: noteToY(pitch) + depthToY(vel), dotScale, depthAlpha, zNorm });
      hit(i, projX, noteToY(pitch) + depthToY(vel), 7 * dotScale + 4);
    });
    bloom.extraNotesAt(i).forEach(pitch => {
      instances.push({ added: true, pitch, vel, flash, projX, projY: noteToY(pitch) + depthToY(vel), dotScale, depthAlpha, zNorm });
    });
    const written = bloom.writtenAt(i);
    if (written !== null) instances.push({ written: true, pitch: written, vel, flash, projX, projY: noteToY(written) + depthToY(vel), dotScale, depthAlpha, zNorm });

    t += wrapAt(bloom.timeIntervals, i);
  }

  // Painter's algorithm — draw far notes first
  instances.sort((a, b) => a.zNorm - b.zNorm);

  ctx.globalCompositeOperation = theme.blendMode;

  // Connector lines (sequence order, depth-faded)
  ctx.lineWidth = 0.5;
  for (let i = 0; i < n - 1; i++) {
    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    const avgZ = (centroids[i].zNorm + centroids[i + 1].zNorm) * 0.5;
    const alpha = theme.lineAlpha((fa + fb) * 0.5) * (0.2 + 0.8 * avgZ);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(centroids[i].x, centroids[i].y);
    ctx.lineTo(centroids[i + 1].x, centroids[i + 1].y);
    ctx.stroke();
  }

  // Note circles — back to front
  const baseR = 7.0;
  for (const inst of instances) {
    const { pitch, vel, flash, projX, projY, dotScale, depthAlpha, zNorm } = inst;
    if (inst.added) {
      drawAddedMark(ctx, projX, projY, baseR * dotScale * 0.8, pitch, vel, flash, theme, depthAlpha);
      continue;
    }
    if (inst.written) { drawWrittenMark(ctx, projX, projY, baseR * dotScale, theme); continue; }
    const [h, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);
    const finalA = a * depthAlpha;
    const r = baseR * dotScale + flash * 7 * zNorm;

    // Glow (scaled by depth — far glows are suppressed)
    if (flash > 0.04 && zNorm > 0.25 && theme.glowScale > 0) {
      const glowR = r * 2.8 * theme.glowScale;
      const gr = ctx.createRadialGradient(projX, projY, 0, projX, projY, glowR);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45 * zNorm})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(projX, projY, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${finalA})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(projX, projY, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${finalA})`;
      ctx.beginPath();
      ctx.arc(projX, projY, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (flash > 0.01 && zNorm > 0.2) {
      const ringR = (baseR * dotScale + 7) + (1 - flash) * 22;
      ctx.strokeStyle = `rgba(255,255,255,${flash * 0.38 * zNorm})`;
      ctx.lineWidth = 1.5 * flash;
      ctx.beginPath();
      ctx.arc(projX, projY, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Traveling bead
  if (playheadIndex >= 0 && playheadIndex < n - 1 && beadProgress > 0.01 && beadProgress < 0.99) {
    const from = centroids[playheadIndex];
    const to = centroids[playheadIndex + 1];
    const bx = from.x + (to.x - from.x) * beadProgress;
    const by = from.y + (to.y - from.y) * beadProgress;
    const bz = from.zNorm + (to.zNorm - from.zNorm) * beadProgress;
    const beadR = 7 * (0.5 + 0.5 * bz);
    const gr = ctx.createRadialGradient(bx, by, 0, bx, by, beadR);
    gr.addColorStop(0, 'rgba(255,255,255,0.13)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(bx, by, beadR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5 * (0.5 + 0.5 * bz), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';

  if (showNoteLabels && instances.length > 0) {
    const labels: NoteLabel[] = instances.filter(inst => !inst.added).map(inst => ({
      x: inst.projX, y: inst.projY, label: pitchName(inst.pitch),
    }));
    const shapeCx = labels.reduce((a, l) => a + l.x, 0) / labels.length;
    const shapeCy = labels.reduce((a, l) => a + l.y, 0) / labels.length;
    overlayNoteLabels(ctx, labels, { x: shapeCx, y: shapeCy }, theme, 8, 7);
  }
}

// ─── 3. Grand Staff Score ─────────────────────────────────────────────────────
// Pitch-only grand staff: solid noteheads + accidentals, no rhythmic values.
// Notes spread left → right by onset time. Uses Canvas 2D throughout.

export function drawScoreAt(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showLabels = false,
  compact = false,          // garden mode: no clefs/brace, staff fills the slot
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;

  // ── Staff layout ─────────────────────────────────────────────────────────────
  // LINE_SPACING = gap between adjacent staff lines.
  // HALF = one diatonic step = LINE_SPACING / 2.
  // Grand staff spans 10 LINE_SPACINGs total (pos −10 → +10).
  // compact: size freely to fill the slot height; full view: clamp to readable range.
  const LINE_SPACING = compact ? h / 12.5 : clamp(h / 18, 10, 20);
  const HALF = LINE_SPACING / 2;

  // Y anchor: staffPos 0 = Middle C, at vertical centre of box.
  const staffCenterY = y + h * 0.5;
  const posToY = (p: number) => staffCenterY - p * HALF;

  // ── Dynamic staff width ────────────────────────────────────────────────────
  // Staff scales with note count so sparse blooms cluster in the centre and
  // dense ones expand toward the canvas edges — mirroring the deep view.
  const LEFT_MARGIN  = compact ? LINE_SPACING * 0.5  : LINE_SPACING * 7.0;
  const RIGHT_MARGIN = compact ? LINE_SPACING * 0.5  : LINE_SPACING * 4.0;
  const INNER_PAD    = compact ? LINE_SPACING * 1.0  : LINE_SPACING * 5.0;
  const NOTE_SLOT    = compact ? LINE_SPACING * 2.5  : LINE_SPACING * 4.5;
  const overhead    = LEFT_MARGIN + RIGHT_MARGIN + INNER_PAD * 2;
  const rawNoteW    = n > 1 ? (n - 1) * NOTE_SLOT : NOTE_SLOT * 2;
  const noteW       = clamp(rawNoteW, NOTE_SLOT * 2, w - overhead);
  const totalW      = noteW + overhead;
  // Centre the grand-staff block within the canvas.
  const blockX  = x + (w - totalW) / 2;
  const staffX1 = blockX + LEFT_MARGIN;
  const staffX2 = staffX1 + INNER_PAD + noteW + INNER_PAD;
  const NOTE_X1 = staffX1 + INNER_PAD;

  // Notehead geometry — small and flat like Crumb's hand-engraved noteheads.
  const NH_W    = LINE_SPACING * 0.54;   // semi-major (horizontal) — used for ledger + accidental x-offset
  const LEDGER_W = NH_W * 2.5;           // half-width of ledger lines

  // Single unified colour — notation view is monochrome.
  const scoreCol = withAlpha(theme.text, 0.70);

  // ── Draw staff lines & barlines ──────────────────────────────────────────────
  ctx.save();
  ctx.lineWidth = 0.7;   // hairline — matches Crumb's manuscript weight
  for (const pos of [2, 4, 6, 8, 10, -2, -4, -6, -8, -10]) {
    ctx.strokeStyle = scoreCol;
    ctx.beginPath();
    ctx.moveTo(staffX1, posToY(pos));
    ctx.lineTo(staffX2, posToY(pos));
    ctx.stroke();
  }

  // Vertical barlines (left + right of each staff section).
  ctx.strokeStyle = scoreCol;
  ctx.lineWidth = 1.0;
  ctx.beginPath(); ctx.moveTo(staffX1, posToY(10)); ctx.lineTo(staffX1, posToY(2));  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(staffX2, posToY(10)); ctx.lineTo(staffX2, posToY(2));  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(staffX1, posToY(-2)); ctx.lineTo(staffX1, posToY(-10)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(staffX2, posToY(-2)); ctx.lineTo(staffX2, posToY(-10)); ctx.stroke();

  if (!compact) {
    // Brace — slender bracket joining both staves.
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(staffX1 - 3, posToY(10));
    ctx.lineTo(staffX1 - 3, posToY(-10));
    ctx.stroke();

    // ── Clef glyphs (font-rendered, sitting on the staff) ─────────────────────
    const clefX  = staffX1 + LINE_SPACING * 0.3;
    const clefFS = LINE_SPACING * 4;
    ctx.fillStyle = scoreCol;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${clefFS}px 'Bravura', serif`;
    ctx.fillText('\u{1D11E}', clefX, posToY(4)  - LINE_SPACING * 0.2);
    ctx.fillText('\u{1D122}', clefX, posToY(-4) - LINE_SPACING * 0.2);
  }

  ctx.restore();

  if (n === 0) return;

  // ── Pitch → staff-position mapping ───────────────────────────────────────────
  // staffPos 0 = C4 (Middle C).  Diatonic steps, signed from C4.
  const CHROMA_DIAT  = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // chroma → diatonic index
  const NEEDS_SHARP  = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]; // 1 = ♯ required

  function midiToStaff(midi: number): { pos: number; acc: string | null } {
    const pc_ = ((Math.round(midi) % 12) + 12) % 12;
    const oct  = Math.floor(midi / 12) - 1;           // C4 is octave 4
    return {
      pos: CHROMA_DIAT[pc_] + 7 * (oct - 4),
      acc: NEEDS_SHARP[pc_] ? '♯' : null,
    };
  }

  // Returns extra ledger-line positions for a note outside its staff.
  // Treble staff spans pos 2–10; Bass staff spans pos −2–−10.
  // Middle-C zone (pos ≤ 0) is handled by the treble branch (pos ≥ 0 → treble).
  function ledgerLines(pos: number, isTreble: boolean): number[] {
    const out: number[] = [];
    const isEven = (pos & 1) === 0;
    if (isTreble) {
      if (pos > 10) {
        // Above F5: ledger at 12, 14, … up to note's even position.
        for (let l = 12; l <= (isEven ? pos : pos - 1); l += 2) out.push(l);
      } else if (pos <= 0) {
        // At/below Middle C: ledger at 0, −2, … down to note's even position.
        for (let l = 0; l >= (isEven ? pos : pos + 1); l -= 2) out.push(l);
      }
    } else {
      // Bass: only needs ledgers below G2 (pos < −10).
      if (pos < -10) {
        for (let l = -12; l >= (isEven ? pos : pos + 1); l -= 2) out.push(l);
      }
    }
    return out;
  }

  // ── Time → X mapping ─────────────────────────────────────────────────────────
  let tLast = 0;
  for (let i = 0; i < n - 1; i++) tLast += wrapAt(bloom.timeIntervals, i);
  const timeScale   = n > 1 && tLast > 0 ? tLast : 1;
  const onsetToX    = (t: number) =>
    n > 1 ? NOTE_X1 + (t / timeScale) * noteW : NOTE_X1 + noteW * 0.5;

  // ── Draw notes ────────────────────────────────────────────────────────────────
  ctx.save();

  let t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches: number[] = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const flash = flashValues[i] ?? 0;
    const nx    = onsetToX(t);

    // Detect adjacent-interval pairs within this chord (classic "second" displacement).
    const sortedPos = pitches.map(p => midiToStaff(p).pos).sort((a, b) => a - b);
    const shiftSet = new Set<number>();
    for (let k = 0; k < sortedPos.length - 1; k++) {
      if (sortedPos[k + 1] - sortedPos[k] === 1) shiftSet.add(sortedPos[k + 1]);
    }

    pitches.forEach(pitch => {
      const { pos, acc } = midiToStaff(pitch);
      const isTreble = pos >= 0;
      const ny = posToY(pos);
      const fx = shiftSet.has(pos) ? nx + NH_W * 1.9 : nx; // offset seconds

      // Ledger lines.
      ctx.strokeStyle = scoreCol;
      ctx.lineWidth   = 0.9;
      for (const lp of ledgerLines(pos, isTreble)) {
        ctx.beginPath();
        ctx.moveTo(fx - LEDGER_W, posToY(lp));
        ctx.lineTo(fx + LEDGER_W, posToY(lp));
        ctx.stroke();
      }

      // Accidental — Canvas-drawn sharp or flat (no font required).
      if (acc === '♯') {
        drawSharp(ctx, fx - NH_W - LINE_SPACING * 0.72, ny, LINE_SPACING, scoreCol);
      } else if (acc === '♭') {
        drawFlat(ctx, fx - NH_W - LINE_SPACING * 0.55, ny, LINE_SPACING, scoreCol);
      }

      // Notehead — Canvas-drawn solid ellipse, hand-engraved tilt.
      drawNotehead(ctx, fx, ny, LINE_SPACING, scoreCol);
      hit(i, fx, ny, Math.max(8, LINE_SPACING));

      // Flash ring — thin circle that expands and fades on note-on.
      if (flash > 0.01) {
        const ringR = NH_W * (1.4 + (1 - flash) * 3.2);  // starts tight, expands outward
        const ringA = flash * 0.75;                        // fades with flash
        ctx.beginPath();
        ctx.arc(fx, ny, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(theme.text, ringA);
        ctx.lineWidth   = 0.9;
        ctx.stroke();
      }
    });

    // Added notes — open diamond noteheads, like harmonics.
    bloom.extraNotesAt(i).forEach(pitch => {
      const { pos, acc } = midiToStaff(pitch);
      const ny = posToY(pos);
      const crowded = sortedPos.some(p => Math.abs(p - pos) <= 1);
      const fx = crowded ? nx + NH_W * 1.9 : nx;

      ctx.strokeStyle = scoreCol;
      ctx.lineWidth   = 0.9;
      for (const lp of ledgerLines(pos, pos >= 0)) {
        ctx.beginPath();
        ctx.moveTo(fx - LEDGER_W, posToY(lp));
        ctx.lineTo(fx + LEDGER_W, posToY(lp));
        ctx.stroke();
      }
      if (acc === '♯') drawSharp(ctx, fx - NH_W - LINE_SPACING * 0.72, ny, LINE_SPACING, scoreCol);

      ctx.beginPath();
      ctx.moveTo(fx, ny - HALF);
      ctx.lineTo(fx + NH_W, ny);
      ctx.lineTo(fx, ny + HALF);
      ctx.lineTo(fx - NH_W, ny);
      ctx.closePath();
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.strokeStyle = flash > 0.01 ? withAlpha(theme.text, 0.70 + flash * 0.30) : scoreCol;
      ctx.lineWidth   = 1.1;
      ctx.stroke();
    });

    // The written note, where a raga sounds another: a dashed ghost notehead
    const written = bloom.writtenAt(i);
    if (written !== null) {
      const { pos } = midiToStaff(written);
      drawWrittenMark(ctx, nx + NH_W * 1.9, posToY(pos), HALF, theme);
    }

    // Optional pitch-name labels above/below the staff.
    if (showLabels) {
      ctx.font         = '8px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'center';
      ctx.fillStyle    = withAlpha(theme.text, 0.55);
      pitches.forEach(pitch => {
        const { pos } = midiToStaff(pitch);
        const labelY = pos >= 0 ? posToY(13) : posToY(-13);
        ctx.fillText(pitchName(pitch), nx, labelY);
      });
    }

    t += wrapAt(bloom.timeIntervals, i);
  }
  ctx.restore();
}

// ─── 4. Orbit ─────────────────────────────────────────────────────────────────

export function drawOrbitAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  orbitRotation = 0,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;
  const minR = radius * 0.10;
  const maxR = radius * 0.88;

  ctx.globalCompositeOperation = theme.blendMode;

  // Central star
  const starR = 3 + (theme.glowScale > 0 ? 1 : 0);
  if (theme.glowScale > 0) {
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 5);
    sg.addColorStop(0, theme.id === 'phosphor' ? 'rgba(255,176,0,0.4)' : 'rgba(255,255,255,0.3)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, starR * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy, starR, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;

    chordNotes.forEach((pitch, ci) => {
      const r = minR + (pitch / 127) * (maxR - minR);
      const initialAngle = ((i + ci * 0.12) / n) * Math.PI * 2 - Math.PI / 2;
      const angle = initialAngle + orbitRotation;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      const planetR = 3 + (vel / 127) * 8 + flash * 5;
      hit(i, px, py, planetR + 5);
      const [h, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);

      // Orbit ring (faint)
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Comet trail on flash
      if (flash > 0.05) {
        const trailArc = flash * 0.6;
        // Arc trail behind the planet
        ctx.save();
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${flash * 0.5})`;
        ctx.lineWidth = planetR * 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle - trailArc, angle, false);
        ctx.stroke();
        ctx.restore();
      }

      // Glow halo
      if (flash > 0.05 && theme.glowScale > 0) {
        const gr = ctx.createRadialGradient(px, py, 0, px, py, planetR * 3 * theme.glowScale);
        gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.5})`);
        gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(px, py, planetR * 3 * theme.glowScale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Planet
      if (theme.strokeOnly) {
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, planetR, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const pg = ctx.createRadialGradient(px - planetR * 0.3, py - planetR * 0.3, 0, px, py, planetR);
        pg.addColorStop(0, `hsla(${h},${s}%,${clamp(l + 20, 0, 100)}%,${a})`);
        pg.addColorStop(1, `hsla(${h},${s}%,${l}%,${a})`);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, planetR, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Added notes ride their own orbit at the same angle
    bloom.extraNotesAt(i).forEach((pitch, ai) => {
      const r = minR + (pitch / 127) * (maxR - minR);
      const angle = ((i + (chordNotes.length + ai) * 0.12) / n) * Math.PI * 2 - Math.PI / 2 + orbitRotation;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      drawAddedMark(ctx, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 3 + (vel / 127) * 5, pitch, vel, flash, theme);
    });
    const written = bloom.writtenAt(i);
    if (written !== null) {
      const r = minR + (written / 127) * (maxR - minR);
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + orbitRotation;
      drawWrittenMark(ctx, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 3 + (vel / 127) * 5, theme);
    }
  }

  ctx.globalCompositeOperation = 'source-over';

  if (showNoteLabels) {
    const labels: NoteLabel[] = [];
    for (let i = 0; i < n; i++) {
      const nv = notes[i];
      const cns = Array.isArray(nv) ? (nv as number[]) : [nv as number];
      cns.forEach((pitch, ci) => {
        const r_orb = minR + (pitch / 127) * (maxR - minR);
        const angle = ((i + ci * 0.12) / n) * Math.PI * 2 - Math.PI / 2 + orbitRotation;
        labels.push({ x: cx + Math.cos(angle) * r_orb, y: cy + Math.sin(angle) * r_orb, label: pitchName(pitch) });
      });
    }
    overlayNoteLabels(ctx, labels, { x: cx, y: cy }, theme, 8, 11);
  }
}


// ─── 5. Tonal Web (circle of fifths) ─────────────────────────────────────────

const FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B Gb Db Ab Eb Bb F
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Map pitch class → index in the circle of fifths
const _pcToFifths: number[] = new Array(12);
FIFTHS_ORDER.forEach((p, i) => { _pcToFifths[p] = i; });

function fifthsAngle(p: number): number {
  return (_pcToFifths[p] / 12) * Math.PI * 2 - Math.PI / 2;
}

export function drawTonalAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const outerR = radius * 0.82;
  const nodeR = clamp(radius * 0.075, 4, 16);
  const labelR = outerR + nodeR + 16;

  // Per-pitch-class aggregates
  const pcFlash = new Float32Array(12);
  const pcVel = new Float32Array(12);
  const pcCount = new Int32Array(12);

  for (let i = 0; i < bloom.notes.length; i++) {
    const noteVal = bloom.notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    pitches.forEach(pitch => {
      const p = pc(pitch);
      pcFlash[p] = Math.max(pcFlash[p], flash);
      pcVel[p] = Math.max(pcVel[p], vel);
      pcCount[p]++;
    });
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // Connecting arcs between consecutive note PCs
  for (let i = 0; i < bloom.notes.length - 1; i++) {
    const noteA = bloom.notes[i];
    const noteB = bloom.notes[i + 1];
    const pitchesA = Array.isArray(noteA) ? (noteA as number[]) : [noteA as number];
    const pitchesB = Array.isArray(noteB) ? (noteB as number[]) : [noteB as number];
    const pcA = pc(pitchesA[0]);
    const pcB = pc(pitchesB[0]);
    if (pcA === pcB) continue;

    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    const fEdge = (fa + fb) * 0.5;

    const ax = cx + Math.cos(fifthsAngle(pcA)) * outerR;
    const ay = cy + Math.sin(fifthsAngle(pcA)) * outerR;
    const bx = cx + Math.cos(fifthsAngle(pcB)) * outerR;
    const by = cy + Math.sin(fifthsAngle(pcB)) * outerR;

    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha(fEdge)})`;
    ctx.lineWidth = 0.5 + fEdge * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // Nodes
  const fontSzT = clamp(radius * 0.07, 8, 12);
  ctx.font = `${fontSzT}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const scalePCsT: Set<number> = bloom.appliedScale
    ? new Set(bloom.appliedScale.degrees)
    : new Set();
  const scaleCircleColorT = theme.id === 'phosphor' ? 'rgba(57,255,20,0.55)'
    : theme.id === 'uv' ? 'rgba(200,100,255,0.55)'
    : 'rgba(255,255,255,0.55)';
  const labelColorActive = theme.id === 'phosphor' ? 'rgba(57,255,20,0.90)'
    : theme.id === 'uv' ? 'rgba(220,160,255,0.90)'
    : 'rgba(255,255,255,0.85)';
  const labelColorDim = theme.id === 'phosphor' ? 'rgba(57,255,20,0.40)'
    : theme.id === 'uv' ? 'rgba(200,100,255,0.40)'
    : 'rgba(255,255,255,0.38)';

  for (let p = 0; p < 12; p++) {
    const ang = fifthsAngle(p);
    const nx = cx + Math.cos(ang) * outerR;
    const ny = cy + Math.sin(ang) * outerR;
    const lx = cx + Math.cos(ang) * labelR;
    const ly = cy + Math.sin(ang) * labelR;

    if (pcCount[p] === 0) {
      // Placeholder
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      if (showNoteLabels) {
        if (scalePCsT.has(p)) {
          ctx.strokeStyle = scaleCircleColorT;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(lx, ly, fontSzT + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = scalePCsT.has(p) ? labelColorDim : theme.text;
        ctx.fillText(PC_NAMES[p], lx, ly);
      }
      continue;
    }

    const flash = pcFlash[p];
    const vel = pcVel[p];
    const [h, s, l, a] = theme.noteHsla(p, vel, flash);
    const nr = nodeR + flash * nodeR + (pcCount[p] - 1) * nodeR * 0.15;

    if (flash > 0.05 && theme.glowScale > 0) {
      const gr = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr * 3.5 * theme.glowScale);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(nx, ny, nr * 3.5 * theme.glowScale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showNoteLabels) {
      if (scalePCsT.has(p)) {
        ctx.strokeStyle = scaleCircleColorT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lx, ly, fontSzT + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = labelColorActive;
      ctx.fillText(PC_NAMES[p], lx, ly);
    }
  }

  drawAddedPcMarks(ctx, bloom, flashValues, theme, cx, cy, outerR, nodeR, fifthsAngle, pcCount);
  drawWrittenPcMarks(ctx, bloom, theme, cx, cy, outerR, nodeR, fifthsAngle);

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 5b. Set (chromatic order) ───────────────────────────────────────────────

function chromaticAngle(p: number): number {
  return (p / 12) * Math.PI * 2 - Math.PI / 2;
}

export function drawSetAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const outerR = radius * 0.82;
  const nodeR = clamp(radius * 0.075, 4, 16);
  const labelR = outerR + nodeR + 16;

  // Per-pitch-class aggregates
  const pcFlash = new Float32Array(12);
  const pcVel = new Float32Array(12);
  const pcCount = new Int32Array(12);

  for (let i = 0; i < bloom.notes.length; i++) {
    const noteVal = bloom.notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    pitches.forEach(pitch => {
      const p = pc(pitch);
      pcFlash[p] = Math.max(pcFlash[p], flash);
      pcVel[p] = Math.max(pcVel[p], vel);
      pcCount[p]++;
    });
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // Connecting arcs between consecutive note PCs
  for (let i = 0; i < bloom.notes.length - 1; i++) {
    const noteA = bloom.notes[i];
    const noteB = bloom.notes[i + 1];
    const pitchesA = Array.isArray(noteA) ? (noteA as number[]) : [noteA as number];
    const pitchesB = Array.isArray(noteB) ? (noteB as number[]) : [noteB as number];
    const pcA = pc(pitchesA[0]);
    const pcB = pc(pitchesB[0]);
    if (pcA === pcB) continue;

    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    const fEdge = (fa + fb) * 0.5;

    const ax = cx + Math.cos(chromaticAngle(pcA)) * outerR;
    const ay = cy + Math.sin(chromaticAngle(pcA)) * outerR;
    const bx = cx + Math.cos(chromaticAngle(pcB)) * outerR;
    const by = cy + Math.sin(chromaticAngle(pcB)) * outerR;

    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha(fEdge)})`;
    ctx.lineWidth = 0.5 + fEdge * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // Nodes
  const fontSzS = clamp(radius * 0.07, 8, 12);
  ctx.font = `${fontSzS}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const scalePCsS: Set<number> = bloom.appliedScale
    ? new Set(bloom.appliedScale.degrees)
    : new Set();
  const scaleCircleColorS = theme.id === 'phosphor' ? 'rgba(57,255,20,0.55)'
    : theme.id === 'uv' ? 'rgba(200,100,255,0.55)'
    : 'rgba(255,255,255,0.55)';
  const labelColorActiveS = theme.id === 'phosphor' ? 'rgba(57,255,20,0.90)'
    : theme.id === 'uv' ? 'rgba(220,160,255,0.90)'
    : 'rgba(255,255,255,0.85)';
  const labelColorDimS = theme.id === 'phosphor' ? 'rgba(57,255,20,0.40)'
    : theme.id === 'uv' ? 'rgba(200,100,255,0.40)'
    : 'rgba(255,255,255,0.38)';

  for (let p = 0; p < 12; p++) {
    const ang = chromaticAngle(p);
    const nx = cx + Math.cos(ang) * outerR;
    const ny = cy + Math.sin(ang) * outerR;
    const lx = cx + Math.cos(ang) * labelR;
    const ly = cy + Math.sin(ang) * labelR;

    if (pcCount[p] === 0) {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      if (showNoteLabels) {
        if (scalePCsS.has(p)) {
          ctx.strokeStyle = scaleCircleColorS;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(lx, ly, fontSzS + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = scalePCsS.has(p) ? labelColorDimS : theme.text;
        ctx.fillText(PC_NAMES[p], lx, ly);
      }
      continue;
    }

    const flash = pcFlash[p];
    const vel = pcVel[p];
    const [h, s, l, a] = theme.noteHsla(p, vel, flash);
    const nr = nodeR + flash * nodeR + (pcCount[p] - 1) * nodeR * 0.15;

    if (flash > 0.05 && theme.glowScale > 0) {
      const gr = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr * 3.5 * theme.glowScale);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(nx, ny, nr * 3.5 * theme.glowScale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showNoteLabels) {
      if (scalePCsS.has(p)) {
        ctx.strokeStyle = scaleCircleColorS;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lx, ly, fontSzS + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = labelColorActiveS;
      ctx.fillText(PC_NAMES[p], lx, ly);
    }
  }

  drawAddedPcMarks(ctx, bloom, flashValues, theme, cx, cy, outerR, nodeR, chromaticAngle, pcCount);
  drawWrittenPcMarks(ctx, bloom, theme, cx, cy, outerR, nodeR, chromaticAngle);

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 5c. Tonal Spiral (circle of fifths unrolled into a 3D helix/coil) ──────

export function drawSpiralAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
  camera: CameraParams = DEFAULT_CAMERA,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const loNote = bloom.lowestPossibleNote;
  const hiNote = bloom.highestPossibleNote;
  const noteRange = Math.max(1, hiNote - loNote);

  const rx = radius * 0.82;          // horizontal ellipse radius
  const vertSpan = radius * 1.65;    // total vertical extent
  // Elevation shifts the view angle from the default side-on tilt
  const baseViewAngle = Math.asin(0.28);
  const viewAngle = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, baseViewAngle + camera.elevation));
  const ry = rx * Math.abs(Math.sin(viewAngle));

  // Project a MIDI pitch + chromatic angle to 2D
  function project(midi: number): { x: number; y: number; sinT: number } {
    const θ = chromaticAngle(((Math.round(midi) % 12) + 12) % 12) + camera.azimuth;
    const yNorm = (midi - loNote) / noteRange;
    const yOff = (yNorm - 0.5) * vertSpan;
    return {
      x: cx + Math.cos(θ) * rx,
      y: (cy - yOff) + Math.sin(θ) * ry,
      sinT: Math.sin(θ),
    };
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // ── Skeleton guide ──────────────────────────────────────────────────────────
  // Central vertical axis
  ctx.strokeStyle = withAlpha(theme.text, 0.28);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - vertSpan * 0.5);
  ctx.lineTo(cx, cy + vertSpan * 0.5);
  ctx.stroke();

  // Octave rings — faint filled discs (establish horizontal plane) + stroked edge
  const loOct = Math.floor(loNote / 12);
  const hiOct = Math.ceil(hiNote / 12);
  for (let oct = loOct; oct <= hiOct; oct++) {
    const cMidi = oct * 12;
    if (cMidi < loNote - 6 || cMidi > hiNote + 6) continue;
    const yNorm = (cMidi - loNote) / noteRange;
    const ringY = cy - (yNorm - 0.5) * vertSpan;
    ctx.beginPath();
    ctx.ellipse(cx, ringY, rx, ry, camera.azimuth, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(theme.text, 0.05);   // subtle disc
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.text, 0.28); // guide, not foreground
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  // Vertical PC columns — structural reference, clearly secondary to notes
  ctx.lineWidth = 0.8;
  for (let p = 0; p < 12; p++) {
    const θ = chromaticAngle(p) + camera.azimuth;
    const topY = cy - vertSpan * 0.5 + Math.sin(θ) * ry;
    const botY = cy + vertSpan * 0.5 + Math.sin(θ) * ry;
    const colX = cx + Math.cos(θ) * rx;
    const isNatural = [0, 2, 4, 5, 7, 9, 11].includes(p);
    ctx.strokeStyle = withAlpha(theme.text, isNatural ? 0.14 : 0.07);
    ctx.beginPath();
    ctx.moveTo(colX, topY);
    ctx.lineTo(colX, botY);
    ctx.stroke();
  }

  // ── Build note positions ────────────────────────────────────────────────────
  type NotePos = { px: number; py: number; sinT: number; flash: number; vel: number; midiPitch: number; added?: boolean; written?: boolean };
  const positions: NotePos[] = [];

  for (let i = 0; i < bloom.notes.length; i++) {
    const noteVal = bloom.notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    pitches.forEach(midi => {
      const { x, y, sinT } = project(midi);
      positions.push({ px: x, py: y, sinT, flash, vel, midiPitch: midi });
      hit(i, x, y, 9);
    });
    bloom.extraNotesAt(i).forEach(midi => {
      const { x, y, sinT } = project(midi);
      positions.push({ px: x, py: y, sinT, flash, vel, midiPitch: midi, added: true });
    });
    const written = bloom.writtenAt(i);
    if (written !== null) {
      const { x, y, sinT } = project(written);
      positions.push({ px: x, py: y, sinT, flash, vel, midiPitch: written, written: true });
    }
  }

  // ── Constellation lines (cylinder-surface geodesics) ────────────────────────
  // Interpolate in cylindrical space (θ, yOff) rather than in screen space,
  // so each edge curves naturally around the barrel of the spiral.
  for (let i = 0; i < bloom.notes.length - 1; i++) {
    const noteA = bloom.notes[i];
    const noteB = bloom.notes[i + 1];
    const pitchA = Array.isArray(noteA) ? (noteA as number[])[0] : noteA as number;
    const pitchB = Array.isArray(noteB) ? (noteB as number[])[0] : noteB as number;
    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    const fEdge = (fa + fb) * 0.5;

    // Cylindrical coordinates for each endpoint
    const θA    = chromaticAngle(((Math.round(pitchA) % 12) + 12) % 12);
    const θB    = chromaticAngle(((Math.round(pitchB) % 12) + 12) % 12);
    const yOffA = ((pitchA - loNote) / noteRange - 0.5) * vertSpan;
    const yOffB = ((pitchB - loNote) / noteRange - 0.5) * vertSpan;

    // Shortest angular arc (normalise Δθ to [-π, π])
    let Δθ = θB - θA;
    if (Δθ >  Math.PI) Δθ -= 2 * Math.PI;
    if (Δθ < -Math.PI) Δθ += 2 * Math.PI;
    const ΔyOff = yOffB - yOffA;

    // Adaptive step count: more steps for larger angular sweep
    const steps = Math.max(4, Math.ceil(Math.abs(Δθ) / Math.PI * 32));

    ctx.strokeStyle = `rgba(255,255,255,${Math.max(0.30, theme.lineAlpha(fEdge))})`;
    ctx.lineWidth = 1.7 + fEdge * 3.5;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t  = s / steps;
      const θt = θA + t * Δθ;
      const yt = yOffA + t * ΔyOff;
      const px = cx + Math.cos(θt + camera.azimuth) * rx;
      const py = (cy - yt) + Math.sin(θt + camera.azimuth) * ry;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ── Nodes (painter's algorithm: back-to-front by sinT) ─────────────────────
  positions.sort((a, b) => a.sinT - b.sinT);
  const nodeR = clamp(radius * 0.055, 3, 12);

  for (const { px, py, flash, vel, midiPitch, added, written } of positions) {
    if (added) {
      drawAddedMark(ctx, px, py, nodeR * (0.6 + vel / 127 * 0.8), midiPitch, vel, flash, theme);
      continue;
    }
    if (written) { drawWrittenMark(ctx, px, py, nodeR * (0.6 + vel / 127 * 0.8), theme); continue; }
    const p = ((Math.round(midiPitch) % 12) + 12) % 12;
    const [h, s, l, a] = theme.noteHsla(p, vel, flash);
    const nr = nodeR * (0.6 + vel / 127 * 0.8) + flash * nodeR * 0.8;

    if (flash > 0.05 && theme.glowScale > 0) {
      const gr = ctx.createRadialGradient(px, py, 0, px, py, nr * 3 * theme.glowScale);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(px, py, nr * 3 * theme.glowScale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, nr, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.beginPath();
      ctx.arc(px, py, nr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = 'source-over';

  // ── Note labels ─────────────────────────────────────────────────────────────
  if (showNoteLabels && positions.length > 0) {
    const labelPositions: NoteLabel[] = positions.filter(pos => !pos.added).map(({ px, py, midiPitch }) => ({
      x: px, y: py, label: pitchName(midiPitch),
    }));
    const sumX = positions.reduce((s, p) => s + p.px, 0) / positions.length;
    const sumY = positions.reduce((s, p) => s + p.py, 0) / positions.length;
    overlayNoteLabels(ctx, labelPositions, { x: sumX, y: sumY }, theme, 10);
  }
}

// ─── 6. Helix ─────────────────────────────────────────────────────────────────

export function drawHelixAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  showNoteLabels = false,
): void {
  bloom = bloom.sounding();   // a raga's notes as they sound; writtenAt marks the rest
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;
  const turns = 2.5;
  const minR = radius * 0.08;
  const maxR = radius * 0.88;

  const allPitches = soundingPitches(bloom);
  const midPitch = (Math.min(...allPitches) + Math.max(...allPitches)) / 2;
  const pitchHalfRange = Math.max(12, (Math.max(...allPitches) - Math.min(...allPitches)) / 2);

  function spiralPos(t: number, pitch: number): { x: number; y: number } {
    const theta = (t / totalTime) * turns * Math.PI * 2 - Math.PI / 2;
    const baseR = minR + (t / totalTime) * (maxR - minR);
    const pitchOffset = ((pitch - midPitch) / pitchHalfRange) * radius * 0.10;
    const r = clamp(baseR + pitchOffset, minR, maxR);
    return { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r };
  }

  ctx.globalCompositeOperation = theme.blendMode;

  // Background spiral path
  const steps = 200;
  ctx.beginPath();
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * totalTime;
    const theta = (t / totalTime) * turns * Math.PI * 2 - Math.PI / 2;
    const r = minR + (s / steps) * (maxR - minR);
    const sx = cx + Math.cos(theta) * r;
    const sy = cy + Math.sin(theta) * r;
    if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Compute note positions
  const positions: Array<{ x: number; y: number }> = [];
  let tAccum = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    positions.push(spiralPos(tAccum, avgPitch));
    tAccum += wrapAt(bloom.timeIntervals, i);
  }

  // Connector lines
  for (let i = 0; i < n - 1; i++) {
    const fa = flashValues[i] ?? 0;
    const fb = flashValues[i + 1] ?? 0;
    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha((fa + fb) * 0.5)})`;
    ctx.lineWidth = 0.5 + (fa + fb) * 0.5 * 2;
    ctx.beginPath();
    ctx.moveTo(positions[i].x, positions[i].y);
    ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
    ctx.stroke();
  }

  // Note circles
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    const { x: px, y: py } = positions[i];
    const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const [h, s, l, a] = theme.noteHsla(pc(avgPitch), vel, flash);
    const r = 3.5 + flash * 6 + (vel / 127) * 4;
    hit(i, px, py, r + 6);

    if (flash > 0.05 && theme.glowScale > 0) {
      const gr = ctx.createRadialGradient(px, py, 0, px, py, r * 2.5 * theme.glowScale);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${flash * 0.45})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(px, py, r * 2.5 * theme.glowScale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Added notes: same moment on the spiral, displaced by their own pitch
  let tAdded = 0;
  for (let i = 0; i < n; i++) {
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    bloom.extraNotesAt(i).forEach(pitch => {
      const pos = spiralPos(tAdded, pitch);
      drawAddedMark(ctx, pos.x, pos.y, 3 + (vel / 127) * 3, pitch, vel, flash, theme);
    });
    const written = bloom.writtenAt(i);
    if (written !== null) {
      const pos = spiralPos(tAdded, written);
      drawWrittenMark(ctx, pos.x, pos.y, 3 + (vel / 127) * 3, theme);
    }
    tAdded += wrapAt(bloom.timeIntervals, i);
  }

  ctx.globalCompositeOperation = 'source-over';

  if (showNoteLabels) {
    const labels: NoteLabel[] = [];
    let tl = 0;
    for (let i = 0; i < n; i++) {
      const nv = notes[i];
      const ps = Array.isArray(nv) ? (nv as number[]) : [nv as number];
      const avgPitch = ps.reduce((a, b) => a + b, 0) / ps.length;
      const pos = spiralPos(tl, avgPitch);
      ps.forEach(pitch => labels.push({ x: pos.x, y: pos.y, label: pitchName(pitch) }));
      tl += wrapAt(bloom.timeIntervals, i);
    }
    overlayNoteLabels(ctx, labels, { x: cx, y: cy }, theme, 8, 5);
  }
}




// ─── Main BloomVisualization class ────────────────────────────────────────────

export class BloomVisualization {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;
  private bloom: Bloom | null = null;
  private _mode: VizMode = 'deep';
  private _theme: Theme = THEMES.dark;
  private _showAxis = false;
  private _showNoteLabels = false;
  private _showChanStrip = false;
  private _showLanes = false;
  private _clean = false;
  private _listMode: LaneMode = null;
  private _lanes = new Lanes();
  /** The bloom as written, for the lanes; the looper's display bloom is wrapped to one pass */
  private _lanesBloom: Bloom | null = null;
  /** Running count of notes played, so each lane's cursor cycles at its own length */
  private _tick = -1;

  // Flash / playhead state
  private petalFlash: number[] = [];
  private playheadIndex = -1;
  private _beadActivatedAt = 0;

  // Orbit rotation state (constant autonomous spin)
  private _orbitRotation = 0;

  // 3D camera state (deep and spiral modes)
  private _camera: CameraParams = { azimuth: 0, elevation: 0 };
  // Drift: while notes play, deep and spiral sweep slowly through broad arcs.
  // Its own clock runs only while playing (easing in and out), so the view
  // never jumps; a drag still turns it on top.
  private _drift = loadPref('bloom.drift', '1') === '1';
  private _driftT = 0;
  private _driftSpeed = 0;
  private _lastNoteAt = 0;
  private _lastFrameAt = 0;

  // Performance framing (clean view only): an aspect to fit the picture in,
  // with the outside shaded, and an overall size
  private _frame: FrameAspect = (loadPref('bloom.frame', 'off') as FrameAspect);
  private _size = Number(loadPref('bloom.size', '1')) || 1;
  private _dragActive = false;
  private _dragLastX = 0;
  private _dragLastY = 0;

  // Pinned events: clicked nodes, marked with a ring; where nodes were last drawn
  private _pinned = new Set<number>();
  private _lastHits: NodeHit[] = [];
  /** Called with the event index when a node is clicked */
  onNodeClick: ((i: number) => void) | null = null;
  // Selected events: boxed by a drag, marked with a soft fill
  private _selected = new Set<number>();
  private _box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Called with the events inside a dragged box (empty when a click lands on no node) */
  onSelect: ((idx: number[]) => void) | null = null;
  // The tuning view (opt-t): the tuning as a pie in place of the current view
  private _tuningView = false;
  private _pieMarks: PieMarks = { a: null, b: null };
  private _pie = { cx: 0, cy: 0, R: 0 };   // where the pie was last drawn, in canvas coordinates
  /** Called with the degree (from the root) when a slice is clicked */
  onTuningClick: ((deg: number, shift: boolean) => void) | null = null;
  /** Called when choosing a view leaves the tuning view */
  onTuningViewClosed: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this._setupResize();
    this._startLoop();
    this._setupDrag();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setPinned(pinned: Set<number>): void {
    this._pinned = new Set(pinned);
  }

  setSelected(sel: Set<number>): void {
    this._selected = new Set(sel);
  }

  /** The event under a point in CSS pixels, or -1: the nearest node within its reach */
  private _nodeAt(x: number, y: number): number {
    let best = -1, bestD = Infinity;
    for (const h of this._lastHits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && d < bestD) { best = h.i; bestD = d; }
    }
    return best;
  }

  /** `trace: false` for display-only blooms (the looper's rotated view), so they aren't shown as edits. */
  setBloom(bloom: Bloom, trace = true): void {
    if (trace) { this._lanes.observe(bloom); this._lanesBloom = bloom; }
    this.bloom = bloom;
    this.petalFlash = new Array(bloom.notes.length).fill(0);
    this.playheadIndex = -1;
    this._beadActivatedAt = 0;
    // _orbitRotation intentionally NOT reset here — it only resets on mode change
  }

  setMode(mode: VizMode): void {
    if (this._tuningView) { this._tuningView = false; this.onTuningViewClosed?.(); }
    if (this._mode !== mode) {
      this._mode = mode;
      this._orbitRotation = 0;
      this._camera = { azimuth: 0, elevation: 0 };
    }
    this.canvas.style.cursor = '';
  }

  setTuningView(on: boolean): void { this._tuningView = on; this.canvas.style.cursor = ''; }
  isTuningView(): boolean { return this._tuningView; }
  setPieMarks(m: PieMarks): void { this._pieMarks = m; }
  private _degreeAt(x: number, y: number): number {
    return this._tuningView && this.bloom ? degreeAt(this.bloom, this._pie.cx, this._pie.cy, this._pie.R, x, y) : -1;
  }

  resetCamera(): void {
    this._camera = { azimuth: 0, elevation: 0 };
    this._driftT = 0;
  }

  setTheme(id: ThemeId): void {
    this._theme = getTheme(id);
  }

  setShowAxis(show: boolean): void { this._showAxis = show; }
  setShowNoteLabels(show: boolean): void { this._showNoteLabels = show; }
  toggleNoteLabels(): boolean { this._showNoteLabels = !this._showNoteLabels; return this._showNoteLabels; }
  /** Show the channel strip (channel-edit mode) */
  setChanStrip(show: boolean): void { this._showChanStrip = show; }
  /** Which list mode is active, so its lane is lit */
  setListMode(m: LaneMode): void { this._listMode = m; }
  /** Bloom lanes: the four lists on one time axis under the view */
  toggleLanes(): boolean { this._showLanes = !this._showLanes; return this._showLanes; }
  setLanes(show: boolean): void { this._showLanes = show; }
  get showLanes(): boolean { return this._showLanes; }
  /** Clean: the picture alone, no strips or overlays (for recording) */
  setClean(on: boolean): void { this._clean = on; }
  /** Show the performance frame and size outside clean view too (while the perform menu is open) */
  setFramePreview(on: boolean): void { this._framePreview = on; }
  private _framePreview = false;
  /** Frame and size apply in clean view, and as a preview while they're being set */
  private get _framed(): boolean { return this._clean || (this._framePreview && !this._showLanes); }

  /** Step through the performance frames: off, 16:9, 1:1, 4:5, 9:16 */
  cycleFrame(): FrameAspect {
    const i = FRAMES.indexOf(this._frame);
    this._frame = FRAMES[(i + 1) % FRAMES.length];
    savePref('bloom.frame', this._frame);
    return this._frame;
  }
  setFrame(f: FrameAspect): void { this._frame = f; savePref('bloom.frame', f); }
  getFrame(): FrameAspect { return this._frame; }
  /** The frame's size on screen in CSS pixels, for setting up a recording */
  frameSize(): string {
    const dpr = window.devicePixelRatio || 1;
    const r = this._frameRect(this.canvas.width / dpr, this.canvas.height / dpr, true);
    return `${Math.round(r.w)}×${Math.round(r.h)}`;
  }
  /** Overall size of the picture in clean view, ×0.3 to ×2.5 */
  setSize(size: number): number {
    this._size = Math.max(0.3, Math.min(2.5, Math.round(size * 100) / 100));
    savePref('bloom.size', String(this._size));
    return this._size;
  }
  getSize(): number { return this._size; }
  setDrift(on: boolean): void { this._drift = on; savePref('bloom.drift', on ? '1' : '0'); }
  getDrift(): boolean { return this._drift; }

  /** The rectangle the picture is drawn in: the frame in clean view, else the whole canvas */
  private _frameRect(W: number, H: number, framed = this._framed): { x: number; y: number; w: number; h: number } {
    const ratio = FRAME_RATIO[this._frame];
    if (!framed || !ratio) return { x: 0, y: 0, w: W, h: H };
    const w = Math.min(W, H * ratio), h = w / ratio;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  getMode(): VizMode { return this._mode; }
  getTheme(): ThemeId { return this._theme.id; }

  activateNote(index: number, tick = index): void {
    if (!this.bloom || index < 0 || index >= this.bloom.notes.length) return;
    this._tick = tick;
    if (this.petalFlash.length !== this.bloom.notes.length)
      this.petalFlash = new Array(this.bloom.notes.length).fill(0);
    this.petalFlash[index] = 1.0;
    this.playheadIndex = index;
    this._beadActivatedAt = performance.now();
    this._lastNoteAt = this._beadActivatedAt;

    // orbit: flash driven by petalFlash; rotation is autonomous (no playhead jump)
  }

  deactivateAll(): void {
    this.petalFlash = this.petalFlash.map(() => 0);
    this.playheadIndex = -1;
    this._beadActivatedAt = 0;
    this._tick = -1;
  }

  /** @deprecated — use setMode() instead; kept for callers that used toggleMode() */
  toggleMode(): VizMode {
    const ORDER: VizMode[] = ['deep', 'flower', 'field', 'orbit', 'tonal', 'spiral', 'set', 'helix', 'score'];
    const next = ORDER[(ORDER.indexOf(this._mode) + 1) % ORDER.length];
    this.setMode(next);
    return this._mode;
  }

  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────

  private _setupResize(): void {
    const apply = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = (rect.width || 400) * dpr;
      this.canvas.height = (rect.height || 400) * dpr;
    };
    new ResizeObserver(apply).observe(this.canvas);
    apply();
  }

  // ─── 3D drag navigation ──────────────────────────────────────────────────────

  private _setupDrag(): void {
    const el = this.canvas;

    // A click that didn't drag pins or unpins the node under it; a click on
    // empty space clears the selection. A drag draws a box that selects the
    // nodes inside it, in every view. Deep and spiral turn with a two-finger
    // scroll (or a mouse wheel), or an opt-drag.
    let downX = 0, downY = 0;
    const local = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top] as const;
    };
    const turns = () => !this._tuningView && (this._mode === 'deep' || this._mode === 'spiral');
    el.addEventListener('mousedown', (e) => {
      downX = e.clientX; downY = e.clientY;
      if (!(turns() && e.altKey) && !this._tuningView) {
        const [x, y] = local(e);
        this._box = { x0: x, y0: y, x1: x, y1: y };
      }
    });
    el.addEventListener('click', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
      if (this._tuningView) {
        const d = this._degreeAt(...local(e));
        if (d >= 0) this.onTuningClick?.(d, e.shiftKey);
        return;
      }
      const i = this._nodeAt(...local(e));
      if (i >= 0) this.onNodeClick?.(i);
      else if (this._selected.size) this.onSelect?.([]);
    });
    el.addEventListener('mousemove', (e) => {
      if (this._box) {
        [this._box.x1, this._box.y1] = local(e);
        return;
      }
      if (this._dragActive) return;
      const over = this._tuningView ? this._degreeAt(...local(e)) >= 0 : this._nodeAt(...local(e)) >= 0;
      el.style.cursor = over ? 'pointer' : turns() && e.altKey ? 'grab' : '';
    });
    const endBox = (e: MouseEvent) => {
      const box = this._box;
      if (!box) return;
      this._box = null;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) <= 4) return;   // a click, not a box
      const [xa, xb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [ya, yb] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      const inside = new Set<number>();
      for (const h of this._lastHits) if (h.x >= xa && h.x <= xb && h.y >= ya && h.y <= yb) inside.add(h.i);
      this.onSelect?.([...inside]);
    };
    el.addEventListener('mouseup', endBox);
    el.addEventListener('mouseleave', endBox);

    el.addEventListener('mousedown', (e) => {
      if (!turns() || !e.altKey) return;
      this._dragActive = true;
      this._dragLastX = e.clientX;
      this._dragLastY = e.clientY;
      el.style.cursor = 'grabbing';
    });

    el.addEventListener('mousemove', (e) => {
      if (!this._dragActive) return;
      const dx = e.clientX - this._dragLastX;
      const dy = e.clientY - this._dragLastY;
      this._camera.azimuth += dx * 0.008;
      this._camera.elevation = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, this._camera.elevation + dy * 0.006),
      );
      this._dragLastX = e.clientX;
      this._dragLastY = e.clientY;
    });

    const endDrag = () => {
      if (!this._dragActive) return;
      this._dragActive = false;
      el.style.cursor = '';
    };
    el.addEventListener('mouseup', endDrag);
    el.addEventListener('mouseleave', endDrag);

    // two-finger scroll turns deep and spiral: sideways round, up and down to tilt
    el.addEventListener('wheel', (e) => {
      if (!turns()) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;   // lines (some mice) → pixels
      this._camera.azimuth -= e.deltaX * unit * 0.004;
      this._camera.elevation = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, this._camera.elevation - e.deltaY * unit * 0.003),
      );
    }, { passive: false });
  }

  // ─── Animation loop ──────────────────────────────────────────────────────────

  private _startLoop(): void {
    const tick = () => {
      this._draw();
      this.animationId = requestAnimationFrame(tick);
    };
    this.animationId = requestAnimationFrame(tick);
  }

  // ─── Main draw dispatcher ────────────────────────────────────────────────────

  private _draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const canvasW = canvas.width / dpr;
    const fullH = canvas.height / dpr;
    const lanesOn = this._showLanes && !this._clean;
    const theme = this._theme;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Drift's clock: runs while notes are sounding, easing to a stop after
    const now = performance.now();
    const dt = this._lastFrameAt ? Math.min(0.1, (now - this._lastFrameAt) / 1000) : 0;
    this._lastFrameAt = now;
    const sounding = now - this._lastNoteAt < 1500;
    this._driftSpeed += ((this._drift && sounding ? 1 : 0) - this._driftSpeed) * Math.min(1, dt * 0.7);
    this._driftT += dt * this._driftSpeed;
    const camera = this._drift || this._driftT ? driftCamera(this._camera, this._driftT) : this._camera;

    // In clean view (or previewing it): the frame, and the picture's overall size within it
    const frame = this._frameRect(canvasW, fullH);
    const W = frame.w;
    const H = lanesOn ? Math.max(80, fullH - LANES_HEIGHT) : frame.h;
    const zoom = this._framed ? this._size : 1;

    const bloom = this.bloom;

    // Decay flash values (0.03/frame ≈ 0.5s at 60fps)
    const n = bloom ? bloom.notes.length : 0;
    if (this.petalFlash.length !== n) this.petalFlash = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this.petalFlash[i] = Math.max(0, this.petalFlash[i] - 0.03);

    // Orbit: constant autonomous spin (~1 rev / 78s at 60fps)
    if (this._mode === 'orbit') {
      this._orbitRotation += 0.0008;
    }

    // Standard clear + background
    ctx.clearRect(0, 0, canvasW, fullH);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvasW, fullH);

    if (!bloom || bloom.notes.length === 0) {
      this._lastHits = [];
      this._drawEmpty(ctx, frame.x + W / 2, frame.y + H / 2, theme);
      ctx.restore();
      return;
    }

    const cx = W / 2;
    const cy = H / 2;
    const minDim = Math.min(W, H);

    // draw in the frame's coordinates, scaled about its centre
    ctx.save();
    ctx.translate(frame.x, frame.y);
    if (frame.w !== canvasW || frame.h !== fullH) {
      ctx.beginPath();
      ctx.rect(0, 0, frame.w, frame.h);
      ctx.clip();
    }
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    _hits = [];
    if (this._tuningView) {
      // room for the controls either side, unless they're hidden in clean view
      const side = this._clean ? minDim * 0.38 : (W - 600) / 2 * 0.8;
      const R = Math.max(minDim * 0.22, Math.min(H * 0.34, side));
      drawTuningPie(ctx, cx, cy, R, bloom, this.petalFlash, theme, this._pieMarks);
      this._pie = { cx: frame.x + cx, cy: frame.y + cy, R: R * zoom };
    } else switch (this._mode) {
      case 'flower':
        drawRadialAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme, this._showNoteLabels);
        break;

      case 'orbit':
        drawOrbitAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme, this._orbitRotation, this._showNoteLabels);
        break;

      case 'tonal':
        drawTonalAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme, this._showNoteLabels);
        break;

      case 'spiral':
        drawSpiralAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme, this._showNoteLabels, camera);
        break;

      case 'set':
        drawSetAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme, this._showNoteLabels);
        break;

      case 'helix':
        drawHelixAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme, this._showNoteLabels);
        break;

      case 'field': {
        const dur = bloom.dur();
        const aspect = Math.max(0.3, Math.min(20.0, dur / 2.0));
        const unitH = minDim * 0.50;
        const unitW = Math.min(unitH * aspect, W * 0.97);
        let beadProgress = 0;
        if (this.playheadIndex >= 0 && this._beadActivatedAt > 0) {
          const intervalMs = beatsToMs(wrapAt(bloom.timeIntervals, this.playheadIndex));
          beadProgress = Math.min(1, (performance.now() - this._beadActivatedAt) / intervalMs);
        }
        drawFieldAt(ctx, (W - unitW) / 2, (H - unitH) / 2, unitW, unitH,
          bloom, this.petalFlash, this.playheadIndex, beadProgress, theme, this._showAxis, this._showNoteLabels);
        break;
      }

      case 'deep': {
        const dur = bloom.dur();
        const aspect = Math.max(0.3, Math.min(20.0, dur / 2.0));
        const unitH = minDim * 0.50;
        const unitW = Math.min(unitH * aspect, W * 0.97);
        let beadProgress = 0;
        if (this.playheadIndex >= 0 && this._beadActivatedAt > 0) {
          const intervalMs = beatsToMs(wrapAt(bloom.timeIntervals, this.playheadIndex));
          beadProgress = Math.min(1, (performance.now() - this._beadActivatedAt) / intervalMs);
        }
        drawDeepAt(ctx, (W - unitW) / 2, (H - unitH) / 2, unitW, unitH,
          bloom, this.petalFlash, this.playheadIndex, beadProgress, theme, this._showAxis, this._showNoteLabels, camera);
        break;
      }

      case 'score':
        drawScoreAt(ctx, 0, 0, W, H, bloom, this.petalFlash, theme, this._showNoteLabels);
        break;
    }
    this._lastHits = _hits;
    _hits = null;
    if (!this._tuningView) {
      this._drawSelected(ctx, theme);
      this._drawPins(ctx, theme);
    }
    ctx.restore();
    // hits were found in the frame's coordinates; clicks come in the canvas's
    this._lastHits = this._lastHits.map(h => ({
      i: h.i, x: frame.x + cx + (h.x - cx) * zoom, y: frame.y + cy + (h.y - cy) * zoom, r: h.r * zoom,
    }));
    this._drawBox(ctx, theme);
    if (frame.w !== canvasW || frame.h !== fullH) this._shadeOutside(ctx, frame, canvasW, fullH, theme);

    if (lanesOn) {
      let progress = 0;
      if (this.playheadIndex >= 0 && this._beadActivatedAt > 0) {
        const intervalMs = beatsToMs(wrapAt(bloom.timeIntervals, this.playheadIndex));
        progress = Math.min(1, (performance.now() - this._beadActivatedAt) / intervalMs);
      }
      this._lanes.draw(ctx, 0, H, W, this._lanesBloom ?? bloom, theme, this._listMode,
        this.playheadIndex >= 0 ? this._tick : -1, progress);
    } else if (this._showChanStrip && !this._clean) {
      this._drawChanStrip(ctx, W, H, bloom, theme);
    }

    ctx.restore();
  }

  /** A soft disc behind every node of a selected event, and the box being dragged */
  private _drawSelected(ctx: CanvasRenderingContext2D, theme: Theme): void {
    ctx.save();
    if (this._selected.size) {
      ctx.fillStyle = withAlpha(theme.text, 0.16);
      ctx.strokeStyle = withAlpha(theme.text, 0.55);
      ctx.lineWidth = 1;
      for (const h of this._lastHits) {
        if (!this._selected.has(h.i)) continue;
        ctx.beginPath();
        ctx.arc(h.x, h.y, Math.max(9, h.r + 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The selection box being dragged, in canvas coordinates */
  private _drawBox(ctx: CanvasRenderingContext2D, theme: Theme): void {
    ctx.save();
    const b = this._box;
    if (b && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 4) {
      ctx.fillStyle = withAlpha(theme.text, 0.06);
      ctx.strokeStyle = withAlpha(theme.text, 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
      const w = Math.abs(b.x1 - b.x0), hgt = Math.abs(b.y1 - b.y0);
      ctx.fillRect(x, y, w, hgt);
      ctx.strokeRect(x + 0.5, y + 0.5, w, hgt);
    }
    ctx.restore();
  }

  /** Shade what lies outside the performance frame, so the crop is plain to see */
  private _shadeOutside(ctx: CanvasRenderingContext2D, f: { x: number; y: number; w: number; h: number },
    W: number, H: number, theme: Theme): void {
    ctx.save();
    ctx.fillStyle = withAlpha(theme.text, 0.07);
    ctx.fillRect(0, 0, W, f.y);
    ctx.fillRect(0, f.y + f.h, W, H - f.y - f.h);
    ctx.fillRect(0, f.y, f.x, f.h);
    ctx.fillRect(f.x + f.w, f.y, W - f.x - f.w, f.h);
    ctx.strokeStyle = withAlpha(theme.text, 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(f.x - 1.5, f.y - 1.5, f.w + 3, f.h + 3);
    ctx.restore();
  }

  /** A dashed ring round every node of a pinned event */
  private _drawPins(ctx: CanvasRenderingContext2D, theme: Theme): void {
    if (this._pinned.size === 0) return;
    ctx.save();
    ctx.strokeStyle = withAlpha(theme.text, 0.8);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2.5, 2.5]);
    for (const h of this._lastHits) {
      if (!this._pinned.has(h.i)) continue;
      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(7, h.r - 1), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Channel-edit mode: the chans array itself, as colored squares along the bottom */
  private _drawChanStrip(ctx: CanvasRenderingContext2D, W: number, H: number, bloom: Bloom, theme: Theme): void {
    const chans = bloom.chans;
    if (chans.length === 0) return;

    const gap = 3;
    const s = Math.min(22, Math.max(8, (W * 0.9) / chans.length - gap));
    const totalW = chans.length * (s + gap) - gap;
    const x0 = (W - totalW) / 2;
    const y = H - s - 10;

    chans.forEach((chan, i) => {
      const x = x0 + i * (s + gap);
      const hue = (chan * 360) / 16;
      ctx.fillStyle = `hsla(${hue},70%,55%,0.9)`;
      ctx.beginPath();
      ctx.roundRect(x, y, s, s, 3);
      ctx.fill();
      if (s >= 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.font = `${Math.floor(s * 0.55)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(chan), x + s / 2, y + s / 2 + 0.5);
      }
    });

    // Note count marker: where the chans cycle sits relative to the notes cycle
    if (chans.length !== bloom.notes.length && bloom.notes.length > 0) {
      ctx.fillStyle = theme.text;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${chans.length} chans / ${bloom.notes.length} notes — phasing`, W / 2, y - 4);
    }
  }

  private _drawEmpty(ctx: CanvasRenderingContext2D, cx: number, cy: number, _theme: Theme): void {
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
  }

}
