// Bloom visualizer — 9 modes × 5 themes, Canvas 2D

import { Bloom } from '../core/Bloom';
import { wrapAt, flatNotes } from '../lib/arrays';
import { beatsToMs } from '../audio/scheduler';
import { THEMES, getTheme } from './theme';
import type { VizMode, ThemeId, Theme } from './theme';

export type { VizMode, ThemeId, Theme };
export { THEMES, getTheme };

// ─── Small helpers ─────────────────────────────────────────────────────────────

function pc(note: number): number { return ((Math.round(note) % 12) + 12) % 12; }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

// ─── 1. Radial ────────────────────────────────────────────────────────────────

export function drawRadialAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
): void {
  const notes = bloom.notes;
  const n = notes.length;
  const times = notes.map((_, i) => wrapAt(bloom.timeIntervals, i));
  const maxTime = Math.max(...times, 0.01);

  ctx.globalCompositeOperation = theme.blendMode;

  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const flash = flashValues[i] ?? 0;
    const vel = wrapAt(bloom.velocities, i);
    const time = wrapAt(bloom.timeIntervals, i);

    chordNotes.forEach((pitch, ci) => {
      const angle = ((i / n) * Math.PI * 2) - Math.PI / 2 + ci * 0.05;
      const baseLength = (pitch / 127) * radius * 0.8 + radius * 0.08;
      const baseHW = (time / maxTime) * 16 + 4;
      const length = baseLength + flash * radius * 0.18;
      const halfW = baseHW + flash * 8;

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
  }

  ctx.globalCompositeOperation = 'source-over';

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = theme.id === 'ink' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)';
  ctx.fill();
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
): void {
  const notes = bloom.notes;
  const n = notes.length;

  const wingW = showLabels ? w * 0.2 : 0;
  const PX = x + wingW;
  const PW = w - wingW * 2;
  const PY = y + h * 0.10;
  const PH = h * 0.78;

  const allPitches = flatNotes(notes) as number[];
  const rawMin = Math.min(...allPitches);
  const rawMax = Math.max(...allPitches);
  const margin = Math.max(6, Math.round((rawMax - rawMin) * 0.18));
  const minNote = Math.max(0, rawMin - margin);
  const maxNote = Math.min(127, rawMax + margin);
  const noteSpan = maxNote - minNote || 12;
  const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;

  const noteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
  const timeToX = (t: number) => PX + (t / totalTime) * PW;

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
}

// ─── 3. Orbit ─────────────────────────────────────────────────────────────────

export function drawOrbitAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  nowMs = 0,
): void {
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
  ctx.fillStyle = theme.id === 'ink' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy, starR, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const chordNotes = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const timeInterval = wrapAt(bloom.timeIntervals, i);
    const flash = flashValues[i] ?? 0;
    // Period: longer timeInterval → slower orbit
    const periodMs = Math.max(200, timeInterval * 3800);

    chordNotes.forEach((pitch, ci) => {
      const r = minR + (pitch / 127) * (maxR - minR);
      const initialAngle = ((i + ci * 0.12) / n) * Math.PI * 2 - Math.PI / 2;
      const angle = initialAngle + (nowMs / periodMs) * Math.PI * 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      const planetR = 3 + (vel / 127) * 8 + flash * 5;
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
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 4. Waterfall snapshot (static — for garden miniatures) ──────────────────

export function drawWaterfallSnapshot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
): void {
  const allPitches = flatNotes(bloom.notes) as number[];
  if (allPitches.length === 0) return;
  const minP = Math.min(...allPitches);
  const maxP = Math.max(...allPitches);
  const margin = Math.max(3, (maxP - minP) * 0.12);
  const pLo = minP - margin;
  const pHi = maxP + margin;
  const pSpan = pHi - pLo || 24;

  ctx.globalCompositeOperation = theme.blendMode;

  for (let i = 0; i < bloom.notes.length; i++) {
    const noteVal = bloom.notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    const t = i / Math.max(1, bloom.notes.length - 1);

    pitches.forEach(pitch => {
      const py = y + h - ((pitch - pLo) / pSpan) * h;
      const [hue, s, l, a] = theme.noteHsla(pc(pitch), vel, flash);
      const lineW = 1.5 + (vel / 127) * 2 + flash * 2;
      // Smear fades left to right (like time scrolling past)
      const grd = ctx.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, `hsla(${hue},${s}%,${l}%,0)`);
      grd.addColorStop(clamp(t, 0.05, 0.95), `hsla(${hue},${s}%,${l}%,${a})`);
      grd.addColorStop(1, `hsla(${hue},${s}%,${l}%,${a * 0.4})`);
      ctx.strokeStyle = grd;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + w, py);
      ctx.stroke();
    });
  }

  ctx.globalCompositeOperation = 'source-over';
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
): void {
  const outerR = radius * 0.82;
  const nodeR = clamp(radius * 0.075, 4, 16);
  const labelR = outerR + nodeR + 10;

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
    const cpx = (ax + bx) * 0.5 * 0.4 + cx * 0.6;
    const cpy = (ay + by) * 0.5 * 0.4 + cy * 0.6;

    ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha(fEdge)})`;
    ctx.lineWidth = 0.5 + fEdge * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cpx, cpy, bx, by);
    ctx.stroke();
  }

  // Nodes
  ctx.font = `${clamp(radius * 0.07, 8, 12)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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
      ctx.fillStyle = theme.text;
      ctx.fillText(PC_NAMES[p], lx, ly);
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

    ctx.fillStyle = theme.text;
    ctx.fillText(PC_NAMES[p], lx, ly);
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fillStyle = theme.id === 'ink' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 6. Helix ─────────────────────────────────────────────────────────────────

export function drawHelixAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
): void {
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;
  const turns = 2.5;
  const minR = radius * 0.08;
  const maxR = radius * 0.88;

  const allPitches = flatNotes(notes) as number[];
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

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 7. Oscilloscope ─────────────────────────────────────────────────────────

export function drawOscilloscopeAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, W: number, H: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
  nowMs = 0,
): void {
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const x0 = cx - W * 0.46;
  const x1 = cx + W * 0.46;
  const ww = x1 - x0;
  const ampH = H * 0.40;
  const samples = Math.max(64, Math.min(512, Math.round(ww)));
  const cycles = 3;

  ctx.globalCompositeOperation = theme.blendMode;

  // Center line
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();

  // Collect frequency components
  interface Component { fRatio: number; amp: number; hue: number; sat: number; lig: number; flash: number; }
  const components: Component[] = [];
  let totalAmp = 0;

  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    pitches.forEach(pitch => {
      const fRatio = Math.pow(2, (pitch - 60) / 12);
      const amp = (vel / 127) * (1 + flash * 0.5);
      const [h, s, l] = theme.noteHsla(pc(pitch), vel, flash);
      components.push({ fRatio, amp, hue: h, sat: s, lig: l, flash });
      totalAmp += amp;
    });
  }
  if (totalAmp === 0) { ctx.globalCompositeOperation = 'source-over'; return; }

  // Composite waveform
  const yComp = new Float32Array(samples);
  for (const c of components) {
    const phase = (nowMs / 4000) * c.fRatio; // slow drift
    for (let s = 0; s < samples; s++) {
      yComp[s] += (c.amp / totalAmp) * Math.sin((s / samples * cycles + phase) * Math.PI * 2);
    }
  }

  // Draw composite waveform
  const baseAlpha = theme.strokeOnly ? 0.7 : 0.55;
  ctx.beginPath();
  for (let s = 0; s < samples; s++) {
    const px = x0 + (s / (samples - 1)) * ww;
    const py = cy - yComp[s] * ampH;
    if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  const wColor = theme.id === 'ink' ? `rgba(30,30,30,${baseAlpha})` : `rgba(255,255,255,${baseAlpha})`;
  ctx.strokeStyle = wColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Active note components (highlighted in pitch color)
  for (const c of components) {
    if (c.flash < 0.05) continue;
    const phase = (nowMs / 4000) * c.fRatio;
    ctx.beginPath();
    for (let s = 0; s < samples; s++) {
      const px = x0 + (s / (samples - 1)) * ww;
      const yv = Math.sin((s / samples * cycles + phase) * Math.PI * 2) * c.amp;
      const py = cy - yv * ampH;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `hsla(${c.hue},${c.sat}%,${c.lig}%,${c.flash * 0.75})`;
    ctx.lineWidth = c.flash * 2.5;
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 8. Skyline (pseudo-isometric columns) ───────────────────────────────────

export function drawSkylineAt(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, W: number, H: number,
  bloom: Bloom,
  flashValues: number[] = [],
  theme: Theme = THEMES.dark,
): void {
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;
  const floorY = cy + H * 0.27;
  const maxColH = H * 0.58;

  // Flatten notes with timing
  interface ColNote { pitch: number; vel: number; flash: number; timeX: number; }
  const cols: ColNote[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const vel = wrapAt(bloom.velocities, i);
    const flash = flashValues[i] ?? 0;
    pitches.forEach(pitch => { cols.push({ pitch, vel, flash, timeX: t / totalTime }); });
    t += wrapAt(bloom.timeIntervals, i);
  }

  const allPitches = cols.map(c => c.pitch);
  const minP = Math.min(...allPitches);
  const maxP = Math.max(...allPitches);
  const pitchSpan = maxP - minP || 12;

  // Back-to-front sort so lower-pitch (closer) columns draw on top
  cols.sort((a, b) => b.pitch - a.pitch);

  const usableW = W * 0.82;
  const colW = Math.max(6, usableW / (cols.length * 1.4));
  const xLeft = cx - usableW / 2;

  ctx.globalCompositeOperation = theme.blendMode;

  // Floor grid line
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - W / 2, floorY);
  ctx.lineTo(cx + W / 2, floorY);
  ctx.stroke();

  for (const col of cols) {
    const x = xLeft + col.timeX * usableW;
    // Depth: higher pitch = further back → slight x-shift and scale
    const depthFrac = (col.pitch - minP) / pitchSpan;
    const depthOffX = depthFrac * usableW * 0.06;
    const cx2 = x - depthOffX;
    const colH = (col.vel / 127) * maxColH * (1 + col.flash * 0.3) + col.flash * maxColH * 0.12;
    const topY = floorY - colH;
    const [h, s, l, a] = theme.noteHsla(pc(col.pitch), col.vel, col.flash);

    // Glow above column top on activation
    if (col.flash > 0.05 && theme.glowScale > 0) {
      const gr = ctx.createRadialGradient(cx2, topY, 0, cx2, topY, colH * 0.5 * theme.glowScale);
      gr.addColorStop(0, `hsla(${h},${s}%,${l}%,${col.flash * 0.55})`);
      gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(cx2, topY, colH * 0.5 * theme.glowScale, colH * 0.18 * theme.glowScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Column face
    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx2 - colW / 2, topY, colW, colH);
    } else {
      const faceGrad = ctx.createLinearGradient(cx2, topY, cx2, floorY);
      faceGrad.addColorStop(0, `hsla(${h},${s}%,${clamp(l + 15, 0, 98)}%,${a})`);
      faceGrad.addColorStop(1, `hsla(${h},${s}%,${l}%,${a * 0.6})`);
      ctx.fillStyle = faceGrad;
      ctx.fillRect(cx2 - colW / 2, topY, colW, colH);
    }

    // Top face (isometric hint)
    const slant = clamp(colW * 0.35, 2, 12);
    ctx.beginPath();
    ctx.moveTo(cx2 - colW / 2, topY);
    ctx.lineTo(cx2 + colW / 2, topY);
    ctx.lineTo(cx2 + colW / 2 + slant, topY - slant * 0.4);
    ctx.lineTo(cx2 - colW / 2 + slant, topY - slant * 0.4);
    ctx.closePath();
    if (theme.strokeOnly) {
      ctx.strokeStyle = `hsla(${h},${s}%,${l}%,${a * 0.7})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsla(${h},${s}%,${clamp(l + 30, 0, 98)}%,${a * 0.75})`;
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ─── 9. Particles background skeleton (used inside BloomVisualization) ───────
// Draws a faint piano-roll skeleton used as the particle mode background.

export function drawParticlesBg(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  bloom: Bloom,
  theme: Theme = THEMES.dark,
): void {
  const notes = bloom.notes;
  const n = notes.length;
  if (n === 0) return;

  const PX = x + w * 0.02;
  const PW = w * 0.96;
  const PY = y + h * 0.12;
  const PH = h * 0.76;

  const allPitches = flatNotes(notes) as number[];
  const rawMin = Math.min(...allPitches);
  const rawMax = Math.max(...allPitches);
  const margin = Math.max(6, (rawMax - rawMin) * 0.18);
  const minNote = rawMin - margin;
  const maxNote = rawMax + margin;
  const noteSpan = maxNote - minNote || 12;
  const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;

  const noteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
  const timeToX = (t: number) => PX + (t / totalTime) * PW;

  ctx.globalCompositeOperation = theme.blendMode;

  let t = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const noteVal = notes[i];
    const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
    const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    xs.push(timeToX(t));
    ys.push(noteToY(avgPitch));
    t += wrapAt(bloom.timeIntervals, i);
  }

  // Faint connector
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(xs[i], ys[i]); else ctx.lineTo(xs[i], ys[i]);
  }
  ctx.strokeStyle = `rgba(255,255,255,${theme.lineAlpha(0) * 0.5})`;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Faint note circles
  t = 0;
  for (let i = 0; i < n; i++) {
    const vel = wrapAt(bloom.velocities, i);
    const [h, s, l, a] = theme.noteHsla(pc(flatNotes([notes[i]])[0] as number), vel, 0);
    ctx.fillStyle = `hsla(${h},${s}%,${l}%,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], 3.5, 0, Math.PI * 2);
    ctx.fill();
    t += wrapAt(bloom.timeIntervals, i);
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ─── Particle type ────────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;   // 0..1
  decay: number;  // reduction per frame
  h: number; s: number; l: number;
  size: number;
}

// ─── Main BloomVisualization class ────────────────────────────────────────────

export class BloomVisualization {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;
  private bloom: Bloom | null = null;
  private _mode: VizMode = 'radial';
  private _theme: Theme = THEMES.dark;

  // Flash / playhead state
  private petalFlash: number[] = [];
  private playheadIndex = -1;
  private _beadActivatedAt = 0;

  // Orbit / scope: time reference
  private _startMs = performance.now();

  // Waterfall state
  private _wfBuf: HTMLCanvasElement | null = null;
  private _wfBufCtx: CanvasRenderingContext2D | null = null;
  private _wfBufW = 0;
  private _wfBufH = 0;
  private _wfLastTime = 0;
  private _wfAccumScroll = 0;
  private _wfPending: number[] = [];  // note indices queued for drawing

  // Particle state
  private _particles: Particle[] = [];
  private _noteCentroids: Array<{ x: number; y: number }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this._setupResize();
    this._startLoop();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setBloom(bloom: Bloom): void {
    this.bloom = bloom;
    this.petalFlash = new Array(bloom.notes.length).fill(0);
    this.playheadIndex = -1;
    this._beadActivatedAt = 0;
    this._particles = [];
    this._noteCentroids = [];
  }

  setMode(mode: VizMode): void {
    if (this._mode !== mode) {
      this._mode = mode;
      // Reset waterfall when switching into it so it starts fresh
      if (mode === 'waterfall') this._resetWaterfall();
      this._particles = [];
    }
  }

  setTheme(id: ThemeId): void {
    this._theme = getTheme(id);
    // Invalidate waterfall so it repaints with new bg color
    this._resetWaterfall();
  }

  getMode(): VizMode { return this._mode; }
  getTheme(): ThemeId { return this._theme.id; }

  activateNote(index: number): void {
    if (!this.bloom || index < 0 || index >= this.bloom.notes.length) return;
    if (this.petalFlash.length !== this.bloom.notes.length)
      this.petalFlash = new Array(this.bloom.notes.length).fill(0);
    this.petalFlash[index] = 1.0;
    this.playheadIndex = index;
    this._beadActivatedAt = performance.now();

    if (this._mode === 'waterfall') this._wfPending.push(index);
    if (this._mode === 'particles') this._emitParticles(index);
  }

  deactivateAll(): void {
    this.petalFlash = this.petalFlash.map(() => 0);
    this.playheadIndex = -1;
    this._beadActivatedAt = 0;
  }

  /** @deprecated — use setMode() instead; kept for callers that used toggleMode() */
  toggleMode(): VizMode {
    const ORDER: VizMode[] = ['radial', 'piano', 'orbit', 'waterfall', 'tonal', 'helix', 'particles', 'oscilloscope', 'skyline'];
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
      this._resetWaterfall(); // invalidate on resize
    };
    new ResizeObserver(apply).observe(this.canvas);
    apply();
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
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const nowMs = performance.now() - this._startMs;
    const theme = this._theme;

    ctx.save();
    ctx.scale(dpr, dpr);

    const bloom = this.bloom;

    // Decay flash values (0.03/frame ≈ 0.5s at 60fps)
    const n = bloom ? bloom.notes.length : 0;
    if (this.petalFlash.length !== n) this.petalFlash = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this.petalFlash[i] = Math.max(0, this.petalFlash[i] - 0.03);

    if (this._mode === 'waterfall') {
      // Waterfall manages its own background + pixel history
      this._drawWaterfall(ctx, W, H, dpr, theme);
      ctx.restore();
      return;
    }

    // Standard clear + background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    if (!bloom || bloom.notes.length === 0) {
      this._drawEmpty(ctx, W / 2, H / 2, theme);
      ctx.restore();
      return;
    }

    const cx = W / 2;
    const cy = H / 2;
    const minDim = Math.min(W, H);

    switch (this._mode) {
      case 'radial':
        drawRadialAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme);
        break;

      case 'piano': {
        const dur = bloom.dur();
        const aspect = Math.max(0.3, Math.min(20.0, dur / 2.0));
        const unitH = minDim * 0.50;
        const unitW = Math.min(unitH * aspect, W * 0.97);
        let beadProgress = 0;
        if (this.playheadIndex >= 0 && this._beadActivatedAt > 0) {
          const intervalMs = beatsToMs(wrapAt(bloom.timeIntervals, this.playheadIndex));
          beadProgress = Math.min(1, (performance.now() - this._beadActivatedAt) / intervalMs);
        }
        drawPianoAt(ctx, (W - unitW) / 2, (H - unitH) / 2, unitW, unitH,
          bloom, this.petalFlash, this.playheadIndex, false, beadProgress, theme);
        break;
      }

      case 'orbit':
        drawOrbitAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme, nowMs);
        break;

      case 'tonal':
        drawTonalAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme);
        break;

      case 'helix':
        drawHelixAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme);
        break;

      case 'particles': {
        const unitH = minDim * 0.50;
        const dur = bloom.dur();
        const aspect = Math.max(0.3, Math.min(20.0, dur / 2.0));
        const unitW = Math.min(unitH * aspect, W * 0.97);
        const px0 = (W - unitW) / 2;
        const py0 = (H - unitH) / 2;
        this._updateParticleCentroids(bloom, px0, py0, unitW, unitH);
        drawParticlesBg(ctx, px0, py0, unitW, unitH, bloom, theme);
        this._updateAndDrawParticles(ctx, theme);
        break;
      }

      case 'oscilloscope':
        drawOscilloscopeAt(ctx, cx, cy, W * 0.95, H * 0.80, bloom, this.petalFlash, theme, nowMs);
        break;

      case 'skyline':
        drawSkylineAt(ctx, cx, cy, W * 0.95, H * 0.82, bloom, this.petalFlash, theme);
        break;
    }

    ctx.restore();
  }

  private _drawEmpty(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: Theme): void {
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = theme.id === 'ink' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
    ctx.fill();
  }

  // ─── Waterfall ────────────────────────────────────────────────────────────────

  private _resetWaterfall(): void {
    this._wfBuf = null;
    this._wfBufCtx = null;
    this._wfBufW = 0;
    this._wfBufH = 0;
    this._wfAccumScroll = 0;
    this._wfPending = [];
  }

  private _drawWaterfall(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, theme: Theme): void {
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);

    // (Re-)initialize buffer on size change
    if (!this._wfBuf || this._wfBufW !== pw || this._wfBufH !== ph) {
      this._wfBuf = document.createElement('canvas');
      this._wfBuf.width = pw;
      this._wfBuf.height = ph;
      this._wfBufCtx = this._wfBuf.getContext('2d')!;
      this._wfBufCtx.fillStyle = theme.bg;
      this._wfBufCtx.fillRect(0, 0, pw, ph);
      this._wfBufW = pw;
      this._wfBufH = ph;
      this._wfLastTime = performance.now();
      this._wfAccumScroll = 0;
    }

    // Scroll amount since last frame
    const now = performance.now();
    const dt = Math.min(now - this._wfLastTime, 80);
    this._wfLastTime = now;
    this._wfAccumScroll += (dt / 1000) * 52 * dpr; // ~52 CSS px/sec
    const scrollPx = Math.floor(this._wfAccumScroll);
    this._wfAccumScroll -= scrollPx;

    // Work in device-pixel coordinates (bypass the dpr scale)
    ctx.save();
    ctx.resetTransform();

    // 1. Draw background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, pw, ph);

    // 2. Draw previous buffer shifted down
    if (scrollPx > 0 && scrollPx < ph) {
      ctx.drawImage(this._wfBuf, 0, 0, pw, ph - scrollPx, 0, scrollPx, pw, ph - scrollPx);
    } else if (scrollPx === 0) {
      ctx.drawImage(this._wfBuf, 0, 0);
    }

    // 3. Draw new note activations at top
    const bloom = this.bloom;
    if (bloom && this._wfPending.length > 0) {
      const allPitches = flatNotes(bloom.notes) as number[];
      const minP = Math.min(...allPitches);
      const maxP = Math.max(...allPitches);
      const margin = Math.max(4, (maxP - minP) * 0.12);
      const pLo = minP - margin;
      const pHi = maxP + margin;
      const pSpan = pHi - pLo || 24;

      while (this._wfPending.length > 0) {
        const idx = this._wfPending.shift()!;
        if (idx < 0 || idx >= bloom.notes.length) continue;
        const noteVal = bloom.notes[idx];
        const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
        const vel = wrapAt(bloom.velocities, idx);

        pitches.forEach(pitch => {
          const thePc = pc(pitch);
          const [h, s, l, a] = theme.noteHsla(thePc, vel, 1.0);
          const py = (1 - (pitch - pLo) / pSpan) * ph;
          const smear = Math.max(5, ph * 0.022);
          const grd = ctx.createLinearGradient(0, py - smear, 0, py + smear);
          grd.addColorStop(0, `hsla(${h},${s}%,${l}%,0)`);
          grd.addColorStop(0.5, `hsla(${h},${s}%,${l}%,${a})`);
          grd.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
          ctx.fillStyle = grd;
          ctx.fillRect(0, py - smear, pw, smear * 2);
        });
      }
    }

    // 4. Copy main canvas state to buffer for next frame
    this._wfBufCtx!.clearRect(0, 0, pw, ph);
    this._wfBufCtx!.drawImage(this.canvas, 0, 0);

    ctx.restore();
  }

  // ─── Particles ────────────────────────────────────────────────────────────────

  private _updateParticleCentroids(bloom: Bloom, x: number, y: number, w: number, h: number): void {
    const notes = bloom.notes;
    const n = notes.length;
    const PX = x + w * 0.02;
    const PW = w * 0.96;
    const PY = y + h * 0.12;
    const PH = h * 0.76;

    const allPitches = flatNotes(notes) as number[];
    const rawMin = Math.min(...allPitches);
    const rawMax = Math.max(...allPitches);
    const margin = Math.max(6, (rawMax - rawMin) * 0.18);
    const minNote = rawMin - margin;
    const maxNote = rawMax + margin;
    const noteSpan = maxNote - minNote || 12;
    const totalTime = bloom.timeIntervals.reduce((a, b) => a + b, 0) || 1;

    const noteToY = (p: number) => PY + PH - ((p - minNote) / noteSpan) * PH;
    const timeToX = (t: number) => PX + (t / totalTime) * PW;

    this._noteCentroids = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const noteVal = notes[i];
      const pitches = Array.isArray(noteVal) ? (noteVal as number[]) : [noteVal as number];
      const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      this._noteCentroids.push({ x: timeToX(t), y: noteToY(avgPitch) });
      t += wrapAt(bloom.timeIntervals, i);
    }
  }

  private _emitParticles(index: number): void {
    if (!this.bloom) return;
    const pos = this._noteCentroids[index];
    if (!pos) return;

    const vel = wrapAt(this.bloom.velocities, index);
    const noteVal = this.bloom.notes[index];
    const pitch = (Array.isArray(noteVal) ? noteVal[0] : noteVal) as number;
    const [h, s, l] = this._theme.noteHsla(pc(pitch), vel, 0.9);
    const count = 14 + Math.round((vel / 127) * 36);

    for (let j = 0; j < count; j++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 3.5;
      this._particles.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(angle) * speed * 0.55,
        vy: -(Math.random() * 0.7 + 0.3) * speed * 1.7,
        life: 1.0,
        decay: 0.011 + Math.random() * 0.019,
        h, s, l,
        size: 1.5 + Math.random() * 3.5,
      });
    }
  }

  private _updateAndDrawParticles(ctx: CanvasRenderingContext2D, theme: Theme): void {
    ctx.globalCompositeOperation = theme.blendMode;
    const gravity = 0.04;

    this._particles = this._particles.filter(p => {
      p.life -= p.decay;
      if (p.life <= 0) return false;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += gravity;
      const a = p.life * 0.9;
      const r = p.size * p.life;
      if (theme.strokeOnly) {
        ctx.strokeStyle = `hsla(${p.h},${p.s}%,${p.l}%,${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = `hsla(${p.h},${p.s}%,${p.l}%,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    });

    ctx.globalCompositeOperation = 'source-over';
  }
}
