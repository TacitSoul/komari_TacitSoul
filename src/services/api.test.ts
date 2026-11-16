import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adaptNodeStatus, adaptStatusRecord, apiService, normalizeMetricDefinitionsResponse } from './api';
import { rpc2Client } from '@/lib/rpc2';
import { nodeStatsToLoadRecord } from '@/lib/chart-utils';
import type { RPC2NodeStatus, RPC2StatusRecord } from '@/lib/rpc2/types';

vi.mock('@/lib/rpc2', () => ({ rpc2Client: { call: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('chart API opt-in errors', () => {
  it('preserves fallback values when the options argument is omitted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(rpc2Client, 'call').mockRejectedValue(new Error('offline'));
    await expect(apiService.getLoadHistory('default-node')).resolves.toBeNull();
    await expect(apiService.getPingHistory('default-node')).resolves.toBeNull();
    await expect(apiService.getNodeRecentStats('default-node')).resolves.toEqual([]);
  });

  it('keeps loadType compatible with strict mode without sending error options to RPC', async () => {
    const rpc = vi.spyOn(rpc2Client, 'call').mockResolvedValue({ records: [], from: '', to: '' });
    await apiService.getLoadHistory('chart-node', 6, { loadType: 'cpu', throwOnError: true });
    expect(rpc).toHaveBeenCalledWith('common:getRecords', {
      uuid: 'chart-node', type: 'load', hours: 6, maxCount: 3000, load_type: 'cpu',
    });
  });

  const methods = [
    { name: 'load', call: (strict: boolean) => apiService.getLoadHistory('chart-node', 6, { throwOnError: strict }), fallback: null },
    { name: 'ping', call: (strict: boolean) => apiService.getPingHistory('chart-node', 6, { throwOnError: strict }), fallback: null },
    { name: 'recent', call: (strict: boolean) => apiService.getNodeRecentStats('chart-node', { throwOnError: strict }), fallback: [] },
  ];

  it.each(methods)('$name keeps default failures compatible but throws when opted in', async ({ call, fallback }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('offline');
    vi.spyOn(rpc2Client, 'call').mockRejectedValue(error);
    await expect(call(false)).resolves.toEqual(fallback);
    await expect(call(true)).rejects.toBe(error);
  });

  it.each(methods)('$name does not deduplicate callers with different error modes', async ({ call, fallback }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('offline');
    const rpc = vi.spyOn(rpc2Client, 'call').mockRejectedValue(error);
    const compatible = call(false);
    const strict = call(true);
    await Promise.all([
      expect(compatible).resolves.toEqual(fallback),
      expect(strict).rejects.toBe(error),
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each(methods)('$name distinguishes a missing response from empty records', async ({ call, fallback }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.spyOn(rpc2Client, 'call').mockResolvedValue(null);
    await expect(call(false)).resolves.toEqual(fallback);
    await expect(call(true)).rejects.toThrow('Empty');
    rpc.mockResolvedValue({ records: [], tasks: [], from: '', to: '' });
    await expect(call(true)).resolves.toEqual(fallback === null
      ? expect.objectContaining({ records: [] })
      : []);
  });
});

describe('normalizeMetricDefinitionsResponse', () => {
  it('normalizes the bare array returned by Komari 1.2.6 and 1.4.3', () => {
    expect(normalizeMetricDefinitionsResponse([
      {
        name: 'cpu.usage',
        type: 'gauge',
        unit: '%',
        retention_days: '7',
        metadata: { source: 'report', ignored: 1 },
        created_at: '2026-01-01T00:00:00Z',
      },
      { name: 'invalid', retention_days: -1 },
      null,
    ])).toEqual([{
      name: 'cpu.usage',
      description: undefined,
      type: 'gauge',
      unit: '%',
      retention_days: 7,
      metadata: { source: 'report' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: undefined,
    }]);
  });

  it('accepts definitions/data envelopes and removes duplicate names', () => {
    expect(normalizeMetricDefinitionsResponse({
      definitions: [
        { name: 'ping.latency_ms', retention_days: 1 },
        { name: 'ping.latency_ms', retention_days: 3 },
      ],
    })).toEqual([{
      name: 'ping.latency_ms',
      description: undefined,
      type: undefined,
      unit: undefined,
      retention_days: 1,
      metadata: undefined,
      created_at: undefined,
      updated_at: undefined,
    }]);

    expect(normalizeMetricDefinitionsResponse({
      data: [{ name: 'memory.used', retention_days: 14 }],
    })[0].name).toBe('memory.used');
  });

  it('returns an empty list for an old server without the method', () => {
    expect(normalizeMetricDefinitionsResponse(null)).toEqual([]);
    expect(normalizeMetricDefinitionsResponse({ error: { code: -32601 } })).toEqual([]);
  });
});

describe('live network rate direction', () => {
  // Komari reports net_out = upload rate and net_in = download rate.
  const wire = {
    client: 'node-1',
    time: '2026-11-10T00:00:00Z',
    cpu: 1,
    gpu: 0,
    ram: 1,
    ram_total: 2,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 1,
    disk_total: 2,
    net_in: 111,
    net_out: 999,
    net_total_up: 5000,
    net_total_down: 7000,
    process: 1,
    connections: 3,
    connections_udp: 1,
  };

  it('maps net_out to up and net_in to down for recent-status records', () => {
    const stats = adaptStatusRecord(wire as RPC2StatusRecord);
    expect(stats.network).toMatchObject({ up: 999, down: 111, totalUp: 5000, totalDown: 7000 });
  });

  it('maps net_out to up and net_in to down for latest status', () => {
    const stats = adaptNodeStatus({ ...wire, online: true } as unknown as RPC2NodeStatus);
    expect(stats.network).toMatchObject({ up: 999, down: 111, totalUp: 5000, totalDown: 7000 });
  });

  it('round-trips back to the wire naming used by the history charts', () => {
    const stats = adaptStatusRecord(wire as RPC2StatusRecord);
    const record = nodeStatsToLoadRecord(stats);
    expect(record.net_out).toBe(999);
    expect(record.net_in).toBe(111);
  });
});
