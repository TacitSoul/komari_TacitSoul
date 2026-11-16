import { describe, expect, it } from 'vitest';
import { capacityTier, cpuTier, filledSegments, osArchLabel, trafficCell } from './tableFormat';

const GB = 1024 ** 3;

describe('table cell formatting rules', () => {
  it('builds the OS + arch label', () => {
    expect(osArchLabel('Debian GNU/Linux 12 (bookworm)', 'x86_64')).toBe('DEBIAN AMD64');
    expect(osArchLabel('Ubuntu 24.04 LTS', 'aarch64')).toBe('UBUNTU ARM64');
    expect(osArchLabel('Red Hat Enterprise Linux', 'x86_64')).toBe('RHEL AMD64');
    expect(osArchLabel('Arch Linux', '')).toBe('ARCH');
    expect(osArchLabel('', '')).toBe('LINUX');
  });

  it('uses the tier thresholds', () => {
    expect(cpuTier(40)).toBe('normal');
    expect(cpuTier(41)).toBe('warn');
    expect(cpuTier(76)).toBe('bad');
    expect(capacityTier(50)).toBe('normal');
    expect(capacityTier(51)).toBe('warn');
    expect(capacityTier(81)).toBe('bad');
  });

  it('fills ten segments by rounding', () => {
    expect(filledSegments(0)).toBe(0);
    expect(filledSegments(4)).toBe(0);
    expect(filledSegments(5)).toBe(1);
    expect(filledSegments(96)).toBe(10);
    expect(filledSegments(140)).toBe(10);
    expect(filledSegments(Number.NaN)).toBe(0);
  });

  it('formats traffic with the limit-type badge, or ∞ when unlimited', () => {
    const limited = trafficCell(30 * GB, 10 * GB, 200 * GB, 'max');
    expect(limited.text).toBe('30.0 / 200 GB');
    expect(trafficCell(512 * 1024 ** 2, 0, 1024 ** 4, 'sum').text).toBe('512 MB / 1.00 TB');
    expect(limited.badge).toBe('MAX');
    expect(limited.sortValue).toBeCloseTo(0.15);
    const unlimited = trafficCell(1 * GB, 2 * GB, 0, 'sum');
    expect(unlimited.badge).toBeNull();
    expect(unlimited.text).toBe('3.00 GB');
    expect(trafficCell(1, 2, 100, 'up').badge).toBe('OUT');
    expect(trafficCell(1, 2, 100, 'down').badge).toBe('IN');
  });
});
