// Status text display — console-scroll mode (newest entry at top)

import { Bloom } from '../core/Bloom';
import { Garden } from '../garden';
import { spellOctave } from '../lib/numbers';

const MAX_HISTORY = 50;

export class Display {
  private el: HTMLElement;
  private history: string[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
  }

  update(bloom: Bloom | null, garden: Garden, status = ''): void {
    const text = this.buildText(bloom, garden, status);
    this.history.unshift(text);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    this.render();
  }

  setStatus(msg: string): void {
    if (this.history.length === 0) return;
    const lines = this.history[0].split('\n');
    const statusIdx = lines.findIndex(l => l.startsWith('> '));
    if (statusIdx >= 0) lines[statusIdx] = `> ${msg}`;
    else lines.push(`> ${msg}`);
    this.history[0] = lines.join('\n');
    this.render();
  }

  private buildText(bloom: Bloom | null, garden: Garden, status: string): string {
    if (!bloom) {
      return [`[empty buffer] ${garden}`, status ? `> ${status}` : ''].filter(Boolean).join('\n');
    }

    const notes = bloom.notes;
    const noteStrs = notes.map(note =>
      Array.isArray(note)
        ? `[${(note as number[]).map(x => spellOctave(x)).join(',')}]`
        : spellOctave(note as number),
    );

    // Show raw arrays — different lengths are intentional (polyrhythm)
    const N = notes.length;
    const velStrs  = bloom.velocities.map(v => String(v));
    const timeStrs = bloom.timeIntervals.map(t => String(Math.round(t * 100) / 100));
    const chanStrs = bloom.chans.map(c => String(c));

    // Add length annotation on the label when arrays are shorter than notes
    const velLabel  = `vel${bloom.velocities.length    < N ? `(${bloom.velocities.length})`    : ''}:`;
    const timeLabel = `time${bloom.timeIntervals.length < N ? `(${bloom.timeIntervals.length})` : ''}:`;
    const chanLabel = `chan${bloom.chans.length         < N ? `(${bloom.chans.length})`         : ''}:`;

    const scale = bloom.scale;
    const scaleName = bloom.appliedScale
      ? ` ${bloom.appliedScale.name}`
      : '';
    const scaleStr = `[${scale.degrees.join(',')}]${scaleName}`;

    const dur = Math.round(bloom.dur() * 100) / 100;

    const lines = [
      `notes:  ${noteStrs.join('  ')}`,
      `${velLabel.padEnd(8)}${velStrs.join('  ')}`,
      `${timeLabel.padEnd(8)}${timeStrs.join('  ')}`,
      `${chanLabel.padEnd(8)}${chanStrs.join('  ')}`,
      `scale:  ${scaleStr}   dur: ${dur}b`,
      bloom.name ? `name:   ${bloom.name}` : '',
      `garden: ${garden}`,
      status ? `> ${status}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  }

  clear(): void {
    this.history = [];
    this.render();
  }

  private render(): void {
    this.el.innerHTML = '';
    this.history.forEach((text, i) => {
      const div = document.createElement('div');
      div.className = i === 0 ? 'console-entry console-entry--current' : 'console-entry';
      div.textContent = text;
      this.el.appendChild(div);
    });
    this.el.scrollTop = 0;
  }
}
