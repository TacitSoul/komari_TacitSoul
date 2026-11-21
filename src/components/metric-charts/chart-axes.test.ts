import { describe, expect, it } from 'vitest';
import { createMetricChartTimeFormatter } from './chart-axes';

const midnight = new Date(2026, 0, 2, 0, 7, 9).toISOString();
const afternoon = new Date(2026, 0, 2, 15, 23, 8).getTime();

describe('metric chart clock', () => {
  it.each(['zh-Hans', 'zh-Hant', 'zh-CN', 'zh-TW'])('uses the local 00–23 clock for %s', (locale) => {
    const clock = createMetricChartTimeFormatter(locale);
    expect(clock(midnight)).toBe('00:07');
    expect(clock(afternoon)).toBe('15:23');
  });

  it('keeps seconds and the calendar date in a Chinese chart tooltip', () => {
    const format = createMetricChartTimeFormatter('zh-Hant', true);
    expect(format(midnight)).toMatch(/01\/02.*00:07:09/);
  });

  it('preserves the existing browser convention outside Chinese and tolerates missing timestamps', () => {
    const clock = createMetricChartTimeFormatter('en');
    expect(clock(afternoon)).toBe(new Date(afternoon).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    expect(clock('not a timestamp')).toBe('');
  });

  it('uses the current local timezone after the formatter was created', () => {
    const original = process.env.TZ;
    const timestamp = Date.parse('2026-01-02T15:23:08Z');
    try {
      process.env.TZ = 'UTC';
      const axis = createMetricChartTimeFormatter('zh-Hans');
      const tooltip = createMetricChartTimeFormatter('zh-Hans', true);
      expect(axis(timestamp)).toBe('15:23');
      process.env.TZ = 'America/New_York';
      expect(axis(timestamp)).toBe('10:23');
      expect(tooltip(timestamp)).toMatch(/10:23:08/);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
