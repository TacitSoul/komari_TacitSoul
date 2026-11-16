import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { formatPriceLabel } from './billing';
import {
  expireStatus,
  expireTone,
  formatCompactRate,
  hasExpiry,
  normalizeLimitType,
  trafficBar,
  trafficUsed,
  usageStatus,
} from './cardFormat';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-10T00:00:00Z');

const t = ((key: string, params?: Record<string, unknown>) =>
  params && 'count' in params ? `${key}:${String(params.count)}` : key) as unknown as TFunction;

describe('card formatting rules', () => {
  it('colours usage at 60 / 80 %', () => {
    expect(usageStatus(59.9)).toBe('ok');
    expect(usageStatus(60)).toBe('warn');
    expect(usageStatus(79.9)).toBe('warn');
    expect(usageStatus(80)).toBe('bad');
    expect(usageStatus(Number.NaN)).toBe('ok');
  });

  it('counts traffic by limit type', () => {
    expect(trafficUsed(3, 5, 'up')).toBe(3);
    expect(trafficUsed(3, 5, 'down')).toBe(5);
    expect(trafficUsed(3, 5, 'min')).toBe(3);
    expect(trafficUsed(3, 5, 'max')).toBe(5);
    expect(trafficUsed(3, 5, 'sum')).toBe(8);
    expect(normalizeLimitType('no_limit')).toBe('sum');
  });

  it('keeps both sum segments inside the bar when over the limit', () => {
    const bar = trafficBar(150, 50, 100, 'sum');
    expect(bar.dual).toBe(true);
    expect(bar.totalPct).toBe(100);
    expect(bar.upPct + bar.downPct).toBeCloseTo(100);
    expect(bar.upPct).toBeCloseTo(75);
  });

  it('uses the larger direction colour for max', () => {
    expect(trafficBar(10, 30, 100, 'max')).toMatchObject({ dual: false, totalPct: 30, singleColor: 'down' });
    expect(trafficBar(10, 30, 100, 'min')).toMatchObject({ totalPct: 10, singleColor: 'up' });
    expect(trafficBar(10, 30, 0, 'sum').totalPct).toBe(0);
  });

  it('classifies expiry, treating year 0001 as unset', () => {
    expect(hasExpiry('0001-01-01T00:00:00Z')).toBe(false);
    expect(expireStatus('0001-01-01T00:00:00Z', NOW)).toBe('none');
    expect(expireStatus(new Date(NOW - DAY).toISOString(), NOW)).toBe('expired');
    expect(expireStatus(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe('critical');
    expect(expireStatus(new Date(NOW + 12 * DAY).toISOString(), NOW)).toBe('warning');
    expect(expireStatus(new Date(NOW + 100 * DAY).toISOString(), NOW)).toBe('normal');
    expect(expireStatus('2226-10-21T00:00:00Z', NOW)).toBe('long_term');
    expect(expireTone('critical')).toBe('bad');
    expect(expireTone('long_term')).toBe('muted');
  });

  it('formats prices with localised cycles and hides unset prices', () => {
    expect(formatPriceLabel(0, '$', 30, t)).toBeNull();
    expect(formatPriceLabel(-1, '$', 30, t)).toBe('mcard.free');
    expect(formatPriceLabel(10, '$', 30, t)).toBe('$10/mcard.cycle.month');
    expect(formatPriceLabel(5.5, '', 365, t)).toBe('¥5.50/mcard.cycle.year');
    expect(formatPriceLabel(20, '€', 730, t)).toBe('€20/mcard.cycle.years:2');
    expect(formatPriceLabel(3, '$', 45, t)).toBe('$3/mcard.cycle.days:45');
  });

  it('keeps rates to three significant digits, promoting at 1000', () => {
    expect(formatCompactRate(0)).toBe('0 B/s');
    expect(formatCompactRate(999)).toBe('999 B/s');
    expect(formatCompactRate(1000)).toBe('0.98 KB/s');
    expect(formatCompactRate(1000 * 1024)).toBe('0.98 MB/s');
    expect(formatCompactRate(106 * 1024)).toBe('106 KB/s');
    expect(formatCompactRate(27.3 * 1024 ** 2)).toBe('27.3 MB/s');
    expect(formatCompactRate(Number.NaN)).toBe('0 B/s');
  });
});
