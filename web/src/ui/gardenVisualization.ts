// Garden carousel — miniature bloom visualizations for each garden slot

import { Bloom } from '../core/Bloom';
import { Garden } from '../garden';
import {
  drawRadialAt, drawFieldAt, drawDeepAt, drawOrbitAt,
  drawTonalAt, drawSpiralAt, drawSetAt, drawHelixAt,
  drawScoreAt,
  THEMES,
} from './visualization';
import { drawOrreryAt } from './orrery';
import { drawRoadAt, roadAhead } from './road';
import { drawWeaveAt, weaveRows, weavePeriod, fitWeave } from './weave';
import type { VizMode, ThemeId, Theme } from './visualization';
import { worldColor, worldHues, worldOf } from './worlds';

const SLIDE_DURATION = 150; // ms
const ANIM_DURATION = 180;  // ms — save/restore overlay

/** The colours a bloom can wear (homeKeys BLOOM_COLORS), as paint */
const SLOT_COLORS: Record<string, string> = {
  red: '#e05555', orange: '#e8923f', yellow: '#d9c84a', green: '#5cb86b', blue: '#5b8fe6', violet: '#a371e0',
};

export class GardenVisualization {
  private gardenArea: HTMLElement;
  private vizArea: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slider: HTMLInputElement;
  private animCanvas: HTMLCanvasElement;

  private garden: Garden | null = null;
  private _mode: VizMode = 'deep';
  private _theme: Theme = THEMES.dark;
  private visibleCount = 5;

  // Slide animation
  private slideOffset = 0;
  private slideSlotWidth = 0;
  private slideAnimStart = 0;

  private animationId: number | null = null;

  constructor(gardenArea: HTMLElement, vizArea: HTMLElement) {
    this.gardenArea = gardenArea;
    this.vizArea = vizArea;

    // ── Garden canvas ──────────────────────────────────────────────────────
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'garden-canvas';
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    gardenArea.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // ── Zoom slider ────────────────────────────────────────────────────────
    this.slider = document.createElement('input');
    this.slider.id = 'garden-zoom';
    this.slider.type = 'range';
    this.slider.min = '3';
    this.slider.max = '11';
    this.slider.step = '1';
    this.slider.value = '5';
    gardenArea.appendChild(this.slider);
    this.slider.addEventListener('input', () => {
      this.visibleCount = parseInt(this.slider.value, 10);
    });

    // ── Anim canvas (overlay for save/restore) — child of #canvas-area ────
    this.animCanvas = document.createElement('canvas');
    this.animCanvas.id = 'anim-canvas';
    this.animCanvas.style.cssText =
      'position:absolute;pointer-events:none;display:none;z-index:10;';
    gardenArea.parentElement!.appendChild(this.animCanvas);

    new ResizeObserver(() => this._updateCanvasSize()).observe(gardenArea);
    this._updateCanvasSize();
    this._startLoop();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  update(garden: Garden): void {
    this.garden = garden;
    const hasContent = garden.slots.length > 1 || garden.slots[0] !== null;
    this.gardenArea.style.display = hasContent ? 'block' : 'none';
  }

  setMode(mode: VizMode): void { this._mode = mode; }

  setTheme(id: ThemeId): void { this._theme = THEMES[id] ?? THEMES.dark; }

  animateSlide(direction: 'left' | 'right'): void {
    const sw = this.canvas.clientWidth / this.visibleCount;
    this.slideSlotWidth = sw;
    this.slideOffset = direction === 'left' ? -sw : sw;
    this.slideAnimStart = performance.now();
  }

  animateSave(bloom: Bloom, mainCanvas: HTMLCanvasElement): void {
    this._runOverlayAnim(bloom, mainCanvas, 'save');
  }

  animateRestore(bloom: Bloom, mainCanvas: HTMLCanvasElement): void {
    this._runOverlayAnim(bloom, mainCanvas, 'restore');
  }

  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _updateCanvasSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.gardenArea.getBoundingClientRect();
    this.canvas.width = (rect.width || 1) * dpr;
    this.canvas.height = (rect.height || 1) * dpr;
  }

  private _startLoop(): void {
    const tick = (now: number) => {
      this._tick(now);
      this.animationId = requestAnimationFrame(tick);
    };
    this.animationId = requestAnimationFrame(tick);
  }

  private _tick(now: number): void {
    if (this.slideOffset !== 0) {
      const elapsed = now - this.slideAnimStart;
      const t = Math.min(elapsed / SLIDE_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      const sign = this.slideOffset > 0 ? 1 : -1;
      this.slideOffset = sign * this.slideSlotWidth * (1 - eased);
      if (t >= 1) this.slideOffset = 0;
    }
    this._draw();
  }

  private _draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas.width === 0 || canvas.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const theme = this._theme;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    if (!this.garden) { ctx.restore(); return; }

    const garden = this.garden;
    const cursor = garden.cursor;
    const slotWidth = W / this.visibleCount;
    const centerX = this._getCurrentSlotCenter(W);
    const cy = H / 2;
    const half = Math.floor(this.visibleCount / 2);
    const hues = worldHues(garden.slots.map(worldOf));

    for (let i = cursor - half - 1; i <= cursor + half + 1; i++) {
      const offsetFromCursor = i - cursor;
      const cx = centerX + offsetFromCursor * slotWidth + this.slideOffset;
      if (cx < -slotWidth || cx > W + slotWidth) continue;

      const isCurrent = i === cursor;
      const base = Math.min(slotWidth, H * 0.92);
      const r = isCurrent ? base * 0.44 : base * 0.38;
      const bloom = (i >= 0 && i < garden.slots.length) ? garden.slots[i] : null;
      this._drawSlot(ctx, cx, cy, r, bloom, isCurrent, slotWidth, H, hues);
    }

    // Slot separator lines
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < this.visibleCount; i++) {
      const sx = (W / this.visibleCount) * i;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
      ctx.stroke();
    }

    ctx.restore();
  }

  private _drawSlot(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, r: number,
    bloom: Bloom | null, isCurrent: boolean,
    cellW = r * 2, cellH = r * 2, hues: Map<string, number> = new Map(),
  ): void {
    const theme = this._theme;
    const cellX = cx - cellW / 2;
    const paint = bloom?.color ? SLOT_COLORS[bloom.color] : undefined;
    const level = bloom ? Math.max(0.1, Math.min(1, bloom.colorLevel)) : 1;

    // its colour (opt-n) washes the whole cell, behind the picture
    if (bloom && paint) {
      ctx.save();
      ctx.fillStyle = paint;
      ctx.globalAlpha = 0.13 * level;
      ctx.fillRect(cellX + 1, 0, cellW - 2, cellH);
      ctx.restore();
    }

    if (!bloom) {
      ctx.save();
      ctx.strokeStyle = isCurrent ? 'rgba(255,255,255,0.22)' : theme.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (isCurrent) {
        ctx.fillStyle = theme.text;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('·', cx, cy);
      }
      ctx.restore();
      return;
    }

    // Clip to slot circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const mode = this._mode;
    const d = r * 2; // diameter

    switch (mode) {
      case 'flower':
        drawRadialAt(ctx, cx, cy, r, bloom, [], theme);
        break;
      case 'field':
        drawFieldAt(ctx, cx - r, cy - r, d, d, bloom, [], -1, 0, theme, false);
        break;
      case 'orbit':
        drawOrbitAt(ctx, cx, cy, r, bloom, [], theme, 0);
        break;
      case 'tonal':
        drawTonalAt(ctx, cx, cy, r, bloom, [], theme);
        break;
      case 'spiral':
        drawSpiralAt(ctx, cx, cy, r, bloom, [], theme);
        break;
      case 'set':
        drawSetAt(ctx, cx, cy, r, bloom, [], theme);
        break;
      case 'helix':
        drawHelixAt(ctx, cx, cy, r, bloom, [], theme);
        break;
      case 'deep':
        drawDeepAt(ctx, cx - r, cy - r, d, d, bloom, [], -1, 0, theme, false);
        break;
      case 'orrery':
        drawOrreryAt(ctx, cx, cy, r * 0.9, bloom, [], theme);
        break;
      case 'road':
        drawRoadAt(ctx, cx, cy, r, bloom, roadAhead(bloom, 0, 32).map(t => ({ ...t, at: t.at + 0.4 })), [], theme);
        break;
      case 'weave': {
        const rows = weaveRows(bloom, 0, Math.min(48, Math.max(16, weavePeriod(bloom))));
        drawWeaveAt(ctx, cx - r, cy - r, d, d, bloom, rows, [], theme, fitWeave(rows, d));
        break;
      }
      case 'score':
        drawScoreAt(ctx, cx - r, cy - r, d, d, bloom, [], theme, false, true);
        break;
    }

    ctx.restore();

    // its colour (opt-n) as a ring (a descendant's fades with each save), its name in the top-left corner
    if (paint) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + (isCurrent ? 7 : 3), 0, Math.PI * 2);
      ctx.strokeStyle = paint;
      ctx.globalAlpha = level;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    const half = cellW / 2 - 14;   // each corner label gets half the cell
    if (bloom.name) {
      ctx.save();
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = paint ?? 'rgba(255,255,255,0.8)';
      const label = fit(ctx, bloom.name, half);
      if (label) ctx.fillText(label, cellX + 8, 6);
      ctx.restore();
    }
    // its tuning (its world) in the top-right corner: a dot in the tuning's colour, and its name
    const world = worldOf(bloom);
    const hue = world !== null ? hues.get(world) : undefined;
    if (world !== null && hue !== undefined) {
      ctx.save();
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const right = cellX + cellW - 8;
      ctx.fillStyle = worldColor(hue);
      ctx.beginPath();
      ctx.arc(right - 4, 12, 4, 0, Math.PI * 2);
      ctx.fill();
      const label = fit(ctx, world, half - 14);
      if (label) ctx.fillText(label, right - 13, 7);
      // and a thin arc of it along the bottom of the circle
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1, Math.PI * 0.2, Math.PI * 0.8);
      ctx.strokeStyle = worldColor(hue, 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Current slot highlight ring
    if (isCurrent) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  private _getCurrentSlotCenter(fallbackW: number): number {
    const vizRect = this.vizArea.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    if (canvasRect.width === 0) return fallbackW / 2;
    return (vizRect.left + vizRect.width / 2) - canvasRect.left;
  }

  // ─── Save / Restore overlay animation ────────────────────────────────────

  private _runOverlayAnim(bloom: Bloom, mainCanvas: HTMLCanvasElement, direction: 'save' | 'restore'): void {
    if (document.body.classList.contains('clean')) return;   // the garden is hidden: there's nowhere to fly from or to
    const ac = this.animCanvas;
    const areaEl = this.gardenArea.parentElement!;
    const areaRect = areaEl.getBoundingClientRect();
    const mainRect = mainCanvas.getBoundingClientRect();
    const gardenCanvasRect = this.canvas.getBoundingClientRect();

    const slotW = this.canvas.clientWidth / this.visibleCount;
    const centerX = this._getCurrentSlotCenter(this.canvas.clientWidth);
    const slotScreenX = gardenCanvasRect.left + centerX;
    const slotScreenY = gardenCanvasRect.top + this.canvas.clientHeight / 2;
    const slotBase = Math.min(slotW, this.canvas.clientHeight * 0.92);
    const slotR = slotBase * 0.44;
    const slotDiam = slotR * 2;
    const scale = slotDiam / Math.min(mainRect.width, mainRect.height);

    const mainLeft = mainRect.left - areaRect.left;
    const mainTop = mainRect.top - areaRect.top;
    const slotCX = slotScreenX - areaRect.left;
    const slotCY = slotScreenY - areaRect.top;
    const dpr = window.devicePixelRatio || 1;

    const drawBloom = (actx: CanvasRenderingContext2D, w: number, h: number) => {
      const theme = this._theme;
      actx.fillStyle = theme.bg;
      actx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);
      const mode = this._mode;
      switch (mode) {
        case 'flower': drawRadialAt(actx, cx, cy, minDim * 0.45, bloom, [], theme); break;
        case 'field': {
          const asp = Math.max(0.3, Math.min(20.0, bloom.dur() / 2.0));
          const uh = minDim * 0.50;
          const uw = Math.min(uh * asp, w * 0.97);
          drawFieldAt(actx, (w - uw) / 2, (h - uh) / 2, uw, uh, bloom, [], -1, 0, theme, false);
          break;
        }
        case 'orbit': drawOrbitAt(actx, cx, cy, minDim * 0.45, bloom, [], theme, 0); break;
        case 'tonal': drawTonalAt(actx, cx, cy, minDim * 0.44, bloom, [], theme); break;
        case 'spiral': drawSpiralAt(actx, cx, cy, minDim * 0.44, bloom, [], theme); break;
        case 'set': drawSetAt(actx, cx, cy, minDim * 0.44, bloom, [], theme); break;
        case 'helix': drawHelixAt(actx, cx, cy, minDim * 0.45, bloom, [], theme); break;
        case 'orrery': drawOrreryAt(actx, cx, cy, minDim * 0.45, bloom, [], theme); break;
        case 'road': drawRoadAt(actx, cx, cy, minDim * 0.48, bloom, roadAhead(bloom, 0, 32).map(t => ({ ...t, at: t.at + 0.4 })), [], theme); break;
        case 'weave': {
          const rows = weaveRows(bloom, 0, Math.min(96, Math.max(32, weavePeriod(bloom))));
          drawWeaveAt(actx, w * 0.05, h * 0.04, w * 0.9, h * 0.92, bloom, rows, [], theme, fitWeave(rows, h * 0.92 - 14));
          break;
        }
        case 'deep': {
          const asp = Math.max(0.3, Math.min(20.0, bloom.dur() / 2.0));
          const uh = minDim * 0.50;
          const uw = Math.min(uh * asp, w * 0.97);
          drawDeepAt(actx, (w - uw) / 2, (h - uh) / 2, uw, uh, bloom, [], -1, 0, theme, false);
          break;
        }
        case 'score': {
          const uh = minDim * 0.5, uw = w * 0.9;
          drawScoreAt(actx, (w - uw) / 2, (h - uh) / 2, uw, uh, bloom, [], theme, false, true);
          break;
        }
      }
    };

    if (direction === 'save') {
      ac.width = mainRect.width * dpr;
      ac.height = mainRect.height * dpr;
      ac.style.width = `${mainRect.width}px`;
      ac.style.height = `${mainRect.height}px`;
      ac.style.left = `${mainLeft}px`;
      ac.style.top = `${mainTop}px`;

      const actx = ac.getContext('2d')!;
      actx.save();
      actx.scale(dpr, dpr);
      drawBloom(actx, mainRect.width, mainRect.height);
      actx.restore();

      ac.style.transform = 'none';
      ac.style.transformOrigin = '0 0';
      ac.style.transition = 'none';
      ac.style.opacity = '1';
      ac.style.display = 'block';
      void ac.offsetHeight;

      const dx = slotCX - mainLeft - mainRect.width / 2 * scale;
      const dy = slotCY - mainTop - mainRect.height / 2 * scale;
      ac.style.transition = `transform ${ANIM_DURATION}ms ease-out, opacity ${ANIM_DURATION}ms ease-out`;
      ac.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      ac.style.opacity = '0.7';
    } else {
      ac.width = mainRect.width * dpr;
      ac.height = mainRect.height * dpr;
      ac.style.width = `${mainRect.width}px`;
      ac.style.height = `${mainRect.height}px`;

      const actx = ac.getContext('2d')!;
      actx.save();
      actx.scale(dpr, dpr);
      drawBloom(actx, mainRect.width, mainRect.height);
      actx.restore();

      const dx = slotCX - mainLeft - mainRect.width / 2 * scale;
      const dy = slotCY - mainTop - mainRect.height / 2 * scale;
      ac.style.left = `${mainLeft}px`;
      ac.style.top = `${mainTop}px`;
      ac.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      ac.style.transformOrigin = '0 0';
      ac.style.transition = 'none';
      ac.style.opacity = '0.7';
      ac.style.display = 'block';
      void ac.offsetHeight;

      ac.style.transition = `transform ${ANIM_DURATION}ms ease-out, opacity ${ANIM_DURATION}ms ease-out`;
      ac.style.transform = 'none';
      ac.style.opacity = '1';
    }

    setTimeout(() => { ac.style.display = 'none'; }, ANIM_DURATION + 40);
  }
}

/** `text` cut (with …) to fit `width`, or '' when not even three characters would */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  for (let n = text.length - 1; n >= 3; n--) {
    const cut = `${text.slice(0, n)}…`;
    if (ctx.measureText(cut).width <= width) return cut;
  }
  return '';
}
