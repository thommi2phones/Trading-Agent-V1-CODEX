"use strict";

/**
 * macro_sizing
 *
 * Pure sizing logic. Combines the macro gate's size_multiplier with the
 * view's confidence to produce an agreement-scaled position size.
 *
 * Formula (Agreement boost + gate cap):
 *   base = gate.size_multiplier (fallback 1.0)
 *   scale = confidence <= 0.5   -> 1.0
 *           confidence <= 0.75  -> 1.25
 *           confidence >  0.75  -> 1.5
 *   final = min(base * scale, base * 2.0, 2.0)
 *
 * Boost only applies on agreement (bullish+LONG or bearish+SHORT). On
 * disagreement, unknown direction, or non-actionable base action, returns
 * { size_multiplier: null, reason: "no_macro_sizing" }. On non-directional
 * views (neutral/mixed/watchful) with base < 1.0, falls through as a
 * downscale cap so macro's explicit risk-reduction signals (e.g. watchful
 * -> 0.5) still reach the caller.
 *
 * The hard cap at 2.0 matches macro-analyzer schema v1.0.0 which bounds
 * gate_suggestion.size_multiplier to [0.0, 2.0].
 */

const SCHEMA_SIZE_CAP = 2.0;

function clampScale(confidence) {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c <= 0.5) return 1.0;
  if (c <= 0.75) return 1.25;
  return 1.5;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function computeSizingFromMacroView(macroView, baseAction) {
  if (!macroView || typeof macroView !== "object") {
    return { size_multiplier: null, reason: "no_macro_sizing" };
  }
  if (baseAction !== "LONG" && baseAction !== "SHORT") {
    return { size_multiplier: null, reason: "no_macro_sizing" };
  }

  const direction = macroView.direction || "unknown";
  const gate = macroView.gate_suggestion || {};
  const base = Number.isFinite(gate.size_multiplier) ? gate.size_multiplier : 1.0;
  const agreesLong = baseAction === "LONG" && direction === "bullish" && gate.allow_long !== false;
  const agreesShort = baseAction === "SHORT" && direction === "bearish" && gate.allow_short !== false;
  const agrees = agreesLong || agreesShort;

  if (!agrees) {
    if (base < 1.0) {
      const final = Math.max(0, base);
      return { size_multiplier: round2(final), reason: `macro_size_cap:${final.toFixed(2)}` };
    }
    return { size_multiplier: null, reason: "no_macro_sizing" };
  }

  const scale = clampScale(macroView.confidence);
  const boosted = base * scale;
  const capped = Math.min(boosted, base * 2.0, SCHEMA_SIZE_CAP);
  const final = round2(capped);

  if (final > 1.0) {
    return { size_multiplier: final, reason: `macro_size_boost:${final.toFixed(2)}` };
  }
  if (final < 1.0) {
    return { size_multiplier: final, reason: `macro_size_cap:${final.toFixed(2)}` };
  }
  return { size_multiplier: 1.0, reason: "macro_size_hold" };
}

module.exports = { computeSizingFromMacroView, SCHEMA_SIZE_CAP };
