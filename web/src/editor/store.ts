// What the editor keeps in the browser (the take it has open and what's been
// done to it, so a reload loses nothing), and its files.

import type { TakeFile } from '../audio/take';
import type { EditFile, Op } from './perf';

const DB = 'bloom-editor', STORE = 'session';

let _db: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return _db ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(err => { _db = null; throw err; });
}

function put(key: string, value: unknown): void {
  db().then(d => { d.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); }).catch(() => { /* best effort */ });
}

function get<T>(key: string): Promise<T | null> {
  return db().then(d => new Promise<T | null>(res => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res((r.result as T | undefined) ?? null);
    r.onerror = () => res(null);
  })).catch(() => null);
}

export interface Session { take: TakeFile; name: string; ops: Op[] }

/** A take opened: kept, with nothing done to it yet */
export function keepTake(take: TakeFile, name: string): void {
  put('take', { take, name });
  put('ops', { of: take.recordedAt, ops: [] });
}

export function keepOps(take: TakeFile, ops: Op[]): void {
  put('ops', { of: take.recordedAt, ops });
}

export async function loadSession(): Promise<Session | null> {
  const t = await get<{ take: TakeFile; name: string }>('take');
  if (!t) return null;
  const o = await get<{ of: number; ops: Op[] }>('ops');
  return { take: t.take, name: t.name, ops: o && o.of === t.take.recordedAt ? o.ops : [] };
}

// ─── Files ──────────────────────────────────────────────────────────────────

export function download(text: string, name: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export type Opened = { take: TakeFile; name: string } | { edit: EditFile; name: string };

/** A file read as a take or an edit; throws with why not */
export async function readFile(file: File): Promise<Opened> {
  const name = file.name.replace(/\.(bloomtake|bloomedit|json)$/i, '');
  let x: { kind?: string; version?: number; events?: unknown; ops?: unknown };
  try { x = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} isn't a take or an edit`); }
  if (x.kind === 'bloom-take' && x.version === 1 && Array.isArray(x.events)) return { take: x as TakeFile, name };
  if (x.kind === 'bloom-edit' && x.version === 1 && Array.isArray(x.ops)) return { edit: x as EditFile, name };
  throw new Error(`${file.name} isn't a take or an edit`);
}
