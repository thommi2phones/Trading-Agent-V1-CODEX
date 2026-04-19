"use strict";

/**
 * pine_snapshot adapter
 *
 * Primary direct-TV ingestion path. Accepts a Pine-derived field set
 * read from a TradingView chart by a Claude coworking session and
 * normalizes it into the same payload shape the webhook receives.
 *
 * The adapter does NOT call TradingView itself — that's the caller's
 * responsibility. The adapter's job is to map whatever Claude pulled
 * back into the canonical REQUIRED_FIELDS set so it survives
 * lib/packet.js#validatePayload.
 */

const REQUIRED_KEYS_FROM_CALLER = ["symbol", "timeframe", "bar_time"];

function readPineSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new Error("pine_snapshot: input object required");
  }

  for (const key of REQUIRED_KEYS_FROM_CALLER) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`pine_snapshot: missing required input key '${key}'`);
    }
  }

  return {
    ...input,

    symbol: String(input.symbol),
    timeframe: String(input.timeframe),
    bar_time: String(input.bar_time),

    taxonomy_version: input.taxonomy_version || "tax_v1",
    setup_id: input.setup_id || `tv_direct_${String(input.symbol).toLowerCase()}_${input.timeframe}`,
    pattern_type: input.pattern_type || "other",
    setup_stage: input.setup_stage || "watch",
    time_horizon: input.time_horizon || "swing",

    pattern_bias: input.pattern_bias || "neutral",
    pattern_confirmed: !!input.pattern_confirmed,
    fib_significance: input.fib_significance || "NONE",

    macd_hist: input.macd_hist ?? null,
    macd_bull_expand: !!input.macd_bull_expand,
    macd_bear_expand: !!input.macd_bear_expand,
    squeeze_release: !!input.squeeze_release,
    rsi: input.rsi ?? null,

    auto_pattern: input.auto_pattern || "none",
    auto_pattern_conf: input.auto_pattern_conf ?? 0,
    auto_pattern_bias: input.auto_pattern_bias || "neutral",
    auto_pattern_aligned: !!input.auto_pattern_aligned,

    entry_price: input.entry_price ?? null,
    stop_price: input.stop_price ?? null,
    tp1_price: input.tp1_price ?? null,
    tp2_price: input.tp2_price ?? null,
    tp3_price: input.tp3_price ?? null,

    near_entry: !!input.near_entry,
    hit_entry: !!input.hit_entry,
    hit_stop: !!input.hit_stop,
    hit_tp1: !!input.hit_tp1,
    hit_tp2: !!input.hit_tp2,
    hit_tp3: !!input.hit_tp3,

    score: input.score ?? 0,
    confluence: input.confluence || "LOW",
    bias: input.bias || "NEUTRAL",

    source_format: "tv_direct_pine"
  };
}

module.exports = { readPineSnapshot };
