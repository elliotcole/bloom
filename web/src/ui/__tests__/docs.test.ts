// The docs against the key tables (homeKeys.ts, modeKeys.ts): the cheat sheet
// names every home key, the cue line only names keys that do something where
// it shows them, and unused-keys.md lists exactly the keys that are free.
// (The GUIDE and the ? overlay are checked in homeKeys.test.ts.)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_KEYS, PUNCT, findHome, keyNames, pressName, viewKeyNames } from '../homeKeys';
import {
  FREEZE_KEYS, SELECT_KEYS, LIST_MODE_KEYS, LIST_MODES, LIST_VERBS, MODE_KEYS, PASS_KEYS, TUNING_KEYS, modeKeyNames,
} from '../modeKeys';
import type { ListMode } from '../modeKeys';
import { TAKE_CUE, cueFor } from '../cues';
import type { CueContext } from '../cues';

const here = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

/** Every home key by name, a range written out: opt-1 … 9 is opt-1, opt-2 … */
const HOME_NAMES = new Set(HOME_KEYS.flatMap(keyNames).flatMap(n =>
  n === 'opt-1 … 9' ? Array.from({ length: 9 }, (_, i) => `opt-${i + 1}`) : [n]));
/** A code-named key that doesn't say which way shift is answers to both: esc and shift-esc, opt-p and opt-P */
const SHIFTED = new Set(HOME_KEYS.filter(k => k.code !== undefined && k.shift === undefined).flatMap(keyNames).flatMap(n => {
  const letter = n.match(/^opt-([a-z])$/);
  return letter ? [`opt-${letter[1].toUpperCase()}`, `opt-shift-${letter[1]}`] : [`shift-${n}`];
}));
const atHome = (n: string) => HOME_NAMES.has(n) || SHIFTED.has(n);
/** Bound in keys.ts and main.ts ahead of the tables */
const CMD_KEYS = ['cmd-z', 'cmd-c', 'cmd-v', 'cmd-shift-v', 'cmd-k', 'cmd-s', 'cmd-o'];
/** The keys that pass home from every mode, by name */
const PASS_NAMES = [...PASS_KEYS.map(k => (k === ' ' ? 'space' : k)), '↑', '↓', '←', '→', '↵', 'del', 'tab', 'shift-space', 'shift-↑', 'shift-↓'];

// ─── The cheat sheet ─────────────────────────────────────────────────────────

describe('the cheat sheet', () => {
  const sheet = here('../../../public/cheatsheet.html');
  const body = sheet.slice(sheet.indexOf('<body'));
  // keys set side by side with nothing between are one press: <kbd>opt</kbd><kbd>tab</kbd>
  const presses = new Set<string>();
  for (const run of body.matchAll(/(?:<kbd>[^<]*<\/kbd>)+/g)) {
    const keys = [...run[0].matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => unescape(m[1]));
    const named = keys.map(k => (k === '⇧' ? 'shift' : k === '⌫' ? 'del' : k));
    presses.add(named.join('-'));
    // a few are written as one cap: opt-k, ⇧↵; and several keys in one cap: "9 0"
    for (const k of named) for (const part of k.replace(/^⇧/, 'shift-').split(' ')) presses.add(part);
  }

  it('names every home key', () => {
    const missing = [...HOME_NAMES].filter(n => {
      if (presses.has(n)) return false;
      if (n === '+') return false;   // = by another name
      if (/^opt-\d$/.test(n)) return !presses.has('opt-0–9');
      return true;
    });
    expect(missing).toEqual([]);
  });

  it('names every list mode, and the keys of tuning mode and the freeze menu', () => {
    const want = ['r', ...Object.keys(MODE_KEYS), ...TUNING_KEYS.flatMap(modeKeyNames), ...FREEZE_KEYS.flatMap(modeKeyNames)];
    expect(want.filter(n => !presses.has(n))).toEqual([]);
  });
});

// ─── The cue line ────────────────────────────────────────────────────────────

/** Words that open a cue but aren't keys */
const key = (t: string) => /^(opt-|shift-|cmd-)?(\S|esc|space|tab|del)$/.test(t);

/** The keys a cue names: each part's leading keys ("9 0 rotate · q snap" → 9 0 q) */
function cueKeys(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\s+·\s+/)) {
    const words = part.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/[:,]$/, '');
      if (w === '…') { i++; continue; }           // opt-0 … 9: a range, its end isn't a key of its own
      if (w === '/' && i > 0 && i < words.length - 1 && !key(words[i + 1])) break;   // "merge / divide"
      if (!key(w) || (w === 'a' && i > 0)) break;   // "3 4 a comma": the article
      out.push(w);
    }
  }
  return out;
}

const ctx = (over: Partial<CueContext>): CueContext => ({
  mode: null, tuning: false, freezeMenu: false, selection: 0, pins: 0, ragaMoves: false, intervals: false,
  figures: false, held: false, pulsing: false, looping: false, slot: false, ...over,
});

describe('the cue line', () => {
  it('reads the keys off a cue', () => {
    expect(cueKeys('9 0 rotate · q snap to the scale · ( ) pivot · { merge · esc home')).toEqual(['9', '0', 'q', '(', ')', '{', 'esc']);
    expect(cueKeys('l pick a tuning · 3 4 a comma · click a slice · opt-k 1/1 there')).toEqual(['l', '3', '4', 'opt-k']);
    expect(cueKeys('a z add / drop · { } merge / divide')).toEqual(['a', 'z', '{', '}']);
  });

  it.each(LIST_MODES)('%s mode: every key named does something there', (m: ListMode) => {
    const there = new Set([
      ...LIST_MODE_KEYS.filter(k => !k.modes || k.modes.includes(m)).flatMap(modeKeyNames),
      ...Object.keys(LIST_VERBS), ...Object.keys(MODE_KEYS), ...PASS_NAMES,
    ]);
    expect(cueKeys(cueFor(ctx({ mode: m })).text).filter(k => !there.has(k))).toEqual([]);
  });

  it('tuning mode', () => {
    const there = new Set([...TUNING_KEYS.flatMap(modeKeyNames), ...PASS_NAMES]);
    expect(cueKeys(cueFor(ctx({ tuning: true })).text).filter(k => !there.has(k))).toEqual([]);
  });

  it('select mode', () => {
    const there = new Set([...SELECT_KEYS.flatMap(modeKeyNames), ...PASS_NAMES]);
    expect(cueKeys(cueFor(ctx({ select: true })).text).filter(k => !there.has(k))).toEqual([]);
    expect(cueFor(ctx({ select: true })).text).toContain('esc home');
  });

  it('the freeze menu', () => {
    const there = new Set([...FREEZE_KEYS.flatMap(modeKeyNames), ...PASS_NAMES]);
    expect(cueKeys(cueFor(ctx({ freezeMenu: true })).text).filter(k => !there.has(k))).toEqual([]);
  });

  // at home a cue may lead into a mode ("b ↵ figures", "F l its length"), so a key of any table will do
  const anywhere = new Set([
    ...HOME_NAMES, ...SHIFTED, ...CMD_KEYS, 'F', 'r', ...SELECT_KEYS.flatMap(modeKeyNames), ...Object.keys(MODE_KEYS), ...Object.keys(LIST_VERBS),
    ...LIST_MODE_KEYS.flatMap(modeKeyNames), ...TUNING_KEYS.flatMap(modeKeyNames), ...FREEZE_KEYS.flatMap(modeKeyNames),
  ]);

  it('at home, whatever is going on', () => {
    const situations: Partial<CueContext>[] = [
      {}, { selection: 2 }, { pins: 1 }, { ragaMoves: true, intervals: true }, { figures: true }, { intervals: true },
      { held: true }, { pulsing: true }, { looping: true }, { slot: true }, { voice: 'B' },
    ];
    for (const s of situations) {
      const text = cueFor(ctx(s), 0).text;
      expect(cueKeys(text).filter(k => !anywhere.has(k)), text).toEqual([]);
    }
  });

  it('every tip', () => {
    const EVERY = 30_000;
    const seen = new Set<string>();
    for (let turn = 1; turn < 400; turn += 2) {
      const { text, tip } = cueFor(ctx({}), turn * EVERY);
      expect(tip).toBe(true);
      if (seen.has(text)) continue;
      seen.add(text);
      expect(cueKeys(text).filter(k => !anywhere.has(k)), text).toEqual([]);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('a take playing back: the view keys, the skips and the stop', () => {
    const free = new Set([...viewKeyNames().flatMap(n => (n === 'opt-1 … 9' ? [] : [n])), '←', '→', '.']);
    expect(cueKeys(TAKE_CUE.replace('playing the take · ', '')).filter(k => !free.has(k))).toEqual([]);
  });
});

// ─── unused-keys.md ──────────────────────────────────────────────────────────

/** Every press of a US keyboard's typing keys, bare, with shift and with opt */
function typingPresses(): { name: string; e: KeyboardEvent; kind: 'bare' | 'shift' | 'opt' }[] {
  const keys: [string, string, string][] = [   // code, plain, shifted
    ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c): [string, string, string] => [`Key${c.toUpperCase()}`, c, c.toUpperCase()]),
    ...'0123456789'.split('').map((d, i): [string, string, string] => [`Digit${d}`, d, ')!@#$%^&*('[i]]),
    ...Object.entries(PUNCT).map(([code, [plain, shifted]]): [string, string, string] => [code, plain, shifted]),
  ];
  const press = (code: string, k: string, altKey: boolean, shiftKey: boolean) =>
    ({ code, key: k, altKey, shiftKey, getModifierState: () => false }) as unknown as KeyboardEvent;
  return keys.flatMap(([code, plain, shifted]) => [
    { kind: 'bare' as const, e: press(code, plain, false, false) },
    { kind: 'shift' as const, e: press(code, shifted, false, true) },
    { kind: 'opt' as const, e: press(code, plain, true, false) },
  ]).map(p => ({ ...p, name: pressName(p.e) }));
}

describe('unused-keys.md', () => {
  const doc = here('../../../unused-keys.md');
  const [free, taken] = doc.slice(doc.indexOf('---')).split('## Taken option keys');   // past the preamble
  // the asides in *( … )* talk about keys that aren't free
  const ticked = (s: string) => [...s.replace(/\*\([^]*?\)\*/g, '').matchAll(/``\s(.+?)\s``|`([^`]+)`/g)].map(m => m[1] ?? m[2]);
  const listed = new Set(ticked(free).filter(k => !k.includes('/')));   // not the file paths
  const presses = typingPresses();
  const unbound = (name: string) => {
    if (name === 'opt-|') return !findHome({ code: 'Backslash', key: '|', altKey: true, shiftKey: true, getModifierState: () => false } as unknown as KeyboardEvent);
    const p = presses.find(x => x.name === name);
    expect(p, `${name}: not a key this test knows`).toBeDefined();
    // F opens the freeze menu, r select mode and the list-mode keys their modes, ahead of the home table
    return !findHome(p!.e) && name !== 'F' && name !== 'r' && !(name in MODE_KEYS);
  };

  it('every key it calls free is free at home', () => {
    expect([...listed].filter(k => !unbound(k))).toEqual([]);
  });

  it('lists every free key', () => {
    expect(presses.filter(p => unbound(p.name) && !listed.has(p.name)).map(p => p.name)).toEqual([]);
  });

  it('every option key it calls taken is taken', () => {
    const names = ticked(taken).filter(k => k.startsWith('opt-'));
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter(n => !atHome(n))).toEqual([]);
  });
});

describe('esc on the cue line', () => {
  it.each(LIST_MODES)('%s mode says esc goes home', (m: ListMode) => {
    expect(cueFor(ctx({ mode: m })).text).toContain('esc home');
  });
  it('the help first, wherever you are', () => {
    expect(cueFor(ctx({ help: true, mode: 'time', selection: 3 })).text).toBe('esc or ? closes the help');
  });
  it('tuning mode: the slices first, then home', () => {
    expect(cueFor(ctx({ tuning: true })).text).toContain('esc home');
    expect(cueFor(ctx({ tuning: true, slices: 2 })).text).toContain('esc lets go of the slices (again: home)');
  });
  it('the selection first, then the pins', () => {
    const text = cueFor(ctx({ selection: 2, pins: 1 })).text;
    expect(text).toContain('esc clears');
    expect(text).toContain('esc again unpins');
  });
  it('the freeze menu', () => {
    expect(cueFor(ctx({ freezeMenu: true })).text).toContain('F or esc closes');
  });
});
