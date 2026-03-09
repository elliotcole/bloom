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
  orbitRotation = 0,
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
    const flash = flashValues[i] ?? 0;

    chordNotes.forEach((pitch, ci) => {
      const r = minR + (pitch / 127) * (maxR - minR);
      const initialAngle = ((i + ci * 0.12) / n) * Math.PI * 2 - Math.PI / 2;
      const angle = initialAngle + orbitRotation;
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
): void {
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

  // Orbit rotation state
  private _orbitRotation = 0;
  private _orbitTargetRotation = 0;

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
    this._orbitRotation = 0;
    this._orbitTargetRotation = 0;
  }

  setMode(mode: VizMode): void {
    if (this._mode !== mode) {
      this._mode = mode;
      this._orbitRotation = 0;
      this._orbitTargetRotation = 0;
    }
  }

  setTheme(id: ThemeId): void {
    this._theme = getTheme(id);
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

    if (this._mode === 'orbit') {
      const n = this.bloom.notes.length;
      this._orbitTargetRotation = -((index / n) * Math.PI * 2);
    }
  }

  deactivateAll(): void {
    this.petalFlash = this.petalFlash.map(() => 0);
    this.playheadIndex = -1;
    this._beadActivatedAt = 0;
  }

  /** @deprecated — use setMode() instead; kept for callers that used toggleMode() */
  toggleMode(): VizMode {
    const ORDER: VizMode[] = ['radial', 'piano', 'orbit', 'tonal', 'set', 'helix'];
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
    const theme = this._theme;

    ctx.save();
    ctx.scale(dpr, dpr);

    const bloom = this.bloom;

    // Decay flash values (0.03/frame ≈ 0.5s at 60fps)
    const n = bloom ? bloom.notes.length : 0;
    if (this.petalFlash.length !== n) this.petalFlash = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this.petalFlash[i] = Math.max(0, this.petalFlash[i] - 0.03);

    // Orbit: smooth rotation toward target
    if (this._mode === 'orbit') {
      let diff = this._orbitTargetRotation - this._orbitRotation;
      // Normalize to shortest path [-π, π]
      diff = ((diff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(diff) > 0.0005) this._orbitRotation += diff * 0.15;
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
        drawOrbitAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme, this._orbitRotation);
        break;

      case 'tonal':
        drawTonalAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme);
        break;

      case 'set':
        drawSetAt(ctx, cx, cy, minDim * 0.44, bloom, this.petalFlash, theme);
        break;

      case 'helix':
        drawHelixAt(ctx, cx, cy, minDim * 0.45, bloom, this.petalFlash, theme);
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

}
