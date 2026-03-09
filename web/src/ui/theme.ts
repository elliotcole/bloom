// Visual theme definitions — shared by all visualization modes

export type VizMode =
  | 'radial' | 'piano' | 'orbit' | 'waterfall'
  | 'tonal' | 'helix' | 'particles' | 'oscilloscope' | 'skyline';

export type ThemeId = 'dark' | 'phosphor' | 'ink' | 'uv' | 'minimal';

export interface Theme {
  id: ThemeId;
  /** Canvas background color */
  bg: string;
  /**
   * Returns [h, s, l, a] for a note given its pitch class (0–11),
   * velocity (0–127), and flash level (0–1).
   */
  noteHsla(pc: number, vel: number, flash: number): [number, number, number, number];
  /** Opacity for constellation / connector lines given flash level. */
  lineAlpha(flash: number): number;
  /** [innerColor, outerColor] for the constellation polygon radial gradient. */
  polyFill(avgFlash: number): [string, string];
  /** Glow radius multiplier. 0 = no glow, 1 = normal, 3 = heavy. */
  glowScale: number;
  /** Stroke outlines only — no fills (minimal theme). */
  strokeOnly: boolean;
  /** Show CRT scanline overlay (phosphor theme, applied via CSS on body). */
  scanlines: boolean;
  blendMode: GlobalCompositeOperation;
  /** Color for playhead bead, active rings, highlights. */
  accent: string;
  /** Color for axis / octave label text. */
  text: string;
  /** Color for guide / grid lines. */
  grid: string;
}

// ─── Dark (default) ───────────────────────────────────────────────────────────
const DARK: Theme = {
  id: 'dark',
  bg: '#0a0a0f',
  noteHsla(pc, vel, flash) {
    const h = pc * 30;
    const t = vel / 127;
    return [h, 65 + t * 30 + flash * 25, 38 + t * 28 + flash * 36, t * 0.55 + 0.18 + flash * 0.42];
  },
  lineAlpha: f => 0.06 + f * 0.22,
  polyFill: f => [`rgba(160,190,255,${0.11 + f * 0.09})`, `rgba(140,170,220,${0.03 + f * 0.03})`],
  glowScale: 1,
  strokeOnly: false,
  scanlines: false,
  blendMode: 'source-over',
  accent: 'rgba(100,180,255,0.55)',
  text: 'rgba(255,255,255,0.14)',
  grid: 'rgba(255,255,255,0.04)',
};

// ─── Phosphor (CRT green) ─────────────────────────────────────────────────────
const PHOSPHOR: Theme = {
  id: 'phosphor',
  bg: '#010a00',
  noteHsla(_pc, vel, flash) {
    const h = flash > 0.25 ? 42 : 110; // amber on activation, green at rest
    const t = vel / 127;
    return [h, 90 + flash * 10, 18 + t * 54 + flash * 20, 0.35 + t * 0.60 + flash * 0.05];
  },
  lineAlpha: f => 0.08 + f * 0.35,
  polyFill: f => [`rgba(20,180,20,${0.10 + f * 0.10})`, `rgba(10,80,10,${0.03 + f * 0.04})`],
  glowScale: 1.6,
  strokeOnly: false,
  scanlines: true,
  blendMode: 'source-over',
  accent: '#ffb000',
  text: 'rgba(57,255,20,0.40)',
  grid: 'rgba(57,255,20,0.07)',
};

// ─── Ink (light / paper) ─────────────────────────────────────────────────────
const INK: Theme = {
  id: 'ink',
  bg: '#f5f0e8',
  noteHsla(pc, vel, flash) {
    const h = pc * 30;
    const t = vel / 127;
    return [h, 15 + t * 35, 8 + t * 22 + flash * 5, 0.30 + t * 0.55 + flash * 0.15];
  },
  lineAlpha: f => 0.10 + f * 0.15,
  polyFill: f => [`rgba(20,40,80,${0.07 + f * 0.06})`, `rgba(20,40,80,${0.02 + f * 0.02})`],
  glowScale: 0,
  strokeOnly: false,
  scanlines: false,
  blendMode: 'multiply',
  accent: '#2244aa',
  text: 'rgba(20,20,20,0.28)',
  grid: 'rgba(20,20,20,0.07)',
};

// ─── UV / Blacklight ─────────────────────────────────────────────────────────
const UV: Theme = {
  id: 'uv',
  bg: '#08000f',
  noteHsla(pc, vel, flash) {
    const h = pc * 30;
    const t = vel / 127;
    return [h, 100, 42 + t * 26 + flash * 20, 0.45 + t * 0.50 + flash * 0.05];
  },
  lineAlpha: f => 0.12 + f * 0.45,
  polyFill: f => [`rgba(200,0,255,${0.10 + f * 0.10})`, `rgba(100,0,200,${0.03 + f * 0.04})`],
  glowScale: 3,
  strokeOnly: false,
  scanlines: false,
  blendMode: 'screen',
  accent: '#ff00ff',
  text: 'rgba(255,0,255,0.30)',
  grid: 'rgba(180,0,255,0.06)',
};

// ─── Minimal / Wireframe ─────────────────────────────────────────────────────
const MINIMAL: Theme = {
  id: 'minimal',
  bg: '#0c0c0c',
  noteHsla(_pc, vel, flash) {
    const t = vel / 127;
    return [0, 0, 68 + flash * 22, 0.12 + t * 0.65 + flash * 0.23];
  },
  lineAlpha: f => 0.20 + f * 0.40,
  polyFill: f => [`rgba(255,255,255,${0.05 + f * 0.07})`, `rgba(255,255,255,${0.01 + f * 0.02})`],
  glowScale: 0,
  strokeOnly: true,
  scanlines: false,
  blendMode: 'source-over',
  accent: 'rgba(255,255,255,0.85)',
  text: 'rgba(255,255,255,0.20)',
  grid: 'rgba(255,255,255,0.05)',
};

// ─── Exports ─────────────────────────────────────────────────────────────────
export const THEMES: Record<ThemeId, Theme> = { dark: DARK, phosphor: PHOSPHOR, ink: INK, uv: UV, minimal: MINIMAL };

export function getTheme(id: ThemeId): Theme {
  return THEMES[id] ?? THEMES.dark;
}
