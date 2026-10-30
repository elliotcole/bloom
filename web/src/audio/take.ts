// Takes — a performance recorded as it went out and as it looked, to be played
// again the same way, as often as wanted.
//
// Armed, a take starts on the first note that sounds (Bloom's, or a keyboard's
// played along). From then it keeps every MIDI message to the output with how
// far ahead it was sent, every message from a keyboard, what went to the tuning
// helper and the piano, and what the picture showed: the bloom, the garden,
// each note as it lit. Stopped, nothing more goes out; what's sounding holds
// ten seconds and is let go. Played, the same stream goes out again, a few ms
// behind its time so every message can be stamped exactly, and the picture
// follows it. Nothing is worked out again, so every playing is the same.

import type { Bloom } from '../core/Bloom';
import type { Garden } from '../garden';
import { bloomToJSON, bloomFromJSON } from '../io/garden-io';
import type { BloomJSON } from '../io/garden-io';
import { setMidiTap, onMidiMessage } from './midi';
import type { MidiOutput } from './midi';
import { setTuningTap, tuningNow, setReplaying, replayHelper, replayPiano } from './tuningOut';

const HOLD_MS = 10_000;        // what's sounding at the stop rings this long
const DELAY_MS = 40;           // a replay sends each message this far ahead of its time
const AHEAD_MS = 10;           // how far ahead of its time a message is handed to the output
const AHEAD_HIDDEN_MS = 1500;  // in a covered or background tab, whose timers run once a second
const SAVE_EVERY_MS = 60_000;  // a take being recorded is kept this often, in case the page goes

/** Times are ms from the start of the take, when the message was sent (or arrived) */
export type TakeEvent =
  | [number, 'm', number[], number]      // MIDI out: the message, and how many ms ahead of its time it went
  | [number, 'h', number]                // to the tuning helper: the message (index in sysex)
  | [number, 'p', number]                // the piano's tuning: index in tables, -1 for 12-TET
  | [number, 'b', number, 0 | 1, 0 | 1]  // the view shows a bloom (index in blooms), traced, the session's own
  | [number, 'g', number]                // the garden strip (index in gardens)
  | [number, 'n', number, number]        // a note lights: index, tick
  | [number, 'x']                        // the lights go out
  | [number, 'a', GardenAnim, number];   // the garden animates (save / restore: the bloom's index)

export type GardenAnim = 'left' | 'right' | 'save' | 'restore';

export interface TakeFile {
  kind: 'bloom-take';
  version: 1;
  recordedAt: number;
  length: number;     // ms, the hold included
  ended: boolean;     // false: kept part way through (the page went while recording)
  saved?: boolean;    // written to a file
  blooms: BloomJSON[];
  gardens: { cursor: number; slots: number[] }[];   // bloom indices, -1 for an empty slot
  sysex: number[][];
  tables: number[][];
  events: TakeEvent[];
}

/** What a take needs from the page */
export interface TakeHost {
  /** What the view shows now, the session's bloom and garden (a take starts from them) */
  shown(): { bloom: Bloom; trace: boolean };
  session(): { bloom: Bloom; garden: Garden };
  /** Stop every loop and play */
  silence(): void;
  out(): MidiOutput | null;
  /** Playing back: the view shows a bloom (main: as the session's own), the garden, a note, the dark */
  show(b: Bloom, trace: boolean, main: boolean): void;
  garden(slots: (Bloom | null)[], cursor: number): void;
  light(index: number, tick: number): void;
  dark(): void;
  animate(kind: GardenAnim, b: Bloom | null): void;
  /** Recording began or ended, playing began or ended */
  changed(): void;
}

export type TakePhase = 'idle' | 'armed' | 'recording' | 'ending' | 'playing';

let _host: TakeHost | null = null;
let _phase: TakePhase = 'idle';
let _take: TakeFile | null = null;   // the last take, recorded or loaded

export function initTakes(host: TakeHost): void {
  _host = host;
  setMidiTap(midiTap);
  setTuningTap(tuningTap);
  onMidiMessage(keyboardIn);
  void loadKept().then(t => { if (t && !_take) { _take = t; host.changed(); } });
}

export function takePhase(): TakePhase { return _phase; }
export function lastTake(): TakeFile | null { return _take; }
/** ms into the take being recorded or played */
export function takeElapsed(): number {
  if (_rec) return performance.now() - _rec.t0;
  if (_play) return Math.max(0, performance.now() - _play.T0 - DELAY_MS);
  return 0;
}

// ─── Recording ────────────────────────────────────────────────────────────────

class Recorder {
  readonly file: TakeFile;
  t0 = 0;
  private bloomIx = new Map<string, number>();
  private gardenIx = new Map<string, number>();
  private sysexIx = new Map<string, number>();
  private tableIx = new Map<string, number>();
  private savedAt = -Infinity;
  private kept = { events: 0, blooms: 0, gardens: 0, sysex: 0, tables: 0, parts: 0 };

  constructor() {
    this.file = {
      kind: 'bloom-take', version: 1, recordedAt: Date.now(), length: 0, ended: false,
      blooms: [], gardens: [], sysex: [], tables: [], events: [],
    };
  }

  at(ms: number): number { return Math.round((ms - this.t0) * 10) / 10; }

  add(e: TakeEvent): void {
    this.file.events.push(e);
    const now = performance.now();
    if (now - this.savedAt > SAVE_EVERY_MS) { this.savedAt = now; this.keepPart(); }
  }

  /** Keep what's new since last time, so a long take never copies itself whole */
  private keepPart(): void {
    const f = this.file, k = this.kept;
    const part: TakePart = {
      events: f.events.slice(k.events), blooms: f.blooms.slice(k.blooms), gardens: f.gardens.slice(k.gardens),
      sysex: f.sysex.slice(k.sysex), tables: f.tables.slice(k.tables),
    };
    this.kept = { events: f.events.length, blooms: f.blooms.length, gardens: f.gardens.length, sysex: f.sysex.length, tables: f.tables.length, parts: k.parts + 1 };
    keepPart(k.parts, part, { recordedAt: f.recordedAt, parts: k.parts + 1 });
  }

  bloom(b: Bloom): number { return intern(this.bloomIx, this.file.blooms, bloomToJSON(b)); }
  garden(g: Garden): number {
    return intern(this.gardenIx, this.file.gardens, { cursor: g.cursor, slots: g.slots.map(s => (s ? this.bloom(s) : -1)) });
  }
  sysexOf(msg: number[]): number { return intern(this.sysexIx, this.file.sysex, msg); }
  tableOf(freqs: number[]): number { return intern(this.tableIx, this.file.tables, freqs); }
}

function intern<T>(ix: Map<string, number>, list: T[], value: T): number {
  const key = JSON.stringify(value);
  let i = ix.get(key);
  if (i === undefined) { i = list.length; list.push(value); ix.set(key, i); }
  return i;
}

let _rec: Recorder | null = null;

/** Arm a take: it starts on the first note that sounds */
export function armTake(): void {
  if (_phase !== 'idle') return;
  _phase = 'armed';
  _host?.changed();
}

/** Disarm, or end the take: nothing more goes out, what's sounding holds and is let go */
export function stopTake(): void {
  if (_phase === 'armed') { _phase = 'idle'; _host?.changed(); return; }
  if (_phase !== 'recording' || !_rec) return;
  const rec = _rec;
  const end = performance.now() - rec.t0;
  _phase = 'ending';   // the tap lets nothing through now
  _host?.silence();
  const file = finish(sorted(rec.file), end);
  _host?.changed();
  setTimeout(() => {
    // let go of what held, as the take does, and of anything sent ahead of the stop
    const out = _host?.out();
    if (out) {
      for (const e of file.events) if (e[1] === 'm' && e[0] >= end) out.send(e[2]);
      for (let ch = 0; ch < 16; ch++) out.send([0xb0 | ch, 123, 0]);
    }
    _rec = null;
    _take = file;
    _phase = 'idle';
    keep(file);
    _host?.changed();
  }, HOLD_MS);
}

function begin(atMs: number): void {
  if (!_host) return;
  const rec = new Recorder();
  rec.t0 = atMs;
  _rec = rec;
  _phase = 'recording';
  // where it starts: the tuning, the garden, the bloom in view
  const { piano, helper } = tuningNow();
  rec.add([0, 'p', piano ? rec.tableOf(piano) : -1]);
  helper.forEach(m => rec.add([0, 'h', rec.sysexOf(m)]));
  const { bloom, garden } = _host.session();
  rec.add([0, 'g', rec.garden(garden)]);
  const shown = _host.shown();
  rec.add([0, 'b', rec.bloom(shown.bloom), shown.trace ? 1 : 0, shown.bloom === bloom ? 1 : 0]);
  _host.changed();
}

const isNoteOn = (d: ArrayLike<number>) => (d[0] & 0xf0) === 0x90 && d[2] > 0;

function midiTap(data: number[], atMs: number | undefined): boolean {
  if (_phase === 'ending') return false;
  const now = performance.now();
  if (_phase === 'armed' && isNoteOn(data)) begin(Math.min(now, atMs ?? now));
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(now), 'm', [...data], Math.max(0, Math.round(((atMs ?? now) - now) * 10) / 10)]);
  return true;
}

/** A keyboard played along: its notes, pedal and the rest go into the take */
function keyboardIn(data: Uint8Array, atMs: number): void {
  const status = data[0] & 0xf0;
  if (status < 0x80 || status > 0xe0) return;   // clock, sysex and the like aren't played
  if (_phase === 'armed' && isNoteOn(data)) begin(Math.min(atMs, performance.now()));
  if (_phase === 'recording' && _rec) _rec.add([Math.max(0, _rec.at(atMs)), 'm', [...data], 0]);
}

function tuningTap(kind: 'helper' | 'piano', data: number[] | null): void {
  if (_phase !== 'recording' || !_rec) return;
  const t = _rec.at(performance.now());
  if (kind === 'helper') _rec.add([t, 'h', _rec.sysexOf(data!)]);
  else _rec.add([t, 'p', data ? _rec.tableOf(data) : -1]);
}

// what the picture does: the page calls these from the view as it changes
export function takeShown(b: Bloom, trace: boolean, main: boolean): void {
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(performance.now()), 'b', _rec.bloom(b), trace ? 1 : 0, main ? 1 : 0]);
}
export function takeGarden(g: Garden): void {
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(performance.now()), 'g', _rec.garden(g)]);
}
export function takeLit(index: number, tick: number): void {
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(performance.now()), 'n', index, tick]);
}
export function takeDark(): void {
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(performance.now()), 'x']);
}
export function takeAnimate(kind: GardenAnim, b: Bloom | null): void {
  if (_phase === 'recording' && _rec) _rec.add([_rec.at(performance.now()), 'a', kind, b ? _rec.bloom(b) : -1]);
}

/** A copy with the events in time order (a keyboard's arrive stamped a little earlier) */
function sorted(f: TakeFile): TakeFile {
  return { ...f, events: f.events.map((e, i) => [e, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(x => x[0]) };
}

function lastTime(f: TakeFile): number {
  return f.events.reduce((m, e) => Math.max(m, e[0] + (e[1] === 'm' ? e[3] : 0)), 0);
}

/**
 * End a take at `end` ms: what would have sounded after it goes, what's
 * sounding then holds HOLD_MS and is released (the pedal lifted too)
 */
export function finish(f: TakeFile, end: number): TakeFile {
  const due = (e: TakeEvent) => e[0] + (e[1] === 'm' ? e[3] : 0);
  const events = f.events.filter(e => due(e) <= end);
  const on = new Map<number, number>();   // ch * 128 + note → on
  const pedal = new Set<number>();
  [...events].filter(e => e[1] === 'm').sort((a, b) => due(a) - due(b)).forEach(e => {
    const d = (e as [number, 'm', number[], number])[2];
    const st = d[0] & 0xf0, ch = d[0] & 0x0f;
    if (st === 0x90 && d[2] > 0) on.set(ch * 128 + d[1], 1);
    else if (st === 0x80 || st === 0x90) on.delete(ch * 128 + d[1]);
    else if (st === 0xb0 && d[1] === 123) [...on.keys()].filter(k => k >> 7 === ch).forEach(k => on.delete(k));
    else if (st === 0xb0 && d[1] === 64) { if (d[2] >= 64) pedal.add(ch); else pedal.delete(ch); }
  });
  const t = Math.round((end + HOLD_MS) * 10) / 10;
  for (const k of on.keys()) events.push([t, 'm', [0x80 | (k >> 7), k & 127, 0], 0]);
  for (const ch of pedal) events.push([t, 'm', [0xb0 | ch, 64, 0], 0]);
  return { ...f, events, length: t, ended: true };
}

// ─── Playing a take ───────────────────────────────────────────────────────────

let _play: { T0: number; timer: ReturnType<typeof setInterval>; gen: number } | null = null;
let _gen = 0;

/** Play the last take from the start; false if there's none */
export function playTake(): boolean {
  const take = _take;
  if (!take || !_host || _phase !== 'idle') return false;
  const host = _host;
  host.silence();
  _phase = 'playing';
  setReplaying(true);
  const gen = ++_gen;
  const T0 = performance.now();
  const blooms = new Map<number, Bloom>();
  const bloomAt = (i: number) => {
    let b = blooms.get(i);
    if (!b) { b = bloomFromJSON(take.blooms[i]); blooms.set(i, b); }
    return b;
  };
  const later = (atMs: number, fn: () => void) => setTimeout(() => { if (_gen === gen) fn(); }, Math.max(0, atMs - performance.now()));
  const ev = take.events;
  let i = 0;
  const tick = () => {
    const now = performance.now() - T0;
    const out = host.out();
    const ahead = document.hidden ? AHEAD_HIDDEN_MS : AHEAD_MS;
    while (i < ev.length && ev[i][0] <= now + ahead) {
      const e = ev[i++];
      const at = T0 + DELAY_MS + e[0];
      switch (e[1]) {
        case 'm': out?.send(e[2], at + e[3]); break;
        case 'h': replayHelper(take.sysex[e[2]], at); break;
        case 'p': replayPiano(e[2] < 0 ? null : take.tables[e[2]]); break;   // before the notes after it, as it went
        case 'b': { const [, , ix, trace, main] = e; later(at, () => host.show(bloomAt(ix), trace === 1, main === 1)); break; }
        case 'g': { const g = take.gardens[e[2]]; later(at, () => host.garden(g.slots.map(s => (s < 0 ? null : bloomAt(s))), g.cursor)); break; }
        case 'n': { const [, , ix, t] = e; later(at, () => host.light(ix, t)); break; }
        case 'x': later(at, () => host.dark()); break;
        case 'a': { const [, , kind, ix] = e; later(at, () => host.animate(kind, ix < 0 ? null : bloomAt(ix))); break; }
      }
    }
    if (i >= ev.length && now > take.length + DELAY_MS + 50) stopPlaying();
  };
  _play = { T0, timer: setInterval(tick, 5), gen };
  tick();
  host.changed();
  return true;
}

export function stopPlaying(): void {
  if (!_play) return;
  clearInterval(_play.timer);
  _play = null;
  _gen++;
  const out = _host?.out();
  if (out) for (let ch = 0; ch < 16; ch++) { out.send([0xb0 | ch, 64, 0]); out.send([0xb0 | ch, 123, 0]); }
  _phase = 'idle';
  setReplaying(false);
  _host?.changed();
}

// ─── Files ────────────────────────────────────────────────────────────────────

export function saveTakeFile(): boolean {
  if (!_take) return false;
  _take.saved = true;
  keep(_take);
  const blob = new Blob([JSON.stringify(_take)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date(_take.recordedAt).toISOString().slice(0, 16).replace(/T/, '-').replace(/:/g, '');
  a.download = `take-${ts}.bloomtake`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function loadTakeFile(done: (err?: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bloomtake,.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) { done(); return; }
    file.text().then(text => {
      const t = JSON.parse(text) as TakeFile;
      if (t.kind !== 'bloom-take' || t.version !== 1 || !Array.isArray(t.events)) throw new Error('not a take');
      if (_phase === 'playing') stopPlaying();
      _take = { ...(t.ended ? t : finish(t, lastTime(t))), saved: true };
      keep(_take);
      _host?.changed();
      done();
    }).catch(err => done(`load failed: ${(err as Error).message}`));
  };
  input.click();
}

// ─── Kept in the browser (IndexedDB): the last take survives a reload ───────

const DB = 'bloom-takes', STORE = 'takes', KEY = 'last';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function keep(f: TakeFile): void {
  db().then(d => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(f, KEY);
    tx.objectStore(STORE).delete(IDBKeyRange.bound('rec', 'rec\uffff'));   // a take being recorded, now whole
  }).catch(() => { /* best effort */ });
}

/** A take being recorded is kept in parts: what came since the last */
type TakePart = Pick<TakeFile, 'events' | 'blooms' | 'gardens' | 'sysex' | 'tables'>;

function keepPart(n: number, part: TakePart, head: { recordedAt: number; parts: number }): void {
  db().then(d => {
    const tx = d.transaction(STORE, 'readwrite');
    if (n === 0) tx.objectStore(STORE).delete(IDBKeyRange.bound('rec', 'rec\uffff'));
    tx.objectStore(STORE).put(part, `rec-part-${n}`);
    tx.objectStore(STORE).put(head, 'rec-head');
  }).catch(() => { /* best effort */ });
}

function get<T>(d: IDBDatabase, key: string): Promise<T | null> {
  return new Promise(res => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res((r.result as T | undefined) ?? null);
    r.onerror = () => res(null);
  });
}

/** The last take; or one the page went in the middle of, if that's newer */
async function loadKept(): Promise<TakeFile | null> {
  try {
    const d = await db();
    const last = await get<TakeFile>(d, KEY);
    const head = await get<{ recordedAt: number; parts: number }>(d, 'rec-head');
    if (!head || (last && last.recordedAt >= head.recordedAt)) return last;
    const f: TakeFile = {
      kind: 'bloom-take', version: 1, recordedAt: head.recordedAt, length: 0, ended: false,
      blooms: [], gardens: [], sysex: [], tables: [], events: [],
    };
    for (let i = 0; i < head.parts; i++) {
      const p = await get<TakePart>(d, `rec-part-${i}`);
      if (!p) break;
      f.events.push(...p.events); f.blooms.push(...p.blooms); f.gardens.push(...p.gardens);
      f.sysex.push(...p.sysex); f.tables.push(...p.tables);
    }
    if (!f.events.length) return last;
    const t = finish(sorted(f), lastTime(f));
    keep(t);
    return t;
  } catch {
    return null;
  }
}

/** h:mm:ss (or m:ss) */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
