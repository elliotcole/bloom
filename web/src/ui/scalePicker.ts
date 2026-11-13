// The scale picker: every scale and raga in the library, by name, on a chosen
// root. Opened from bloom ▾ (or a click on the scale badge); type to filter,
// ↑↓ to move, ↵ or a click to attach, esc to close.

import type { Scale } from '../lib/scales';
import { ALL_SCALES, scaleTranspose } from '../lib/scales';
import { spell } from '../lib/numbers';
import { Picker } from './picker';

export interface ScalePickerHost {
  /** The attached scale, if any, and the root a new one goes on */
  current(): Scale | null;
  root(): number;
  /** Attach this scale (written on C) on this root */
  apply(scale: Scale, root: number): void;
}

/** The library in the order it's shown: ragas first, then the scales by size */
function groups(): { title: string; scales: Scale[] }[] {
  const ragas = ALL_SCALES.filter(s => s.root !== undefined);
  const rest = ALL_SCALES.filter(s => s.root === undefined && s.pitchesPerOctave === 12);
  const sizes = [...new Set(rest.map(s => s.degrees.length))].sort((a, b) => a - b);
  return [
    { title: 'ragas (↕ rising and falling differ)', scales: ragas },
    ...sizes.map(n => ({ title: `${n} notes`, scales: rest.filter(s => s.degrees.length === n) })),
  ];
}

/** A row of the picker: a scale, as it reads on the chosen root */
export interface ScaleRow {
  scale: Scale;
  /** the header it sits under */
  group: string;
  name: string;
  /** its notes from the root up (a raga's rising and falling forms) */
  notes: string;
  /** it's the one attached */
  current: boolean;
}

const sorted = (pcs: number[]) => [...pcs].sort((a, b) => a - b).join();

/** The scales whose name has what's typed, group by group, spelled on `root`; `cur` is the attached one */
export function scaleRows(query: string, root: number, cur: Scale | null): ScaleRow[] {
  const q = query.trim().toLowerCase();
  const curKey = cur ? `${cur.name}|${sorted(cur.degrees)}` : '';
  const notes = (pcs: number[]) => [...pcs].sort((a, b) => (a - root + 12) % 12 - (b - root + 12) % 12).map(p => spell(p)).join(' ');
  return groups().flatMap(g => g.scales.filter(s => !q || s.name.toLowerCase().includes(q)).map(s => {
    const on = scaleTranspose(s, root);
    return {
      scale: s,
      group: g.title,
      name: `${s.name}${s.up ? ' ↕' : ''}`,
      notes: on.up && on.down ? `↑ ${notes(on.up)}  ↓ ${notes(on.down)}` : notes(on.degrees),
      current: `${s.name}|${sorted(on.degrees)}` === curKey,
    };
  }));
}

export class ScalePicker extends Picker<ScaleRow> {
  private rootSel: HTMLSelectElement;
  private host: ScalePickerHost;

  constructor(host: ScalePickerHost) {
    super({ id: 'scale-picker', hint: 'type to filter · ↑↓ move · ↵ or click attaches · esc closes', placeholder: 'scale or raga' });
    this.host = host;
    const label = document.createElement('label');
    label.className = 'sp-root';
    label.append('on ', this.rootSel = document.createElement('select'));
    this.top.appendChild(label);
    for (let pc = 0; pc < 12; pc++) this.rootSel.append(new Option(spell(pc), String(pc)));
    this.rootSel.addEventListener('change', () => { this.render(); this.input.focus(); });
  }

  open(): void {
    this.rootSel.value = String(this.host.root());
    this.openList();
  }

  protected rows(query: string): ScaleRow[] { return scaleRows(query, Number(this.rootSel.value), this.host.current()); }

  protected row(r: ScaleRow): HTMLElement {
    const el = this.rowEl(r.name, r.notes);
    el.classList.toggle('current', r.current);
    return el;
  }

  protected override start(rows: ScaleRow[]): number { return rows.findIndex(r => r.current); }
  protected override group(r: ScaleRow): string { return r.group; }

  protected choose(r: ScaleRow): boolean {
    this.host.apply(r.scale, Number(this.rootSel.value));
    return true;
  }
}
