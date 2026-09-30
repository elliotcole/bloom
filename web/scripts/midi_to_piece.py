#!/usr/bin/env python3
"""Convert a MIDI recording of a Bloom session into a piece file for the player.

    python3 scripts/midi_to_piece.py flow.mid public/pieces/flow.json --title "Flow"

The piece file holds the recorded notes (timing and velocities untouched) plus an
annotation: which bloom each note belongs to, and its position in that bloom.

Parsing model: a bloom always enters at its own position 1 and may be interrupted
at any point. So a bloom's start is where its repeating pattern first appears.
Passages that never repeat (blooms heard for less than two cycles) are kept as
short-lived fragment blooms, chunked at the length of the loop before them.
"""

import argparse
import json
import struct

MAX_LOOP = 40          # longest bloom considered
MIN_RUN = 8            # a loop must last at least this many notes (and two cycles)
PEDAL_RING_S = 15.0    # cap on how long a pedalled note is left ringing


# ─── MIDI reading ─────────────────────────────────────────────────────────────

def _vlq(b, i):
    v = 0
    while True:
        c = b[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if c < 0x80:
            return v, i


def read_midi(path):
    """Return (notes, pedal, title). Times are in seconds.

    notes: [start, duration, pitch, velocity], sorted by start
    pedal: [time, down] changes of the sustain pedal
    """
    d = open(path, 'rb').read()
    if d[:4] != b'MThd':
        raise SystemExit(f'{path}: not a MIDI file')
    hlen, _fmt, ntracks, div = struct.unpack('>IHHH', d[4:14])
    if div & 0x8000:
        raise SystemExit('SMPTE time division is not supported')

    raw, pedal, tempos, title = [], [], [(0, 500000)], ''
    pos = 8 + hlen
    for _ in range(ntracks):
        length = struct.unpack('>I', d[pos + 4:pos + 8])[0]
        b = d[pos + 8:pos + 8 + length]
        pos += 8 + length
        i = tick = status = 0
        held = {}
        while i < len(b):
            dt, i = _vlq(b, i)
            tick += dt
            s = b[i]
            if s == 0xFF:
                kind = b[i + 1]
                n, i = _vlq(b, i + 2)
                data = b[i:i + n]; i += n
                if kind == 0x51:
                    tempos.append((tick, int.from_bytes(data, 'big')))
                elif kind == 0x03 and not title:
                    title = data.decode('latin1')
                continue
            if s in (0xF0, 0xF7):
                n, i = _vlq(b, i + 1); i += n
                continue
            if s & 0x80:
                status = s; i += 1
            kind = status & 0xF0
            n = 1 if kind in (0xC0, 0xD0) else 2
            a = b[i:i + n]; i += n
            key = (status & 0x0F, a[0])
            if kind == 0x90 and a[1] > 0:
                held.setdefault(key, []).append((tick, a[1]))
            elif kind in (0x80, 0x90):
                if held.get(key):
                    t0, vel = held[key].pop(0)
                    raw.append((t0, tick, a[0], vel))
            elif kind == 0xB0 and a[0] == 64:
                pedal.append((tick, a[1] >= 64))

    tempos.sort()

    def seconds(tick):
        t, last_tick, uspq = 0.0, 0, 500000
        for tt, u in tempos:
            if tt >= tick:
                break
            t += (tt - last_tick) / div * uspq / 1e6
            last_tick, uspq = tt, u
        return t + (tick - last_tick) / div * uspq / 1e6

    raw.sort()
    notes = [[seconds(a), seconds(b) - seconds(a), p, v] for a, b, p, v in raw]
    return notes, [(seconds(t), down) for t, down in pedal], title


def apply_pedal(notes, pedal):
    """Lengthen notes released while the pedal is down."""
    for n in notes:
        off = n[0] + n[1]
        down, up_at = False, None
        for t, d in pedal:
            if t <= off:
                down, up_at = d, None
            elif down and not d:
                up_at = t
                break
        if down:
            ring_until = up_at if up_at is not None else float('inf')
            n[1] = max(n[1], min(ring_until - n[0], PEDAL_RING_S))


# ─── Segmentation ─────────────────────────────────────────────────────────────

def periodic_runs(seq):
    """Maximal stretches (period, start, end) where seq repeats every `period` notes."""
    out = []
    for p in range(1, MAX_LOOP + 1):
        k = 0
        while k + p < len(seq):
            if seq[k] != seq[k + p]:
                k += 1
                continue
            s = k
            while k + p < len(seq) and seq[k] == seq[k + p]:
                k += 1
            if k + p - s >= max(2 * p, MIN_RUN):
                out.append((p, s, k + p))
    # a run at a multiple of another run's period says nothing new
    return [r for r in out
            if not any(q < r[0] and r[0] % q == 0 and s <= r[1] and e >= r[2]
                       for q, s, e in out)]


def find_loops(seq):
    """Stable loops in order, as (period, start, end)."""
    runs = periodic_runs(seq)
    loops, pos = [], 0
    while True:
        here = [(e - max(s, pos), -p, p, s, e) for p, s, e in runs
                if s <= pos < e and e - max(s, pos) >= p + 1]
        if not here:
            later = [s for _, s, _ in runs if s > pos]
            if not later:
                break
            pos = min(later)
            continue
        _, _, p, s, e = max(here)
        loops.append((p, s, e))
        pos = e

    # drop false starts: a short run that is only the opening of the next bloom,
    # interrupted and restarted
    kept = []
    for i, (p, s, e) in enumerate(loops):
        if i + 1 < len(loops):
            p2, s2, _ = loops[i + 1]
            if p2 > p and s < s2 < e and (s2 - s) % p == 0 and seq[s2:s2 + p] == seq[s:s + p]:
                continue
        kept.append((p, s, e))
    return kept


def annotate(notes):
    """Assign every note a bloom state and a position within it.

    Returns (states, tags): states are blooms as {notes, velocities, timeIntervals,
    loop}; tags[i] = (state index, position) for note i.
    """
    seq = [n[2] for n in notes]
    total = len(seq)
    beats = [(notes[i + 1][0] - notes[i][0]) * 2 for i in range(total - 1)] + [1.0]

    loops = find_loops(seq)
    # spans: (start, end, period, loop number or None for a fragment)
    spans, cursor = [], 0
    for k, (p, s, e) in enumerate(loops):
        s = max(s, cursor) if s < cursor and spans and spans[-1][3] is None else s
        end = min(e, loops[k + 1][1]) if k + 1 < len(loops) else e
        if spans and spans[-1][1] > s:          # the new bloom interrupts the old
            a, _, q, n = spans[-1]
            spans[-1] = (a, s, q, n)
        if s > cursor:
            chunk = spans[-1][2] if spans else p
            for a in range(cursor, s, chunk):
                spans.append((a, min(a + chunk, s), min(chunk, s - a), None))
        spans.append((s, end, p, k))
        cursor = end
    if cursor < total:
        chunk = spans[-1][2] if spans else total
        for a in range(cursor, total, chunk):
            spans.append((a, min(a + chunk, total), min(chunk, total - a), None))

    states, tags = [], [None] * total
    for start, end, period, loop in spans:
        if end <= start:
            continue
        pitches = [seq[start + i] if start + i < total else seq[start + i - period]
                   for i in range(period)]
        vels = times = None
        for c0 in range(start, end, period):
            heard = min(period, end - c0)
            # an interrupted cycle keeps the previous cycle's values where unheard
            vels = [notes[c0 + i][3] if i < heard else (vels[i] if vels else notes[c0][3])
                    for i in range(period)]
            times = [round(beats[c0 + i], 3) if i < heard else (times[i] if times else 0.76)
                     for i in range(period)]
            state = {'notes': pitches, 'velocities': vels, 'timeIntervals': times, 'loop': loop}
            if not states or states[-1] != state:
                states.append(state)
            for i in range(heard):
                tags[c0 + i] = (len(states) - 1, i)
    return states, tags, len(loops)


# ─── Output ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('midi')
    ap.add_argument('out')
    ap.add_argument('--title', help='defaults to the MIDI track name')
    args = ap.parse_args()

    notes, pedal, track_name = read_midi(args.midi)
    states, tags, nloops = annotate(notes)
    apply_pedal(notes, pedal)

    piece = {
        'version': 1,
        'title': args.title or track_name,
        'duration': round(max(n[0] + min(n[1], 4.0) for n in notes), 3),
        # loop: number of the stable loop this state belongs to, null for a fragment
        'blooms': states,
        # [start s, duration s, pitch, velocity, bloom index, position in bloom]
        'events': [[round(n[0], 4), round(n[1], 4), n[2], n[3], t[0], t[1]]
                   for n, t in zip(notes, tags)],
    }
    with open(args.out, 'w') as f:
        json.dump(piece, f, separators=(',', ':'))

    in_loops = sum(1 for t in tags if states[t[0]]['loop'] is not None)
    print(f"{args.out}: {len(notes)} notes, {piece['duration'] / 60:.1f} min, "
          f"{nloops} loops, {len(states)} bloom states, "
          f"{in_loops / len(notes):.0%} of notes in stable loops")


if __name__ == '__main__':
    main()
