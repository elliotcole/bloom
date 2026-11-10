import { describe, it, expect } from 'vitest';
import { filterTunings } from '../tuningPicker';
import type { Tuning } from '../../lib/tuning';

const t = (name: string, description?: string): Tuning => ({ name, description, cents: Array(12).fill(0), period: 1200 });

describe('the tuning menu', () => {
  const lib = [t('12-TET'), t('young-lm_piano', 'La Monte Young, The Well-Tuned Piano'), t('partch_43', 'Partch 43-tone'), t('kirnberger')];
  it('every tuning, in library order, with nothing typed', () => {
    expect(filterTunings(lib, '').map(x => x.name)).toEqual(['12-TET', 'young-lm_piano', 'partch_43', 'kirnberger']);
  });
  it('filters on the name and the description, every word', () => {
    expect(filterTunings(lib, 'well piano').map(x => x.name)).toEqual(['young-lm_piano']);
    expect(filterTunings(lib, 'PARTCH').map(x => x.name)).toEqual(['partch_43']);
    expect(filterTunings(lib, 'zzz')).toEqual([]);
  });
});
