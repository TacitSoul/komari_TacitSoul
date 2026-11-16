/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  JSONRPC2Request,
  JSONRPC2Response,
  JSONRPC2BatchRequest,
  JSONRPC2BatchResponse,
  RPC2ConnectionStateType,
  RPC2ConnectionOptions,
  RPC2CallOptions,
  RPC2EventListeners,
} from "./types";
import { RPC2ConnectionState, RPC2ResponseError } from "./types";

/** One signal that aborts when any of the given signals does. */
function combineSignals(signals: AbortSignal[]): AbortSignal | undefined {
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * RPC2 Client
 * Supports JSON-RPC 2.0 calls via WebSocket and HTTP POST
 */
export class RPC2Client {
  private _ws: WebSocket | null = null;
  private connectionState: RPC2ConnectionStateType = RPC2ConnectionState.DISCONNECTED;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }>();
  private reconnectAttempts = 0;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private eventListeners: RPC2EventListeners = {};

  private readonly baseUrl: string;
  private readonly options: Required<RPC2ConnectionOptions>;

  constructor(
    baseUrl = "/api/rpc2",
    options: RPC2ConnectionOptions = {}
  ) {
    this.baseUrl = baseUrl;
    this.options = {
      autoConnect: true,
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      requestTimeout: 30000,
      enableHeartbeat: true,
      heartbeatInterval: 15000,
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    };

    if (this.options.autoConnect) {
      this.autoConnect();
    }
  }

  /** Get current connection state */
  get state(): RPC2ConnectionStateType {
    return this.connectionState;
  }

  /** Get internal WebSocket instance (for WebSocketStatus component compatibility) */
  get ws(): WebSocket | null {
    return this._ws;
  }

  /** Set event listeners */
  setEventListeners(listeners: RPC2EventListeners): void {
    this.eventListeners = { ...this.eventListeners, ...listeners };
  }

  /** Establish WebSocket connection */
  async connect(): Promise<void> {
    if (this.connectionState === RPC2ConnectionState.CONNECTED ||
        this.connectionState === RPC2ConnectionState.CONNECTING) {
      return;
    }

    this.setConnectionState(RPC2ConnectionState.CONNECTING);

    try {
      const wsUrl = this.getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      this._ws = ws;
      this.setupWebSocketHandlers();

      await new Promise<void>((resolve, reject) => {
        const handleOpen = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error("WebSocket connection failed"));
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("WebSocket connection timeout"));
        }, 10000);

        const cleanup = () => {
          clearTimeout(timeout);
          ws.removeEventListener("open", handleOpen);
          ws.removeEventListener("error", handleError);
        };

        ws.addEventListener("open", handleOpen, { once: true });
        ws.addEventListener("error", handleError, { once: true });
      });
    } catch (error) {
      this.setConnectionState(RPC2ConnectionState.ERROR);
      this.eventListeners.onError?.(error as Error);
      throw error;
    }
  }

  /** Auto-connect (non-blocking) */
  private autoConnect(): void {
    if (this.connectionState !== RPC2ConnectionState.DISCONNECTED) {
      return;
    }

    this.connect().catch((error) => {
      console.warn("RPC2 auto-connect failed:", error.message);
    });
  }

  /** Disconnect WebSocket */
  disconnect(): void {
    this.options.autoReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this.setConnectionState(RPC2ConnectionState.DISCONNECTED);
    this.clearPendingRequests(new Error("Connection closed"));
  }

  /** Call RPC method via WebSocket */
  async callViaWebSocket<TParams = any, TResult = any>(
    method: string,
    params?: TParams,
    options: RPC2CallOptions = {}
  ): Promise<TResult> {
    if (this.connectionState !== RPC2ConnectionState.CONNECTED) {
      throw new Error("WebSocket not connected");
    }

    const request: JSONRPC2Request<TParams> = {
      jsonrpc: "2.0",
      method,
      params,
      id: options.notification ? undefined : this.generateRequestId(),
    };

    if (options.notification) {
      this.sendMessage(request);
      return undefined as TResult;
    }

    const signal = options.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    return new Promise<TResult>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pendingRequests.get(request.id!);
        if (pending?.timeout) clearTimeout(pending.timeout);
        this.pendingRequests.delete(request.id!);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const detach = () => signal?.removeEventListener("abort", onAbort);

      const timeout = setTimeout(() => {
        detach();
        this.pendingRequests.delete(request.id!);
        reject(new Error(`Request timeout: ${method}`));
      }, options.timeout || this.options.requestTimeout);

      this.pendingRequests.set(request.id!, {
        resolve: (value) => {
          detach();
          resolve(value);
        },
        reject: (reason) => {
          detach();
          reject(reason);
        },
        timeout,
      });
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        this.sendMessage(request);
      } catch (error) {
        clearTimeout(timeout);
        detach();
        this.pendingRequests.delete(request.id!);
        reject(error);
      }
    });
  }

  /** Call RPC method via HTTP POST */
  async callViaHTTP<TParams = any, TResult = any>(
    method: string,
    params?: TParams,
    options: RPC2CallOptions = {}
  ): Promise<TResult> {
    const request: JSONRPC2Request<TParams> = {
      jsonrpc: "2.0",
      method,
      params,
      id: options.notification ? undefined : this.generateRequestId(),
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.options.headers,
        body: JSON.stringify(request),
        signal: combineSignals([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(options.timeout ?? this.options.requestTimeout),
        ]),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (options.notification) {
        return undefined as TResult;
      }

      const jsonResponse: JSONRPC2Response<TResult> = await response.json();

      if ("error" in jsonResponse) {
        throw new RPC2ResponseError(jsonResponse.error);
      }

      return jsonResponse.result;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Request failed: ${method}`);
    }
  }

  /** Batch call (HTTP only) */
  async batchCall(requests: Array<{
    method: string;
    params?: any;
    notification?: boolean;
  }>): Promise<any[]> {
    const batchRequest: JSONRPC2BatchRequest = requests.map(req => ({
      jsonrpc: "2.0",
      method: req.method,
      params: req.params,
      id: req.notification ? undefined : this.generateRequestId(),
    }));

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.options.headers,
        body: JSON.stringify(batchRequest),
        signal: AbortSignal.timeout(this.options.requestTimeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonResponse: JSONRPC2BatchResponse = await response.json();

      return jsonResponse.map(res => {
        if ("error" in res) {
          throw new RPC2ResponseError(res.error);
        }
        return res.result;
      });
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Batch request failed");
    }
  }

  /** Auto-select call method (prefer WebSocket) */
  async call<TParams = any, TResult = any>(
    method: string,
    params?: TParams,
    options: RPC2CallOptions = {}
  ): Promise<TResult> {
    if (this.options.autoConnect &&
        this.connectionState === RPC2ConnectionState.DISCONNECTED) {
      this.autoConnect();
    }

    if (this.connectionState === RPC2ConnectionState.CONNECTED) {
      try {
        return await this.callViaWebSocket(method, params, options);
      } catch (error) {
        // The server already answered (with an error), or the caller gave up:
        // replaying the same call over HTTP cannot change the outcome.
        if (error instanceof RPC2ResponseError || options.signal?.aborted) throw error;
        return this.callViaHTTP(method, params, options);
      }
    }

    return this.callViaHTTP(method, params, options);
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}${this.baseUrl}`;
  }

  private setupWebSocketHandlers(): void {
    const ws = this._ws;
    if (!ws) return;

    ws.onopen = () => {
      if (this._ws !== ws) return;
      this.setConnectionState(RPC2ConnectionState.CONNECTED);
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.eventListeners.onConnect?.();
    };

    ws.onmessage = (event) => {
      if (this._ws !== ws) return;
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
        this.eventListeners.onMessage?.(data);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      // A delayed close from an old socket must not clear the new socket's calls.
      if (this._ws !== ws) return;
      this.setConnectionState(RPC2ConnectionState.DISCONNECTED);
      this.stopHeartbeat();
      this.clearPendingRequests(new Error("WebSocket connection closed"));
      this.eventListeners.onDisconnect?.();

      if (this.options.autoReconnect &&
          this.reconnectAttempts < this.options.maxReconnectAttempts) {
        this.attemptReconnect();
      }
    };

    ws.onerror = (error) => {
      if (this._ws !== ws) return;
      console.error("WebSocket error:", error);
      this.eventListeners.onError?.(new Error("WebSocket connection error"));
    };
  }

  private handleMessage(data: JSONRPC2Response): void {
    if (!data.id) return;

    const pending = this.pendingRequests.get(data.id);
    if (!pending) return;

    this.pendingRequests.delete(data.id);

    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    if ("error" in data) {
      pending.reject(new RPC2ResponseError(data.error));
    } else {
      pending.resolve(data.result);
    }
  }

  private sendMessage(message: JSONRPC2Request): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this._ws.send(JSON.stringify(message));
  }

  private setConnectionState(state: RPC2ConnectionStateType): void {
    this.connectionState = state;
  }

  private generateRequestId(): number {
    return ++this.requestId;
  }

  private clearPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /** Start heartbeat */
  private startHeartbeat(): void {
    if (!this.options.enableHeartbeat) {
      return;
    }

    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try {
          const heartbeatRequest: JSONRPC2Request = {
            jsonrpc: "2.0",
            method: "rpc.ping",
            params: { timestamp: Date.now() }
          };
          this._ws.send(JSON.stringify(heartbeatRequest));
        } catch (error) {
          console.warn("Failed to send heartbeat:", error);
        }
      }
    }, this.options.heartbeatInterval);
  }

  /** Stop heartbeat */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private attemptReconnect(): void {
    this.reconnectAttempts++;
    this.setConnectionState(RPC2ConnectionState.RECONNECTING);
    this.eventListeners.onReconnecting?.(this.reconnectAttempts);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect failure triggers onclose, which may retry or stop
      });
    }, this.options.reconnectInterval);
  }

  /** Reset and reconnect — re-enable auto-reconnect and connect */
  reconnect(): void {
    this.disconnect();
    this.options.autoReconnect = true;
    this.reconnectAttempts = 0;
    this.connect().catch((error) => {
      console.warn("RPC2 reconnect failed:", error.message);
    });
  }
}
