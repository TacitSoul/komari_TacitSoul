import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout } from "./abort";

function mockBodyFetch() {
  let finish: (() => void) | undefined;
  let seen: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
    seen = init!.signal!;
    return new Response(new ReadableStream({
      start(controller) {
        const abort = () => controller.error(seen!.reason);
        if (seen!.aborted) abort();
        else seen!.addEventListener("abort", abort, { once: true });
        finish = () => {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        };
      },
    }));
  }));
  return { finish: () => finish!(), signal: () => seen! };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchJsonWithTimeout response bodies", () => {
  it("times out a body stalled after headers arrived", async () => {
    vi.useFakeTimers();
    const body = mockBodyFetch();
    const pending = fetchJsonWithTimeout("/x", undefined, 100);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(body.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(body.signal().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["upstream", "init", "request"])("cancels the body through the %s signal", async (source) => {
    vi.useFakeTimers();
    mockBodyFetch();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const input = source === "request"
      ? new Request("https://example.test/x", { signal: controller.signal })
      : "/x";
    const pending = fetchJsonWithTimeout(
      input,
      source === "init" ? { signal: controller.signal } : undefined,
      10_000,
      source === "upstream" ? controller.signal : undefined,
    );
    const reason = new DOMException("View cancelled", "AbortError");
    const assertion = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);
    await assertion;
    if (source !== "request") expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans the timer and upstream listener only after JSON finishes", async () => {
    vi.useFakeTimers();
    const body = mockBodyFetch();
    const upstream = new AbortController();
    const remove = vi.spyOn(upstream.signal, "removeEventListener");
    const pending = fetchJsonWithTimeout("/x", undefined, 10_000, upstream.signal);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    expect(remove).not.toHaveBeenCalled();
    body.finish();
    await expect(pending).resolves.toMatchObject({ json: { ok: true } });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    upstream.abort();
    expect(body.signal().aborted).toBe(false);
  });

  it("cleans up on invalid JSON and network failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json")));
    await expect(fetchJsonWithTimeout("/x", undefined, 10_000)).rejects.toBeInstanceOf(SyntaxError);
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    await expect(fetchJsonWithTimeout("/x", undefined, 10_000)).rejects.toThrow("network down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns HTTP errors without waiting for their optional body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream(), { status: 503 })));
    await expect(fetchJsonWithTimeout("/x", undefined, 100)).resolves.toMatchObject({ response: { status: 503 }, json: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
