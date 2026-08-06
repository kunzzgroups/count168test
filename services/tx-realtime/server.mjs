/**
 * App-wide realtime SSE hub (invalidate bus).
 *
 * - GET  /sse?ticket=...          → EventSource stream (ticket from PHP)
 * - POST /publish                 → PHP fanout (X-Realtime-Secret)
 * - GET  /health                  → liveness
 *
 * Events: ledger_changed (legacy TX) | domain_changed (accounts, processes, …)
 * Optional Redis (REDIS_URL): PUBLISH on /publish + SUBSCRIBE for multi-instance.
 * Single EC2: in-memory fanout works without Redis.
 */

const ALLOWED_EVENT_TYPES = new Set(["ledger_changed", "domain_changed"]);

import http from "node:http";
import { createClient } from "redis";
import { createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.TX_REALTIME_PORT || 3911);
const HOST = process.env.TX_REALTIME_HOST || "127.0.0.1";
const SECRET = String(process.env.TX_REALTIME_SECRET || "").trim();
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
const REDIS_CHANNEL = "tx:ledger";

/** @type {Map<string, Set<http.ServerResponse>>} */
const channelClients = new Map();

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from((s + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function verifyTicket(ticket) {
  if (!SECRET || !ticket || typeof ticket !== "string") return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", SECRET).update(body).digest();
  let got;
  try {
    got = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
  const channels = Array.isArray(payload.channels)
    ? payload.channels.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  if (channels.length === 0) return null;
  return { channels, uid: payload.uid };
}

function addClient(channels, res) {
  for (const ch of channels) {
    if (!channelClients.has(ch)) channelClients.set(ch, new Set());
    channelClients.get(ch).add(res);
  }
}

function removeClient(channels, res) {
  for (const ch of channels) {
    const set = channelClients.get(ch);
    if (!set) continue;
    set.delete(res);
    if (set.size === 0) channelClients.delete(ch);
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function fanoutLocal(channels, payload) {
  const eventName =
    payload?.type && ALLOWED_EVENT_TYPES.has(payload.type)
      ? payload.type
      : "domain_changed";
  const seen = new Set();
  for (const ch of channels) {
    const set = channelClients.get(ch);
    if (!set) continue;
    for (const res of set) {
      if (seen.has(res)) continue;
      seen.add(res);
      try {
        writeSse(res, eventName, payload);
      } catch {
        /* drop broken socket on next cleanup */
      }
    }
  }
  return seen.size;
}

let redisPub = null;
let redisSub = null;

async function initRedis() {
  if (!REDIS_URL) {
    console.log("[tx-realtime] Redis disabled (no REDIS_URL); in-memory fanout only");
    return;
  }
  try {
    redisPub = createClient({ url: REDIS_URL });
    redisSub = redisPub.duplicate();
    redisPub.on("error", (e) => console.error("[tx-realtime] redisPub", e.message));
    redisSub.on("error", (e) => console.error("[tx-realtime] redisSub", e.message));
    await redisPub.connect();
    await redisSub.connect();
    await redisSub.subscribe(REDIS_CHANNEL, (message) => {
      try {
        const payload = JSON.parse(message);
        const channels = Array.isArray(payload?.channels) ? payload.channels : [];
        if (channels.length) fanoutLocal(channels, payload);
      } catch (e) {
        console.error("[tx-realtime] redis message", e.message);
      }
    });
    console.log("[tx-realtime] Redis connected, subscribed", REDIS_CHANNEL);
  } catch (e) {
    console.error("[tx-realtime] Redis init failed, continuing in-memory only:", e.message);
    redisPub = null;
    redisSub = null;
  }
}

async function publishEvent(payload) {
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  if (!channels.length) return { delivered: 0 };

  // Always fanout locally first (single-node / same process).
  const delivered = fanoutLocal(channels, payload);

  if (redisPub?.isReady) {
    try {
      await redisPub.publish(REDIS_CHANNEL, JSON.stringify(payload));
    } catch (e) {
      console.error("[tx-realtime] redis publish", e.message);
    }
  }

  return { delivered };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      clients: [...channelClients.values()].reduce((n, s) => n + s.size, 0),
      redis: Boolean(redisPub?.isReady),
    });
  }

  if (req.method === "POST" && url.pathname === "/publish") {
    if (!SECRET) {
      return sendJson(res, 503, { ok: false, error: "TX_REALTIME_SECRET not set" });
    }
    const hdr = String(req.headers["x-realtime-secret"] || "");
    const a = Buffer.from(hdr);
    const b = Buffer.from(SECRET);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return sendJson(res, 403, { ok: false, error: "forbidden" });
    }
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      if (!payload || !ALLOWED_EVENT_TYPES.has(String(payload.type || ""))) {
        return sendJson(res, 400, { ok: false, error: "invalid payload" });
      }
      const result = await publishEvent(payload);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || "bad request" });
    }
  }

  if (req.method === "GET" && url.pathname === "/sse") {
    if (!SECRET) {
      return sendJson(res, 503, { ok: false, error: "TX_REALTIME_SECRET not set" });
    }
    const ticket = url.searchParams.get("ticket") || "";
    const verified = verifyTicket(ticket);
    if (!verified) {
      return sendJson(res, 401, { ok: false, error: "invalid or expired ticket" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    writeSse(res, "ready", { channels: verified.channels, uid: verified.uid });

    addClient(verified.channels, res);
    // Cloudflare / proxies idle-cut long streams; keep under ~20s.
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeClient(verified.channels, res);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
});

await initRedis();

if (!SECRET) {
  console.warn("[tx-realtime] WARNING: TX_REALTIME_SECRET is empty — publish/sse will reject");
}

server.listen(PORT, HOST, () => {
  console.log(`[tx-realtime] listening http://${HOST}:${PORT}`);
});
