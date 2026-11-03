# Patterns: a guide for learning

Braid and pyramid look like two different tricks. They are one machine. This guide teaches that machine from the ground up, a step at a time, with exercises. Every example below was run through the real code (`src/lib/patterns.ts`), so the answers are what Bloom will play.

> **Where this stands (2 Nov 2026).** `d` opens the palette: the presets, a box to type your own, and a live preview of the indices and the length. `↵` bakes, `D` bakes the last one again, opt-`d` works on the pitches alone, and in a list mode `d` writes out that list. Everything below can be tried there.

---

## 1. The one idea: a window that moves

Picture your notes in a row, numbered from 1:

```
1 2 3 4 5
```

A pattern lays a **window** over some of them and plays what's inside. Then it **moves the window** and plays again. It keeps going until the window would fall off the end.

You write two things: the **first window**, then **how it moves**.

```
123 +1
```

- `123` is the first window: notes 1, 2, 3.
- `+1` moves it up one each round.

```
123 +1   →   123 234 345
```

On the next round the window would be `456`, and there is no 6, so it stops there. That's braid.

**Try:** what does `12 +1` give on five notes?
<details><summary>answer</summary>

`12 23 34 45`: eight notes.
</details>

---

## 2. A window has two edges

`+1` moves the whole window. But a window has a **left edge** and a **right edge**, and you can move them separately. Write them as `left,right`:

```
1 0,+1   →   1 12 123 1234 12345
```

The left edge stays put (`0`) and the right edge grows (`+1`). That's pyramid. So braid and pyramid differ only in their edges:

| | left edge | right edge | written |
|---|---|---|---|
| braid | +1 | +1 | `123 +1` (one number moves both) |
| pyramid | 0 | +1 | `1 0,+1` |

Everything else comes from choosing these two numbers.

| movement | what it does | example on 5 notes |
|---|---|---|
| `+1` | slides | `123 +1` → `123 234 345` |
| `+2` | slides in bigger jumps | `123 +2` (on 7) → `123 345 567` |
| `-1` | slides down | `345 -1` → `345 234 123` |
| `0,+1` | grows to the right | `1 0,+1` → `1 12 123 1234 12345` |
| `0,-1` | shrinks from the right | `12345 0,-1` → `12345 1234 123 12 1` |
| `+1,0` | shrinks from the left | `12345 +1,0` → `12345 2345 345 45 5` |
| `-1,0` | grows to the left | `5 -1,0` → `5 45 345 2345 12345` |
| `+1,-1` | closes in from both ends | `12345 +1,-1` → `12345 234 3` |
| `+1,+2` | slides **and** grows | `1 +1,+2` (on 8) → `1 23 345 4567` |

**Try:** predict `5 0,-1`. (Hint: a window can't shrink below one note.)
<details><summary>answer</summary>

Just `5`. The next window would end before it starts, so the pattern stops after one round.
</details>

**Try:** predict `345 -1`, then `123 -1`.
<details><summary>answer</summary>

`345 234 123`, and then just `123`. Its next window would start at 0, which is off the left end.
</details>

---

## 3. No movement: a reordering

Leave the movement off (or write `0`) and the window plays **once**:

```
53124   →   53124
321     →   321
```

This is a plain reordering of your notes, which is useful on its own. It becomes much more useful in slice 3, where the order list steers the playhead.

---

## 4. The window's shape travels with it

The first window doesn't have to be a run. Whatever shape you give it, the pattern carries that shape along:

```
13 +1     →   13 24 35                (thirds)
1213 +1   →   1213 2324 3435          (a sequence, like a melodic figure)
321 +1    →   321 432 543             (falling figures)
11 +1     →   11 22 33 44 55          (stutter: each note twice)
```

That's the difference between a window and a range: `13` is a *shape*, with a gap in it, and the gap travels.

### The one rule to remember

**A shape can only travel at a fixed width.** If the window grows or shrinks, the pattern has to invent the new notes, so it reads a plain run, keeping the first window's spacing and direction:

```
13 0,+2    (on 7)   →   13 135 1357      spacing 2, so the run grows in 2s
135 0,+2   (on 7)   →   135 1357
```

A shape that isn't evenly spaced, like `1213`, can't grow. The pattern tells you so:

```
1213 0,+1   →   "a motif needs a window that keeps its width (one number, like +1)"
```

So: **shapes slide, runs grow.** If you hit that message, either change the movement to a single number, or make the first window an even run.

---

## 5. Flags: what happens to each window

After the movement you can add flags. They change how each window is read, or how the whole run is assembled.

| flag | name | example | gives |
|---|---|---|---|
| `r` | reverse | `123 +1 r` | `321 432 543` |
| `a` | alternate | `123 +1 a` | `123 432 345` (every other window backward) |
| `\|` | there and back | `123 +1 \|` | `123 234 345 234 123` |
| `~` | wrap | `123 +1 ~` | `123 234 345 451 512` |
| `x2` | repeat | `123 +1 x2` | `123 123 234 234 345 345` |

Flags combine. Write them together or apart; `a|` and `a |` are the same:

```
123 +1 a|      →   123 432 345 432 123
12 +1 x3  (on 4) → 12 12 12 23 23 23 34 34 34
1 0,+1 |       →   1 12 123 1234 12345 1234 123 12 1      (climb and return)
```

Some notes on the flags:

- **`|` doesn't repeat the top.** It turns round on the last window and comes back, so `345` plays once.
- **`~` wraps round the end** instead of stopping, and keeps going until the window has gone once round. It does nothing to a window that only grows, because growing never runs off the left.
- **`r` and `a` together:** `a` flips the odd windows, and `r` flips everything, so the even windows are the ones that end up backward.

**Try:** predict `1 +1 |`.
<details><summary>answer</summary>

`1 2 3 4 5 4 3 2 1`. That's mirror.
</details>

---

## 6. Wildcards: `*` and `**`

- **`*`** is a random note **from inside the window**.
- **`**`** is a random note **from anywhere** in the list.

```
12* +1   →   12* 23* 34*
```

In the first window, `*` picks from notes 1, 2 and 3: the window includes the `*`'s own place. Then the window slides, and `*` picks from 2–4, then 3–5. So a braid with one loose note wanders a little, but stays near home.

```
1**3 +1  →   1**3 2**4 3**5
```

Here `**` can be any note at all, and it doesn't make the window wider: `1**3` still spans 1–3 for the purpose of running off the end.

**When do they roll?**
- **Baked** into a list (slice 2): each wildcard is rolled once, and the result is written down as plain values.
- **Live** on the order list (slice 3): a wildcard rolls each time that step plays, so the loop never quite repeats.

As with shapes, a wildcard needs a fixed width: `12* 0,+1` is refused.

**A quirk to know:** a lone `*` with nothing else in the window picks from the whole list, and then the window has nowhere to slide, so `* +1` plays a single random note. Use `**` (or `**` with `x8`, say) for that.

---

## 7. Talking about any length: `n` and ranges

Presets have to work on a list of any length. Two shorthands do that:

- **`n`** is the last note.
- **`a..b`** is a range: `1..n` is the whole list, `2..4` is notes 2, 3, 4, and `n..1` is the whole list backward.

```
1..n +1,0      →   12345 2345 345 45 5        (subtract)
n -1,0         →   5 45 345 2345 12345        (from the top)
1..n +1,-1     →   12345 234 3                (wedge, on 5)
1..n +1,-1     →   123456 2345 34             (wedge, on 6)
n..1           →   54321
2..4 0,+1      →   234 2345 23456             (on 6)
```

---

## 8. Lists longer than nine

`123` is read digit by digit, so it can't say "note 10". Put **spaces** between the indices and each word is one index:

```
1 10 +1       (on 12)   →   1 10 · 2 11 · 3 12
1 2 10 +1     (on 12)   →   1 2 10 · 2 3 11 · 3 4 12
```

On a list longer than nine, the preview writes it the same way: spaces inside a window, `·` between windows. You can still use the compact form for a long list: `123 +1` on twelve notes is fine, and `1..n` covers everything.

---

## 9. Length, the warning, and the cap

Patterns grow fast. A pyramid on 30 notes is 465 notes long.

- Past **200** notes the palette will warn you.
- At **500** the pattern is cut, a whole window at a time, so you never end mid-figure. A braid of 3 on a 200-note list stops at 498.

A rough guide to lengths on a list of *n*:

| pattern | length |
|---|---|
| braid `123 +1` | 3 × (n − 2) |
| pyramid `1 0,+1` | n(n+1)/2 |
| climb and return | n² |
| any `x2` | double |
| any `\|` | nearly double |

---

## 10. When it says no

The messages are meant to be read. The ones you'll meet:

| you typed | it says | meaning |
|---|---|---|
| `9` on 5 notes | the list has 5: there's no 9 | an index past the end |
| `1213 0,+1` | a motif needs a window that keeps its width (one number, like +1) | shapes slide, runs grow (§4) |
| `12* 0,+1` | a window that changes width takes no * (keep one number, like +1) | the same rule, for wildcards |
| `123 x` | x: the flags are a r \| ~ x2 | an unknown flag, or `x` without a count |
| `abc` | start with the first window, like 123 | the pattern must begin with a window |
| (nothing) | type a first window, like 123 +1 | |

---

## 11. The presets, decoded

These are what `d` will offer. Each is on five notes.

| name | spec | gives | the idea |
|---|---|---|---|
| braid | `123 +1` | 123 234 345 | slide |
| pyramid | `1 0,+1` | 1 12 123 1234 12345 | grow right |
| climb and return | `1 0,+1 \|` | 1 12 … 12345 … 12 1 | grow, then shrink back |
| subtract | `1..n +1,0` | 12345 2345 345 45 5 | shrink from the left |
| from the top | `n -1,0` | 5 45 345 2345 12345 | grow to the left |
| wedge | `1..n +1,-1` | 12345 234 3 | close in |
| thirds | `13 +1` | 13 24 35 | a shape with a gap |
| sequence | `1213 +1` | 1213 2324 3435 | a figure, sequenced |
| falling figures | `321 +1` | 321 432 543 | a downward shape, rising |
| zigzag | `123 +1 a` | 123 432 345 | alternate direction |
| stutter | `11 +1` | 11 22 33 44 55 | each note twice |
| mirror | `1 +1 \|` | 1 2 3 4 5 4 3 2 1 | one at a time, there and back |
| braid, one loose | `12* +1` | 12* 23* 34* | a braid with a wandering note |

Braid, pyramid, mirror and stutter give exactly what Bloom's current keys give (the tests check this), so nothing you already use changes.

---

## 12. Exercises

Work these out on paper first. Answers below.

1. On 6 notes, write a braid of **four**.
2. Write a pattern that plays **5 4 3 2 1** one at a time, without typing every note.
3. On 5 notes: thirds that go **down** inside each pair (31 42 53).
4. A pyramid that **ends** on the whole list but **starts** with the top note.
5. On 5 notes: each window of a braid of 3 played **twice**, and the second time **backward**. (Trick question: can the flags do this?)
6. On 8 notes, a window of two that **slides by one and grows by one** each round.
7. On 12 notes: pairs a fifth apart in index (1 and 8, 2 and 9, …).
8. Why does `1213 0,+1` fail, and what's the nearest pattern that works?

<details><summary>answers</summary>

1. `1234 +1` → 1234 2345 3456
2. `n -1` → 5 4 3 2 1 (or `n..1`, which plays it as one window)
3. `31 +1` → 31 42 53
4. `n -1,0` (from the top) → 5 45 345 2345 12345
5. Not with one pattern: `x2` repeats a window as it is, and `a` flips alternate *windows*, not alternate repeats. `123 +1 x2` gives 123 123 234 234 … The nearest is to write the shape out yourself: `123321 +1` → 123321 234432 345543.
6. `12 +1,+2` → 12 234 3456 45678
7. `1 8 +1` → 1 8 · 2 9 · 3 10 · 4 11 · 5 12
8. A figure like `1213` has no single spacing, so the pattern can't tell how to grow it. Keep the width fixed (`1213 +1`), or grow an even run (`123 0,+1`).
</details>

---

## 13. Coming next

- **Slice 2: the palette (built).** `d` opens the presets and a box to type your own, with a live preview of the indices and the length (warning past 200, cut at 500). In a list mode it **bakes**: the list is rewritten by the pattern, so you can, say, stretch only your velocities into a long patterned list while the pitches stay as they are. At home it bakes too, until slice 3.
- **Slice 3: the order list.** At home, a pattern stops rewriting notes and instead changes **how the playhead travels** through them. The other lists follow the step, so a phasing bloom keeps phasing; a switch makes them follow the note instead. Wildcards roll each time they play.
