#!/usr/bin/env node
/**
 * Read-only development gateway for a real Komari instance.
 *
 * `vite dev` proxies /api here instead of straight to the server, so a theme that is still
 * being written can never change the instance it borrows data from:
 *   - Cookie / Authorization are removed from every request, Set-Cookie from every response,
 *     so the upstream always sees an anonymous visitor;
 *   - only GET/HEAD on public REST paths and POST /api/rpc2 with read-only RPC methods pass;
 *   - everything else (admin API, uploads, WebSocket upgrades, unknown RPC methods) is
 *     answered here and never reaches the upstream.
 * Listens on loopback only. No dependencies.
 */
import http from "node:http";

const UPSTREAM = new URL(process.env.KOMARI_UPSTREAM || "http://127.0.0.1:25774");
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.GATEWAY_PORT || "25780", 10);
const MAX_BODY = 256 * 1024;

const GET_ALLOW = [
  /^\/api\/public$/,
  /^\/api\/nodes$/,
  /^\/api\/version$/,
  /^\/api\/me$/,
  /^\/api\/recent\/[0-9a-zA-Z-]{8,64}$/,
  /^\/api\/records\/(load|ping)$/,
  /^\/api\/task\/ping$/,
];

const RPC_ALLOW = new Set([
  "common:getNodes",
  "common:getNodesLatestStatus",
  "common:getNodeRecentStatus",
  "common:getRecords",
  "common:getPublicInfo",
  "common:getMe",
  "common:getVersion",
  "public:getPublicSettings",
  "public:getPublicPingTasks",
  "public:listMetricDefinitions",
  "public:queryMetrics",
  "public:getPingMetricStats",
  "public:getNodesInformation",
  "public:getPingRecords",
  "public:getRecordsByUUID",
  "public:getClientRecentRecords",
  "public:getMe",
  "public:getVersion",
]);

const STRIP_REQUEST = new Set(["cookie", "authorization", "proxy-authorization", "x-api-key"]);
const stats = { forwarded: 0, blocked: 0 };

function log(kind, detail) {
  console.log(`${new Date().toISOString()} ${kind} ${detail}`);
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length });
  res.end(data);
}

function block(res, req, reason) {
  stats.blocked += 1;
  log("BLOCK", `${req.method} ${req.url.split("?")[0]} — ${reason}`);
  sendJson(res, 403, { status: "error", message: `blocked by read-only dev gateway: ${reason}`, data: null });
}

function forward(req, res, body) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (STRIP_REQUEST.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  headers.host = UPSTREAM.host;
  delete headers.origin;
  delete headers.referer;
  if (body) headers["content-length"] = String(body.length);

  const upstream = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || 80,
      method: req.method,
      path: req.url,
      headers,
      timeout: 30_000,
    },
    (up) => {
      const out = { ...up.headers };
      delete out["set-cookie"];
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", (err) => {
    if (!res.headersSent) sendJson(res, 502, { status: "error", message: `gateway: ${err.message}`, data: null });
    else res.destroy();
  });
  stats.forwarded += 1;
  upstream.end(body);
}

/** Resolves with the body, or with null once it exceeds MAX_BODY (the rest is discarded, never buffered). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function rpcError(id, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } };
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  if (req.method === "GET" || req.method === "HEAD") {
    if (GET_ALLOW.some((re) => re.test(path))) return forward(req, res, null);
    return block(res, req, "path is not on the public read list");
  }

  if (req.method === "POST" && path === "/api/rpc2") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return block(res, req, err.message);
    }
    if (body === null) {
      res.setHeader("connection", "close");
      return block(res, req, "request body too large");
    }
    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return block(res, req, "invalid JSON");
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const denied = calls.filter((call) => !call || typeof call.method !== "string" || !RPC_ALLOW.has(call.method));
    if (denied.length === 0) return forward(req, res, body);

    stats.blocked += 1;
    log("BLOCK", `rpc ${denied.map((call) => String(call?.method)).join(", ")}`);
    const reply = calls.map((call) =>
      rpcError(call?.id, `blocked by read-only dev gateway: ${String(call?.method)}`),
    );
    return sendJson(res, 200, Array.isArray(payload) ? reply : reply[0]);
  }

  return block(res, req, "method is not allowed");
});

// Live channels are not relayed: the theme falls back to HTTP polling, which is read-only above.
server.on("upgrade", (req, socket) => {
  stats.blocked += 1;
  log("BLOCK", `upgrade ${String(req.url).split("?")[0]}`);
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
});

server.listen(PORT, HOST, () => {
  log("READY", `http://${HOST}:${PORT} -> ${UPSTREAM.origin} (read-only, anonymous)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("STOP", `forwarded=${stats.forwarded} blocked=${stats.blocked}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
