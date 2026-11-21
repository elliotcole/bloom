// Bloom's editor: a whole performance (a take) as the thing worked on. It's
// traversed by pass or by note, flagged, cut, reshaped, copied, and worked by
// Bloom's own verbs; the take itself is never changed, and what's done to it
// is a list that can be undone, saved beside it, and written out as a take
// again or as a score.
//
//   editor.html
//
// The model is editor/perf.ts, the picture editor/view.ts, the keys editor/keys.ts.

import './style.css';
import './ui/palette.css';
import type { TakeFile } from './audio/take';
import { finish, lastTime, loadKept } from './audio/take';
import { parseClock } from './audio/takeFrom';
import { getState, initMidi, onOutputChange, registerVirtualOutput } from './audio/midi';
import { isLoaded, loadSynth, pianoOutput } from './audio/synth';
import { connectHelper } from './audio/tuningOut';
import type { BloomJSON } from './io/garden-io';
import { takeToMusicXML } from './io/musicxml';
import { spellOctave } from './lib/numbers';
import { Overlay } from './ui/overlay';
import { Edit, bloomList, editFile, editIsOf, joined, liftTake, noteFrom, passAt, renderTake, sameTime } from './editor/perf';
import type { Op, Pass, Perf, Voice } from './editor/perf';
import { clipOf, clipPattern, onsetsIn } from './editor/ops';
import type { Clip } from './editor/ops';
import { nextOnset, onsetBefore, onsetFrom, onsetMembers, placeInPass, prevOnset } from './editor/notes';
import { rework } from './editor/rework';
import { PREFILL_MAX, nowOf, numbers, pitchesOf } from './editor/typed';
import { VerbPalette } from './editor/verbs';
import { EditorView } from './editor/view';
import type { NoteMark, Scene } from './editor/view';
import { Player } from './editor/play';
import { cueLine, helpHtml, keyFor } from './editor/keys';
import type { Ed, Level } from './editor/keys';
import { clampWin, lasting, showWin, stamp, zoomWin } from './editor/window';
import type { Win } from './editor/window';
import { download, keepOps, keepTake, loadSession, readFile } from './editor/store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('editor-canvas');
const nameEl = $('name'), totalsEl = $('totals'), statusEl = $('status'), readoutEl = $('readout'), cueEl = $('cue');
const emptyEl = $('empty'), emptyLast = $('empty-last'), helpEl = $('help'), askEl = $('ask');
const outEl = $<HTMLSelectElement>('out');
const askLabel = $('ask-label'), askInput = $<HTMLInputElement>('ask-input'), fileInput = $<HTMLInputElement>('file');

const view = new EditorView(canvas);
const player = new Player();

// ─── What's open ────────────────────────────────────────────────────────────

let take: TakeFile | null = null;
let name = '';
let edit: Edit | null = null;
let win: Win = { from: 0, span: 1 };
let lane: Voice = 0;
let cursor = 0;
let anchor: number | null = null;
let level: Level = 'pass';
let noteAt = 0;                      // note mode: when the onset under the note cursor starts
let noteAnchor: number | null = null;   // note mode: when the onset at the selection's other end starts
let following = false;               // playing, and the cursor goes with it
let sounding: TakeFile | null = null;   // the edited performance as a take, made when it's first wanted
let savedOps = 0;                    // how many operations the last saved file had
let kept: TakeFile | null = null;    // Bloom's last take, offered while nothing's open
let clip: Clip | null = null;        // what ⌘c and ⌘x took, for ⌘v (this page's own, not the system's)
const typed: Record<string, string> = {};   // the last typed for each verb, to begin the next with

const passes = (): Pass[] => (edit ? edit.perf.passes[lane] : []);
const clampPass = (i: number) => Math.max(0, Math.min(passes().length - 1, i));
const selection = (): [number, number] => (anchor === null ? [cursor, cursor] : [Math.min(anchor, cursor), Math.max(anchor, cursor)]);

/** Every bloom a pass can name, made again only when the edit adds one */
let bloomsOf: BloomJSON[] | null = null, bloomsNow: BloomJSON[] = [];
function blooms(): BloomJSON[] {
  if (!edit || !take) return [];
  if (bloomsOf !== edit.perf.blooms) { bloomsOf = edit.perf.blooms; bloomsNow = bloomList(take, edit.perf); }
  return bloomsNow;
}

function say(text: string): void { statusEl.textContent = text; }

function openTake(t: TakeFile, called: string, ops: Op[] = [], fresh = true): void {
  player.stop();
  take = t.ended ? t : finish(t, lastTime(t));
  name = called;
  edit = new Edit(liftTake(take), ops);
  savedOps = fresh ? 0 : ops.length;
  sounding = null;
  bloomsOf = null;
  lane = 0; cursor = 0; anchor = null; level = 'pass'; noteAnchor = null;
  win = clampWin({ from: 0, span: 120_000 }, edit.perf.length);
  if (fresh) keepTake(take, name);
  if (player.output() !== pianoOutput && take.sysex.length) void connectHelper();
  emptyEl.hidden = true;
  say(passes().length ? '' : 'this take has no notes');
  changed(false);
}

/** After anything that changes the performance: nothing made from the old one is good now */
function changed(store = true): void {
  if (!edit || !take) return;
  sounding = null;
  cursor = clampPass(cursor);
  if (anchor !== null) anchor = clampPass(anchor);
  if (level === 'note') {
    const i = noteCursor();
    if (i < 0) leaveNotes();
    else { noteAt = edit.perf.notes[i].at; cursor = Math.max(0, passAt(passes(), noteAt)); anchor = null; }
  }
  win = clampWin(win, edit.perf.length);
  if (store) keepOps(take, edit.ops);
  refresh();
}

// ─── Note mode ──────────────────────────────────────────────────────────────

/** The onset under the note cursor (an index into the notes; -1 with no notes in the lane) */
function noteCursor(): number {
  if (!edit) return -1;
  const i = onsetFrom(edit.perf, lane, noteAt);
  return i >= 0 ? i : onsetBefore(edit.perf, lane, Infinity);
}

/** The note selection's first and last onsets (both the cursor's, with none) */
function noteSelection(): [number, number] {
  const c = noteCursor();
  if (!edit || noteAnchor === null || c < 0) return [c, c];
  const a = onsetFrom(edit.perf, lane, noteAnchor);
  if (a < 0) return [c, c];
  return edit.perf.notes[a].at < edit.perf.notes[c].at ? [a, c] : [c, a];
}

/** Where the onset after the one at `i` starts; the last of the lane, its pass's end */
function afterOnset(i: number): number {
  const p = edit!.perf, n = nextOnset(p, lane, i);
  if (n >= 0) return p.notes[n].at;
  const s = p.passes[lane][passAt(p.passes[lane], p.notes[i].at)];
  return Math.max(s ? s.end : 0, p.notes[i].at + 1);
}

/** How many onsets from the one at `a` to the one at `b` */
function countOnsets(a: number, b: number): number {
  let n = 1;
  for (let i = a; edit && i >= 0 && i !== b; n++) i = nextOnset(edit.perf, lane, i);
  return n;
}

/** The note cursor to the onset at `i`; `extend` keeps the other end where the selection began */
function noteTo(i: number, extend: boolean): void {
  if (!edit || i < 0) return;
  if (extend) { if (noteAnchor === null) noteAnchor = noteAt; following = false; }
  else noteAnchor = null;
  noteAt = edit.perf.notes[i].at;
  if (noteAnchor !== null && sameTime(noteAnchor, noteAt)) noteAnchor = null;
  cursor = Math.max(0, passAt(passes(), noteAt));
  if (player.playing() && following) startPlaying(noteAt, edit.perf.length);
  else win = showWin(win, noteAt, afterOnset(i), edit.perf.length);
  refresh();
}

function leaveNotes(): void {
  level = 'pass';
  noteAnchor = null;
  anchor = null;
  if (edit) cursor = clampPass(passAt(passes(), noteAt));
}

/** The onsets from `from` up to `to` selected (none long: the cursor on the onset at `from`) */
function selectNotes(from: number, to: number): void {
  if (!edit) return;
  const p = edit.perf;
  let i = onsetFrom(p, lane, from);
  if (i < 0) i = onsetBefore(p, lane, Infinity);
  if (i < 0) { leaveNotes(); return; }
  const j = to > from ? onsetBefore(p, lane, to) : -1;
  noteAnchor = j >= 0 && p.notes[j].at > p.notes[i].at ? p.notes[i].at : null;
  noteAt = p.notes[noteAnchor !== null ? j : i].at;
  cursor = Math.max(0, passAt(passes(), noteAt));
  win = showWin(win, from, Math.max(to, from + 1), p.length);
}

/** `count` onsets from the one at `from` selected */
function selectCount(from: number, count: number): void {
  if (!edit) return;
  const p = edit.perf, i = onsetFrom(p, lane, from);
  if (i < 0) { selectNotes(from, from); return; }
  let j = i;
  for (let k = 1; k < count; k++) { const n = nextOnset(p, lane, j); if (n < 0) break; j = n; }
  noteAnchor = j !== i ? p.notes[i].at : null;
  noteAt = p.notes[j].at;
  cursor = Math.max(0, passAt(passes(), noteAt));
}

/** A stretch selected at either level */
function selectStretch(from: number, to: number): void {
  if (level === 'note') selectNotes(from, to); else selectSpan(from, to);
}

// ─── The picture and the words ──────────────────────────────────────────────

let queued = false;
function refresh(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(); });
}

function paint(): void {
  if (!edit || !take) return;
  let playhead: number | null = null;
  if (player.playing()) {
    playhead = player.position();
    if (following && level === 'pass') { const c = passAt(passes(), playhead); if (c >= 0 && c !== cursor) cursor = c; }
    if (following && level === 'note') {
      const i = onsetBefore(edit.perf, lane, playhead + 1);
      if (i >= 0) { noteAt = edit.perf.notes[i].at; cursor = Math.max(0, passAt(passes(), noteAt)); }
    }
    win = showWin(win, playhead, playhead + win.span * 0.1, edit.perf.length);
    refresh();
  }
  const scene: Scene = { perf: edit.perf, blooms: blooms(), win, lane, cursor, anchor: level === 'note' ? null : anchor, playhead, note: noteMark() };
  view.draw(scene);
  words();
}

/** What the view marks in note mode */
function noteMark(): NoteMark | null {
  if (!edit || level !== 'note') return null;
  const i = noteCursor();
  if (i < 0) return null;
  const s = noteAnchor !== null ? stretch() : null;
  return { notes: onsetMembers(edit.perf, lane, i).map(k => edit!.perf.notes[k]), to: afterOnset(i), sel: s && { from: s.from, to: s.to } };
}

let cueOf: Level | null = null;
function words(): void {
  if (!edit || !take) return;
  const perf = edit.perf, mine = passes();
  const off = edit.base.length - perf.length;
  if (cueOf !== level) { cueEl.textContent = cueLine(level); cueOf = level; }
  nameEl.textContent = `${name}${edit.ops.length !== savedOps ? ' •' : ''}`;
  totalsEl.textContent = [
    stamp(perf.length), `${mine.length} passes`, `${perf.notes.length} notes`,
    ...(edit.ops.length ? [`${edit.ops.length} edit${edit.ops.length === 1 ? '' : 's'}${off > 0 ? `, ${lasting(off)} shorter` : ''}`] : []),
  ].join(' · ');
  const voice = perf.voices === 2 ? `${lane === 0 ? 'A' : 'B'} · ` : '';
  if (level === 'note') { readoutEl.textContent = noteWords(perf, voice); return; }
  const [lo, hi] = selection();
  const a = mine[lo], b = mine[hi];
  if (!a || !b) { readoutEl.textContent = ''; return; }
  if (anchor !== null) {
    readoutEl.textContent = `${voice}passes ${lo + 1}–${hi + 1} · ${hi - lo + 1} passes · ${lasting(b.end - a.at)} · from ${stamp(a.at, true)}`;
    return;
  }
  const notes: number[] = [];
  for (let i = noteFrom(perf.notes, a.at); i < perf.notes.length && perf.notes[i].at < a.end; i++) if (perf.notes[i].voice === lane) notes.push(perf.notes[i].pitch);
  const flag = perf.flags.find(f => sameTime(f.at, a.at));
  const run = sameBloomRun(mine, lo);
  readoutEl.textContent = [
    `${voice}pass ${lo + 1} of ${mine.length}`,
    ...(a.id !== lo ? [`${a.id + 1} as recorded`] : []),
    stamp(a.at, true), lasting(a.end - a.at),
    ...(run[1] > 1 ? [`${run[0]} of ×${run[1]}`] : []),
    `${notes.length} notes  ${notes.slice(0, 14).map(spellOctave).join(' ')}${notes.length > 14 ? ' …' : ''}`,
    ...(flag ? [`⚑ ${flag.name}`] : []),
  ].join(' · ');
}

/** The readout in note mode: the onset under the cursor, or the notes selected */
function noteWords(perf: Perf, voice: string): string {
  const i = noteCursor();
  if (i < 0) return '';
  if (noteAnchor !== null) {
    const s = stretch();
    return s ? `${voice}${s.what} · ${lasting(s.to - s.from)} · from ${stamp(s.from, true)}` : '';
  }
  const at = perf.notes[i].at, here = onsetMembers(perf, lane, i).map(k => perf.notes[k]);
  const { nth, of, pass } = placeInPass(perf, lane, i);
  const next = nextOnset(perf, lane, i);
  return [
    `${voice}note ${nth} of ${of} in pass ${pass + 1}`,
    stamp(at, true),
    here.map(n => spellOctave(n.pitch)).sort().join(' '),
    `vel ${Math.max(...here.map(n => n.vel))}`,
    next >= 0 ? `next in ${((perf.notes[next].at - at) / 1000).toFixed(3)} s` : 'the last',
  ].join(' · ');
}

/** Where a pass stands among its neighbours with the same bloom: which of how many */
function sameBloomRun(mine: Pass[], i: number): [number, number] {
  let lo = i, hi = i;
  while (lo > 0 && mine[lo - 1].bloom === mine[i].bloom) lo--;
  while (hi + 1 < mine.length && mine[hi + 1].bloom === mine[i].bloom) hi++;
  return [i - lo + 1, hi - lo + 1];
}

// ─── Moving ─────────────────────────────────────────────────────────────────

/** The cursor to a pass; `extend` keeps the other end where the selection began */
function moveTo(i: number, extend: boolean): void {
  if (!edit || !passes().length) return;
  if (extend) { if (anchor === null) anchor = cursor; following = false; }
  else anchor = null;
  cursor = clampPass(i);
  const p = passes()[cursor];
  if (player.playing() && following) startPlaying(p.at, edit.perf.length);   // playing: go on from there
  else win = showWin(win, p.at, p.end, edit.perf.length);
  refresh();
}

const bloomChanges = (i: number) => i > 0 && passes()[i].bloom !== passes()[i - 1].bloom;

function startPlaying(from: number, until: number): void {
  if (!edit || !take) return;
  sounding ??= renderTake(take, edit.perf);
  player.start(sounding, from, until, () => { following = false; refresh(); });
  refresh();
}

function ask(label: string, value: string, done: (text: string) => void): void {
  askLabel.textContent = label;
  askInput.value = value;
  askEl.hidden = false;
  askInput.focus();
  askInput.select();
  askInput.onkeydown = e => {
    e.stopPropagation();
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    askEl.hidden = true;
    askInput.blur();
    if (e.key === 'Enter') done(askInput.value.trim());
  };
}

const baseName = () => name || 'take';

/** Passes from `lo` to `hi` (indices) in words */
const passWords = (lo: number, hi: number) => (lo === hi ? `pass ${lo + 1}` : `passes ${lo + 1}–${hi + 1}`);

/**
 * The stretch being worked on, at either level, as a stretch of the clock and
 * in words: the selected passes (or the cursor's), or in note mode the
 * selected onsets (or the cursor's), up to where the onset after them starts
 */
function stretch(): { from: number; to: number; what: string } | null {
  if (!edit) return null;
  const mine = passes();
  if (level === 'note') {
    const [a, b] = noteSelection();
    if (a < 0) return null;
    const p = edit.perf, from = p.notes[a].at, to = afterOnset(b);
    const pa = passAt(mine, from), pb = passAt(mine, p.notes[b].at);
    if (a === b) return { from, to, what: `note ${placeInPass(p, lane, a).nth} of pass ${pa + 1}` };
    return { from, to, what: `${countOnsets(a, b)} notes, ${pa === pb ? `of pass ${pa + 1}` : passWords(pa, pb)}` };
  }
  const [lo, hi] = selection();
  if (!mine[lo]) return null;
  return { from: mine[lo].at, to: mine[hi].end, what: passWords(lo, hi) };
}

/** The onsets of the stretch now, when there are few enough to show at a prompt */
function stretchNow(s: { from: number; to: number }): ReturnType<typeof nowOf> | null {
  if (!edit) return null;
  const os = onsetsIn(edit.perf, s.from, s.to, voiceOf().voice);
  return os.length && os.length <= PREFILL_MAX ? nowOf(edit.perf, os, s.to) : null;
}

/** An op's voice: the lane's, with two */
const voiceOf = (): { voice?: Voice } => (edit?.perf.voices === 2 ? { voice: lane } : {});
const voiceWords = (op: { voice?: Voice }) => (op.voice === undefined ? '' : ` (${op.voice === 0 ? 'A' : 'B'})`);

/** The passes from `from` up to `to` selected (none long: the cursor on the pass at `from`) */
function selectSpan(from: number, to: number): void {
  if (!edit) return;
  cursor = Math.max(0, passAt(passes(), to > from ? to - 1 : from));
  anchor = to > from ? Math.max(0, passAt(passes(), from)) : null;
  if (anchor === cursor) anchor = null;
  win = showWin(win, from, Math.max(to, from + 1), edit.perf.length);
}

/** How much longer or shorter the performance (or a voice) came out */
function longer(before: number, op: { voice?: Voice }): string {
  if (!edit) return '';
  const mine = edit.perf.passes[op.voice ?? 0];
  const now = op.voice === undefined ? edit.perf.length : mine[mine.length - 1]?.end ?? 0;
  const d = now - before;
  return Math.abs(d) < 50 ? '' : `: ${lasting(Math.abs(d))} ${d > 0 ? 'longer' : 'shorter'}`;
}

/** A shape or pattern done over the selection, which stays selected */
function reshape(op: Op & { from: number; voice?: Voice }, words: string): void {
  if (!edit) return;
  player.stop();
  following = false;
  const mine = edit.perf.passes[op.voice ?? 0];
  const before = op.voice === undefined ? edit.perf.length : mine[mine.length - 1]?.end ?? 0;
  const [a, b] = noteSelection(), count = level === 'note' && a >= 0 ? countOnsets(a, b) : 0;
  edit.do(op);
  say(`${words}${voiceWords(op)}${longer(before, op)} · ⌘z undoes it`);
  if (level === 'note') selectCount(op.from, count);
  changed();
  const p = passes()[cursor];
  if (p && level === 'pass') win = showWin(win, p.at, p.end, edit.perf.length);
}

const SHAPES = {
  loud: { label: 'loudness % (60 100 = a crescendo)', start: '100', words: 'loudness' },
  pace: { label: 'pace % (100 150 = faster and faster)', start: '100', words: 'pace' },
  vels: { label: 'velocities, over and over (100 60 80 60)', start: '100 60', words: 'velocities' },
};

/** What an op was, in a word or two */
const OP_WORDS: Record<Op['op'], string> = {
  cut: 'the delete', flag: 'the flag', unflag: 'taking the flag away', loud: 'loudness', pace: 'pace', vels: 'velocities',
  gaps: 'timing', insert: 'the paste', drop: 'the silence', transpose: 'the transpose', pitches: 'the pitches', group: 'Bloom\'s verbs',
};
const opWords = (op: Op) => (op.op === 'group' ? op.label : OP_WORDS[op.op]);

/** The stretch an op was done to, as it was before (none: a flag) */
function spanOf(op: Op): { from: number; to: number; voice?: Voice } | null {
  switch (op.op) {
    case 'flag': case 'unflag': return null;
    case 'insert': return { from: op.at, to: op.to ?? op.at, voice: op.voice };
    case 'group': {
      const spans = op.ops.map(spanOf).filter(s => s !== null);
      if (!spans.length) return null;
      return { from: Math.min(...spans.map(s => s.from)), to: Math.max(...spans.map(s => s.to)), voice: spans[0].voice };
    }
    default: return { from: op.from, to: op.to, voice: op.voice };
  }
}

/** Semitones in words */
const semis = (by: number) => `${by > 0 ? 'up' : 'down'} ${Math.abs(by) % 12 === 0 ? `${Math.abs(by) / 12} octave${Math.abs(by) === 12 ? '' : 's'}` : `${Math.abs(by)} semitone${Math.abs(by) === 1 ? '' : 's'}`}`;

// ─── Bloom's verbs ──────────────────────────────────────────────────────────

/** The passes ⌘k works on: the selection's (or the cursor's); in note mode, the note cursor's */
let verbPasses: [number, number] = [0, 0];

const verbs = new VerbPalette((run, names) => {
  if (!edit) return;
  const mine = passes(), [lo, hi] = verbPasses, chosen = mine.slice(lo, hi + 1);
  const label = `${names} on ${passWords(lo, hi)}`;
  player.stop();
  following = false;
  let done: ReturnType<typeof rework>;
  try { done = rework(edit.perf, blooms(), chosen, run, label, voiceOf().voice); } catch (err) { say(`${names}: ${(err as Error).message}`); return; }
  if (!done) { say(`${passWords(lo, hi)}: no notes to work on`); return; }
  edit.do(done.op);
  say(`${label}${chosen.length > 1 ? ` (${done.kinds} kind${done.kinds === 1 ? '' : 's'})` : ''}${voiceWords(voiceOf())} · ⌘z undoes it`);
  if (level === 'note') selectNotes(mine[lo].at, mine[lo].at);
  changed();
});

// ─── What the keys do ───────────────────────────────────────────────────────

const ed: Ed = {
  play(runUp = false) {
    if (!edit) return;
    if (player.playing()) { player.stop(); following = false; refresh(); return; }
    if (player.output() === pianoOutput && !isLoaded()) { say('the piano is still loading'); return; }
    const mine = passes();
    if (!mine.length) return;
    if (level === 'note') {
      const s = stretch();
      if (!s) return;
      if (noteAnchor !== null) { following = false; startPlaying(s.from, s.to); }
      else { following = true; startPlaying(Math.max(0, s.from - (runUp ? 2000 : 0)), edit.perf.length); }
      return;
    }
    if (anchor !== null) {
      const [lo, hi] = selection();
      following = false;
      startPlaying(mine[lo].at, mine[hi].end);
    } else {
      following = true;
      startPlaying(mine[clampPass(cursor - (runUp ? 2 : 0))].at, edit.perf.length);
    }
  },
  step(by, extend) { moveTo(cursor + by, extend); },
  seam(dir, extend) {
    const n = passes().length;
    /** the next pass after `from` where the bloom changes (n: there's none) */
    const next = (from: number) => { let i = from + 1; while (i < n && !bloomChanges(i)) i++; return Math.min(i, n); };
    if (dir === -1) {
      let i = cursor - 1;
      while (i > 0 && !bloomChanges(i)) i--;
      moveTo(i, extend);
    } else if (!extend) moveTo(next(cursor), false);
    else {
      // selecting on: up to the last pass before the change (from there, before the one after)
      const c = next(cursor);
      moveTo(c - 1 > cursor ? c - 1 : next(c) - 1, true);
    }
  },
  flagStep(dir, extend) {
    if (!edit) return;
    const mine = passes(), here = mine[cursor]?.at ?? 0;
    const at = edit.perf.flags.map(f => passAt(mine, f.at));
    if (dir === 1) {
      const next = at.find(i => mine[i].at > here + 0.5 && i > cursor);
      // selecting on: up to the pass before the flag, so a section is a flag to the next
      moveTo(next === undefined ? mine.length - 1 : extend && next - 1 > cursor ? next - 1 : next, extend);
    } else {
      const prev = at.filter(i => i < cursor).pop();
      moveTo(prev ?? 0, extend);
    }
  },
  edge(dir, extend) { moveTo(dir === 1 ? passes().length - 1 : 0, extend); },
  section() {
    if (!edit) return;
    const mine = passes(), at = edit.perf.flags.map(f => passAt(mine, f.at));
    const from = at.filter(i => i <= cursor).pop() ?? 0;
    const next = at.find(i => i > cursor);
    anchor = from;
    following = false;
    cursor = clampPass(next === undefined ? mine.length - 1 : next - 1);
    win = showWin(win, mine[from].at, mine[cursor].end, edit.perf.length);
    refresh();
  },
  clear() {
    if (!helpEl.hidden) { helpEl.hidden = true; return; }
    if (level === 'note') {
      if (noteAnchor !== null) noteAnchor = null;
      else { leaveNotes(); say(''); }
    } else anchor = null;
    refresh();
  },
  zoom(factor) {
    if (!edit) return;
    const here = level === 'note' ? noteAt : passes()[cursor]?.at ?? 0;
    const about = player.playing() ? player.position() : here;
    win = zoomWin(win, factor, about, edit.perf.length);
    refresh();
  },
  whole() {
    if (!edit) return;
    win = { from: 0, span: edit.perf.length };
    refresh();
  },
  lane() {
    if (!edit || edit.perf.voices === 1) return;
    if (level === 'note') leaveNotes();
    const at = passes()[cursor]?.at ?? 0;
    lane = lane === 0 ? 1 : 0;
    anchor = null;
    cursor = Math.max(0, passAt(passes(), at));
    refresh();
  },
  flag() {
    if (!edit) return;
    const p = passes()[cursor];
    if (!p) return;
    const had = edit.perf.flags.find(f => sameTime(f.at, p.at));
    ask('flag', had?.name ?? '', text => {
      if (!edit || !text) return;
      edit.do({ op: 'flag', at: p.at, name: text });
      say(`⚑ ${text} at ${stamp(p.at)}`);
      changed();
    });
  },
  unflag() {
    if (!edit) return;
    const p = passes()[cursor];
    const had = p && edit.perf.flags.find(f => sameTime(f.at, p.at));
    if (!had) { say('no flag on this pass'); return; }
    edit.do({ op: 'unflag', at: had.at });
    say(`flag “${had.name}” taken away`);
    changed();
  },
  cut(everyVoice) {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    player.stop();
    following = false;
    const two = edit.perf.voices === 2;
    edit.do({ op: 'cut', from: s.from, to: s.to, ...(two && !everyVoice ? { voice: lane } : {}) });
    if (level === 'note') selectNotes(s.from, s.from);
    else { anchor = null; cursor = Math.max(0, passAt(passes(), s.from)); }
    say(`deleted ${s.what} (${lasting(s.to - s.from)})${two ? (everyVoice ? ' from both voices' : ` from ${lane === 0 ? 'A' : 'B'}`) : ''} · ⌘z brings it back`);
    changed();
    const p = passes()[cursor];
    if (p && level === 'pass') win = showWin(win, p.at, p.end, edit.perf.length);
  },
  drop() {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    player.stop();
    following = false;
    edit.do({ op: 'drop', from: s.from, to: s.to, ...voiceOf() });
    if (level === 'note') selectNotes(s.from, s.from);
    say(`silenced ${s.what}: its time stays${voiceWords(voiceOf())} · ⌘z brings it back`);
    changed();
  },
  transpose(by) {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    const op: Op = { op: 'transpose', from: s.from, to: s.to, by, ...voiceOf() };
    // pressed again on the same stretch: the same edit goes further
    const join = joined(edit.ops[edit.ops.length - 1], op);
    if (join === undefined) edit.do(op); else edit.amend(join);
    const total = join === undefined ? by : join?.op === 'transpose' ? join.by : 0;
    say(total ? `${s.what} ${semis(total)}${voiceWords(voiceOf())} · ⌘z undoes it` : `${s.what} back where it was`);
    changed();
  },
  typePitches() {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    ask('pitches, over and over (60 64 67, or C4 E4 G4)', stretchNow(s)?.pitches ?? typed.pitches ?? '', text => {
      if (!edit || !text) return;
      const values = pitchesOf(text);
      if (!values) { say(`“${text}” isn't pitches (60 64, or C4 E4; 0 to 127)`); return; }
      typed.pitches = text;
      reshape({ op: 'pitches', from: s.from, to: s.to, values, ...voiceOf() }, `pitches ${text} over ${s.what}`);
    });
  },
  typeTimes() {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    ask('timing in seconds, over and over (0.25 0.25 0.5)', stretchNow(s)?.gaps ?? typed.times ?? '0.25', text => {
      if (!edit || !text) return;
      const values = numbers(text);
      if (!values) { say(`“${text}” isn't numbers (0.25 0.5)`); return; }
      if (values.some(v => v <= 0)) { say('a time is more than 0 s: nothing done'); return; }
      typed.times = text;
      reshape({ op: 'gaps', from: s.from, to: s.to, values: values.map(v => v * 1000), ...voiceOf() }, `timing ${text} s over ${s.what}`);
    });
  },
  verbs() {
    if (!edit || !passes().length) return;
    verbPasses = level === 'note' ? [cursor, cursor] : selection();
    verbs.open();
  },
  undo() {
    if (!edit) return;
    player.stop();
    const op = edit.undo();
    if (!op) { say('nothing to undo'); return; }
    const span = spanOf(op);
    if (op.op === 'flag') say(`flag “${op.name}” undone`);
    else if (op.op === 'unflag') say('flag put back');
    else if (span) {
      // the stretch it was done to, as it was, selected
      if (span.voice !== undefined) lane = span.voice;
      selectStretch(span.from, span.to);
      say(op.op === 'cut' ? `brought back ${lasting(op.to - op.from)}` : `${opWords(op)} undone${op.op === 'insert' && op.to !== undefined ? ': what it replaced is back' : ''}`);
    }
    changed();
  },
  redo() {
    if (!edit) return;
    player.stop();
    const next = edit.undone[edit.undone.length - 1];
    const span = next ? spanOf(next) : null;
    if (span?.voice !== undefined) lane = span.voice;
    // a shape keeps the passes (or onsets) it was done to, so they're found before it's done
    const was = span ? [Math.max(0, passAt(passes(), span.from)), Math.max(0, passAt(passes(), span.to - 1))] : null;
    const a = span && level === 'note' ? onsetFrom(edit.perf, lane, span.from) : -1;
    const b = span && level === 'note' ? onsetBefore(edit.perf, lane, span.to) : -1;
    const count = a >= 0 && b >= 0 ? countOnsets(a, b) : 1;
    const op = edit.redo();
    if (!op) { say('nothing to redo'); return; }
    if (op.op === 'cut' || op.op === 'drop' || op.op === 'group') {
      if (level === 'note') selectNotes(span!.from, span!.from);
      else if (op.op === 'cut') { anchor = null; cursor = Math.max(0, passAt(passes(), op.from)); }
      else if (was) { anchor = was[0] === was[1] ? null : was[0]; cursor = was[1]; }
    } else if (op.op === 'insert') selectStretch(op.at, op.at + op.clip.length);
    else if (span && level === 'note') selectCount(span.from, count);
    else if (was) { anchor = was[0] === was[1] ? null : was[0]; cursor = was[1]; }
    say(`${opWords(op)} done again`);
    changed();
  },
  goTo() {
    if (!edit) return;
    ask('go to (a time, or a pass)', '', text => {
      if (!text) return;
      const ms = text.includes(':') ? parseClock(text) : null;
      const n = /^\d+$/.test(text) ? Number(text) : null;
      if (ms !== null) moveTo(passAt(passes(), ms), false);
      else if (n !== null && n >= 1) moveTo(n - 1, false);
      else say(`“${text}” isn't a time (1:02:10) or a pass (416)`);
    });
  },
  open() { fileInput.click(); },
  save() {
    if (!edit || !take) return;
    download(JSON.stringify(editFile(take, edit.ops)), `${baseName()}.bloomedit`);
    savedOps = edit.ops.length;
    say(`saved ${baseName()}.bloomedit (${edit.ops.length} edits): keep it beside the take`);
    refresh();
  },
  exportTake() {
    if (!edit || !take) return;
    download(JSON.stringify({ ...renderTake(take, edit.perf), saved: true }), `${baseName()} edited.bloomtake`);
    say(`written as a take: ${baseName()} edited.bloomtake`);
  },
  exportScore() {
    if (!edit || !take) return;
    const xml = takeToMusicXML(renderTake(take, edit.perf), { title: baseName() });
    download(xml, `${baseName()} edited.musicxml`, 'application/vnd.recordare.musicxml+xml');
    say(`written as a score: ${xml.split('<measure ').length - 1} bars`);
  },
  help() { helpEl.hidden = !helpEl.hidden; },
  shape(kind) {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    const { label, start, words } = SHAPES[kind];
    const now = kind === 'vels' ? stretchNow(s)?.vels : undefined;
    ask(label, now ?? typed[kind] ?? start, text => {
      if (!edit || !text) return;
      const values = numbers(text);
      if (!values) { say(`“${text}” isn't numbers (60 100)`); return; }
      typed[kind] = text;
      if (kind === 'pace' && values.some(v => v <= 0)) { say('a pace is more than 0%: nothing done'); return; }
      if (kind === 'loud' && values.some(v => v < 0)) { say('loudness is 0% or more: nothing done'); return; }
      if (kind === 'vels' && values.some(v => v < 1 || v > 127)) { say('velocities are 1 to 127: nothing done'); return; }
      const how = kind === 'vels' ? values.join(' ') : `${values.join(' → ')} %`;
      reshape({ op: kind, from: s.from, to: s.to, values, ...voiceOf() }, `${words} ${how} over ${s.what}`);
    });
  },
  copy(andCut) {
    if (!edit) return;
    const s = stretch();
    if (!s) return;
    clip = clipOf(edit.perf, s.from, s.to, lane);
    if (!andCut) { say(`copied ${s.what} (${lasting(s.to - s.from)}): ⌘v puts it in before the cursor`); return; }
    ed.cut(false);
    say(`cut ${s.what} (${lasting(s.to - s.from)}): ⌘v puts it in before the cursor · ⌘z brings it back`);
  },
  paste() {
    if (!edit) return;
    if (!clip) { say('nothing copied: ⌘c copies the selection'); return; }
    const s = stretch();
    if (!s) return;
    player.stop();
    following = false;
    const at = s.from, over = (level === 'note' ? noteAnchor !== null : anchor !== null) ? s : null;
    edit.do({ op: 'insert', at, ...(over ? { to: over.to } : {}), clip, ...voiceOf() });
    const n = clip.passes.length;
    say(`pasted ${n} pass${n === 1 ? '' : 'es'} (${lasting(clip.length)})${over ? ` in place of ${over.what}` : ` before ${s.what}`}${voiceWords(voiceOf())} · ⌘z takes it out`);
    selectStretch(at, at + clip.length);
    changed();
    refresh();
  },
  pasteOne(kind) {
    if (!edit) return;
    if (!clip) { say('nothing copied: ⌘c copies the selection'); return; }
    const s = stretch();
    if (!s) return;
    const pat = clipPattern(clip), values = kind === 'vels' ? pat.vels : pat.gaps;
    if (!values.length) { say('what was copied has no notes'); return; }
    const words = `${kind === 'vels' ? 'velocities' : 'timing'} of what was copied (${values.length} onsets, over and over) on ${s.what}`;
    reshape({ op: kind, from: s.from, to: s.to, values, ...voiceOf() }, words);
  },
  run() {
    if (!edit) return;
    const mine = passes();
    if (!mine[cursor]) return;
    const [at, of] = sameBloomRun(mine, cursor);
    following = false;
    if (of === 1) { anchor = null; say('no pass either side has this bloom'); refresh(); return; }
    anchor = cursor - at + 1;
    cursor = anchor + of - 1;
    win = showWin(win, mine[anchor].at, mine[cursor].end, edit.perf.length);
    say(`${of} passes of the same bloom`);
    refresh();
  },
  notes() {
    if (!edit) return;
    const p = passes()[cursor];
    if (!p) return;
    const i = onsetFrom(edit.perf, lane, p.at);
    if (i < 0 || edit.perf.notes[i].at >= p.end) { say(`pass ${cursor + 1} has no notes`); return; }
    level = 'note';
    anchor = null;
    noteAnchor = null;
    noteAt = edit.perf.notes[i].at;
    // a pass too narrow to see its notes in fills half the strip
    if (((p.end - p.at) / win.span) * view.stripWidth() < 300) win = zoomWin(win, (2 * (p.end - p.at)) / win.span, (p.at + p.end) / 2, edit.perf.length);
    win = showWin(win, p.at, p.end, edit.perf.length);
    say('note mode: ← → by onset, ⌥← → by pass · esc back to passes');
    refresh();
  },
  noteStep(by, extend) {
    if (!edit) return;
    let i = noteCursor();
    for (let k = 0; k < Math.abs(by) && i >= 0; k++) {
      const j = by > 0 ? nextOnset(edit.perf, lane, i) : prevOnset(edit.perf, lane, i);
      if (j < 0) break;
      i = j;
    }
    noteTo(i, extend);
  },
  notePass(dir, extend) {
    if (!edit) return;
    const mine = passes(), here = passAt(mine, noteAt);
    // the first pass that way with notes in it
    for (let k = here + dir; k >= 0 && k < mine.length; k += dir) {
      const i = onsetFrom(edit.perf, lane, mine[k].at);
      if (i >= 0 && edit.perf.notes[i].at < mine[k].end) { noteTo(i, extend); return; }
    }
  },
};

// ─── Keys, the pointer, files ───────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (!askEl.hidden || Overlay.anyOpen()) return;   // the prompt, or Bloom's palette, has the keys
  const key = keyFor(e, level);
  if (!key) return;
  // with nothing open, only the keys that open something (and the help)
  if (!edit && key.group !== 'file' && key.chord[0] !== '?') return;
  e.preventDefault();
  if (key.chord[0] !== '?' && key.chord[0] !== 'Escape') helpEl.hidden = true;
  key.run(ed);
});

document.addEventListener('keydown', e => {
  if (edit || !kept || e.key !== 'Enter' || !askEl.hidden || Overlay.anyOpen()) return;
  openTake(kept, 'last take');
});

canvas.addEventListener('mousedown', e => {
  if (!edit) return;
  const r = canvas.getBoundingClientRect();
  const hit = view.at(e.clientX - r.left, e.clientY - r.top, { perf: edit.perf, blooms: [], win, lane, cursor, anchor, playhead: null });
  if (hit.zone === 'roll' && hit.voice !== lane && edit.perf.voices === 2) { if (level === 'note') leaveNotes(); lane = hit.voice; anchor = null; }
  if (level === 'note') {
    // the onset at or before the point
    const i = onsetBefore(edit.perf, lane, hit.ms + 1);
    noteTo(i >= 0 ? i : onsetFrom(edit.perf, lane, hit.ms), e.shiftKey);
    return;
  }
  moveTo(passAt(passes(), hit.ms), e.shiftKey);
});

canvas.addEventListener('wheel', e => {
  if (!edit) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) win = clampWin({ span: win.span, from: win.from + (e.deltaX / r.width) * win.span }, edit.perf.length);
  else {
    const hit = view.at(e.clientX - r.left, e.clientY - r.top, { perf: edit.perf, blooms: [], win, lane, cursor, anchor, playhead: null });
    win = zoomWin(win, Math.exp(e.deltaY * 0.004), hit.zone === 'roll' ? hit.ms : passes()[cursor]?.at ?? 0, edit.perf.length);
  }
  refresh();
}, { passive: false });

async function openFiles(files: File[]): Promise<void> {
  // a take before an edit of it, if both came together
  const read = [];
  for (const f of files) {
    try { read.push(await readFile(f)); } catch (err) { say((err as Error).message); return; }
  }
  read.sort((a, b) => Number('edit' in a) - Number('edit' in b));
  for (const x of read) {
    if ('take' in x) openTake(x.take, x.name);
    else if (!take || !edit) say(`${x.name} is an edit: open its take first`);
    else if (!editIsOf(x.edit, take)) say(`${x.name} is an edit of another take`);
    else {
      const t = take, called = name;
      openTake(t, called, x.edit.ops, false);
      keepOps(t, x.edit.ops);
      say(`${x.name}: ${x.edit.ops.length} edits`);
    }
  }
}

fileInput.addEventListener('change', () => {
  void openFiles([...(fileInput.files ?? [])]);
  fileInput.value = '';
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  void openFiles([...(e.dataTransfer?.files ?? [])]);
});
emptyEl.addEventListener('click', () => fileInput.click());

window.addEventListener('resize', () => { view.resize(); refresh(); });

// ─── Where it plays ─────────────────────────────────────────────────────────

const OUT_KEY = 'bloom-editor-out';

/** The outputs in the list, the one last chosen selected if it's there (else the piano) */
function listOutputs(): void {
  let wanted = pianoOutput.name;
  try { wanted = localStorage.getItem(OUT_KEY) ?? wanted; } catch { /* no storage: the piano */ }
  const outs = getState().outputs;
  const chosen = outs.find(o => o.name === wanted) ?? pianoOutput;
  outEl.replaceChildren(...outs.map(o => new Option(o.name, o.name, false, o === chosen)));
  if (player.output() !== chosen) { player.setOutput(chosen); following = false; refresh(); }
  // a port may have the tuning helper behind it: the take's tunings go to it
  if (chosen !== pianoOutput && take?.sysex.length) void connectHelper();
}

outEl.addEventListener('change', () => {
  try { localStorage.setItem(OUT_KEY, outEl.value); } catch { /* not remembered */ }
  listOutputs();
  outEl.blur();   // the keys are the editor's again
  say(`plays on ${outEl.value}`);
});

registerVirtualOutput(pianoOutput);
listOutputs();
onOutputChange(listOutputs);
void initMidi().then(listOutputs);

// ─── Start ──────────────────────────────────────────────────────────────────

cueEl.textContent = cueLine();
$('help-body').innerHTML = helpHtml();
loadSynth().catch(() => say('the piano failed to load: nothing will sound'));

void loadSession().then(async s => {
  if (s) { openTake(s.take, s.name, s.ops, false); savedOps = 0; refresh(); return; }
  kept = await loadKept().catch(() => null);
  if (kept && !edit) emptyLast.textContent = `↵  the last take from Bloom (${stamp(kept.length)})`;
});
