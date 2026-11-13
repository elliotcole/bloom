// The rhythm picker (k in time mode): duration palettes the times snap to,
// and rhythm cells the time list becomes. Type to filter by name, or type a
// cell of your own: "5/8" spreads five over eight, "3 3 2" is the gaps
// themselves, in pulses. ↑↓ move, ↵ or a click chooses, esc closes.

import { DURATION_PALETTES, RHYTHM_CELLS, parseCell, ratioText } from '../lib/rhythms';
import { Picker, hasWords } from './picker';

export interface RhythmRow {
  kind: 'palette' | 'cell';
  name: string;
  says: string;
  /** a palette's ratios of the pulse, or a cell's durations in pulses */
  values: number[];
}

export interface RhythmPickerHost {
  apply(row: RhythmRow): void;
}

/** The rows for what's typed: a typed cell first, then the palettes and cells whose name or description has every word */
export function rhythmRows(query: string): RhythmRow[] {
  const typed = parseCell(query);
  if (typed) return [{ kind: 'cell', name: typed.name, says: typed.says, values: typed.cell }];
  return [
    ...DURATION_PALETTES.map((p): RhythmRow => ({ kind: 'palette', name: p.name, says: p.says, values: p.ratios })),
    ...RHYTHM_CELLS.map((c): RhythmRow => ({ kind: 'cell', name: c.name, says: c.says, values: c.cell })),
  ].filter(r => hasWords(`${r.name} ${r.says}`, query));
}

export class RhythmPicker extends Picker<RhythmRow> {
  private host: RhythmPickerHost;

  constructor(host: RhythmPickerHost) {
    super({ id: 'rhythm-picker', hint: 'type to filter, or a cell of your own: 5/8, 3 3 2 · ↑↓ move · ↵ or click chooses · esc closes', placeholder: 'palette or cell' });
    this.host = host;
  }

  open(): void { this.openList(); }

  protected rows(query: string): RhythmRow[] { return rhythmRows(query); }

  protected row(r: RhythmRow): HTMLElement {
    return this.rowEl(r.name, `${r.values.map(ratioText).join('  ')}   ·   ${r.says}`);
  }

  protected override group(r: RhythmRow): string {
    return r.kind === 'palette'
      ? 'duration palettes: the times snap to these (1 is the pulse, your commonest duration)'
      : 'rhythm cells: the time list becomes this, at its own length, phasing against the notes';
  }

  protected choose(r: RhythmRow): boolean {
    this.host.apply(r);
    return true;
  }
}
