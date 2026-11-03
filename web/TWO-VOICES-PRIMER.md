# Two voices: a primer for first use and testing

## Before you start
- Run `npm run dev` in `web/` and open the page. Click the picture once so it takes keys.
- Turn on the lanes with opt-`\`. They show both voices' lists, which is the clearest way to see what's going on.
- A reload brings back only the voice that had the focus. Save anything you want to keep to the garden (`↓`) as you go.

## 1. Bring in the second voice
1. Start with a bloom you like. This is voice **A**.
2. Press **opt-`tab`**. Voice **B** appears as an exact copy of A. The badge by the scale reads **`A · B`**, B is drawn dimmed over the picture, and its lanes sit dimmed above A's.
3. Press **`tab`** a few times. The badge swaps between `A · B` and `B · A`, and the first letter is the voice with the focus. Every key acts on that voice only.

## 2. Two loops, one starting on the other's downbeat
1. With A focused, press **`,`** to loop it.
2. Press **`tab`** to move to B, then **`,`**. B waits for A's next downbeat and starts with it. The badge reads **`B · A ↻ · in step`**.
3. Change B with whatever you like, such as `m`, `s` or a palette move. A keeps playing as it was.

## 3. Let them drift: the Facets case
1. With B focused, press **`z`** twice to drop two notes, so B has 3 notes against A's 5.
2. The badge now counts down, for example **`meet 9`**: the beats until both loops next start together. When they meet, the rim of the picture flares.
3. Press **`a`** to add a note back and watch the count change. That count is the period of the pattern the two voices make together.

## 4. Same length, different number of notes
1. Press **`F`** then **`l`** for the length lock. The badge shows `❄ l`, and the status line gives the other voice's length.
2. While B loops, add and drop notes. B is stretched back to A's length on each change, so the badge stays **`in step`**.
3. Press **`tab`**. The lock follows the focus, so A is now the voice held to B's length.
4. Press **`F` `l`** again to turn it off. Press `F` or `esc` to close the freeze menu.

## 5. Take one list from the other voice
1. With B focused, press **`t`** for time mode, then **opt-`f`**. B takes A's rhythm and keeps its own pitches.
2. Then press **opt-`x`**. It laces A's time list into B's.
3. Try the same in pitch (`p`) and velocity (`v`) modes. Plain `f` and `x` still use the garden slot.
4. Press **`esc`** to go home.

## 6. Copy a whole voice, stop, and leave
- **opt-`x`** at home copies the focused voice over the other. If both are looping, they play in unison from the next downbeat. The copied-over voice can get its old self back with cmd-`z` once it has the focus.
- **`.`** stops the focused voice. A second **`.`** stops the other.
- **opt-`tab`** goes back to one bloom, keeping the voice that has the focus. Press it again to bring the other voice back exactly as you left it.

## 7. Garden and takes
- **`↓`** saves the focused voice and **`↑`** lifts a slot into it. To keep a pair: save A, press `tab`, save B.
- **perform ▾ → take** records both voices. Play the take back to see the dimmed voice and the focus moving between them.

## What to watch for
- **Timing.** Does B really start on A's downbeat? Does an opt-`x` copy land in step? Listen for flams at the joins.
- **Undo across a `tab`.** cmd-`z` in each voice should undo only that voice's changes.
- **The meeting count.** It should reach the flare and then start again from the full period. If it ever jumps around, note which keys you pressed.
- **The lock and other freezes together.** The lock overrides `F d`, the fixed duration. Check that it feels right with `F g`, the grid, as well.
- **Faintness.** The dimmed voice and its lanes are drawn at about a third of full strength. Note if that's hard to read.
- **Expected limits:**
  - The tuning follows the focus. opt-`t` holds one tuning over both voices.
  - A reload keeps only one voice.
  - In a list mode, opt-`x` laces from the other voice rather than copying the whole voice.
