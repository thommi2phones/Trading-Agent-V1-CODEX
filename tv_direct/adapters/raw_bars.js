"use strict";

/**
 * raw_bars adapter — STUB
 *
 * Future fallback when Pine compute is unavailable. Will eventually take
 * raw OHLC bars (and any chart drawings) and locally port Pine indicators
 * (EMA, RSI, MACD, TTM squeeze, pattern detection) to populate the full
 * REQUIRED_FIELDS set.
 *
 * For MVP this stub populates only the bare minimum so callers can
 * exercise the pipeline without crashing. Packets it produces will fail
 * lib/packet.js#validatePayload (missing the indicator fields), land
 * with accepted=false, and the decision engine will return BLOCKED. That
 * is intentional — we do not want to act on incomplete data.
 *
 * Graduating raw mode out of stub status requires:
 *   1. JS ports of EMA / RSI / MACD / TTM squeeze / 7 pattern detectors
 *   2. A Pine-vs-JS reconciliation harness with <0.5% drift on a
 *      rolling 100-bar window per symbol/timeframe
 *   3. A spec doc describing the JS-side computation contract
 */

function readRawBars(input) {
  if (!input || typeof input !== "object") {
    throw new Error("raw_bars: input object required");
  }
  if (!input.symbol || !input.timeframe || !input.bar_time) {
    throw new Error("raw_bars: input requires symbol, timeframe, bar_time");
  }

  // Intentionally do NOT set the indicator fields (rsi, macd_hist, squeeze_release).
  // Leaving them undefined causes lib/packet.js#normalizePayload to set them
  // to null and validatePayload to flag them as missing — yielding
  // accepted=false and a BLOCKED decision. Raw mode must stay non-actionable
  // until the JS indicator port lands.
  return {
    symbol: String(input.symbol),
    timeframe: String(input.timeframe),
    bar_time: String(input.bar_time),

    close: input.close ?? null,
    open: input.open ?? null,
    high: input.high ?? null,
    low: input.low ?? null,

    bars_lookback: Array.isArray(input.bars) ? input.bars.length : 0,

    setup_id: input.setup_id || `tv_direct_raw_${String(input.symbol).toLowerCase()}_${input.timeframe}`,
    setup_stage: "watch",
    pattern_type: "other",
    pattern_bias: "neutral",
    pattern_confirmed: false,
    fib_significance: "NONE",

    score: 0,
    confluence: "LOW",
    bias: "NEUTRAL",

    source_format: "tv_direct_raw"
  };
}

module.exports = { readRawBars };
