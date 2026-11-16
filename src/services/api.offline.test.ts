import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService, type NodeData } from './api';
import { offlineCache } from '@/lib/offlineCache';
import { rpc2Client } from '@/lib/rpc2';

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    },
  });
  offlineCache.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getNodes offline snapshots', () => {
  it('returns live private fields but persists only the guest-safe projection', async () => {
    vi.spyOn(rpc2Client, 'call').mockResolvedValue({
      'node-1': {
        uuid: 'node-1', name: 'Server', ipv4: '192.0.2.1', ipv6: '2001:db8::1',
        remark: 'Private note', public_remark: 'Public note',
      },
    });
    const nodes = await apiService.getNodes();
    expect(nodes[0]).toMatchObject({ ipv4: '192.0.2.1', ipv6: '2001:db8::1', remark: 'Private note' });
    const cached = offlineCache.getNodes()?.data[0];
    expect(cached).toMatchObject({ uuid: 'node-1', public_remark: 'Public note' });
    expect(cached).not.toHaveProperty('ipv4');
    expect(cached).not.toHaveProperty('ipv6');
    expect(cached).not.toHaveProperty('remark');
  });

  it.each([[], {}])('replaces old nodes when the server successfully returns %j', async result => {
    offlineCache.setNodes([{ uuid: 'deleted', name: 'Deleted server' } as NodeData]);
    vi.spyOn(rpc2Client, 'call').mockResolvedValue(result);
    expect(await apiService.getNodes()).toEqual([]);
    expect(offlineCache.getNodes()?.data).toEqual([]);
  });

  it('keeps and returns the last snapshot when the request fails', async () => {
    offlineCache.setNodes([{ uuid: 'node-1', name: 'Server' } as NodeData]);
    const before = offlineCache.getNodes();
    vi.spyOn(rpc2Client, 'call').mockRejectedValue(new Error('Offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await apiService.getNodes()).toEqual(before?.data);
    expect(offlineCache.getNodes()).toEqual(before);
  });

  it('does not confuse a missing payload with a valid empty collection', async () => {
    offlineCache.setNodes([{ uuid: 'node-1', name: 'Server' } as NodeData]);
    const before = offlineCache.getNodes();
    vi.spyOn(rpc2Client, 'call').mockResolvedValue(null);
    expect(await apiService.getNodes()).toEqual(before?.data);
    expect(offlineCache.getNodes()).toEqual(before);
  });
});
