// The editor's keys, one table: what's pressed, what it's called, what it
// does, and at which level (passes, or the notes of note mode). The help and
// the cue line are written from it.

/** What the keys work on (the page is one) */
export interface Ed {
  play(runUp?: boolean): void;
  step(by: number, extend: boolean): void;
  seam(dir: 1 | -1, extend: boolean): void;
  flagStep(dir: 1 | -1, extend: boolean): void;
  edge(dir: 1 | -1, extend: boolean): void;
  section(): void;
  clear(): void;
  zoom(factor: number): void;
  whole(): void;
  lane(): void;
  flag(): void;
  unflag(): void;
  cut(everyVoice: boolean): void;
  undo(): void;
  redo(): void;
  goTo(): void;
  open(): void;
  save(): void;
  exportTake(): void;
  exportScore(): void;
  help(): void;
  /** loudness or pace as a shape over the selection, or its velocities as a pattern, typed in */
  shape(kind: 'loud' | 'pace' | 'vels'): void;
  copy(andCut: boolean): void;
  paste(): void;
  /** the clipboard's velocities or timing alone, over the selection */
  pasteOne(kind: 'vels' | 'gaps'): void;
  run(): void;
  /** note mode, at the cursor pass's first onset */
  notes(): void;
  /** note mode: the cursor by onsets */
  noteStep(by: number, extend: boolean): void;
  /** note mode: the first onset of the pass before or after */
  notePass(dir: 1 | -1, extend: boolean): void;
  /** silence: the notes taken out, the time left */
  drop(): void;
  transpose(by: number): void;
  /** the pitches, or the timing, typed */
  typePitches(): void;
  typeTimes(): void;
  /** Bloom's palette on the passes */
  verbs(): void;
}

export type Level = 'pass' | 'note';

export interface Key {
  /** as `chordOf` spells it; several, if more than one key does it */
  chord: string[];
  does: string;
  group: 'move' | 'select' | 'notes' | 'edit' | 'view' | 'file';
  /** the level it works at; absent, both */
  level?: Level;
  /** its words on the cue line, keys and all; absent, it isn't on it */
  cue?: string;
  /** the one level whose cue line has it; absent, each it works at */
  cueAt?: Level;
  run(ed: Ed): void;
}

export const KEYS: Key[] = [
  { chord: ['space'], level: 'pass', group: 'move', cue: 'space play', does: 'play from the cursor, or stop. With a selection: play it, and stop at its end', run: ed => ed.play() },
  { chord: ['⇧space'], level: 'pass', group: 'move', does: 'play from two passes before the cursor, to hear a join', run: ed => ed.play(true) },
  { chord: ['ArrowLeft'], level: 'pass', group: 'move', cue: '← → pass', does: 'the pass before', run: ed => ed.step(-1, false) },
  { chord: ['ArrowRight'], level: 'pass', group: 'move', does: 'the next pass', run: ed => ed.step(1, false) },
  { chord: ['⌥ArrowLeft'], level: 'pass', group: 'move', cue: '⌥← → bloom changes', does: 'back to where the bloom last changed', run: ed => ed.seam(-1, false) },
  { chord: ['⌥ArrowRight'], level: 'pass', group: 'move', does: 'on to where the bloom next changes', run: ed => ed.seam(1, false) },
  { chord: ['['], level: 'pass', group: 'move', cue: '[ ] flags', does: 'the flag before', run: ed => ed.flagStep(-1, false) },
  { chord: [']'], level: 'pass', group: 'move', does: 'the next flag', run: ed => ed.flagStep(1, false) },
  { chord: ['Home', '⌘ArrowLeft'], level: 'pass', group: 'move', does: 'the start', run: ed => ed.edge(-1, false) },
  { chord: ['End', '⌘ArrowRight'], level: 'pass', group: 'move', does: 'the end', run: ed => ed.edge(1, false) },
  { chord: ['g'], level: 'pass', group: 'move', cue: 'g go to', does: 'go to a time (1:02:10) or a pass (416)', run: ed => ed.goTo() },

  { chord: ['⇧ArrowLeft'], level: 'pass', group: 'select', cue: '⇧ select', does: 'select back a pass', run: ed => ed.step(-1, true) },
  { chord: ['⇧ArrowRight'], level: 'pass', group: 'select', does: 'select on a pass', run: ed => ed.step(1, true) },
  { chord: ['⌥⇧ArrowLeft'], level: 'pass', group: 'select', does: 'select back to where the bloom changed', run: ed => ed.seam(-1, true) },
  { chord: ['⌥⇧ArrowRight'], level: 'pass', group: 'select', does: 'select on to where the bloom changes', run: ed => ed.seam(1, true) },
  { chord: ['{'], level: 'pass', group: 'select', does: 'select back to the flag before', run: ed => ed.flagStep(-1, true) },
  { chord: ['}'], level: 'pass', group: 'select', does: 'select on to the next flag', run: ed => ed.flagStep(1, true) },
  { chord: ['⇧Home', '⌘⇧ArrowLeft'], level: 'pass', group: 'select', does: 'select back to the start', run: ed => ed.edge(-1, true) },
  { chord: ['⇧End', '⌘⇧ArrowRight'], level: 'pass', group: 'select', does: 'select on to the end', run: ed => ed.edge(1, true) },
  { chord: ['s'], level: 'pass', group: 'select', cue: 's section', does: 'select the section the cursor is in, flag to flag', run: ed => ed.section() },
  { chord: ['r'], level: 'pass', group: 'select', does: 'select the run of passes round the cursor that play the same bloom', run: ed => ed.run() },
  { chord: ['Escape'], level: 'pass', group: 'select', does: 'let the selection go', run: ed => ed.clear() },

  { chord: ['Enter'], level: 'pass', group: 'notes', cue: '↵ notes', does: 'note mode: the notes of the passes one onset (a chord is one) at a time, from the cursor pass\'s first', run: ed => ed.notes() },
  { chord: ['space'], level: 'note', group: 'notes', cue: 'space play', does: 'play from the note cursor, or stop. With a selection: play it, and stop', run: ed => ed.play() },
  { chord: ['⇧space'], level: 'note', group: 'notes', does: 'play from a little before the note cursor', run: ed => ed.play(true) },
  { chord: ['ArrowLeft'], level: 'note', group: 'notes', cue: '← → onset', does: 'the onset before, on through the passes', run: ed => ed.noteStep(-1, false) },
  { chord: ['ArrowRight'], level: 'note', group: 'notes', does: 'the next onset', run: ed => ed.noteStep(1, false) },
  { chord: ['⌥ArrowLeft'], level: 'note', group: 'notes', cue: '⌥← → pass', does: 'the first onset of the pass before', run: ed => ed.notePass(-1, false) },
  { chord: ['⌥ArrowRight'], level: 'note', group: 'notes', does: 'the first onset of the next pass', run: ed => ed.notePass(1, false) },
  { chord: ['⇧ArrowLeft'], level: 'note', group: 'notes', cue: '⇧ select', does: 'select back an onset', run: ed => ed.noteStep(-1, true) },
  { chord: ['⇧ArrowRight'], level: 'note', group: 'notes', does: 'select on an onset', run: ed => ed.noteStep(1, true) },
  { chord: ['⌥⇧ArrowLeft'], level: 'note', group: 'notes', does: 'select back to the first onset of a pass', run: ed => ed.notePass(-1, true) },
  { chord: ['⌥⇧ArrowRight'], level: 'note', group: 'notes', does: 'select on to the first onset of the next pass', run: ed => ed.notePass(1, true) },
  { chord: ['Escape'], level: 'note', group: 'notes', cue: 'esc passes', does: 'let the note selection go; with none, back to passes', run: ed => ed.clear() },

  { chord: ['x', 'Backspace', 'Delete'], group: 'edit', cue: 'x delete', does: 'delete the selection (or the pass, or the onset, under the cursor) and close the gap. Two voices: from this voice alone', run: ed => ed.cut(false) },
  { chord: ['X'], group: 'edit', does: 'two voices: delete that stretch of the clock from both', run: ed => ed.cut(true) },
  { chord: ['d'], group: 'edit', cue: 'd silence', cueAt: 'note', does: 'silence: take the notes of the selection out and leave the time where it was', run: ed => ed.drop() },
  { chord: ['m'], group: 'edit', cue: 'm flag', cueAt: 'pass', does: 'a flag here, or its name changed. Playing: where it is now', run: ed => ed.flag() },
  { chord: ['M'], group: 'edit', does: 'take the flag here away', run: ed => ed.unflag() },
  { chord: ['c'], group: 'edit', cue: 'c a v loud, pace, accents', cueAt: 'pass', does: 'loudness as a shape over the selection, in % (100 flat, 60 100 louder and louder, 60 100 80 up then down)', run: ed => ed.shape('loud') },
  { chord: ['a'], group: 'edit', does: 'pace as a shape, in % (100 as played, 100 150 faster and faster); what follows moves up or back', run: ed => ed.shape('pace') },
  { chord: ['v'], group: 'edit', cue: 'v velocities', cueAt: 'note', does: 'velocities as a pattern over the onsets, over and over and on through the passes (100 60 80 60)', run: ed => ed.shape('vels') },
  { chord: ['p'], group: 'edit', cue: 'p t pitches, times', cueAt: 'note', does: 'pitches for the onsets in turn, over and over (60 64 67, or C4 E4 G4); a chord moves whole, its lowest note to the pitch', run: ed => ed.typePitches() },
  { chord: ['t'], group: 'edit', does: 'timing for the onsets in turn, in seconds as in Bloom (0.25 0.25 0.5), over and over; what follows moves up or back', run: ed => ed.typeTimes() },
  { chord: ['1'], group: 'edit', cue: '1 2 transpose', cueAt: 'note', does: 'down a semitone (as in Bloom); pressed again, the same edit goes further', run: ed => ed.transpose(-1) },
  { chord: ['2'], group: 'edit', does: 'up a semitone', run: ed => ed.transpose(1) },
  { chord: ['!'], group: 'edit', does: 'down an octave', run: ed => ed.transpose(-12) },
  { chord: ['@'], group: 'edit', does: 'up an octave', run: ed => ed.transpose(12) },
  { chord: ['⌘k'], group: 'edit', cue: '⌘k verbs', does: 'Bloom\'s palette on the selected passes (note mode: the pass under the note cursor), each made a bloom and back; passes that sound the same come out the same', run: ed => ed.verbs() },
  { chord: ['⌘c'], group: 'edit', cue: '⌘c ⌘v copy, paste', cueAt: 'pass', does: 'copy the selection (or the pass under the cursor) of this voice', run: ed => ed.copy(false) },
  { chord: ['⌘x'], group: 'edit', does: 'copy it, then delete it', run: ed => ed.copy(true) },
  { chord: ['⌘v'], group: 'edit', does: 'put what was copied in before the cursor; with a selection, in its place', run: ed => ed.paste() },
  { chord: ['V'], group: 'edit', does: 'the velocities of what was copied, over the selection', run: ed => ed.pasteOne('vels') },
  { chord: ['T'], group: 'edit', does: 'the timing of what was copied (its gaps), over the selection; what follows moves up or back', run: ed => ed.pasteOne('gaps') },
  { chord: ['⌘z'], group: 'edit', cue: '⌘z undo', does: 'undo', run: ed => ed.undo() },
  { chord: ['⌘⇧z'], group: 'edit', does: 'redo', run: ed => ed.redo() },

  { chord: ['ArrowUp'], group: 'view', cue: '↑ ↓ zoom', cueAt: 'pass', does: 'closer', run: ed => ed.zoom(0.5) },
  { chord: ['ArrowDown'], group: 'view', does: 'wider', run: ed => ed.zoom(2) },
  { chord: ['0'], group: 'view', does: 'the whole performance', run: ed => ed.whole() },
  { chord: ['Tab'], group: 'view', does: 'two voices: the other voice (from note mode, at pass level)', run: ed => ed.lane() },
  { chord: ['?'], group: 'view', cue: '? keys', does: 'these keys', run: ed => ed.help() },

  { chord: ['⌘o'], group: 'file', does: 'open a take (.bloomtake) or an edit of this one (.bloomedit)', run: ed => ed.open() },
  { chord: ['⌘s'], group: 'file', does: 'save the edit: a small file beside the take, which stays as it was', run: ed => ed.save() },
  { chord: ['⌘e'], group: 'file', does: 'write the edited performance as a take, to play in Bloom', run: ed => ed.exportTake() },
  { chord: ['⌘⇧e'], group: 'file', does: 'write it as a score (MusicXML)', run: ed => ed.exportScore() },
];

export interface Pressed { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/**
 * A key press as the table spells it: ⌘ (or ctrl), ⌥, ⇧, then the key. A
 * character already says whether shift was down ("M", "{"), so ⇧ is written
 * only for a named key (⇧ArrowLeft, ⇧space) or with ⌘ (⌘⇧z).
 */
export function chordOf(e: Pressed): string {
  const cmd = e.metaKey || e.ctrlKey;
  let key = e.key === ' ' ? 'space' : e.key;
  if (cmd && key.length === 1) key = key.toLowerCase();
  const shift = e.shiftKey && (key.length > 1 || cmd);
  return `${cmd ? '⌘' : ''}${e.altKey ? '⌥' : ''}${shift ? '⇧' : ''}${key}`;
}

/** Whether a key works at a level */
export const atLevel = (k: Key, level: Level): boolean => k.level === undefined || k.level === level;

const BY_CHORD: Record<Level, Map<string, Key>> = {
  pass: new Map(KEYS.filter(k => atLevel(k, 'pass')).flatMap(k => k.chord.map(c => [c, k] as const))),
  note: new Map(KEYS.filter(k => atLevel(k, 'note')).flatMap(k => k.chord.map(c => [c, k] as const))),
};
export const keyFor = (e: Pressed, level: Level = 'pass'): Key | undefined => BY_CHORD[level].get(chordOf(e));

const NAMES: [string, string][] = [['ArrowLeft', '←'], ['ArrowRight', '→'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['Escape', 'esc'], ['Backspace', '⌫'], ['Delete', 'del'], ['Home', 'home'], ['End', 'end'], ['Tab', 'tab'], ['Enter', '↵']];
/** A chord as it's shown */
export function shown(chord: string): string {
  return NAMES.reduce((s, [a, b]) => s.replace(a, b), chord);
}

const GROUPS: [Key['group'], string][] = [['move', 'moving'], ['select', 'selecting'], ['notes', 'notes'], ['edit', 'editing'], ['view', 'the view'], ['file', 'files']];

/** The guide's section on the editor (the same guide the bloom's ? links to) */
export const GUIDE_URL = 'https://github.com/elliotcole/bloom/blob/main/web/GUIDE.md#the-editor-editor';

/** The help: every key by group, a pair of keys that go opposite ways on one line, and the guide */
export function helpHtml(): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const groups = GROUPS.map(([g, title]) => {
    const rows = KEYS.filter(k => k.group === g).map(k => `<tr><td>${k.chord.map(c => `<b>${esc(shown(c))}</b>`).join(' ')}</td><td>${esc(k.does)}</td></tr>`);
    return `<h3>${title}</h3><table>${rows.join('')}</table>`;
  }).join('');
  return `${groups}<p class="help-links"><a href="${GUIDE_URL}" target="_blank" rel="noopener">the guide</a></p>`;
}

/** The cue line for a level: the keys worth having in view there */
export function cueLine(level: Level = 'pass'): string {
  return KEYS.flatMap(k => (k.cue && atLevel(k, level) && (k.cueAt ?? level) === level ? [k.cue] : [])).join('   ');
}
