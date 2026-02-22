#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const TV_WEBHOOK_TOKEN = process.env.TV_WEBHOOK_TOKEN || "";
const AGENT_FORWARD_URL = process.env.AGENT_FORWARD_URL || "";
const AGENT_FORWARD_BEARER = process.env.AGENT_FORWARD_BEARER || "";

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

function ensureDataDir() {
  fs.mkdirSync(eventsDir, { recursive: true });
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

async function forwardToAgent(event) {
  if (!AGENT_FORWARD_URL) return { forwarded: false };
  const headers = { "Content-Type": "application/json" };
  if (AGENT_FORWARD_BEARER) {
    headers.Authorization = `Bearer ${AGENT_FORWARD_BEARER}`;
  }

  const res = await fetch(AGENT_FORWARD_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(event)
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
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && parsedUrl.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "tv-webhook-receiver",
      ts: new Date().toISOString()
    });
  }

  if (req.method !== "POST" || parsedUrl.pathname !== "/tv-webhook") {
    return json(res, 404, { ok: false, error: "Not found" });
  }

  try {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sourceIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    console.log(`[webhook] request_received id=${requestId} method=${req.method} path=${parsedUrl.pathname} ip=${sourceIp}`);

    const token = parsedUrl.searchParams.get("token") || "";
    if (TV_WEBHOOK_TOKEN && token !== TV_WEBHOOK_TOKEN) {
      console.log(`[webhook] request_rejected id=${requestId} reason=invalid_token`);
      return json(res, 401, { ok: false, error: "Invalid token" });
    }

    const raw = await readBody(req);
    const parsed = parseJson(raw);
    if (!parsed.ok) {
      console.log(`[webhook] request_rejected id=${requestId} reason=invalid_json`);
      return json(res, 400, { ok: false, error: "Invalid JSON", detail: parsed.error });
    }

    const payload = parsed.data;
    const missing = validatePayload(payload);
    const mismatch_flags = inferMismatchFlags(payload);

    const event = {
      received_at: new Date().toISOString(),
      source: "tradingview",
      missing_fields: missing,
      mismatch_flags,
      payload
    };

    writeEvent(event);
    const forwardResult = await forwardToAgent(event);

    console.log(
      `[webhook] request_processed id=${requestId} accepted=${missing.length === 0} symbol=${payload.symbol || "na"} setup_id=${payload.setup_id || "na"} stage=${payload.setup_stage || "na"} confluence=${payload.confluence || "na"}`
    );

    return json(res, 200, {
      ok: true,
      accepted: missing.length === 0,
      missing_fields: missing,
      mismatch_flags,
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
  console.log("[tv-webhook-receiver] endpoint: POST /tv-webhook?token=YOUR_TOKEN");
});
