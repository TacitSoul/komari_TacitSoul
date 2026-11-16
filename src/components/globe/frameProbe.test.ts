import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameProbe } from './frameProbe';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

describe('visible full-rate frame probe', () => {
  it('does not probe an initially hidden or off-screen globe', () => {
    const wake = vi.fn();
    const slow = vi.fn();
    const probe = createFrameProbe(wake, slow);
    probe.setRunning(false);
    vi.advanceTimersByTime(10000);
    expect(wake).not.toHaveBeenCalled();
    expect(slow).not.toHaveBeenCalled();
    probe.dispose();
  });

  it('cancels warmup while paused and starts a fresh warmup on return', () => {
    const wake = vi.fn();
    const probe = createFrameProbe(wake, vi.fn());
    probe.setRunning(true);
    vi.advanceTimersByTime(2000);
    probe.setRunning(false);
    vi.advanceTimersByTime(10000);
    expect(wake).not.toHaveBeenCalled();
    probe.setRunning(true);
    vi.advanceTimersByTime(2499);
    expect(wake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(wake).toHaveBeenCalledWith(3000);
    probe.dispose();
  });

  it.each(['tab hidden', 'globe off screen'])('discards an interrupted sample: %s', () => {
    const slow = vi.fn();
    const probe = createFrameProbe(vi.fn(), slow);
    probe.setRunning(true);
    vi.advanceTimersByTime(2500);
    probe.frame();
    vi.advanceTimersByTime(1000);
    probe.setRunning(false);
    vi.advanceTimersByTime(10000);
    expect(slow).not.toHaveBeenCalled();
    probe.setRunning(true);
    vi.advanceTimersByTime(2500);
    for (let frame = 0; frame < 60; frame += 1) probe.frame();
    vi.advanceTimersByTime(3000);
    expect(slow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    probe.dispose();
  });

  it('does not retain frames from an interrupted sample', () => {
    const slow = vi.fn();
    const probe = createFrameProbe(vi.fn(), slow);
    probe.setRunning(true);
    vi.advanceTimersByTime(2500);
    for (let frame = 0; frame < 60; frame += 1) probe.frame();
    probe.setRunning(false);
    probe.setRunning(true);
    vi.advanceTimersByTime(5500);
    expect(slow).toHaveBeenCalledOnce();
    probe.dispose();
  });

  it.each([{ frames: 23, slow: true }, { frames: 24, slow: false }])('keeps the 8 FPS threshold for $frames frames in three seconds', ({ frames, slow }) => {
    const onSlow = vi.fn();
    const wake = vi.fn();
    const probe = createFrameProbe(wake, onSlow);
    probe.setRunning(true);
    vi.advanceTimersByTime(2500);
    for (let frame = 0; frame < frames; frame += 1) probe.frame();
    vi.advanceTimersByTime(3000);
    expect(onSlow).toHaveBeenCalledTimes(slow ? 1 : 0);
    probe.setRunning(false);
    probe.setRunning(true);
    vi.advanceTimersByTime(10000);
    expect(wake).toHaveBeenCalledOnce();
    probe.dispose();
  });

  it('does not restart on repeated visible notifications and cleans up on disposal', () => {
    const wake = vi.fn();
    const slow = vi.fn();
    const probe = createFrameProbe(wake, slow);
    probe.setRunning(true);
    vi.advanceTimersByTime(2000);
    probe.setRunning(true);
    vi.advanceTimersByTime(500);
    expect(wake).toHaveBeenCalledOnce();
    probe.dispose();
    vi.advanceTimersByTime(10000);
    expect(slow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
