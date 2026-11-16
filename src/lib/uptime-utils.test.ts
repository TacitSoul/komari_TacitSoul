import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  computeUptime,
  hydrateUptimeMeasurements,
  isCurrentUptimeRequest,
  needsUptimeRefresh,
  observableStart,
  sortUptimeNodes,
  summarizeUptime,
  type LoadRecord,
  type UptimeMeasurement,
  type UptimeResult,
} from './uptime-utils';
import { apiService, type NodeWithStatus } from '@/services/api';
import { rpc2Client } from '@/lib/rpc2';
import { UptimeView } from '@/components/UptimeView';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/rpc2', () => ({ rpc2Client: { call: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const HOUR = 3600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-11T00:00:00Z');

function recordsBetween(start: number, end: number, interval = 5 * MINUTE): LoadRecord[] {
  const records: LoadRecord[] = [];
  for (let time = start; time <= end; time += interval) records.push({ time: new Date(time).toISOString() });
  return records;
}

function success(result: UptimeResult): UptimeMeasurement {
  return { result, failed: false };
}

describe('computeUptime', () => {
  it('U1 excludes time before creation and measures only the covered part of a slot', () => {
    const created = NOW - 2.5 * HOUR;
    const result = computeUptime(recordsBetween(created, NOW), 24, created, NOW);
    expect(result.slots.filter(s => s.status === 'unknown')).toHaveLength(21);
    expect(result.slots[21].onlineMs).toBe(30 * MINUTE);
    expect(result).toMatchObject({ uptimePercent: 100, onlineSlots: 3, offlineSlots: 0, totalSlots: 3, offlineMs: 0, lastIncident: null });
  });

  it('U1 clips retention independently of creation and does not count unobservable time as downtime', () => {
    const start = observableStart(new Date(NOW - 20 * DAY).toISOString(), 1.5, NOW);
    expect(start).toBe(NOW - 1.5 * HOUR);
    const result = computeUptime([], 24, start, NOW);
    expect(result.offlineMs).toBe(1.5 * HOUR);
    expect(result.offlineSlots).toBe(2);
    expect(result.totalSlots).toBe(2);
    expect(observableStart('invalid', 744, NOW)).toBe(NOW - 744 * HOUR);
  });

  it('U1 returns null with no observable time, not zero percent', () => {
    const result = computeUptime([], 24, NOW, NOW);
    expect(result).toMatchObject({ uptimePercent: null, onlineSlots: 0, offlineSlots: 0, totalSlots: 0, offlineMs: 0, lastIncident: null });
    expect(result.slots.every(s => s.status === 'unknown')).toBe(true);
  });

  it('U2 measures a 30-minute outage inside an hour as partial and about 97.9% over 24 hours', () => {
    const gapStart = NOW - 12 * HOUR;
    const records = recordsBetween(NOW - DAY, NOW).filter(r => {
      const time = Date.parse(r.time);
      return time < gapStart || time >= gapStart + 30 * MINUTE;
    });
    const result = computeUptime(records, 24, -Infinity, NOW);
    expect(result.uptimePercent).toBeCloseTo(97.9167, 3);
    expect(result.slots[12]).toMatchObject({ status: 'partial', onlineMs: 30 * MINUTE, offlineMs: 30 * MINUTE });
    expect(result.offlineMs).toBe(30 * MINUTE);
    expect(result.offlineSlots).toBe(1);
    expect(result.lastIncident).toBe(gapStart + 30 * MINUTE);
  });

  it('U2 does not let a single five-minute record make an hour fully online', () => {
    const start = NOW - 12 * HOUR;
    const records = recordsBetween(NOW - DAY, NOW).filter(r => {
      const time = Date.parse(r.time);
      return time <= start || time >= start + HOUR;
    });
    const result = computeUptime(records, 24, -Infinity, NOW);
    expect(result.slots[12]).toMatchObject({ status: 'offline', onlineMs: 5 * MINUTE, offlineMs: 55 * MINUTE });
    expect(result.uptimePercent).toBeCloseTo((1 - 55 / 1440) * 100);
  });

  it.each([
    { hours: 168, interval: HOUR, count: 28 },
    { hours: 720, interval: DAY, count: 30 },
  ])('U2 tolerates the newest bucket lag for $hours hours', ({ hours, interval, count }) => {
    const result = computeUptime(recordsBetween(NOW - hours * HOUR, NOW - interval, interval), hours, -Infinity, NOW);
    expect(result.slots).toHaveLength(count);
    expect(result.uptimePercent).toBe(100);
    expect(result.offlineMs).toBe(0);
    expect(result.lastIncident).toBeNull();
  });

  it('U2 treats only the bounded newest-bucket tolerance as unknown', () => {
    const result = computeUptime(recordsBetween(NOW - DAY - 2.5 * MINUTE, NOW - 7.5 * MINUTE), 24, -Infinity, NOW);
    expect(result.uptimePercent).toBe(100);
    expect(result.slots[23].onlineMs).toBe(57.5 * MINUTE);
    expect(result.offlineMs).toBe(0);
    const overdue = computeUptime(recordsBetween(NOW - DAY, NOW - 20 * MINUTE), 24, -Infinity, NOW);
    expect(overdue.offlineMs).toBe(12.5 * MINUTE);
    expect(overdue.lastIncident).toBe(NOW);
  });

  it('U2 uses the tier fallback for a single daily bucket', () => {
    const result = computeUptime([{ time: new Date(NOW - DAY).toISOString() }], 720, NOW - DAY, NOW);
    expect(result.uptimePercent).toBe(100);
    expect(result.totalSlots).toBe(1);
  });

  it('U2 does not move the last incident into an unknown newest-bucket tail', () => {
    const records = recordsBetween(NOW - DAY - MINUTE, NOW - HOUR - MINUTE);
    records.push({ time: new Date(NOW - 6 * MINUTE).toISOString() });
    const result = computeUptime(records, 24, -Infinity, NOW);
    expect(result.offlineMs).toBe(50 * MINUTE);
    expect(result.lastIncident).toBe(NOW - 6 * MINUTE);
  });

  it('U1/U2 handles 22 daily bucket starts for a node created 21 days ago like Komari 1.6.1', () => {
    const now = Date.parse('2026-11-11T23:30:00+08:00');
    const newest = Date.parse('2026-11-11T08:00:00+08:00');
    const created = now - 21 * DAY;
    const records = recordsBetween(newest - 21 * DAY, newest, DAY);
    expect(records).toHaveLength(22);
    const result = computeUptime(records, 720, observableStart(new Date(created).toISOString(), 744, now), now);
    expect(result.slots).toHaveLength(30);
    expect(result.slots.some(s => s.status === 'unknown')).toBe(true);
    expect(result).toMatchObject({ uptimePercent: 100, offlineMs: 0, offlineSlots: 0, lastIncident: null });
  });

  it('U2 sorts and deduplicates timestamps and ignores invalid/future records', () => {
    const records = recordsBetween(NOW - DAY, NOW);
    const result = computeUptime([
      ...records.reverse(), records[0], { time: 'invalid' }, { time: new Date(NOW + HOUR).toISOString() },
    ], 24, -Infinity, NOW);
    expect(result.uptimePercent).toBe(100);
    expect(result.offlineMs).toBe(0);
  });

  it('U2 infers the median cadence instead of the mean outage gap', () => {
    const records = recordsBetween(NOW - DAY, NOW).filter(r => {
      const time = Date.parse(r.time);
      return time < NOW - 10 * HOUR || time >= NOW - 8 * HOUR;
    });
    expect(computeUptime(records, 24, -Infinity, NOW).offlineMs).toBe(2 * HOUR);
  });

  it('U9 aligns grids for rows loaded minutes apart', () => {
    const a = computeUptime([], 24, -Infinity, NOW + MINUTE);
    const b = computeUptime([], 24, -Infinity, NOW + 30 * MINUTE);
    expect(a.slots.map(s => s.start)).toEqual(b.slots.map(s => s.start));
  });

  it('U1/U9 includes the current partial slot without inventing downtime before the API window', () => {
    const now = NOW + 23 * MINUTE;
    const records = recordsBetween(now - DAY, now);
    const result = computeUptime(records, 24, -Infinity, now);
    expect(result.slots).toHaveLength(24);
    expect(result.slots[0].start).toBe(NOW - DAY + HOUR);
    expect(result.slots[23]).toMatchObject({ end: now, status: 'online', onlineMs: 23 * MINUTE });
    expect(result.uptimePercent).toBe(100);
    expect(result.offlineMs).toBe(0);
    const created = now - 10 * MINUTE;
    const fresh = computeUptime(records, 24, created, now);
    expect(fresh.uptimePercent).toBe(100);
    expect(fresh.totalSlots).toBe(1);
    expect(fresh.slots[23].onlineMs).toBe(10 * MINUTE);
  });
});

describe('summarizeUptime', () => {
  it('U1 excludes unknown measurements from the average and nodes-at-target denominator', () => {
    const data = new Map([
      ['known', success(computeUptime(recordsBetween(NOW - DAY, NOW), 24, -Infinity, NOW))],
      ['unknown', success(computeUptime([], 24, NOW, NOW))],
    ]);
    expect(summarizeUptime(['known', 'unknown'], data, 99.9)).toMatchObject({ avg: 100, measured: 1, loaded: 2, atTarget: 1, downtimeHours: 0, lastIncident: null });
  });

  it('U3 keeps failed rows separate from a successful empty history and excludes stale data', () => {
    const empty = computeUptime([], 24, -Infinity, NOW);
    const healthy = computeUptime(recordsBetween(NOW - DAY, NOW), 24, -Infinity, NOW);
    const data = new Map<string, UptimeMeasurement>([
      ['empty', success(empty)],
      ['failed', { result: null, failed: true }],
      ['stale', { result: healthy, failed: true }],
    ]);
    expect(summarizeUptime(['empty', 'failed', 'stale'], data, 99.9)).toMatchObject({ avg: 0, measured: 1, loaded: 3, failed: 2, atTarget: 0, downtimeHours: 24 });
    expect(summarizeUptime(['failed', 'stale'], data, 99.9)).toMatchObject({ avg: null, measured: 0, failed: 2, downtimeHours: 0, lastIncident: null, fleet: [] });
  });

  it('U8 excludes deleted nodes from every summary metric and timeline', () => {
    const healthy = computeUptime(recordsBetween(NOW - DAY, NOW), 24, -Infinity, NOW);
    const data = new Map([
      ['current', success(healthy)],
      ['deleted', success(computeUptime([], 24, -Infinity, NOW))],
      ['deleted-failed', { result: null, failed: true }],
    ]);
    const stats = summarizeUptime(['current'], data, 99.9);
    expect(stats).toMatchObject({ avg: 100, measured: 1, loaded: 1, failed: 0, atTarget: 1, downtimeHours: 0, lastIncident: null });
    expect(stats.fleet.every(cell => cell.total === 1 && cell.down === 0)).toBe(true);
  });

  it('U9 merges fleet timeline by slot start, not array index or input order', () => {
    const a = computeUptime([], 24, -Infinity, NOW);
    const b = computeUptime(recordsBetween(NOW - DAY, NOW), 24, -Infinity, NOW + HOUR);
    b.slots.reverse();
    const stats = summarizeUptime(['a', 'b'], new Map([['a', success(a)], ['b', success(b)]]), 99.9);
    expect(stats.fleet).toHaveLength(25);
    expect(stats.fleet[0]).toMatchObject({ start: NOW - DAY, total: 1, down: 1 });
    expect(stats.fleet[1]).toMatchObject({ start: NOW - DAY + HOUR, total: 2, down: 1 });
    expect(stats.fleet[24]).toMatchObject({ start: NOW, total: 1 });
  });

  it('U2 sums actual downtime and preserves partial fleet status', () => {
    const records = recordsBetween(NOW - DAY, NOW).filter(r => {
      const time = Date.parse(r.time);
      return time < NOW - HOUR || time >= NOW - 30 * MINUTE;
    });
    const stats = summarizeUptime(['node'], new Map([['node', success(computeUptime(records, 24, -Infinity, NOW))]]), 99.9);
    expect(stats.downtimeHours).toBe(0.5);
    expect(stats.lastIncident).toBe(NOW - 30 * MINUTE);
    expect(stats.fleet[23]).toMatchObject({ down: 1, total: 1, partial: true });
  });
});

describe('uptime cache lifecycle', () => {
  it('U4 seeds cached measurements immediately when returning to the view', () => {
    const nodes = [{ uuid: 'node', created_at: new Date(NOW - DAY).toISOString() }];
    const cache = new Map([['node', { records: recordsBetween(NOW - DAY, NOW), failed: false }]]);
    const measurements = hydrateUptimeMeasurements(nodes, cache, 24, 744, NOW);
    expect(summarizeUptime(['node'], measurements, 99.9)).toMatchObject({ loaded: 1, measured: 1, avg: 100 });
    expect(hydrateUptimeMeasurements(nodes, new Map(), 24, 744, NOW).size).toBe(0);
  });

  it('U5 refreshes missing, failed and old cached histories, including after the first load', () => {
    const interval = 2 * MINUTE;
    expect(needsUptimeRefresh(undefined, false, NOW, interval)).toBe(true);
    expect(needsUptimeRefresh(NOW, false, NOW, interval)).toBe(false);
    expect(needsUptimeRefresh(NOW, false, NOW + interval, interval)).toBe(true);
    expect(needsUptimeRefresh(NOW - DAY, false, NOW, interval)).toBe(true);
    expect(needsUptimeRefresh(NOW, true, NOW, interval)).toBe(true);
  });

  it('U6 rejects cancelled requests and previous cache generations even for the same range', async () => {
    const captured = { rangeHours: 24 };
    let active = captured;
    const request = Promise.resolve().then(() => isCurrentUptimeRequest(captured, active, false));
    active = { rangeHours: 168 };
    expect(await request).toBe(false);
    expect(isCurrentUptimeRequest(captured, { rangeHours: 24 }, false)).toBe(false);
    expect(isCurrentUptimeRequest(captured, captured, true)).toBe(false);
    expect(isCurrentUptimeRequest(captured, captured, false)).toBe(true);
  });

  it('U7 uses current node objects with stable equal-weight ordering and updated weights', () => {
    const old = [{ uuid: 'b', weight: 1, status: 'offline', name: 'old', group: 'old' }, { uuid: 'a', weight: 1, status: 'online', name: 'a', group: '' }];
    const current = [{ ...old[0], status: 'online', name: 'new', group: 'new' }, { ...old[1] }];
    const sorted = sortUptimeNodes(current);
    // Equal weights must retain the canonical backend list order, not UUID order.
    expect(sorted.map(n => n.uuid)).toEqual(['b', 'a']);
    expect(sorted[0]).toBe(current[0]);
    expect(sorted[0]).toMatchObject({ status: 'online', name: 'new', group: 'new' });
    expect(sortUptimeNodes([{ ...current[0], weight: 0 }, current[1]]).map(n => n.uuid)).toEqual(['b', 'a']);
    expect(current[0].uuid).toBe('b');
  });
});

describe('uptime history requests', () => {
  it('U6 lets explicit refreshes bypass deduplication of older in-flight requests', async () => {
    const call = vi.spyOn(rpc2Client, 'call').mockResolvedValue({ records: [], count: 0 });
    await Promise.all([
      apiService.getLoadHistory('node', 24, { throwOnError: true, deduplicate: false }),
      apiService.getLoadHistory('node', 24, { throwOnError: true, deduplicate: false }),
    ]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('U3 throws on request failure only for opt-in callers, even when calls overlap', async () => {
    const error = new Error('history unavailable');
    const call = vi.spyOn(rpc2Client, 'call').mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [legacy, uptime] = await Promise.allSettled([
      apiService.getLoadHistory('node', 24, { loadType: 'cpu' }),
      apiService.getLoadHistory('node', 24, { loadType: 'cpu', throwOnError: true }),
    ]);
    expect(legacy).toEqual({ status: 'fulfilled', value: null });
    expect(uptime).toEqual({ status: 'rejected', reason: error });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('U3 treats a successful empty history as success, not a transport failure', async () => {
    vi.spyOn(rpc2Client, 'call').mockResolvedValue({ records: [], count: 0, from: '', to: '' });
    await expect(apiService.getLoadHistory('node', 720, { loadType: 'cpu', throwOnError: true })).resolves.toMatchObject({ records: [], count: 0 });
  });

  it('U3 rejects a missing response rather than treating it as an empty history', async () => {
    vi.spyOn(rpc2Client, 'call').mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(apiService.getLoadHistory('node', 24, { throwOnError: true })).rejects.toThrow('Empty load history response');
    await expect(apiService.getLoadHistory('node', 24)).resolves.toBeNull();
  });
});

it('U10 renders a real keyboard-focusable node detail link with a visible focus style', () => {
  const node: NodeWithStatus = {
    uuid: 'node-link', name: 'Keyboard node', cpu_name: '', virtualization: '', arch: '', cpu_cores: 1,
    os: '', gpu_name: '', region: '', mem_total: 0, swap_total: 0, disk_total: 0, weight: 0,
    price: 0, billing_cycle: 30, currency: '', expired_at: '', group: '', tags: '', created_at: '',
    updated_at: '', status: 'online',
  };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UptimeView, { nodes: [node] })));
  expect(html).toContain('href="/node/node-link"');
  expect(html).toMatch(/<a[^>]*focus-visible:outline-ring[^>]*>.*Keyboard node.*<\/a>/);
});
