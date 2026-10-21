// Restore prompt — on arrival with an autosave, ask whether to pick it up or start fresh

import type { AutosaveInfo } from '../io/garden-io';

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Resolves true to restore, false to start new. Enter / r restores; n / esc starts new. */
export function askRestore(info: AutosaveInfo): Promise<boolean> {
  const el = document.getElementById('restore-prompt') as HTMLElement | null;
  if (!el) return Promise.resolve(true);

  const parts = [`${info.notes} note${info.notes === 1 ? '' : 's'}`];
  if (info.blooms > 0) parts.push(`${info.blooms} in the garden`);
  if (info.savedAt) parts.push(ago(info.savedAt));
  (el.querySelector('.rp-detail') as HTMLElement).textContent = parts.join(' · ');
  el.classList.add('open');

  return new Promise(resolve => {
    const done = (restore: boolean) => {
      el.classList.remove('open');
      window.removeEventListener('keydown', onKey, true);
      resolve(restore);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'enter' || k === 'r') { e.preventDefault(); e.stopImmediatePropagation(); done(true); }
      else if (k === 'escape' || k === 'n') { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
    };
    window.addEventListener('keydown', onKey, true);
    (el.querySelector('#rp-restore') as HTMLElement).onclick = () => done(true);
    (el.querySelector('#rp-new') as HTMLElement).onclick = () => done(false);
  });
}
