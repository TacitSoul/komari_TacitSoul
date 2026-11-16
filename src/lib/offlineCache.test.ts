import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeData, NodeStats } from '@/services/api';
import { clearOfflineCacheOnLogout, offlineCache, toGuestSafeNode } from './offlineCache';

const node = {
  uuid: 'node-1', name: 'Server', public_remark: 'Public note',
  ipv4: '192.0.2.1', ipv6: '2001:db8::1', remark: 'Private note',
} as NodeData;
const stats = { cpu: { usage: 5 }, ram: { used: 1, total: 2 } } as NodeStats;

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
afterEach(() => vi.unstubAllGlobals());

describe('guest-safe offline nodes', () => {
  it('drops private fields, preserves public_remark and does not mutate the live node', () => {
    const safe = toGuestSafeNode(node);
    expect(safe).toEqual({ uuid: 'node-1', name: 'Server', public_remark: 'Public note' });
    expect(node.remark).toBe('Private note');
    expect(node.ipv4).toBe('192.0.2.1');
    expect(node.ipv6).toBe('2001:db8::1');
  });

  it('enforces the projection at the storage boundary', () => {
    offlineCache.setNodes([node]);
    expect(offlineCache.getNodes()?.data).toEqual([toGuestSafeNode(node)]);
    const raw = window.localStorage.getItem('tacitsoul:cache:lastNodes')!;
    for (const key of ['"ipv4"', '"ipv6"', '"remark"']) expect(raw).not.toContain(key);
  });

  it('rejects and removes old-schema snapshots containing private data', () => {
    window.localStorage.setItem('tacitsoul:cache:lastNodes', JSON.stringify({ v: 1, t: 1, data: [node] }));
    expect(offlineCache.getNodes()).toBeNull();
    expect(window.localStorage.getItem('tacitsoul:cache:lastNodes')).toBeNull();
  });

  it('clears nodes and statuses on logout and resets the status-write throttle', () => {
    offlineCache.setNodes([node]);
    offlineCache.setStatuses(['node-1'], { 'node-1': stats });
    clearOfflineCacheOnLogout(true, false);
    expect(offlineCache.getNodes()).toBeNull();
    expect(offlineCache.getStatuses()).toBeNull();
    expect(offlineCache.setStatuses(['node-1'], { 'node-1': stats })).toBeGreaterThan(0);
  });

  it.each([[false, false], [false, true], [true, true]])('keeps caches for login transition %s -> %s', (before, after) => {
    offlineCache.setNodes([node]);
    clearOfflineCacheOnLogout(before, after);
    expect(offlineCache.getNodes()?.data).toHaveLength(1);
  });
});

describe('empty offline snapshots', () => {
  it('replaces deleted nodes with a timestamped empty snapshot', () => {
    offlineCache.setNodes([node]);
    expect(offlineCache.setNodes([])).toBeGreaterThan(0);
    expect(offlineCache.getNodes()?.data).toEqual([]);
    expect(offlineCache.getNodes()?.capturedAt).toBeGreaterThan(0);
  });

  it('replaces statuses with an empty snapshot even inside the throttle interval', () => {
    offlineCache.setStatuses(['node-1'], { 'node-1': stats });
    expect(offlineCache.setStatuses([], {})).toBeGreaterThan(0);
    expect(offlineCache.getStatuses()?.data).toEqual({ online: [], data: {} });
  });

  it('still throttles nonempty status snapshots', () => {
    offlineCache.setStatuses(['node-1'], { 'node-1': stats });
    expect(offlineCache.setStatuses(['node-2'], { 'node-2': stats })).toBe(0);
    expect(offlineCache.getStatuses()?.data.online).toEqual(['node-1']);
  });

  it('throttles repeated empty snapshots after the deletion has been persisted', () => {
    expect(offlineCache.setStatuses([], {})).toBeGreaterThan(0);
    expect(offlineCache.setStatuses([], {})).toBe(0);
  });
});
