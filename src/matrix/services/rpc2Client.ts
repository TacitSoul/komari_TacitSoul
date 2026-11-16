/**
 * RPC entry point for the matrix data layer.
 *
 * Every call goes through the base theme's
 * single `rpc2Client`, so the page keeps one RPC connection and one reconnect policy.
 * Only the error type the matrix code branches on is translated.
 */
import { rpc2Client, RPC2ResponseError } from "@/lib/rpc2";

type RpcCallOptions = {
  timeout?: number;
  signal?: AbortSignal;
};

/** The server rejected the call. Must not be replayed over another transport. */
export class RpcResponseError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcResponseError";
  }
}

const client = {
  async call<TParams = Record<string, unknown>, TResult = unknown>(
    method: string,
    params?: TParams,
    options: RpcCallOptions = {},
  ): Promise<TResult> {
    try {
      return await rpc2Client.call<TParams, TResult>(method, params, options);
    } catch (error) {
      if (error instanceof RPC2ResponseError) {
        throw new RpcResponseError(error.message, error.code);
      }
      throw error;
    }
  },
};

export function getRpc2Client() {
  return client;
}
