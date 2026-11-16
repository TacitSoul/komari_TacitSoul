import { describe, expect, it, vi } from 'vitest';
import { adaptNodeStatus, adaptStatusRecord } from '@/services/api';
import type { RPC2NodeStatus, RPC2StatusRecord } from '@/lib/rpc2/types';
import {
  createChartRequestGuard,
  ewmaSmooth,
  interpolatePingNulls,
  mergeLoadRecords,
  nodeStatsToLoadRecord,
  processPingRecords,
  summarizePingRecords,
  transformLoadRecords,
  type LoadRecord,
  type PingRecord,
} from './chart-utils';

const record = (minute: number, overrides: Partial<LoadRecord> = {}): LoadRecord => ({
  time: new Date(Date.UTC(2026, 10, 10, 0, minute)).toISOString(),
  cpu: 1, ram: 1, ram_total: 2, swap: 0, swap_total: 0, disk: 1, disk_total: 2,
  load: 0, process: 1, connections: 13, connections_udp: 3, net_in: 111, net_out: 999,
  ...overrides,
});
const ping = (minute: number, value: number, task_id = 1): PingRecord => ({
  client: 'node-1', task_id, time: record(minute).time, value,
});
const tasks = [{ id: 1, name: 'A', interval: 60 }, { id: 2, name: 'B', interval: 60 }];

vi.mock('@/lib/rpc2', () => ({ rpc2Client: { call: vi.fn() } }));

describe('chart request generations', () => {
  it('only lets the latest range update data, loading and error', async () => {
    const guard = createChartRequestGuard();
    let state = { data: '', loading: false, error: false };
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    const run = async (promise: Promise<string>) => {
      const isCurrent = guard.start();
      state = { ...state, loading: true, error: false };
      try {
        const data = await promise;
        if (isCurrent()) state = { ...state, data };
      } catch {
        if (isCurrent()) state = { ...state, error: true };
      } finally {
        if (isCurrent()) state = { ...state, loading: false };
      }
    };
    const old = run(new Promise(resolve => { resolveOld = resolve; }));
    const latest = run(new Promise(resolve => { resolveNew = resolve; }));
    resolveOld('old');
    await old;
    expect(state).toEqual({ data: '', loading: true, error: false });
    resolveNew('new');
    await latest;
    expect(state).toEqual({ data: 'new', loading: false, error: false });
  });

  it.each(['success', 'failure'])('ignores an older %s after a newer success', async outcome => {
    const guard = createChartRequestGuard();
    let state = { data: '', error: false };
    let finish!: () => void;
    const isOldCurrent = guard.start();
    const old = new Promise<string>((resolve, reject) => {
      finish = () => outcome === 'success' ? resolve('old') : reject(new Error('old failure'));
    }).then(data => {
      if (isOldCurrent()) state = { data, error: false };
    }).catch(() => {
      if (isOldCurrent()) state = { ...state, error: true };
    });
    const latest = guard.start();
    const data = await Promise.resolve('new');
    if (latest()) state = { data, error: false };
    finish();
    await old;
    expect(state).toEqual({ data: 'new', error: false });
  });

  it('invalidates on node/enabled changes and unmount, including strict effect replay', () => {
    const guard = createChartRequestGuard();
    const old = guard.start();
    guard.invalidate();
    expect(old()).toBe(false);
    const next = guard.start();
    expect(next()).toBe(true);
    guard.invalidate();
    expect(next()).toBe(false);
  });

  it('keeps independent ping and load requests independent', () => {
    const pingGuard = createChartRequestGuard();
    const loadGuard = createChartRequestGuard();
    const pingRequest = pingGuard.start();
    const loadRequest = loadGuard.start();
    pingGuard.invalidate();
    expect(pingRequest()).toBe(false);
    expect(loadRequest()).toBe(true);
  });
});

describe('ping loss and smoothing', () => {
  it('marks packet loss separately from timestamps contributed by another task', () => {
    const rows = processPingRecords([ping(0, 10), ping(1, -1), ping(2, 20, 2), ping(3, 40)], tasks, 1);
    expect(rows[1]['1']).toBeNull();
    expect(rows[1]['__lost:1']).toBe(1);
    expect(rows[2]['1']).toBeUndefined();
    expect(rows[2]['__lost:1']).toBeUndefined();
  });

  it('never interpolates packet loss or bridges across it', () => {
    const raw = processPingRecords([ping(0, 10), ping(1, 20, 2), ping(2, -1), ping(3, 20, 2), ping(4, 50)], tasks, 1);
    const smoothed = ewmaSmooth(interpolatePingNulls(raw, ['1']), ['1']);
    expect(raw.map(r => r['1'])).toEqual([10, undefined, null, undefined, 50]);
    expect(smoothed.map(r => r['1'])).toEqual([10, undefined, null, undefined, 50]);
  });

  it('can bridge only missing timestamps without mutating raw data', () => {
    const raw = processPingRecords([ping(0, 10), ping(1, 5, 2), ping(2, 30)], tasks, 1);
    expect(interpolatePingNulls(raw, ['1']).map(r => r['1'])).toEqual([10, 20, 30]);
    expect(raw[1]['1']).toBeUndefined();
  });

  it('restarts EWMA immediately after a loss gap', () => {
    const raw = processPingRecords([ping(0, 10), ping(1, 30), ping(2, -1), ping(3, 90), ping(4, 100)], tasks, 1);
    const result = ewmaSmooth(interpolatePingNulls(raw, ['1']), ['1'], 0.3);
    expect(result.map(r => r['1'])).toEqual([10, 16, null, 90, 93]);
  });

  it('does not interpolate long missing gaps', () => {
    const raw = processPingRecords([ping(0, 10), ping(30, 5, 2), ping(60, 30)], tasks, 6);
    expect(interpolatePingNulls(raw, ['1'])[1]['1']).toBeUndefined();
  });
});

describe('historical and live connections', () => {
  it('splits historical wire totals into TCP and UDP', () => {
    expect(transformLoadRecords([record(0)])[0]).toMatchObject({ connections: 10, connections_udp: 3 });
  });

  it('splits recent-status connections exactly once through the live chart path', () => {
    const stats = adaptStatusRecord({ ...record(0), client: 'node-1' } as RPC2StatusRecord);
    expect(stats.connections).toEqual({ tcp: 10, udp: 3 });
    const live = nodeStatsToLoadRecord(stats);
    expect(live.connections).toBe(13);
    expect(transformLoadRecords([live])[0]).toMatchObject({ connections: 10, connections_udp: 3 });
  });

  it('splits latest-status connections exactly once through the live chart path', () => {
    const stats = adaptNodeStatus({ ...record(0), online: true } as unknown as RPC2NodeStatus);
    expect(transformLoadRecords([nodeStatsToLoadRecord(stats)])[0]).toMatchObject({ connections: 10, connections_udp: 3 });
  });

  it('handles UDP-only and zero-connection samples', () => {
    expect(transformLoadRecords([
      record(0, { connections: 3, connections_udp: 3 }),
      record(1, { connections: 0, connections_udp: 0 }),
    ]).map(r => [r.connections, r.connections_udp])).toEqual([[0, 3], [0, 0]]);
  });
});

describe('selected-window ping statistics', () => {
  const samples = [ping(0, 10), ping(120, 40), ping(121, -1), ping(122, 20, 2), ping(123, 100)];

  it('uses the selected six-hour range instead of a hard-coded hour', () => {
    expect(summarizePingRecords(samples, 6).get(1)).toMatchObject({
      current: 100, avg: 50, min: 10, max: 100, p50: 40, p99: 100, loss: 25, total: 4,
    });
  });

  it('uses the same one-hour window for latency, loss and sample counts', () => {
    expect(summarizePingRecords(samples, 1).get(1)).toMatchObject({
      current: 100, avg: 70, min: 40, max: 100, p50: 100, p99: 100, total: 3,
    });
    expect(summarizePingRecords(samples, 1).get(1)?.loss).toBeCloseTo(100 / 3);
  });

  it('uses real successful samples, not interpolated or grouped values', () => {
    const raw = [ping(3, -1), ping(0, 10), ping(1, 999, 2), ping(2, 100)];
    expect(summarizePingRecords(raw, 6).get(1)).toMatchObject({ current: 100, avg: 55, total: 3 });
    expect(summarizePingRecords(raw, 6).get(2)).toMatchObject({ current: 999, avg: 999, total: 1 });
  });

  it('returns null latencies and full loss when all samples are lost', () => {
    expect(summarizePingRecords([ping(0, -1), ping(1, -1)], 1).get(1)).toEqual({
      current: null, avg: null, min: null, max: null, p50: null, p99: null, jitter: null, loss: 100, total: 2,
    });
    expect(summarizePingRecords([], 1).size).toBe(0);
  });
});

describe('realtime history merge', () => {
  it('retains live samples received while the initial snapshot was pending', () => {
    expect(mergeLoadRecords([record(0), record(1)], [record(2), record(3)], 150))
      .toEqual([record(0), record(1), record(2), record(3)]);
  });

  it('sorts and deduplicates by timestamp, preferring live values', () => {
    const live = record(1, { cpu: 99, time: '2026-11-10T00:01:00+00:00' });
    expect(mergeLoadRecords([record(2), record(1), record(0)], [live], 150))
      .toEqual([record(0), live, record(2)]);
  });

  it('caps at the newest samples even when live updates arrive out of order', () => {
    const merged = mergeLoadRecords([record(3), record(4)], [record(0), record(2), record(5)], 3);
    expect(merged).toEqual([record(3), record(4), record(5)]);
    expect(mergeLoadRecords(merged, [record(1)], 3)).toEqual(merged);
  });

  it('ignores invalid timestamps', () => {
    expect(mergeLoadRecords([record(0, { time: 'invalid' })], [record(1)], 150)).toEqual([record(1)]);
  });
});
