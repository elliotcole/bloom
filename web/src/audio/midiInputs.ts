// Which MIDI inputs Bloom listens to, and a watch for one that sends Bloom's
// own notes back. Every input is listened to unless muted in ⚙ → midi (the
// mutes remembered by port name); the bus Bloom sends on never is, and the
// helper's ports aren't inputs at all. An input that only echoes Bloom (a DAW
// track passing everything on to TouchDesigner over another IAC bus, say)
// would otherwise be taken for a keyboard and recorded into every take.

const MUTED_KEY = 'bloom.midiIn.muted';

let _muted = new Set<string>();
try {
  const raw = localStorage.getItem(MUTED_KEY);
  if (raw) _muted = new Set(JSON.parse(raw) as string[]);
} catch { /* private window: none muted */ }

export function inputMuted(name: string): boolean {
  return _muted.has(name);
}

export function setInputMuted(name: string, muted: boolean): void {
  if (muted) _muted.add(name); else _muted.delete(name);
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([..._muted])); } catch { /* best effort */ }
}

export type InputRole = 'listening' | 'muted' | 'own';

/** What Bloom does with an input: the bus it sends on is its own playing coming back */
export function inputRole(name: string, outputName: string | null): InputRole {
  if (outputName !== null && name === outputName) return 'own';
  return _muted.has(name) ? 'muted' : 'listening';
}

// ─── Echoes ───────────────────────────────────────────────────────────────────
// A note-on heard at the pitch and velocity of one Bloom sent just before is an
// echo. One could be chance (a keyboard played along); most of the last 16 is
// a loop back.

const ECHO_WINDOW_MS = [-20, 150];   // heard this long after the note was due
const KEEP_MS = 1000;
const OF_LAST = 16;
const ECHOES = 12;

export class EchoWatch {
  private sent: { key: number; at: number }[] = [];
  private seen = new Map<string, boolean[]>();
  private flagged = new Set<string>();

  /** Bloom sent a note-on, due at `at` */
  out(note: number, vel: number, at: number): void {
    this.sent.push({ key: note * 128 + vel, at });
    if (this.sent.length > 512 || this.sent[0].at < at - KEEP_MS) this.sent = this.sent.filter(s => s.at >= at - KEEP_MS);
  }

  /** A note-on came in on `input` at `at`: true the moment that input is found to be echoing */
  heard(input: string, note: number, vel: number, at: number): boolean {
    const key = note * 128 + vel;
    const echo = this.sent.some(s => s.key === key && at - s.at >= ECHO_WINDOW_MS[0] && at - s.at <= ECHO_WINDOW_MS[1]);
    const last = this.seen.get(input) ?? [];
    last.push(echo);
    if (last.length > OF_LAST) last.shift();
    this.seen.set(input, last);
    if (this.flagged.has(input) || last.length < OF_LAST || last.filter(Boolean).length < ECHOES) return false;
    this.flagged.add(input);
    return true;
  }

  echoing(input: string): boolean {
    return this.flagged.has(input);
  }

  /** Muted or unmuted: watch it afresh */
  forget(input: string): void {
    this.flagged.delete(input);
    this.seen.delete(input);
  }
}
