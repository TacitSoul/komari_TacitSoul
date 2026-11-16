import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcCall = vi.hoisted(() => vi.fn());
vi.mock("@/matrix/services/rpc2Client", () => ({
  getRpc2Client: () => ({ call: rpcCall }),
  RpcResponseError: class extends Error {},
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  rpcCall.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("matrix API timeout integration", () => {
  it("bounds shared task-name lookup, preserves latency records, and retries after failure", async () => {
    let taskRequests = 0;
    let taskSignal: AbortSignal | undefined;
    rpcCall.mockImplementation(async (method: string, _params: unknown, options?: { signal?: AbortSignal }) => {
      if (method === "public:getPublicPingTasks") {
        taskRequests += 1;
        if (taskRequests > 1) return [{ id: 7, name: "Recovered probe", clients: ["a"] }];
        taskSignal = options!.signal!;
        return new Promise((_resolve, reject) => {
          taskSignal!.addEventListener("abort", () => reject(taskSignal!.reason), { once: true });
        });
      }
      if (method === "public:queryMetrics") {
        return { series: [{
          metric_key: "ping.latency_ms", entity_id: "a", tags: { task_id: "7" },
          interval_seconds: 0,
          points: [{ time: "2026-01-01T11:59:00Z", value: 42, count: 1 }],
        }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const { getPingOverview } = await import("./api");
    const first = getPingOverview(1, 7, { entityIds: ["a"], includeStats: false });
    const second = getPingOverview(1, 7, { entityIds: ["a"], includeStats: false });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(taskRequests).toBe(1);
    expect(taskSignal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const results = await Promise.all([first, second]);
    expect(taskSignal!.aborted).toBe(true);
    for (const result of results) {
      expect(result.records).toMatchObject([{ task_id: 7, value: 42, count: 1 }]);
      expect(result.taskAssignmentsKnown).toBe(false);
    }
    const recovered = await getPingOverview(1, 7, { entityIds: ["a"], includeStats: false });
    expect(taskRequests).toBe(2);
    expect(recovered.tasks[0].name).toBe("Recovered probe");
    expect(recovered.records[0].value).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "cancel"])("bounds HTTP fallback response-body reads on %s", async (mode) => {
    rpcCall.mockRejectedValue(new Error("RPC unavailable"));
    let headersArrived = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      headersArrived = true;
      const signal = init!.signal!;
      return new Response(new ReadableStream({
        start(controller) {
          if (signal.aborted) controller.error(signal.reason);
          else signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      }));
    }));
    const { getPingOverview } = await import("./api");
    const upstream = new AbortController();
    const pending = getPingOverview(1, 7, { signal: upstream.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(headersArrived).toBe(true);
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(12_000);
    else upstream.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves HTTP status errors instead of trying to parse an error body", async () => {
    rpcCall.mockRejectedValue(new Error("RPC unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON", { status: 503 })));
    const { getPingOverview, ApiRequestError } = await import("./api");
    const pending = getPingOverview(1, 7);
    await expect(pending).rejects.toBeInstanceOf(ApiRequestError);
    await expect(pending).rejects.toMatchObject({ status: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
