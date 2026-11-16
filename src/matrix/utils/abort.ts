interface ManagedTimeoutSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

function createTimeoutSignal(
  sources: readonly (AbortSignal | null | undefined)[],
  ms: number,
): ManagedTimeoutSignal {
  const controller = new AbortController();
  const upstreams = [...new Set(sources.filter((source): source is AbortSignal => Boolean(source)))];
  const delay = Math.max(0, Number.isFinite(ms) ? ms : 0);
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== undefined) globalThis.clearTimeout(timer);
    for (const upstream of upstreams) {
      upstream.removeEventListener("abort", onUpstreamAbort);
    }
  };

  function onUpstreamAbort(event: Event) {
    const upstream = event.currentTarget as AbortSignal;
    cleanup();
    if (!controller.signal.aborted) controller.abort(upstream.reason);
  }

  const abortedSource = upstreams.find((upstream) => upstream.aborted);
  if (abortedSource) {
    controller.abort(abortedSource.reason);
  } else {
    timer = globalThis.setTimeout(() => {
      cleanup();
      if (!controller.signal.aborted) controller.abort();
    }, delay);
    for (const upstream of upstreams) {
      upstream.addEventListener("abort", onUpstreamAbort, { once: true });
    }
  }

  return { signal: controller.signal, cleanup };
}

export async function withTimeoutSignal<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  upstream?: AbortSignal,
): Promise<T> {
  const managed = createTimeoutSignal([upstream], ms);
  try {
    return await operation(managed.signal);
  } finally {
    managed.cleanup();
  }
}

async function fetchAndReadWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  upstream: AbortSignal | undefined,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const requestSignal =
    typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined;
  const effectiveRequestSignal =
    init?.signal !== undefined ? init.signal : requestSignal;
  const { signal, cleanup } = createTimeoutSignal([upstream, effectiveRequestSignal], ms);
  try {
    const response = await fetch(input, { ...init, signal });
    return await read(response);
  } finally {
    cleanup();
  }
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  upstream?: AbortSignal,
): Promise<Response> {
  return fetchAndReadWithTimeout(input, init, ms, upstream, async (response) => response);
}

export function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  upstream?: AbortSignal,
): Promise<{ response: Response; json: unknown }> {
  return fetchAndReadWithTimeout(input, init, ms, upstream, async (response) => ({
    response,
    // HTTP errors are handled by the caller without waiting for an optional body.
    json: response.ok ? await response.json() : undefined,
  }));
}
