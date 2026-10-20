// Notices — a brief readout of what the last key did and what it changed,
// shown over the view while the console is closed. Each key replaces the last.

import { Bloom } from '../core/Bloom';
import { flatNotes } from '../lib/arrays';
import { spell, spellOctave } from '../lib/numbers';

const SHOW_MS = 1800;

export class Notice {
  private el: HTMLElement;
  private labelEl: HTMLElement;
  private detailEl: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private label = '';
  private detail = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'notice';
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'notice-label';
    this.detailEl = document.createElement('div');
    this.detailEl.className = 'notice-detail';
    this.el.append(this.labelEl, this.detailEl);
    parent.appendChild(this.el);
  }

  /** A new key: forget what the previous one said */
  begin(): void { this.label = ''; this.detail = ''; }

  setLabel(label: string): void { this.label = label; this.render(); }

  /** What changed; keeps the label if one was already given for this key */
  setDetail(fallbackLabel: string, detail: string): void {
    if (!this.label) this.label = fallbackLabel;
    this.detail = detail;
    this.render();
  }

  private render(): void {
    // the console already says all this
    if (document.getElementById('console-overlay')?.classList.contains('visible')) return;
    if (!this.label && !this.detail) return;
    this.labelEl.textContent = this.label;
    this.detailEl.textContent = this.detail;
    this.detailEl.style.display = this.detail ? '' : 'none';
    this.el.classList.add('on');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('on'), SHOW_MS);
  }
}

// ─── What changed ─────────────────────────────────────────────────────────────

/** A snapshot small enough to keep per key, and to compare */
export interface Snap {
  notes: string; flat: number[]; time: number[]; vel: number[]; chan: number[]; intervals: string;
  scaleName: string; scaleDegs: string; nNotes: number;
}

export function snap(b: Bloom): Snap {
  const sc = b.scale;
  return {
    notes: JSON.stringify(b.notes), flat: flatNotes(b.notes) as number[],
    time: [...b.timeIntervals], vel: [...b.velocities], chan: [...b.chans],
    intervals: JSON.stringify(b.intervals), nNotes: b.notes.length,
    scaleName: sc.name, scaleDegs: [...sc.degrees].sort((x, y) => x - y).join(','),
  };
}

export function sameSnap(a: Snap, z: Snap): boolean {
  return a.notes === z.notes && a.intervals === z.intervals && a.scaleDegs === z.scaleDegs
    && a.time.join() === z.time.join() && a.vel.join() === z.vel.join() && a.chan.join() === z.chan.join();
}

const scaleText = (s: Snap) =>
  s.scaleName || s.scaleDegs.split(',').map(d => spell(Number(d))).join(' ');

/** One line saying what changed between two states, most telling first */
export function describeChange(a: Snap, z: Snap): string {
  const parts: string[] = [];
  if (a.scaleDegs !== z.scaleDegs || (z.scaleName && a.scaleName !== z.scaleName)) parts.push(`scale ${scaleText(z)}`);

  const len = (name: string, x: number, y: number) => { if (x !== y) parts.push(`${name} ${x} → ${y}`); };
  len('notes', a.nNotes, z.nNotes);
  len('times', a.time.length, z.time.length);
  len('vels', a.vel.length, z.vel.length);
  len('chans', a.chan.length, z.chan.length);

  if (a.notes !== z.notes && a.nNotes === z.nNotes) {
    if (a.flat.length === z.flat.length) {
      const moved = z.flat.filter((m, i) => m !== a.flat[i]).length;
      const same = [...a.flat].sort().join() === [...z.flat].sort().join();
      if (same && moved) parts.push('pitches reordered');
      else if (moved) parts.push(`${moved} of ${z.flat.length} pitches moved`);
    } else parts.push('chords changed');
    const lo = Math.min(...z.flat), hi = Math.max(...z.flat);
    if (lo !== Math.min(...a.flat) || hi !== Math.max(...a.flat)) parts.push(`range ${spellOctave(lo)}–${spellOctave(hi)}`);
  }
  const values = (name: string, x: number[], y: number[]) => {
    if (x.length !== y.length || x.join() === y.join()) return;
    const n = y.filter((v, i) => v !== x[i]).length;
    parts.push([...x].sort().join() === [...y].sort().join() ? `${name} reordered` : `${n} ${name} changed`);
  };
  values('times', a.time, z.time);
  values('vels', a.vel, z.vel);
  values('chans', a.chan, z.chan);
  if (a.intervals !== z.intervals) parts.push('intervals changed');
  return parts.slice(0, 3).join(' · ');
}
