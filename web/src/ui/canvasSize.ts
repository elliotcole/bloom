// A canvas's backing store: whole device pixels, and told when the device
// pixel ratio changes (the window moved to another display, the page zoomed).

/** The backing size for a canvas of `cssW` × `cssH` CSS pixels: whole device pixels, at least one */
export function backingSize(cssW: number, cssH: number, dpr: number): [number, number] {
  return [Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr))];
}

/** Call `changed` whenever the device pixel ratio changes */
export function onDprChange(changed: () => void): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const watch = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => { changed(); watch(); }, { once: true });   // the query names one ratio: ask again for the new one
  };
  watch();
}
