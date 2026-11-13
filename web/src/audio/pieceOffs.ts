// The piece player's releases. A note is handed to the piano a lookahead
// before it sounds, its release kept until a later tick. When the player
// pauses or jumps, every release still kept has to go out: dropped, the note
// would ring the length of its sample.

/** A note handed to the piano and not yet released: when it starts and when it ends (ms, performance.now's clock) */
export interface PendingOff { onMs: number; atMs: number; pitch: number }

/**
 * The player stops at `nowMs`: when each note is let go. One that sounds, now;
 * one handed over ahead, as it starts (the piano can't take a note back);
 * never later than it would have ended anyway.
 */
export function offsAtPause(pending: PendingOff[], nowMs: number): { pitch: number; atMs: number }[] {
  return pending.map(p => ({ pitch: p.pitch, atMs: Math.min(p.atMs, Math.max(nowMs, p.onMs + 1)) }));
}
