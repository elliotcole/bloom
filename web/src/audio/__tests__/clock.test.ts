import { describe, it, expect, vi } from 'vitest';
import { after, every } from '../clock';

describe('clock (without workers: the page timers stand in)', () => {
  it('ticks every ms until stopped, and fires once after', () => {
    vi.useFakeTimers();
    let n = 0, once = 0;
    const stop = every(10, () => n++);
    const cancel = after(25, () => once++);
    vi.advanceTimersByTime(35);
    expect([n, once]).toEqual([3, 1]);
    stop(); cancel();
    vi.advanceTimersByTime(50);
    expect(n).toBe(3);
    const never = after(10, () => once++);
    never();
    vi.advanceTimersByTime(20);
    expect(once).toBe(1);
    vi.useRealTimers();
  });
});
