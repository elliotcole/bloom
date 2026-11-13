// The tuning picker: every loaded tuning by name, chosen on purpose rather
// than stepped through (] [ sound each one on the way). Opened with l in
// tuning mode; type to filter, ↑↓ to move, ↵ or a click to choose, esc to
// close. Nothing sounds until a tuning is chosen.

import type { Tuning } from '../lib/tuning';
import { Picker, hasWords } from './picker';

export interface TuningPickerHost {
  /** The loaded tunings, 12-TET first */
  library(): Tuning[];
  /** The sounding tuning's name ('12-TET' when none) */
  current(): string;
  /** Make this the base under the same alterations */
  apply(t: Tuning): void;
}

/** The tunings whose name or description has every word typed, in library order */
export function filterTunings(lib: Tuning[], q: string): Tuning[] {
  return lib.filter(t => hasWords(`${t.name} ${t.description ?? ''}`, q));
}

export class TuningPicker extends Picker<Tuning> {
  private host: TuningPickerHost;

  constructor(host: TuningPickerHost) {
    super({ id: 'tuning-picker', hint: 'type to filter · ↑↓ move · ↵ or click chooses · esc closes', placeholder: 'tuning' });
    this.host = host;
  }

  open(): void { this.openList(); }

  protected rows(query: string): Tuning[] { return filterTunings(this.host.library(), query); }

  protected row(t: Tuning): HTMLElement {
    const el = this.rowEl(t.name, t.description ?? '');
    el.classList.toggle('current', t.name === this.host.current());
    return el;
  }

  protected override start(rows: Tuning[]): number {
    const cur = this.host.current();
    return rows.findIndex(t => t.name === cur);
  }

  protected choose(t: Tuning): boolean {
    this.host.apply(t);
    return true;
  }
}
