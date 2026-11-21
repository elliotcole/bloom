// The editor's picture, two strips on one canvas. Above, the whole
// performance on the clock: where the notes lie, its pace, its loudness, the
// flags, and a bracket round the stretch the strip below shows. Below, that
// stretch as notes, a tick wherever a pass begins: faint if the bloom is the
// same as the pass before, heavier the more it changed. In note mode, the
// onset under the note cursor is lit and the notes selected are tinted.

import type { BloomJSON } from '../io/garden-io';
import { spellOctave } from '../lib/numbers';
import { columns, noteFrom, passAt, seam } from './perf';
import type { Note, Pass, Perf, Voice } from './perf';
import { rulerStep, stamp } from './window';
import type { Win } from './window';

export interface Scene {
  perf: Perf;
  blooms: BloomJSON[];      // every bloom a pass can name (perf.ts bloomList)
  win: Win;
  lane: Voice;
  cursor: number;           // a pass of the lane
  anchor: number | null;    // the other end of a selection
  playhead: number | null;  // ms, while playing
  note?: NoteMark | null;   // note mode
}

/** Note mode: the onset under the note cursor (its notes, and up to the next), and the notes selected */
export interface NoteMark { notes: Note[]; to: number; sel: { from: number; to: number } | null }

const BG = '#0a0a0f';
const ink = (a: number) => `rgba(200,206,228,${a})`;
const gold = (a: number) => `rgba(236,200,120,${a})`;
const flagInk = (a: number) => `rgba(240,140,104,${a})`;
const noteInk = (n: Note, a = 1) => `hsla(${(205 + n.chan * 22.5) % 360},72%,${38 + (n.vel / 127) * 40}%,${a})`;
const FONT = "10px Monaco, Menlo, Consolas, monospace";

const GUTTER = 36;       // left of both strips: what each row is
const FLAGS_H = 15;
const PACE_H = 24, LOUD_H = 24, RULER_H = 15, GAP = 12;

export class EditorView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private whole: HTMLCanvasElement | null = null;
  private wholeOf: Perf | null = null;
  private lo = 36;
  private hi = 96;
  private seams = new Map<string, 0 | 1 | 2 | 3>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    this.whole = null;
  }

  // ─── Where things are ─────────────────────────────────────────────────────

  private plotW(): number { return Math.max(10, this.w - GUTTER - 8); }
  /** How wide the strips are drawn (px) */
  stripWidth(): number { return this.plotW(); }
  private bandH(voices: number): number { return voices === 2 ? 44 : 64; }
  private wholeH(voices: number): number { return FLAGS_H + this.bandH(voices) * voices + PACE_H + LOUD_H + RULER_H; }
  /** The passes strip: each voice's lane, top and height */
  private lanes(voices: number): { top: number; height: number }[] {
    const top = this.wholeH(voices) + GAP + FLAGS_H;
    const height = Math.max(40, this.h - top - RULER_H - 4);
    if (voices === 1) return [{ top, height }];
    const each = (height - 8) / 2;
    return [{ top, height: each }, { top: top + each + 8, height: each }];
  }

  /** What's under a point: which strip, the moment, the voice */
  at(x: number, y: number, s: Scene): { zone: 'whole' | 'roll'; ms: number; voice: Voice } {
    const k = Math.max(0, Math.min(1, (x - GUTTER) / this.plotW()));
    if (y < this.wholeH(s.perf.voices) + GAP / 2) return { zone: 'whole', ms: k * s.perf.length, voice: s.lane };
    const lanes = this.lanes(s.perf.voices);
    const voice: Voice = lanes.length === 2 && y >= lanes[1].top - 4 ? 1 : 0;
    return { zone: 'roll', ms: s.win.from + k * s.win.span, voice };
  }

  // ─── The whole, drawn once for a performance and a width ──────────────────

  private range(perf: Perf): void {
    let lo = Infinity, hi = -Infinity;
    for (const n of perf.notes) { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; }
    if (lo > hi) { lo = 48; hi = 84; }
    this.lo = Math.floor(lo / 12) * 12;
    this.hi = Math.ceil((hi + 1) / 12) * 12;
  }

  private drawWhole(s: Scene): HTMLCanvasElement {
    const perf = s.perf, voices = perf.voices, W = this.plotW(), H = this.wholeH(voices), band = this.bandH(voices);
    const c = document.createElement('canvas');
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(H * this.dpr);
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.font = FONT;
    g.textBaseline = 'middle';
    this.range(perf);
    const x = (ms: number) => GUTTER + (ms / Math.max(perf.length, 1)) * W;
    const label = (text: string, y: number) => { g.fillStyle = ink(0.34); g.fillText(text, 2, y); };

    // where the bloom changed most: a faint line through the pitch rows
    perf.passes.forEach((mine, v) => {
      const top = FLAGS_H + v * band;
      mine.forEach((p, i) => {
        if (i && this.seamAt(mine, i, s.blooms) === 3) { g.fillStyle = ink(0.13); g.fillRect(x(p.at), top, 1, band - 2); }
      });
    });
    // the notes, each a point
    for (const n of perf.notes) {
      const top = FLAGS_H + n.voice * band;
      const y = top + 2 + ((this.hi - n.pitch - 1) / (this.hi - this.lo)) * (band - 6);
      g.fillStyle = noteInk(n, 0.6);
      g.fillRect(x(n.at), y, 1, 1.5);
    }
    if (voices === 2) { label('A', FLAGS_H + band / 2); label('B', FLAGS_H + band * 1.5); } else label('pitch', FLAGS_H + band / 2);

    const cols = columns(perf.notes, perf.length, Math.round(W));
    // pace: onsets a second, each doubling the same height
    const paceTop = FLAGS_H + band * voices;
    const paces = cols.map(c2 => c2.pace).filter(p => p > 0);
    if (paces.length) {
      const lo = Math.log2(Math.min(...paces)) - 0.2, hi = Math.log2(Math.max(...paces)) + 0.2;
      g.strokeStyle = ink(0.75);
      g.lineWidth = 1;
      g.beginPath();
      let pen = false;
      cols.forEach((c2, i) => {
        if (!c2.pace) { pen = false; return; }
        const y = paceTop + PACE_H - 3 - ((Math.log2(c2.pace) - lo) / (hi - lo)) * (PACE_H - 6);
        if (pen) g.lineTo(GUTTER + i + 0.5, y); else g.moveTo(GUTTER + i + 0.5, y);
        pen = true;
      });
      g.stroke();
    }
    label('pace', paceTop + PACE_H / 2);
    // loudness: the mean velocity
    const loudTop = paceTop + PACE_H;
    g.fillStyle = ink(0.4);
    cols.forEach((c2, i) => {
      if (!c2.count) return;
      const hgt = (c2.vel / 127) * (LOUD_H - 4);
      g.fillRect(GUTTER + i, loudTop + LOUD_H - 2 - hgt, 1, hgt);
    });
    label('loud', loudTop + LOUD_H / 2);
    // the clock
    const rulerTop = loudTop + LOUD_H;
    const step = rulerStep(perf.length, W, 70);
    g.fillStyle = ink(0.34);
    for (let t = 0; t <= perf.length; t += step) {
      g.fillRect(x(t), rulerTop, 1, 3);
      if (x(t) < this.w - 40) g.fillText(stamp(t), x(t) + 3, rulerTop + 8);
    }
    return c;
  }

  private seamAt(passes: Pass[], i: number, blooms: BloomJSON[]): 0 | 1 | 2 | 3 {
    if (i <= 0) return 3;
    const a = passes[i - 1].bloom, b = passes[i].bloom;
    if (a === b) return 0;
    const key = `${a}:${b}`;
    let v = this.seams.get(key);
    if (v === undefined) { v = seam(blooms[a]?.notes, blooms[b]?.notes, false); this.seams.set(key, v); }
    return v;
  }

  // ─── A frame ──────────────────────────────────────────────────────────────

  draw(s: Scene): void {
    const g = this.ctx, perf = s.perf, voices = perf.voices, W = this.plotW();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = BG;
    g.fillRect(0, 0, this.w, this.h);
    g.font = FONT;
    g.textBaseline = 'middle';
    if (this.wholeOf !== perf || !this.whole) { this.whole = this.drawWhole(s); this.wholeOf = perf; }
    const wholeH = this.wholeH(voices);
    g.drawImage(this.whole, 0, 0, this.w, wholeH);

    const passes = perf.passes[s.lane];
    const lo = s.anchor === null ? s.cursor : Math.min(s.anchor, s.cursor);
    const hi = s.anchor === null ? s.cursor : Math.max(s.anchor, s.cursor);
    const selFrom = passes[lo]?.at ?? 0, selTo = passes[hi]?.end ?? 0;
    const cur = passes[s.cursor];

    // ── over the whole: the window, the selection, the cursor, the flags, the playhead
    const wx = (ms: number) => GUTTER + (ms / Math.max(perf.length, 1)) * W;
    const bodyTop = FLAGS_H, bodyH = wholeH - FLAGS_H - RULER_H;
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(GUTTER, bodyTop, wx(s.win.from) - GUTTER, bodyH);
    g.fillRect(wx(s.win.from + s.win.span), bodyTop, GUTTER + W - wx(s.win.from + s.win.span), bodyH);
    g.strokeStyle = ink(0.55);
    g.lineWidth = 1;
    g.strokeRect(Math.round(wx(s.win.from)) + 0.5, bodyTop + 0.5, Math.max(2, wx(s.win.from + s.win.span) - wx(s.win.from)), bodyH - 1);
    if (s.anchor !== null) { g.fillStyle = gold(0.3); g.fillRect(wx(selFrom), bodyTop, Math.max(1, wx(selTo) - wx(selFrom)), bodyH); }
    if (cur) { g.fillStyle = gold(0.95); g.fillRect(Math.round(wx(cur.at)), bodyTop - 3, 1, bodyH + 6); }
    let nameEnd = -Infinity;
    for (const f of perf.flags) {
      const fx = Math.round(wx(f.at));
      g.fillStyle = flagInk(0.8);
      g.fillRect(fx, 2, 1, wholeH - RULER_H - 2);
      if (fx > nameEnd + 6) { g.fillText(f.name, fx + 3, 7); nameEnd = fx + 3 + g.measureText(f.name).width; }
    }
    if (s.playhead !== null) { g.fillStyle = '#fff'; g.fillRect(Math.round(wx(s.playhead)), bodyTop - 3, 1, bodyH + 6); }

    // ── the passes strip
    const lanes = this.lanes(voices);
    const end = s.win.from + s.win.span;
    const rx = (ms: number) => GUTTER + ((ms - s.win.from) / s.win.span) * W;
    const stripTop = lanes[0].top, stripBottom = lanes[lanes.length - 1].top + lanes[lanes.length - 1].height;
    g.save();
    g.beginPath();
    g.rect(GUTTER, stripTop - FLAGS_H, W, stripBottom - stripTop + FLAGS_H + RULER_H);
    g.clip();

    lanes.forEach((lane, v) => {
      const mine = perf.passes[v], active = v === s.lane;
      const y = (p: number) => lane.top + 3 + ((this.hi - p - 1) / (this.hi - this.lo)) * (lane.height - 8);
      const row = (lane.height - 8) / (this.hi - this.lo);
      // the Cs
      for (let c = this.lo; c <= this.hi; c += 12) { g.fillStyle = ink(0.07); g.fillRect(GUTTER, Math.round(y(c) + row), W, 1); }
      if (active && mine.length) {
        if (s.anchor !== null) { g.fillStyle = gold(0.13); g.fillRect(rx(selFrom), lane.top, rx(selTo) - rx(selFrom), lane.height); }
        if (s.note?.sel) { g.fillStyle = gold(0.2); g.fillRect(rx(s.note.sel.from), lane.top, Math.max(2, rx(s.note.sel.to) - rx(s.note.sel.from)), lane.height); }
        if (cur) {
          const x0 = rx(cur.at), cw = Math.max(2, rx(cur.end) - x0);
          g.fillStyle = gold(0.1);
          g.fillRect(x0, lane.top, cw, lane.height);
          g.fillStyle = gold(0.95);
          g.fillRect(x0, lane.top, cw, 1.5);
          g.fillRect(x0, lane.top + lane.height - 1.5, cw, 1.5);
          g.fillRect(x0, lane.top, 1.5, lane.height);
        }
      }
      // where each pass begins
      let numberEnd = -Infinity;
      for (let i = Math.max(0, passAt(mine, s.win.from)); i < mine.length && mine[i].at < end; i++) {
        const p = mine[i], x0 = rx(p.at), pw = ((p.end - p.at) / s.win.span) * W;
        const sm = this.seamAt(mine, i, s.blooms);
        const here = active && i === s.cursor;
        if (sm === 3 || (sm === 2 && pw >= 3) || (sm === 1 && pw >= 6) || (sm === 0 && pw >= 10)) {
          g.fillStyle = ink([0.1, 0.17, 0.34, 0.72][sm]);
          if (sm === 0) { for (let yy = lane.top; yy < lane.top + lane.height; yy += 5) g.fillRect(Math.round(x0), yy, 1, 2); }
          else g.fillRect(Math.round(x0), lane.top, sm === 3 ? 1.5 : 1, lane.height);
        }
        if (x0 > numberEnd + 8 && (pw >= 30 || sm === 3 || here)) {
          const text = String(i + 1);
          g.fillStyle = here ? gold(1) : ink(sm === 3 ? 0.6 : 0.34);
          g.fillText(text, x0 + 4, lane.top + 8);
          numberEnd = x0 + 4 + g.measureText(text).width;
        }
      }
      // the notes
      const head = Math.max(2, Math.min(6, (W / s.win.span) * 30));
      const nh = Math.max(2.5, Math.min(5, row * 0.85));
      const tails = s.win.span <= 45_000;
      const notes = perf.notes;
      for (let i = noteFrom(notes, s.win.from - (tails ? 12_000 : 0)); i < notes.length && notes[i].at < end; i++) {
        const n = notes[i];
        if (n.voice !== v) continue;
        const x0 = rx(n.at), yy = y(n.pitch) + (row - nh) / 2;
        if (tails) { g.fillStyle = noteInk(n, 0.16); g.fillRect(x0, yy + nh / 2 - 0.5, (n.dur / s.win.span) * W, 1); }
        const sounding = s.playhead !== null && n.at <= s.playhead && s.playhead < n.at + Math.min(n.dur, 350);
        g.fillStyle = sounding ? '#fff' : noteInk(n, active ? 1 : 0.6);
        g.fillRect(x0, yy, head, nh);
      }
      // note mode: the onset under the cursor, a column up to the next and a ring round each note
      if (active && s.note?.notes.length) {
        const at = s.note.notes[0].at, x0 = rx(at);
        g.fillStyle = gold(0.16);
        g.fillRect(x0, lane.top, Math.max(2, rx(s.note.to) - x0), lane.height);
        g.fillStyle = gold(0.95);
        g.fillRect(Math.round(x0) - 1, lane.top, 2, lane.height);
        g.strokeStyle = gold(1);
        g.lineWidth = 1.5;
        for (const n of s.note.notes) g.strokeRect(rx(n.at) - 2.5, y(n.pitch) + (row - nh) / 2 - 2.5, head + 5, nh + 5);
      }
    });

    // the flags, the playhead, the clock
    for (const f of perf.flags) {
      if (f.at < s.win.from - s.win.span || f.at > end) continue;
      const fx = Math.round(rx(f.at));
      g.fillStyle = flagInk(0.85);
      g.fillRect(fx, stripTop - FLAGS_H + 2, 1, stripBottom - stripTop + FLAGS_H - 2);
      g.fillText(f.name, fx + 4, stripTop - FLAGS_H + 7);
    }
    if (s.playhead !== null) { g.fillStyle = '#fff'; g.fillRect(Math.round(rx(s.playhead)), stripTop - 4, 1, stripBottom - stripTop + 8); }
    const step = rulerStep(s.win.span, W);
    g.fillStyle = ink(0.4);
    for (let t = Math.ceil(s.win.from / step) * step; t < end; t += step) {
      g.fillRect(Math.round(rx(t)), stripBottom, 1, 4);
      g.fillText(stamp(t, step < 1000), rx(t) + 3, stripBottom + 9);
    }
    g.restore();

    // the gutter: the Cs by name, the voices
    lanes.forEach((lane, v) => {
      const row = (lane.height - 8) / (this.hi - this.lo);
      g.fillStyle = ink(0.34);
      if (lane.height >= 110) {
        for (let c = this.lo; c < this.hi; c += 12) {
          const yy = lane.top + 3 + ((this.hi - c - 1) / (this.hi - this.lo)) * (lane.height - 8) + row / 2;
          g.fillText(spellOctave(c), voices === 2 ? 12 : 4, yy);
        }
      }
      if (voices === 2) { g.fillStyle = v === s.lane ? gold(1) : ink(0.4); g.fillText(v === 0 ? 'A' : 'B', 2, lane.top + 8); }
    });
  }
}
