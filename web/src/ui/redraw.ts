// When a canvas needs drawing again. The views used to redraw every frame;
// now a frame is drawn when something changed (the view was told so), while
// something is moving, and otherwise only now and then, as a safety net for a
// change nobody announced (a setting written straight onto the bloom, say).
// A view that isn't on the page at all isn't drawn.

/** An idle view is still redrawn this often */
export const IDLE_REPAINT_MS = 250;

export interface FrameState {
  /** the canvas is on the page, with some size */
  visible: boolean;
  /** something it shows has changed since the last draw */
  dirty: boolean;
  /** something it shows is moving */
  animating: boolean;
  now: number;
  lastDrawAt: number;
}

export function needsFrame(s: FrameState): boolean {
  if (!s.visible) return false;
  return s.dirty || s.animating || s.now - s.lastDrawAt >= IDLE_REPAINT_MS;
}

/** What moves in the main view (and the other voice's, drawn over it) */
export interface ViewMotion {
  /** a bloom is shown */
  hasBloom: boolean;
  mode: string;
  /** the tuning pie is shown in place of the view */
  tuningView: boolean;
  /** a note's flash is still fading */
  flashing: boolean;
  /** a note has sounded and nothing has stopped it: there's a playhead */
  playing: boolean;
  /** ms since that note began, and how long it lasts */
  msSinceNote: number;
  stepMs: number;
  /** drift is on, and how fast its clock is running (0..1: it eases in and out) */
  drift: boolean;
  driftSpeed: number;
  /** the lanes are showing a change's trace */
  tracing: boolean;
  /** two voices: the meeting flare is fading */
  flare: boolean;
}

/** Drift's clock below this is as good as stopped */
export const DRIFT_STILL = 0.001;
/** A note's bead, hand or shuttle is drawn a little past its end, so its last frame is the finished one */
const STEP_MARGIN_MS = 100;
/** Drift speeds up for this long after a note (visualization.ts: `sounding`) */
export const SOUNDING_MS = 1500;

export function viewMoving(m: ViewMotion): boolean {
  if (!m.hasBloom) return false;
  if (m.flashing || m.flare || m.tracing) return true;
  if (m.playing && m.msSinceNote <= m.stepMs + STEP_MARGIN_MS) return true;   // the bead, a ring's hand, the shuttle, a lane's cursor
  if (m.tuningView) return false;   // the pie moves only with the flashes
  if (m.mode === 'orbit') return true;   // it turns all the time, by design
  if (m.mode === 'road' && m.playing) return true;   // the road keeps coming after the last note
  if ((m.mode === 'deep' || m.mode === 'spiral')
    && (m.driftSpeed > DRIFT_STILL || (m.drift && m.msSinceNote < SOUNDING_MS))) return true;   // the camera's drift
  return false;
}
