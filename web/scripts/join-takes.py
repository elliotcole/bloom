#!/usr/bin/env python3
"""
Join .bloomtake files into one, tight (each take's 10 s ring-out dropped:
what was sounding at its stop is let go there, and the next take starts
on that instant), and cut out the blooms deleted from the garden while
recording: from when such a bloom became the one sounding (a lift) to when
another took over, the time is removed and the rest closes up. Notes begun
in a cut go with it; tuning, garden and view changes in it land at the cut.

  python3 scripts/join-takes.py out.bloomtake a.bloomtake b.bloomtake ...
  (--keep-deleted: join only)
"""
import json, sys
from collections import Counter, defaultdict

HOLD_MS = 10_000
STATE = {'p', 'h', 'g', 'b', 'v'}   # events that set what's shown or tuned: kept, moved to the cut


def due(e):
    return e[0] + (e[3] if e[1] == 'm' else 0)


def deleted_blooms(d):
    """Blooms whose garden slot was deleted (the garden one shorter, the cursor's bloom gone)"""
    out, prev = [], None
    for e in d['events']:
        if e[1] != 'g':
            continue
        g = d['gardens'][e[2]]
        if prev is not None:
            a, b = prev['slots'], g['slots']
            if len(b) == len(a) - 1 or (len(a) == 1 and a[0] >= 0 and b[0] == -1):
                gone = Counter(x for x in a if x >= 0) - Counter(x for x in b if x >= 0)
                out += [(e[0], x) for x in gone]
        prev = g
    return out


def spans_of(d, ixs):
    """When each of these blooms was the session's own in view: [start, end) ms"""
    spans, cur, start = [], None, 0.0
    for e in d['events']:
        if e[1] == 'b' and e[4] == 1 and e[2] != cur:
            if cur in ixs:
                spans.append((start, e[0], cur))
            cur, start = e[2], e[0]
    if cur in ixs:
        spans.append((start, d['length'], cur))
    merged = []
    for s, t, x in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(t, merged[-1][1]), merged[-1][2])
        else:
            merged.append((s, t, x))
    return merged


def cut(d, spans):
    """The take with these spans removed, closed up"""
    def new_time(t):
        shift = 0.0
        for s, e, _ in spans:
            if t >= e:
                shift += e - s
            elif t >= s:
                return s - shift, True
        return t - shift, False

    dropped = defaultdict(int)   # (ch, note) → note-ons dropped, whose offs go too
    events = []
    for e in sorted(d['events'], key=due):
        t, inside = new_time(due(e))
        k = e[1]
        if k == 'm':
            msg = e[2]
            st, key = msg[0] & 0xf0, ((msg[0] & 0x0f), msg[1] if len(msg) > 1 else -1)
            on = st == 0x90 and msg[2] > 0
            off = st == 0x80 or (st == 0x90 and msg[2] == 0)
            if on and inside:
                dropped[key] += 1
                continue
            if off and dropped[key]:
                dropped[key] -= 1
                continue
            events.append([round(t - e[3], 1), 'm', msg, e[3]])
        elif inside and k not in STATE:
            continue   # lights and garden animations of what was cut
        else:
            events.append([round(t, 1), *e[1:]])
    length = d['length'] - sum(e - s for s, e, _ in spans)
    return {**d, 'events': events, 'length': round(length, 1)}


def tighten(d):
    """Its ring-out dropped: what held past the stop is let go at the stop. Returns it and the stop."""
    stop = d['length'] - HOLD_MS
    events = [[min(e[0], stop - (e[3] if e[1] == 'm' else 0)), *e[1:]] if due(e) > stop else e for e in d['events']]
    events += [[stop, 'm', [0xb0 | ch, 123, 0], 0] for ch in range(16)]   # all notes off: nothing carries over
    return {**d, 'events': events, 'length': stop}, stop


def join(takes):
    out = {'kind': 'bloom-take', 'version': 1, 'recordedAt': takes[0]['recordedAt'], 'length': 0, 'ended': True,
           'saved': True, 'blooms': [], 'gardens': [], 'sysex': [], 'tables': [], 'events': []}
    at = 0.0
    for n, d in enumerate(takes):
        last = n == len(takes) - 1
        if not last:
            d, stop = tighten(d)
        ob, og, os_, ot = (len(out[k]) for k in ('blooms', 'gardens', 'sysex', 'tables'))
        out['blooms'] += d['blooms']
        out['gardens'] += [{'cursor': g['cursor'], 'slots': [s + ob if s >= 0 else -1 for s in g['slots']]} for g in d['gardens']]
        out['sysex'] += d['sysex']
        out['tables'] += d['tables']
        for e in d['events']:
            e = list(e)
            e[0] = round(e[0] + at, 1)
            k = e[1]
            if k == 'b': e[2] += ob
            elif k in ('a', 'v') and e[-1] >= 0: e[-1] += ob
            elif k == 'g': e[2] += og
            elif k == 'h': e[2] += os_
            elif k == 'p' and e[2] >= 0: e[2] += ot
            out['events'].append(e)
        at += stop if not last else d['length']
    out['length'] = round(at, 1)
    out['events'].sort(key=lambda e: e[0])   # stable: same-time order kept
    return out


def clock(ms):
    return f'{int(ms // 60000)}:{ms / 1000 % 60:04.1f}'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    keep = '--keep-deleted' in sys.argv
    out_path, paths = args[0], args[1:]
    takes = []
    for p in paths:
        d = json.load(open(p))
        if not keep:
            dels = deleted_blooms(d)
            spans = spans_of(d, {x for _, x in dels})
            for t, x in dels:
                print(f'{p.split("/")[-1]}: bloom deleted at {clock(t)}')
            for s, e, x in spans:
                print(f'  cut {clock(s)}–{clock(e)} ({(e - s) / 1000:.1f} s) where it sounded')
            d = cut(d, spans)
        takes.append(d)
    j = join(takes)
    json.dump(j, open(out_path, 'w'), separators=(',', ':'))
    print(f'{out_path}: {clock(j["length"])}, {len(j["events"])} events')


if __name__ == '__main__':
    main()
