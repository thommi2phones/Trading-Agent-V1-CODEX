#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const { URL } = require("url");
const { computeLifecycleLatest } = require("./lifecycle");
const { evaluateDecision } = require("./decision");
const {
  maybeNumber,
  normalizePayload,
  validatePayload,
  inferMismatchFlags,
  buildAgentPacket
} = require("../lib/packet");
const {
  latestPath,
  writeEvent,
  readRecentEvents,
  writeAgentInbox: writeAgentInboxToDir
} = require("../lib/events_store");
const { gateDecisionWithMacro } = require("../lib/macro_decision");

const PORT = Number(process.env.PORT || 8787);
const AGENT_FORWARD_URL = process.env.AGENT_FORWARD_URL || "";
const AGENT_FORWARD_BEARER = process.env.AGENT_FORWARD_BEARER || "";
const AGENT_INBOX_DIR = process.env.AGENT_INBOX_DIR || "";
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const MAX_EVENTS_READ = Number(process.env.MAX_EVENTS_READ || 200);

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

/**
 * Parse plain-text TradingView alert messages into a payload object.
 *
 * Common TV formats:
 *   "BTCUSD, 5 Crossing Horizontal Ray"
 *   "BTCUSD Crossing Up Horizontal Ray, value: 98000"
 *   "XRPUSD, 15, close = 2.35, Crossing Down EMA 50"
 *   "Alert: TSLA breakout on 1D"
 */
/**
 * Attempt to recover data from truncated JSON.
 * TradingView sometimes sends payloads that get cut off mid-field.
 * We extract all complete key-value pairs we can find.
 */
function salvageTruncatedJson(raw) {
  const text = raw.trim();
  if (!text.startsWith("{")) return null;

  const result = {};
  // Match complete "key": value pairs (string, number, boolean, null)
  const pairRegex = /"([^"]+)"\s*:\s*(?:"([^"]*)"|([\d.eE+-]+)|(true|false|null))/g;
  let match;
  let count = 0;

  while ((match = pairRegex.exec(text)) !== null) {
    const key = match[1];
    if (match[2] !== undefined) {
      result[key] = match[2]; // string value
    } else if (match[3] !== undefined) {
      result[key] = Number(match[3]); // number value
    } else if (match[4] !== undefined) {
      // boolean or null
      result[key] = match[4] === "null" ? null : match[4] === "true";
    }
    count++;
  }

  // Only return if we found meaningful data (at least symbol)
  if (count >= 2 && result.symbol) return result;
  return null;
}

function parsePlainText(raw) {
  const text = raw.trim();
  if (!text) return null;

  // Try to extract symbol (first word-like token, usually all caps, may include / or =)
  const symbolMatch = text.match(/\b([A-Z]{2,10}(?:\/[A-Z]{3})?(?:=[A-Z])?)\b/);
  const symbol = symbolMatch ? symbolMatch[1] : "UNKNOWN";

  // Try to extract timeframe (digits + m/h/d/w/M suffix, or bare number near start)
  const tfMatch = text.match(/\b(\d{1,3})\s*([mhHdDwWM](?:in)?)\b/i);
  let timeframe = "";
  if (tfMatch) {
    const num = tfMatch[1];
    const unit = tfMatch[2].toLowerCase().charAt(0);
    const unitMap = { m: "m", h: "h", d: "D", w: "W" };
    timeframe = `${num}${unitMap[unit] || unit}`;
  } else {
    // Bare number after symbol+comma: "BTCUSD, 5 Crossing..."
    const bareNum = text.match(/,\s*(\d{1,4})\b/);
    if (bareNum) timeframe = `${bareNum[1]}m`;
  }

  // Try to extract a price value
  const priceMatch = text.match(/(?:value|price|close|=)\s*[:=]?\s*([\d,.]+)/i);
  const close = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) || null : null;

  // Infer bias from keywords
  let bias = "NEUTRAL";
  if (/crossing\s*up|bullish|breakout|long|bounce/i.test(text)) bias = "BULLISH";
  else if (/crossing\s*down|bearish|breakdown|short|rejection/i.test(text)) bias = "BEARISH";

  // Build the description from the full text
  return {
    symbol,
    timeframe,
    close,
    bias,
    confluence: "LOW",
    score: 0,
    rsi: null,
    macd_hist: null,
    setup_id: `tv_alert_${symbol.replace(/\//g, "")}`.toLowerCase(),
    setup_stage: "alert",
    alert_text: text,
    source_format: "plain_text"
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

function writeAgentInbox(agentPacket) {
  return writeAgentInboxToDir(agentPacket, AGENT_INBOX_DIR);
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

  if (req.method === "GET" && parsedUrl.pathname === "/decision/latest") {
    const requestedLimit = maybeNumber(parsedUrl.searchParams.get("limit"), 200);
    const limit = Math.max(1, Math.min(requestedLimit || 200, MAX_EVENTS_READ));
    const setupId = parsedUrl.searchParams.get("setup_id") || "";
    const events = readRecentEvents(limit, setupId);
    const latestEvent = events[0] || null;

    if (!latestEvent) {
      return json(res, 200, {
        ok: true,
        mode: "no_data",
        decision: null
      });
    }

    const agentPacket = buildAgentPacket(latestEvent);
    const baseDecision = evaluateDecision(agentPacket);
    const decision = await gateDecisionWithMacro(baseDecision, agentPacket);

    return json(res, 200, {
      ok: true,
      mode: "latest_event",
      setup_id: agentPacket.setup_id,
      event_id: agentPacket.event_id,
      agent_packet: agentPacket,
      decision
    });
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

    let payload;
    let sourceFormat = "json";

    if (parsed.ok) {
      payload = normalizePayload(parsed.data);
    } else {
      // Try to salvage truncated JSON by extracting key-value pairs
      const salvaged = salvageTruncatedJson(raw);
      if (salvaged) {
        payload = normalizePayload(salvaged);
        sourceFormat = "truncated_json";
        console.log(`[webhook] salvaged_truncated_json id=${requestId} symbol=${payload.symbol}`);
      } else {
        // Fall back to plain text parsing
        const plainData = parsePlainText(raw);
        if (plainData) {
          payload = normalizePayload(plainData);
          sourceFormat = "plain_text";
          console.log(`[webhook] parsed_plain_text id=${requestId} symbol=${payload.symbol} text="${raw.slice(0, 120)}"`);
        } else {
          const preview = raw.replace(/\s+/g, " ").slice(0, 240);
          console.log(`[webhook] request_rejected id=${requestId} reason=unparseable raw_preview="${preview}"`);
          return json(res, 400, { ok: false, error: "Could not parse payload", detail: parsed.error });
        }
      }
    }

    payload.source_format = sourceFormat;
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
  console.log("[tv-webhook-receiver] decision: GET /decision/latest?limit=200&setup_id=...");
  console.log("[tv-webhook-receiver] endpoints: POST /tv-webhook, /tv-webhook/, /webhook, /webhook/");
  if (AGENT_INBOX_DIR) {
    console.log(`[tv-webhook-receiver] local agent inbox: ${AGENT_INBOX_DIR}`);
  }
  if (AGENT_FORWARD_URL) {
    console.log(`[tv-webhook-receiver] forwarding to: ${AGENT_FORWARD_URL}`);
  }
});
