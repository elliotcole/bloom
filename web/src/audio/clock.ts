// Timers that keep time behind another window. Chrome throttles a hidden
// page's timers, and after five minutes hidden a chain of them wakes only once
// a minute: a loop or a take's replay would send a minute of notes at once,
// then nothing. A worker's timers aren't held back that way, so the beat
// comes from one, and the page does the work on each message. Without
// workers (tests, an old browser) the page's own timers stand in.

type Stop = () => void;

let _worker: Worker | null | undefined;
const _fns = new Map<number, () => void>();
let _next = 1;

const SRC = `const t = new Map();
onmessage = (e) => {
  const [kind, id, ms] = e.data;
  if (kind === 'every') t.set(id, setInterval(() => postMessage(id), ms));
  else if (kind === 'after') t.set(id, setTimeout(() => { t.delete(id); postMessage(id); }, ms));
  else { clearInterval(t.get(id)); clearTimeout(t.get(id)); t.delete(id); }
};`;

function worker(): Worker | null {
  if (_worker !== undefined) return _worker;
  try {
    _worker = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })));
    _worker.onmessage = (e: MessageEvent<number>) => _fns.get(e.data)?.();
  } catch {
    _worker = null;
  }
  return _worker;
}

function start(kind: 'every' | 'after', ms: number, fn: () => void): Stop {
  const w = typeof Worker !== 'undefined' ? worker() : null;
  if (!w) {
    const id = kind === 'every' ? setInterval(fn, ms) : setTimeout(fn, ms);
    return () => { clearInterval(id); clearTimeout(id); };
  }
  const id = _next++;
  _fns.set(id, kind === 'every' ? fn : () => { _fns.delete(id); fn(); });
  w.postMessage([kind, id, ms]);
  return () => { if (_fns.delete(id)) w.postMessage(['stop', id, 0]); };
}

/** Call `fn` every `ms`, on time behind another window too; returns its stop */
export const every = (ms: number, fn: () => void): Stop => start('every', ms, fn);
/** Call `fn` once in `ms`, likewise; returns its cancel */
export const after = (ms: number, fn: () => void): Stop => start('after', ms, fn);
