#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { computeLifecycleLatest } = require("./lifecycle");

const PORT = Number(process.env.PORT || 8787);
const AGENT_FORWARD_URL = process.env.AGENT_FORWARD_URL || "";
const AGENT_FORWARD_BEARER = process.env.AGENT_FORWARD_BEARER || "";
const AGENT_INBOX_DIR = process.env.AGENT_INBOX_DIR || "";
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const MAX_EVENTS_READ = Number(process.env.MAX_EVENTS_READ || 200);
const MAX_EVENTS_FILE_BYTES = Number(process.env.MAX_EVENTS_FILE_BYTES || 5_000_000);

const REQUIRED_FIELDS = [
  "symbol",
  "timeframe",
  "bar_time",
  "setup_id",
  "pattern_type",
  "setup_stage",
  "pattern_bias",
  "pattern_confirmed",
  "fib_significance",
  "macd_hist",
  "squeeze_release",
  "rsi",
  "score",
  "confluence",
  "bias"
];

const workspaceRoot = process.cwd();
const eventsDir = path.join(workspaceRoot, "webhook", "data");
const eventsPath = path.join(eventsDir, "events.ndjson");
const eventsBackupPath = path.join(eventsDir, "events.prev.ndjson");
const latestPath = path.join(eventsDir, "latest.json");

function ensureDataDir() {
  fs.mkdirSync(eventsDir, { recursive: true });
}

function ensureInboxDir() {
  if (!AGENT_INBOX_DIR) return;
  fs.mkdirSync(AGENT_INBOX_DIR, { recursive: true });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function parseJson(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function maybeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePayload(payload) {
  return {
    ...payload,
    score: maybeNumber(payload.score, 0),
    rsi: maybeNumber(payload.rsi),
    macd_hist: maybeNumber(payload.macd_hist),
    close: maybeNumber(payload.close),
    confluence: payload.confluence || "LOW",
    bias: payload.bias || "NEUTRAL",
    auto_pattern: payload.auto_pattern || "none",
    auto_pattern_conf: maybeNumber(payload.auto_pattern_conf, 0),
    setup_id: String(payload.setup_id || "setup_unknown"),
    symbol: String(payload.symbol || "UNKNOWN")
  };
}

function validatePayload(payload) {
  const missing = [];
  for (const key of REQUIRED_FIELDS) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
      missing.push(key);
    }
  }
  return missing;
}

function inferMismatchFlags(payload) {
  const flags = [];
  if (!payload.taxonomy_version) flags.push("taxonomy_incomplete");
  if (!payload.pattern_type || payload.pattern_type === "other") flags.push("pattern_unspecified");
  if (payload.fib_significance === "NONE") flags.push("no_fib_confluence");
  if (payload.pattern_confirmed === false && payload.confluence === "HIGH") flags.push("confidence_vs_pattern_conflict");
  if (payload.pattern_bias === "bullish" && payload.bias === "BEARISH") flags.push("bias_conflict");
  if (payload.pattern_bias === "bearish" && payload.bias === "BULLISH") flags.push("bias_conflict");
  return flags;
}

function buildAgentPacket(event) {
  const p = event.payload;
  const reasons = [];
  if (p.pattern_confirmed) reasons.push("manual_pattern_confirmed");
  if (p.auto_pattern && p.auto_pattern !== "none") reasons.push(`auto_pattern:${p.auto_pattern}`);
  if (p.fib_significance && p.fib_significance !== "NONE") reasons.push(`fib:${p.fib_significance}`);
  if (p.near_entry) reasons.push("near_entry");
  if (p.squeeze_release) reasons.push("squeeze_release");
  if (p.macd_bull_expand || p.macd_bear_expand) reasons.push("macd_expand");

  return {
    source: "tradingview_webhook",
    received_at: event.received_at,
    event_id: event.event_id,
    setup_id: p.setup_id,
    symbol: p.symbol,
    timeframe: p.timeframe,
    stage: p.setup_stage,
    bias: p.bias,
    confluence: p.confluence,
    score: p.score,
    pattern: {
      manual_type: p.pattern_type,
      manual_bias: p.pattern_bias,
      manual_confirmed: !!p.pattern_confirmed,
      auto_type: p.auto_pattern,
      auto_conf: p.auto_pattern_conf,
      auto_bias: p.auto_pattern_bias || "neutral",
      auto_aligned: !!p.auto_pattern_aligned
    },
    levels: {
      entry: p.entry_price,
      stop: p.stop_price,
      tp1: p.tp1_price,
      tp2: p.tp2_price,
      tp3: p.tp3_price,
      near_entry: !!p.near_entry,
      hit_entry: !!p.hit_entry,
      hit_stop: !!p.hit_stop,
      hit_tp1: !!p.hit_tp1,
      hit_tp2: !!p.hit_tp2,
      hit_tp3: !!p.hit_tp3
    },
    momentum: {
      rsi: p.rsi,
      macd_hist: p.macd_hist,
      squeeze_release: !!p.squeeze_release
    },
    mismatch_flags: event.mismatch_flags,
    missing_fields: event.missing_fields,
    accepted: event.accepted,
    reasons
  };
}

async function forwardToAgent(event, agentPacket) {
  if (!AGENT_FORWARD_URL) return { forwarded: false };
  const headers = { "Content-Type": "application/json" };
  if (AGENT_FORWARD_BEARER) {
    headers.Authorization = `Bearer ${AGENT_FORWARD_BEARER}`;
  }

  const res = await fetch(AGENT_FORWARD_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      event,
      agent_packet: agentPacket
    })
  });

  const text = await res.text();
  return {
    forwarded: true,
    status: res.status,
    ok: res.ok,
    response: text.slice(0, 3000)
  };
}

function writeEvent(event) {
  ensureDataDir();
  rotateEventsIfNeeded();
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(event, null, 2), "utf8");
}

function rotateEventsIfNeeded() {
  if (!fs.existsSync(eventsPath)) return;
  const size = fs.statSync(eventsPath).size;
  if (size < MAX_EVENTS_FILE_BYTES) return;

  if (fs.existsSync(eventsBackupPath)) {
    fs.unlinkSync(eventsBackupPath);
  }
  fs.renameSync(eventsPath, eventsBackupPath);
}

function writeAgentInbox(agentPacket) {
  if (!AGENT_INBOX_DIR) return null;
  ensureInboxDir();
  const safeSetup = agentPacket.setup_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const filename = `${Date.now()}_${safeSetup}.json`;
  const fullPath = path.join(AGENT_INBOX_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(agentPacket, null, 2), "utf8");
  return fullPath;
}

function parseNdjsonLines(raw) {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readRecentEvents(limit = 50, setupId = "") {
  if (!fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, "utf8");
  const events = parseNdjsonLines(raw);
  const filtered = setupId ? events.filter((e) => e?.payload?.setup_id === setupId) : events;
  return filtered.slice(-limit).reverse();
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, statusCode, body) {
  withCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  console.log(`[http] id=${requestId} method=${req.method} path=${parsedUrl.pathname} ip=${sourceIp}`);

  if (req.method === "OPTIONS") {
    withCors(res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && parsedUrl.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "tv-webhook-receiver",
      ts: new Date().toISOString()
    });
  }

  if (req.method === "GET" && parsedUrl.pathname === "/events/latest") {
    if (!fs.existsSync(latestPath)) {
      return json(res, 200, { ok: true, event: null });
    }
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    return json(res, 200, { ok: true, event: latest });
  }

  if (req.method === "GET" && parsedUrl.pathname === "/events") {
    const requestedLimit = maybeNumber(parsedUrl.searchParams.get("limit"), 50);
    const limit = Math.max(1, Math.min(requestedLimit || 50, MAX_EVENTS_READ));
    const setupId = parsedUrl.searchParams.get("setup_id") || "";
    const events = readRecentEvents(limit, setupId);
    return json(res, 200, {
      ok: true,
      count: events.length,
      events
    });
  }

  if (req.method === "GET" && parsedUrl.pathname === "/lifecycle/latest") {
    const requestedLimit = maybeNumber(parsedUrl.searchParams.get("limit"), 200);
    const limit = Math.max(1, Math.min(requestedLimit || 200, MAX_EVENTS_READ));
    const setupId = parsedUrl.searchParams.get("setup_id") || "";
    const events = readRecentEvents(limit, "").reverse();
    const lifecycle = computeLifecycleLatest(events, setupId);
    return json(res, 200, { ok: true, ...lifecycle });
  }

  const webhookPaths = new Set(["/tv-webhook", "/tv-webhook/", "/webhook", "/webhook/"]);
  if (req.method !== "POST" || !webhookPaths.has(parsedUrl.pathname)) {
    console.log(`[webhook] request_ignored id=${requestId} reason=path_or_method_mismatch`);
    return json(res, 404, { ok: false, error: "Not found" });
  }

  try {
    console.log(`[webhook] request_received id=${requestId} method=${req.method} path=${parsedUrl.pathname} ip=${sourceIp}`);

    const raw = await readBody(req);
    const parsed = parseJson(raw);
    if (!parsed.ok) {
      const preview = raw.replace(/\s+/g, " ").slice(0, 240);
      console.log(`[webhook] request_rejected id=${requestId} reason=invalid_json raw_preview="${preview}"`);
      return json(res, 400, { ok: false, error: "Invalid JSON", detail: parsed.error });
    }

    const payload = normalizePayload(parsed.data);
    const missing = validatePayload(payload);
    const mismatch_flags = inferMismatchFlags(payload);

    const event = {
      event_id: requestId,
      received_at: new Date().toISOString(),
      source: "tradingview",
      accepted: missing.length === 0,
      missing_fields: missing,
      mismatch_flags,
      payload
    };

    writeEvent(event);
    const agentPacket = buildAgentPacket(event);
    const inboxPath = writeAgentInbox(agentPacket);
    const forwardResult = await forwardToAgent(event, agentPacket);

    console.log(
      `[webhook] request_processed id=${requestId} accepted=${missing.length === 0} symbol=${payload.symbol || "na"} setup_id=${payload.setup_id || "na"} stage=${payload.setup_stage || "na"} confluence=${payload.confluence || "na"}`
    );

    return json(res, 200, {
      ok: true,
      accepted: missing.length === 0,
      missing_fields: missing,
      mismatch_flags,
      agent_packet: agentPacket,
      inbox_path: inboxPath,
      forward: forwardResult
    });
  } catch (err) {
    console.error(`[webhook] request_failed error=${err.message}`);
    return json(res, 500, { ok: false, error: "Internal error", detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[tv-webhook-receiver] listening on :${PORT}`);
  console.log(`[tv-webhook-receiver] health: http://localhost:${PORT}/health`);
  console.log(`[tv-webhook-receiver] events: GET /events/latest, GET /events?limit=50`);
  console.log("[tv-webhook-receiver] lifecycle: GET /lifecycle/latest?limit=200&setup_id=...");
  console.log("[tv-webhook-receiver] endpoints: POST /tv-webhook, /tv-webhook/, /webhook, /webhook/");
  if (AGENT_INBOX_DIR) {
    console.log(`[tv-webhook-receiver] local agent inbox: ${AGENT_INBOX_DIR}`);
  }
  if (AGENT_FORWARD_URL) {
    console.log(`[tv-webhook-receiver] forwarding to: ${AGENT_FORWARD_URL}`);
  }
});
