// Cues: one quiet line under the header with the few keys that belong to where
// you are. Not a list of everything (? is that), and not what the last key did
// (the notice is that): a reminder of what's possible here.
//
// A mode takes every key, so its own keys replace everything else. At home the
// situations that open up keys stack, two at most, most pressing first. With
// nothing special going on, the line teaches: it shows space · n · ?, and every
// half minute a lesser-known key instead.

export type CueMode = 'pitch' | 'time' | 'vel' | 'chan' | 'iv' | 'fig';

export interface CueContext {
  mode: CueMode | null;
  tuning: boolean;          // tuning mode (the pie)
  freezeMenu: boolean;
  selection: number;        // events selected
  pins: number;             // events pinned
  ragaMoves: boolean;       // a raga sounds some notes other than written
  intervals: boolean;
  figures: boolean;
  held: boolean;            // a tuning held over every bloom
  pulsing: boolean;
  looping: boolean;
  slot: boolean;            // the selected garden slot holds a bloom
}

const MODE_CUES: Record<CueMode, string> = {
  pitch: '9 0 rotate · q snap to the scale · ( ) pivot · esc home',
  time: '9 0 rotate · q quantize · } divide · ! @ double / half time · esc home',
  vel: '9 0 rotate · y unify · q fewer levels · l L tilt · esc home',
  chan: '9 0 rotate · y unify · q fewer channels · l L tilt · esc home',
  fig: '↵ type them (tab: divide insert superimpose · vel %) · n N new · ; : longer / shorter · a z add / drop · B clear',
  iv: '↵ type them: -P5/10 (tab: vel %) · 7 & sparser / denser · - = evener / uneven · ; : thicker / thinner · q into the scale',
};

const TUNING_CUE = '3 4 a comma · # $ breeze · click a slice · esc home';
const FREEZE_CUE = 'p t v c 5 g freeze · d duration · e unpin · F closes';
const IDLE_CUE = 'space play · n new · ? all keys';

/** Lesser-known home keys, one at a time while nothing else needs saying */
const TIPS = [
  "' vary: a few small changes at once",
  '- = calm / intensify',
  '{ } merge / split a note (} asks into how many)',
  '" repeat every list (how many times?) · Z trim them to the notes',
  '( ) pivot on the highest / loudest note',
  '[ ] step the scale flatward / sharpward',
  'l L tilt the line down / up',
  '# $ breeze: some notes a scale step',
  'k K j J choose, slant, lift, reduce the scale',
  'e E shear an octave outward / centre the range',
  'w draw curves · W remove doubles',
  '; : clump / flatten chords',
  'opt-s u d: move only the pitches',
  'opt-p push a save point · opt-shift-p pop back',
  'opt-w wheels within wheels',
  'opt-1 … 9 change the view',
  'F freeze lists while you keep playing',
  'T tuning mode · opt-t hold the tuning',
  '5 ↵ add a chord every few notes: -P5/10',
  'b ↵ figures: 0 (1 2 3) 0 — a note plays do re mi in its time',
  'b ↵ figures: @3 — a note plays garden slot 3 from itself',
  'b ↵ tab: figures divide the note, insert into the flow, or superimpose on their own timeline',
  'b or 5 ↵ tab: vel % — how loud figures or added notes are against their note',
  'p t v c list modes: one key, one verb in each',
  '↓ save into the garden · ↑ lift a slot back',
];
const TIP_EVERY_MS = 30_000;

/** The situations at home that open up keys, most pressing first */
function situations(c: CueContext): string[] {
  const out: string[] = [];
  if (c.selection) out.push('esc clears · shift-esc inverts · keys act on these only');
  if (c.pins) out.push('esc unpins · click toggles a pin');
  if (c.ragaMoves) out.push('* bake what you hear');
  if (c.figures) out.push('b figures mode · * bake · B clear');
  if (c.intervals) out.push(c.ragaMoves ? '8 reset intervals' : '7 & sparser / denser · * bake · 8 reset');
  if (c.held) out.push('opt-t releases the hold');
  if (c.pulsing) out.push('< > rate · . stop');
  else if (c.looping) out.push('. stop');
  if (c.slot) out.push('↑ lift · shift-space play the slot');
  return out;
}

/** While a take plays back (perform ▾ → take): only the view is yours */
export const TAKE_CUE = 'playing the take · opt-1 … 9 view · opt-c clean · \\ console · | labels · opt-\\ lanes · . stops it';

/** What the line says now; `now` turns the tips */
export function cueFor(c: CueContext, now = Date.now()): { text: string; tip: boolean } {
  if (c.tuning) return { text: TUNING_CUE, tip: false };
  if (c.freezeMenu) return { text: FREEZE_CUE, tip: false };
  if (c.mode) return { text: MODE_CUES[c.mode], tip: false };
  const s = situations(c);
  if (s.length) return { text: s.slice(0, 2).join('   ·   '), tip: false };
  const turn = Math.floor(now / TIP_EVERY_MS);
  return turn % 2 === 0 ? { text: IDLE_CUE, tip: false } : { text: TIPS[Math.floor(turn / 2) % TIPS.length], tip: true };
}
