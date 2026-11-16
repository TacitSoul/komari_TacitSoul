import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService, type NodeData } from './api';
import { offlineCache } from '@/lib/offlineCache';
import { rpc2Client } from '@/lib/rpc2';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const EXTRA = '44444444-4444-4444-8444-444444444444';

// Replace only the RPC transport; adapters, ordering and cache stay real.
vi.mock('@/lib/rpc2', () => ({ rpc2Client: { call: vi.fn() } }));

function node(uuid: string, overrides: Partial<NodeData> = {}): NodeData {
  return {
    uuid, name: 'Same name', cpu_name: 'CPU', virtualization: 'kvm', arch: 'amd64',
    cpu_cores: 2, os: 'linux', gpu_name: '', region: 'US', mem_total: 1024,
    swap_total: 0, disk_total: 4096, weight: 0, price: 5, billing_cycle: 30,
    currency: 'USD', expired_at: '2027-01-01T00:00:00Z', group: 'Group', tags: 'Tag',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    kernel_version: '6.1', hidden: false, auto_renewal: true, traffic_limit: 1024,
    traffic_limit_type: 'sum', public_remark: 'Public note', ipv4: '192.0.2.1',
    ipv6: '2001:db8::1', remark: 'Private note', ...overrides,
  };
}

function mockNodes(metadata: unknown, ordered: unknown) {
  return vi.spyOn(rpc2Client, 'call').mockImplementation(async method => {
    let result: unknown;
    if (method === 'common:getNodes') result = metadata;
    else if (method === 'public:getNodesInformation') result = ordered;
    else throw new Error(`Unexpected RPC method: ${method}`);
    if (result instanceof Error) throw result;
    return result;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe('getNodes default admin-list order', () => {
  it('preserves the backend array order for equal weights, not UUID or creation order', async () => {
    const rpc = mockNodes({
      [A]: { uuid: A, name: 'Same name', weight: 0, created_at: '2026-01-01T00:00:00Z' },
      [B]: { uuid: B, name: 'Same name', weight: 0, created_at: '2026-02-01T00:00:00Z' },
      [C]: { uuid: C, name: 'Same name', weight: 0, created_at: '2026-03-01T00:00:00Z' },
    }, [{ uuid: C }, { uuid: A }, { uuid: B }]);

    const nodes = await apiService.getNodes();

    expect(nodes.map(node => node.uuid)).toEqual([C, A, B]);
    expect(rpc).toHaveBeenCalledWith('common:getNodes');
    expect(rpc).toHaveBeenCalledWith('public:getNodesInformation', undefined, { timeout: 5_000 });
    expect(offlineCache.getNodes()?.data.map(node => node.uuid)).toEqual([C, A, B]);
  });

  it('bounds the optional order lookup instead of using the full metadata timeout', async () => {
    const rpc = mockNodes({ [A]: node(A) }, [{ uuid: A }]);
    await apiService.getNodes();
    expect(rpc).toHaveBeenCalledWith('public:getNodesInformation', undefined, { timeout: 5_000 });
  });

  it.each([
    { label: 'ascending', keys: [A, B, C] },
    { label: 'descending', keys: [C, B, A] },
    { label: 'shuffled', keys: [B, A, C] },
  ])('ignores $label map-key enumeration order', async ({ keys }) => {
    const metadata = Object.fromEntries(keys.map(uuid => [uuid, node(uuid)]));
    mockNodes(metadata, [{ uuid: C }, { uuid: A }, { uuid: B }]);
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([C, A, B]);
  });

  it('uses primary weights and preserves every authorized field without importing auxiliary nodes', async () => {
    const a = Object.freeze(node(A, { weight: 5, hidden: true }));
    const b = Object.freeze(node(B, { weight: -2 }));
    const c = Object.freeze(node(C, { weight: 5 }));
    const metadata = Object.freeze({ [A]: a, [B]: b, [C]: c });
    const order = Object.freeze([
      Object.freeze({ ...a, weight: -999, name: 'Wrong metadata', hidden: false, ipv4: '' }),
      Object.freeze({ uuid: C, weight: 99 }),
      Object.freeze({ uuid: B, weight: 999 }),
      Object.freeze(node(EXTRA, { hidden: true })),
    ]);
    const rpc = mockNodes(metadata, order);

    const nodes = await apiService.getNodes();

    expect(nodes).toStrictEqual([b, a, c]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['common:getNodes', 'public:getNodesInformation']);
    expect(metadata).toEqual({ [A]: a, [B]: b, [C]: c });
    expect(order.map(item => item.uuid)).toEqual([A, C, B, EXTRA]);
    const cached = offlineCache.getNodes()?.data;
    expect(cached?.map(item => item.uuid)).toEqual([B, A, C]);
    for (const item of cached ?? []) {
      expect(item).not.toHaveProperty('ipv4');
      expect(item).not.toHaveProperty('ipv6');
      expect(item).not.toHaveProperty('remark');
      expect(item.public_remark).toBe('Public note');
    }
  });

  it('keeps all authorized nodes when order data is partial or contains invalid and duplicate UUIDs', async () => {
    mockNodes({
      [A]: node(A, { created_at: '2026-01-01T00:00:00Z' }),
      [B]: node(B, { created_at: '2025-01-01T00:00:00Z' }),
      [C]: node(C, { created_at: '2024-01-01T00:00:00Z' }),
    }, [null, false, {}, [], { uuid: '' }, { uuid: 1 }, { uuid: EXTRA }, { uuid: A }, { uuid: A }]);
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([A, C, B]);
  });

  it.each([
    { label: 'missing', order: undefined },
    { label: 'null', order: null },
    { label: 'empty', order: [] },
    { label: 'map instead of array', order: { [A]: { uuid: A } } },
    { label: 'malformed', order: [{ uuid: null }, { uuid: 'wrong-id' }] },
  ])('uses fresh main metadata with stable fallback for $label order data', async ({ order }) => {
    mockNodes({
      [A]: node(A, { created_at: '2026-01-01T00:00:00Z' }),
      [B]: node(B, { created_at: '2025-01-01T00:00:00Z' }),
      [C]: node(C, { created_at: 'invalid' }),
    }, order);
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([B, A, C]);
    expect(offlineCache.getNodes()?.data.map(item => item.uuid)).toEqual([B, A, C]);
  });

  it.each(['RPC Error -32601: method not found', 'Forbidden', 'Offline'])(
    'does not discard live metadata or serve stale cache when only the order RPC fails: %s', async message => {
      offlineCache.setNodes([node(EXTRA)]);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockNodes({
        [A]: node(A, { weight: 10 }),
        [B]: node(B, { weight: -1 }),
      }, new Error(message));
      expect(await apiService.getNodes()).toStrictEqual([node(B, { weight: -1 }), node(A, { weight: 10 })]);
      expect(offlineCache.getNodes()?.data.map(item => item.uuid)).toEqual([B, A]);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'array', metadata: [node(A), node(B)], expected: [B, A] },
    { label: 'singleton', metadata: node(A), expected: [A] },
    { label: 'UUID-map key fallback', metadata: { [A]: { name: 'Same name' }, [B]: { name: 'Same name' } }, expected: [B, A] },
  ])('keeps the existing $label main-payload normalization compatible', async ({ metadata, expected }) => {
    mockNodes(metadata, [{ uuid: B }, { uuid: A }]);
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual(expected);
  });

  it.each([
    { label: 'array', metadata: [] },
    { label: 'map', metadata: {} },
  ])('replaces stale cache with an authorized empty $label even if the order RPC has nodes', async ({ metadata }) => {
    offlineCache.setNodes([node(EXTRA)]);
    mockNodes(metadata, [node(A), node(EXTRA)]);
    expect(await apiService.getNodes()).toEqual([]);
    expect(offlineCache.getNodes()?.data).toEqual([]);
  });

  it.each([null, undefined])('returns the unchanged cached snapshot for missing main payload %s', async metadata => {
    offlineCache.setNodes([node(B, { weight: 5 }), node(A, { weight: -1 })]);
    const before = offlineCache.getNodes();
    mockNodes(metadata, [{ uuid: A }, { uuid: B }, { uuid: EXTRA }]);
    expect(await apiService.getNodes()).toEqual(before?.data);
    expect(offlineCache.getNodes()).toEqual(before);
  });

  it('returns the unchanged safe cache when the main RPC fails even if the order RPC succeeds', async () => {
    offlineCache.setNodes([node(B), node(A)]);
    const before = offlineCache.getNodes();
    const error = new Error('Main metadata unavailable');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNodes(error, [node(EXTRA), node(A), node(B)]);
    expect(await apiService.getNodes()).toEqual(before?.data);
    expect(offlineCache.getNodes()).toEqual(before);
    expect(log).toHaveBeenCalledWith('RPC2 getNodes failed:', error);
  });

  it.each([
    { label: 'missing', metadata: undefined },
    { label: 'null', metadata: null },
    { label: 'rejected', metadata: new Error('Offline') },
  ])('returns an empty list when the main response is $label and no snapshot exists', async ({ metadata }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNodes(metadata, [node(EXTRA)]);
    expect(await apiService.getNodes()).toEqual([]);
    expect(offlineCache.getNodes()).toBeNull();
  });

  it('starts both reads in parallel and deduplicates the pair for concurrent callers', async () => {
    const metadata = deferred<unknown>();
    const order = deferred<unknown>();
    const rpc = mockNodes(metadata.promise, order.promise);
    const first = apiService.getNodes();
    const second = apiService.getNodes();
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['common:getNodes', 'public:getNodesInformation']);
    order.resolve([{ uuid: B }, { uuid: A }]);
    metadata.resolve({ [A]: node(A), [B]: node(B) });
    const [a, b] = await Promise.all([first, second]);
    expect(a.map(item => item.uuid)).toEqual([B, A]);
    expect(b).toBe(a);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('refreshes array ranks and primary weights rather than freezing the first successful order', async () => {
    const metadata = { [A]: node(A), [B]: node(B) };
    const order = [{ uuid: A }, { uuid: B }];
    const rpc = mockNodes(metadata, order);
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([A, B]);
    order.reverse();
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([B, A]);
    metadata[A].weight = -1;
    expect((await apiService.getNodes()).map(item => item.uuid)).toEqual([A, B]);
    expect(offlineCache.getNodes()?.data.map(item => item.uuid)).toEqual([A, B]);
    expect(rpc).toHaveBeenCalledTimes(6);
  });
});
