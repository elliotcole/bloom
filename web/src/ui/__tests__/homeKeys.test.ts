// The home-key table against itself and against the docs: no two keys claim
// the same press, and every key is in the GUIDE and the ? overlay.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_KEYS, keyNames, matches } from '../homeKeys';
import type { HomeKey } from '../homeKeys';

const here = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

/** Every press a key answers to, as a fake event */
function presses(k: HomeKey): KeyboardEvent[] {
  const codes = k.code === undefined ? [undefined] : Array.isArray(k.code) ? k.code : [k.code];
  const keys = k.key === undefined ? [undefined] : Array.isArray(k.key) ? k.key : [k.key];
  const shifts = k.shift === undefined ? [false, true] : [k.shift];
  const out: KeyboardEvent[] = [];
  for (const code of codes) for (const key of keys) for (const shiftKey of shifts) {
    out.push({ code: code ?? `Key${(key ?? 'x').toUpperCase()}`, key: key ?? code, altKey: !!k.alt, shiftKey, getModifierState: () => false } as unknown as KeyboardEvent);
  }
  return out;
}

describe('home keys', () => {
  it('every key has a label and a press', () => {
    for (const k of HOME_KEYS) {
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.key !== undefined || k.code !== undefined).toBe(true);
    }
  });

  it('no two keys answer the same press', () => {
    for (const k of HOME_KEYS) {
      for (const e of presses(k)) {
        const hits = HOME_KEYS.filter(o => matches(o, e, e.key));
        expect(hits.map(h => h.label), `${keyNames(k).join(' ')} (${e.code}, shift ${e.shiftKey})`).toEqual([k.label]);
      }
    }
  });

  it('the GUIDE names every key', () => {
    const guide = here('../../../GUIDE.md');
    const missing = HOME_KEYS.flatMap(keyNames).filter(name => {
      // opt-↓ is written opt-`↓`, shift-space shift-`space`, opt-1 … 9 opt-`1`…`9`, a bare key in backticks (or double backticks)
      const m = name.match(/^(opt-|shift-|opt \+ )?(.+)$/)!;
      const keyPart = m[2].replace(/^(\d) … (\d)$/, '`$1`…`$2`');
      const forms = [`${m[1] ?? ''}\`${m[2]}\``, `${m[1] ?? ''}${keyPart}`, `\`\` ${m[2]} \`\``];
      return !forms.some(f => guide.includes(f));
    });
    expect(missing).toEqual([]);
  });

  it('the ? overlay names every key', () => {
    const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const bodies = [...here('../../../index.html').matchAll(/<b>([^<]*)<\/b>/g)].map(m => unescape(m[1]).toLowerCase());
    const missing = HOME_KEYS.flatMap(keyNames).filter(name => {
      const n = name.toLowerCase();
      const bare = n.replace(/^(opt-|shift-)/, '');
      return !bodies.some(b => b === n || b.split(/[\s/]+/).includes(bare) || b.includes(n.replace('-', ' ')));
    });
    expect(missing).toEqual([]);
  });
});
