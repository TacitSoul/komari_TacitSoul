import { describe, it, expect } from 'vitest';
import { formatBytes } from './utils';

describe('formatBytes', () => {
  it('formats real Komari capacity values using a binary (1024) base', () => {
    // traffic_limit = 200 * 1024^3 → must read as a round 200 GB (binary), not 215 GB.
    expect(formatBytes(214748364800)).toBe('200 GB');
    // disk_total
    expect(formatBytes(63290032128)).toBe('58.9 GB');
    // mem_total
    expect(formatBytes(1794953216)).toBe('1.67 GB');
    // swap_total
    expect(formatBytes(2084564992)).toBe('1.94 GB');
  });

  it('picks the right unit at each 1024 boundary', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1 PB');
    expect(formatBytes(1024 ** 6)).toBe('1 EB');
  });

  it('keeps ~3 significant figures', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 3 * 1.5)).toBe('1.5 GB');
    expect(formatBytes(1024 ** 3 * 12.345)).toBe('12.3 GB');
    expect(formatBytes(1024 ** 3 * 123.45)).toBe('123 GB');
  });

  it('handles zero, negative, and non-finite inputs gracefully', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(-(1024 ** 3))).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});

describe('formatSpeed (one unit system theme-wide)', () => {
  it('is 1024-based with KB / MB labels, three significant digits, promoted at 1000', async () => {
    const { formatSpeed, formatSpeedParts } = await import('./utils');
    expect(formatSpeed(0)).toBe('0 B/s');
    expect(formatSpeed(87)).toBe('87 B/s');
    expect(formatSpeed(999)).toBe('999 B/s');
    expect(formatSpeed(1000)).toBe('0.98 KB/s');
    expect(formatSpeed(1024)).toBe('1.00 KB/s');
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s');
    expect(formatSpeed(30 * 1024 ** 2)).toBe('30.0 MB/s');
    expect(formatSpeedParts(Number.NaN)).toEqual({ value: '0', unit: 'B/s' });
  });

  it('matches the matrix card and cluster panel helpers', async () => {
    const { formatSpeed } = await import('./utils');
    const { formatByteRateLabel } = await import('@/matrix/utils/format');
    const { formatCompactRate } = await import('@/components/cards/cardFormat');
    for (const value of [0, 87, 1000, 1536, 999_999, 31_200_000, 2.5 * 1024 ** 3]) {
      expect(formatByteRateLabel(value)).toBe(formatSpeed(value));
      expect(formatCompactRate(value)).toBe(formatSpeed(value));
    }
  });
});
