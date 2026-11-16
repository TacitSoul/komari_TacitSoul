import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC2Client } from './client';
import { RPC2ConnectionState, RPC2ResponseError } from './types';

class MockSocket extends EventTarget {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();

  constructor() {
    super();
    MockSocket.instances.push(this);
  }

  open() {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.readyState = 3;
  }

  serverClose() {
    this.close();
    this.onclose?.();
  }

  reply(result: unknown) {
    const request = JSON.parse(this.send.mock.calls.at(-1)![0]);
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
  }
}

function createClient(requestTimeout = 30_000) {
  return new RPC2Client('/api/rpc2', {
    autoConnect: false,
    autoReconnect: false,
    enableHeartbeat: false,
    requestTimeout,
  });
}

async function connect(client: RPC2Client) {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'example.test' } });
  vi.stubGlobal('WebSocket', MockSocket);
  const connected = client.connect();
  const socket = MockSocket.instances.at(-1)!;
  socket.open();
  await connected;
  return socket;
}

function stallFetch(body: boolean) {
  const fetchMock = vi.fn((_input: unknown, init?: RequestInit): Promise<Response> => {
    const signal = init!.signal!;
    if (!body) {
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        const abort = () => controller.error(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      },
    })));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  MockSocket.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RPC HTTP timeout', () => {
  it.each([false, true])('uses the constructor timeout with stalled body=%s', async (body) => {
    stallFetch(body);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await expect(createClient(20).call('test')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(timeout).toHaveBeenCalledWith(20);
  });

  it('defaults HTTP calls to 30000 ms and respects an explicit override', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: 7 })));
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = createClient();
    await expect(client.callViaHTTP('test')).resolves.toBe(7);
    expect(timeout).toHaveBeenLastCalledWith(30_000);
    await expect(client.callViaHTTP('test', {}, { timeout: 12 })).resolves.toBe(7);
    expect(timeout).toHaveBeenLastCalledWith(12);
    await client.callViaHTTP('test', {}, { timeout: 0 });
    expect(timeout).toHaveBeenLastCalledWith(0);
  });

  it.each([false, true])('preserves caller cancellation with stalled body=%s', async (body) => {
    stallFetch(body);
    const upstream = new AbortController();
    const reason = new DOMException('View cancelled', 'AbortError');
    const pending = createClient().callViaHTTP('test', {}, { signal: upstream.signal });
    const assertion = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    upstream.abort(reason);
    await assertion;
  });

  it('bounds batch response-body reads with the constructor timeout too', async () => {
    stallFetch(true);
    await expect(createClient(20).batchCall([{ method: 'test' }])).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('RPC socket closure', () => {
  it('rejects every pending call immediately and falls back to HTTP without advancing timers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: 'fallback' }))));
    const client = createClient();
    const socket = await connect(client);
    const first = client.call('first');
    const second = client.call('second');
    socket.serverClose();
    await expect(first).resolves.toBe('fallback');
    await expect(second).resolves.toBe('fallback');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });

  it('clears the closed socket requests before onDisconnect can start a newer connection', async () => {
    vi.useFakeTimers();
    const client = createClient();
    const oldSocket = await connect(client);
    const pending = client.callViaWebSocket('old');
    const assertion = expect(pending).rejects.toThrow('WebSocket connection closed');
    let connected: Promise<void> | undefined;
    client.setEventListeners({ onDisconnect: () => { connected = client.connect(); } });
    oldSocket.serverClose();
    const newSocket = MockSocket.instances.at(-1)!;
    newSocket.open();
    await connected;
    await assertion;
    const newer = client.callViaWebSocket('new');
    oldSocket.onclose?.();
    oldSocket.onopen?.();
    expect(client.state).toBe(RPC2ConnectionState.CONNECTED);
    newSocket.reply('new-result');
    await expect(newer).resolves.toBe('new-result');
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });

  it('ignores a delayed close after an explicit reconnect without rejecting newer requests', async () => {
    vi.useFakeTimers();
    const client = createClient();
    const oldSocket = await connect(client);
    client.reconnect();
    const newSocket = MockSocket.instances.at(-1)!;
    newSocket.open();
    await Promise.resolve();
    const pending = client.callViaWebSocket('new');
    oldSocket.serverClose();
    expect(client.state).toBe(RPC2ConnectionState.CONNECTED);
    newSocket.reply(42);
    await expect(pending).resolves.toBe(42);
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replay server RPC errors or caller cancellation over HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const client = createClient();
    const socket = await connect(client);
    const pending = client.call('bad');
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    socket.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -1, message: 'Rejected' } }) });
    await expect(pending).rejects.toBeInstanceOf(RPC2ResponseError);
    const controller = new AbortController();
    const cancelled = client.call('cancelled', {}, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    client.disconnect();
  });
});
