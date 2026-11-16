import { describe, expect, it } from 'vitest';
import { formatResourceUsage, resourceUsage } from './resourceUsage';

describe('resource usage', () => {
  it.each([0, -1, NaN, Infinity, -Infinity])('marks an invalid total (%s) unavailable', (total) => {
    expect(resourceUsage(0, total)).toBeNull();
    expect(resourceUsage(100, total)).toBeNull();
    expect(formatResourceUsage(resourceUsage(0, total), 1)).toBe('—');
  });

  it.each([NaN, Infinity, -Infinity])('marks a non-finite used value (%s) unavailable', (used) => {
    expect(resourceUsage(used, 100)).toBeNull();
  });

  it('does not pass overflowed percentages to a gauge', () => {
    expect(resourceUsage(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
  });

  it('distinguishes real zero usage from missing telemetry and preserves precision', () => {
    expect(resourceUsage(0, 100)).toBe(0);
    expect(formatResourceUsage(resourceUsage(0, 100), 1)).toBe('0.0%');
    expect(resourceUsage(25, 200)).toBe(12.5);
    expect(formatResourceUsage(resourceUsage(25, 200), 0)).toBe('13%');
    expect(formatResourceUsage(resourceUsage(25, 200), 1)).toBe('12.5%');
  });
});
