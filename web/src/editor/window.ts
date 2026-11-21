// The stretch of the clock the passes strip shows, and the marks along it.

export interface Win { from: number; span: number }   // ms

/** The least the strip shows: two seconds */
export const MIN_SPAN = 2000;

/** A window kept inside the performance (all of it, if it's shorter than the window) */
export function clampWin(w: Win, length: number): Win {
  const span = Math.max(Math.min(MIN_SPAN, length), Math.min(w.span, Math.max(length, 1)));
  return { span, from: Math.max(0, Math.min(w.from, length - span)) };
}

/** Wider (factor over 1) or closer, the moment `about` staying where it is on the screen */
export function zoomWin(w: Win, factor: number, about: number, length: number): Win {
  const span = Math.max(Math.min(MIN_SPAN, length), Math.min(w.span * factor, Math.max(length, 1)));
  const k = w.span > 0 ? (about - w.from) / w.span : 0.5;
  return clampWin({ span, from: about - Math.max(0, Math.min(1, k)) * span }, length);
}

/**
 * The window moved so `from`…`to` is in view: untouched if it already is,
 * else turned like a page so the stretch sits a fifth of the way in (or is
 * centred, if it's wider than that leaves room for)
 */
export function showWin(w: Win, from: number, to: number, length: number): Win {
  const edge = w.span * 0.04;
  if (from >= w.from + Math.min(edge, from) && Math.min(to, from + w.span * 0.6) <= w.from + w.span - edge) return w;
  const wide = to - from;
  const lead = wide > w.span * 0.6 ? 0.05 : 0.2;
  return clampWin({ span: w.span, from: from - w.span * lead }, length);
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600].map(s => s * 1000);

/** The spacing of the clock's marks (ms): the smallest round one at least `minPx` apart */
export function rulerStep(span: number, width: number, minPx = 90): number {
  return STEPS.find(s => (s / span) * width >= minPx) ?? STEPS[STEPS.length - 1];
}

/** h:mm:ss, m:ss; with tenths when asked */
export function stamp(ms: number, tenths = false): string {
  const t = Math.max(0, tenths ? Math.round(ms / 100) / 10 : Math.floor(ms / 1000));
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0') + (tenths ? `.${Math.round((t - s) * 10)}` : '');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A length of time in words: 0.8 s, 21.4 s, 3:05, 1:02:10 */
export function lasting(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : stamp(ms);
}
