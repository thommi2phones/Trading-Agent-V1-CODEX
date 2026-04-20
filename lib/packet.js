"use strict";

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

  let packetSource = "tradingview_webhook";
  if (event.source && event.source !== "tradingview") {
    packetSource = event.source;
  }

  return {
    source: packetSource,
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

function wrapEvent({ payload, source = "tradingview", event_id, received_at }) {
  const missing = validatePayload(payload);
  const mismatch_flags = inferMismatchFlags(payload);
  return {
    event_id: event_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    received_at: received_at || new Date().toISOString(),
    source,
    accepted: missing.length === 0,
    missing_fields: missing,
    mismatch_flags,
    payload
  };
}

module.exports = {
  REQUIRED_FIELDS,
  maybeNumber,
  normalizePayload,
  validatePayload,
  inferMismatchFlags,
  buildAgentPacket,
  wrapEvent
};
