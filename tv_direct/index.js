"use strict";

/**
 * tv_direct
 *
 * Direct-TradingView ingestion lane for the ta_charts perception agent.
 * The webhook (webhook/server.js) remains as a fallback; tv_direct is the
 * primary path when a Claude coworking session can read TV directly.
 *
 * Two entry points:
 *
 *   captureChartSnapshot({ symbol, timeframe, mode, ... })
 *     - Orchestrates an adapter, normalizes to the canonical payload,
 *       wraps as an event, builds an agent_packet, persists, and
 *       publishes to the perception bus.
 *
 *   ingest(payload, { source, agent_id })
 *     - Injection path for callers that already assembled a payload
 *       (e.g. a Claude session that pulled the full Pine field set).
 *       Same downstream pipeline, no adapter call.
 *
 * Both paths converge on lib/packet.js → lib/events_store.js →
 * lib/agent_bus.js, so direct-TV events show up in the same
 * events.ndjson the webhook writes and are visible to /events,
 * /lifecycle/latest, and /decision/latest unchanged.
 */

const {
  normalizePayload,
  buildAgentPacket,
  wrapEvent
} = require("../lib/packet");
const { writeEvent } = require("../lib/events_store");
const {
  buildEnvelope,
  publish: publishEnvelope
} = require("../lib/agent_bus");
const { evaluateDecision } = require("../webhook/decision");
const { gateDecisionWithMacro } = require("../lib/macro_decision");

const { readPineSnapshot } = require("./adapters/pine_snapshot");
const { readRawBars } = require("./adapters/raw_bars");

const DEFAULT_AGENT_ID = process.env.TV_DIRECT_AGENT_ID || "ta_charts_v1";
const DEFAULT_AGENT_ROLE = "ta_charts";

function sourceTagForMode(mode) {
  if (mode === "raw") return "tv_direct_raw";
  if (mode === "pine") return "tv_direct_pine";
  throw new Error(`tv_direct: unknown mode '${mode}' (expected 'pine' | 'raw')`);
}

function runAdapter(mode, input) {
  if (mode === "pine") return readPineSnapshot(input);
  if (mode === "raw") return readRawBars(input);
  throw new Error(`tv_direct: unknown mode '${mode}'`);
}

async function persistAndPublish({ payload, source, agentId, requestEnvelope }) {
  const event = wrapEvent({ payload, source });
  writeEvent(event);

  const agent_packet = buildAgentPacket(event);
  const baseDecision = evaluateDecision(agent_packet);
  const decision = await gateDecisionWithMacro(baseDecision, agent_packet);

  const responseEnvelope = buildEnvelope({
    direction: "outbound",
    from_agent: { agent_id: agentId, agent_role: DEFAULT_AGENT_ROLE },
    to_agent_role: requestEnvelope?.from_agent?.agent_role || "reasoning",
    reply_to_request_id: requestEnvelope?.envelope_id,
    symbol: payload.symbol,
    timeframes: payload.timeframe ? [payload.timeframe] : undefined,
    payload: {
      per_timeframe: [
        {
          timeframe: payload.timeframe,
          event_id: event.event_id,
          agent_packet,
          decision
        }
      ]
    }
  });

  let bus = null;
  if (process.env.TV_DIRECT_PUBLISH !== "0") {
    bus = await publishEnvelope(responseEnvelope);
  }

  return { event, agent_packet, decision, envelope: responseEnvelope, bus };
}

async function captureChartSnapshot(opts) {
  const mode = opts?.mode || process.env.TV_DIRECT_DEFAULT_MODE || "pine";
  const source = sourceTagForMode(mode);
  const agentId = opts?.agent_id || DEFAULT_AGENT_ID;

  const adapterInput = { ...opts };
  delete adapterInput.mode;
  delete adapterInput.agent_id;
  delete adapterInput.request_envelope;

  const rawPayload = runAdapter(mode, adapterInput);
  const payload = normalizePayload(rawPayload);

  return persistAndPublish({
    payload,
    source,
    agentId,
    requestEnvelope: opts?.request_envelope
  });
}

async function ingest(payload, opts = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("tv_direct.ingest: payload object required");
  }
  const source = opts.source || "tv_direct_pine";
  if (!["tv_direct_pine", "tv_direct_raw"].includes(source)) {
    throw new Error(`tv_direct.ingest: unsupported source '${source}'`);
  }
  const normalized = normalizePayload(payload);
  return persistAndPublish({
    payload: normalized,
    source,
    agentId: opts.agent_id || DEFAULT_AGENT_ID,
    requestEnvelope: opts.request_envelope
  });
}

module.exports = {
  captureChartSnapshot,
  ingest,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_ROLE,
  sourceTagForMode
};
