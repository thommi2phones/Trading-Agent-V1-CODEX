"use strict";

/**
 * Macro Integration — tactical-executor ↔ macro-analyzer
 *
 * Pulls macro directional views from the Macro Analyzer and posts trade
 * outcomes back. Contract version 1.0.0 — see /integration/macro_schema.json
 * for the full schema.
 *
 * Graceful degradation: if MACRO_ANALYZER_URL is not set or the service is
 * down, all calls no-op. Tactical decisions proceed without the macro gate.
 */

const { getAssetClass } = require("../lib/asset_class");
const { computeSizingFromMacroView } = require("../lib/macro_sizing");

const MACRO_ANALYZER_URL = process.env.MACRO_ANALYZER_URL || "";
const MACRO_REQUEST_TIMEOUT_MS = Number(process.env.MACRO_REQUEST_TIMEOUT_MS || 3000);
const CONTRACT_VERSION = "1.0.0";

const DEFAULT_PARTIAL_WEIGHTS = [0.5, 0.25, 0.25];

/**
 * Scale-out weights for pnl_r accounting. See computeWeightedPnlR below.
 * Env: MACRO_PNL_PARTIAL_WEIGHTS="w1,w2,w3" (must sum to 1.0).
 */
function getPartialWeights() {
  const raw = process.env.MACRO_PNL_PARTIAL_WEIGHTS;
  if (!raw) return DEFAULT_PARTIAL_WEIGHTS;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x) || x < 0)) {
    console.warn(`[macro_integration] invalid MACRO_PNL_PARTIAL_WEIGHTS="${raw}" — falling back to default`);
    return DEFAULT_PARTIAL_WEIGHTS;
  }
  const sum = parts[0] + parts[1] + parts[2];
  if (Math.abs(sum - 1.0) > 1e-6) {
    console.warn(`[macro_integration] MACRO_PNL_PARTIAL_WEIGHTS sums to ${sum} (must be 1.0) — falling back to default`);
    return DEFAULT_PARTIAL_WEIGHTS;
  }
  return parts;
}

/**
 * Fetch the current macro view for a symbol. Optionally accepts an
 * explicit asset_class; if omitted, it's inferred from `lib/asset_class`
 * and passed as a query param to give macro-analyzer a routing hint.
 *
 * Returns null on any failure — tactical proceeds unfiltered.
 */
async function fetchMacroView(symbol, explicitAssetClass) {
  if (!MACRO_ANALYZER_URL || !symbol) return null;

  const inferred = explicitAssetClass || getAssetClass(symbol);
  const base = MACRO_ANALYZER_URL.replace(/\/$/, "");
  const qs = new URLSearchParams({ asset: String(symbol) });
  if (inferred) qs.set("asset_class", inferred);
  const url = `${base}/positioning/view?${qs.toString()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MACRO_REQUEST_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[macro_integration] fetch_non_ok status=${res.status} url=${url}`);
      return null;
    }

    const data = await res.json();

    if (data?.contract_version && data.contract_version !== CONTRACT_VERSION) {
      console.warn(
        `[macro_integration] contract_version_mismatch expected=${CONTRACT_VERSION} got=${data.contract_version}`
      );
    }

    return data;
  } catch (err) {
    console.warn(`[macro_integration] fetch_error ${err.message || err}`);
    return null;
  }
}

/**
 * Derive a UI-facing summary of the macro gating outcome.
 * Downstream consumers (dashboards, LLM prompts) should read this instead
 * of re-deriving status from reason_codes.
 */
function summarizeMacro(macroView, reasons, sizeMultiplier) {
  const reasonList = Array.isArray(reasons) ? reasons : [];
  if (!macroView || typeof macroView !== "object") {
    return {
      consulted: false,
      direction: null,
      agreement: MACRO_ANALYZER_URL ? "unavailable" : "not_consulted",
      size_effect: "none",
      size_multiplier: null
    };
  }

  const direction = macroView.direction || "unknown";
  let agreement;
  if (reasonList.includes("macro_blocks_long") || reasonList.includes("macro_blocks_short")) {
    agreement = "disagree";
  } else if (reasonList.includes("macro_aligns_long") || reasonList.includes("macro_aligns_short")) {
    agreement = "agree";
  } else if (direction === "unknown") {
    agreement = "unknown";
  } else {
    agreement = "neutral";
  }

  let sizeEffect = "none";
  const boostReason = reasonList.find((r) => typeof r === "string" && r.startsWith("macro_size_boost:"));
  const capReason = reasonList.find((r) => typeof r === "string" && r.startsWith("macro_size_cap:"));
  if (boostReason) sizeEffect = "boost";
  else if (capReason) sizeEffect = "cap";
  else if (reasonList.includes("macro_size_hold")) sizeEffect = "hold";

  return {
    consulted: true,
    direction,
    agreement,
    size_effect: sizeEffect,
    size_multiplier: Number.isFinite(sizeMultiplier) ? sizeMultiplier : null
  };
}

/**
 * Apply macro gate to a decision.
 *
 * Rules (vocabulary matches the rest of the repo — `macro_blocks_*`,
 * `macro_aligns_*`, `macro_no_view`, `macro_direction_<dir>` for the
 * non-directional view variants, plus `macro_size_boost:<x>|hold|cap:<x>`
 * for sizing effects):
 *  - macroView === null             → return unchanged + macro_no_view if URL set
 *  - direction === "unknown"        → add macro_no_view; no sizing
 *  - direction in {neutral,mixed,watchful} → add macro_direction_<dir>
 *                                     (still honors allow_* and sizing)
 *  - LONG + allow_long=false        → downgrade to WAIT + macro_blocks_long
 *  - SHORT + allow_short=false      → downgrade to WAIT + macro_blocks_short
 *  - LONG + allow_long=true         → macro_aligns_long
 *  - SHORT + allow_short=true       → macro_aligns_short
 *  - Sizing (lib/macro_sizing.js) runs after the direction gate. Boost on
 *    agreement, cap on explicit risk-reduction (base < 1.0 even without
 *    agreement — e.g. watchful -> 0.5). Attaches decision.size_multiplier
 *    and a matching size reason.
 *  - decision.macro_summary is always set.
 */
function applyMacroGate(decision, macroView) {
  if (!decision) return decision;
  if (!macroView) {
    const reasons = [...(decision.reason_codes || [])];
    if (MACRO_ANALYZER_URL) reasons.push("macro_no_view");
    return {
      ...decision,
      reason_codes: [...new Set(reasons)],
      macro_summary: summarizeMacro(null, reasons, null)
    };
  }

  const direction = macroView.direction || "unknown";
  const gate = macroView.gate_suggestion || {};
  const action = decision.action;
  const reasons = [...(decision.reason_codes || [])];
  let mutatedAction = action;
  let mutatedRiskTier = decision.risk_tier;
  let mutatedConfidence = decision.confidence;

  if (direction === "unknown") {
    reasons.push("macro_no_view");
    return {
      ...decision,
      reason_codes: [...new Set(reasons)],
      macro_context: {
        direction: "unknown",
        confidence: 0,
        gate_applied: false
      },
      macro_summary: summarizeMacro(macroView, reasons, null)
    };
  }

  // Non-directional views (neutral / mixed / watchful) get an annotation.
  if (direction === "neutral" || direction === "mixed" || direction === "watchful") {
    reasons.push(`macro_direction_${direction}`);
  }

  if (action === "LONG" && gate.allow_long === false) {
    mutatedAction = "WAIT";
    mutatedRiskTier = "BLOCKED";
    mutatedConfidence = "LOW";
    reasons.push("macro_blocks_long");
  } else if (action === "SHORT" && gate.allow_short === false) {
    mutatedAction = "WAIT";
    mutatedRiskTier = "BLOCKED";
    mutatedConfidence = "LOW";
    reasons.push("macro_blocks_short");
  } else if (action === "LONG" && gate.allow_long === true && direction === "bullish") {
    reasons.push("macro_aligns_long");
  } else if (action === "SHORT" && gate.allow_short === true && direction === "bearish") {
    reasons.push("macro_aligns_short");
  }

  // Sizing — delegated to macro_sizing.js. Only fires on LONG/SHORT after
  // the direction gate (not on WAIT/BLOCKED).
  const sizing = computeSizingFromMacroView(macroView, mutatedAction);
  let sizeMultiplier = null;
  if (sizing.size_multiplier !== null) {
    sizeMultiplier = sizing.size_multiplier;
    reasons.push(sizing.reason);
  }

  const dedup = [...new Set(reasons)];
  const next = {
    ...decision,
    action: mutatedAction,
    confidence: mutatedConfidence,
    risk_tier: mutatedRiskTier,
    reason_codes: dedup,
    macro_context: {
      direction: macroView.direction,
      confidence: macroView.confidence,
      horizon: macroView.horizon,
      source_theses: macroView.source_theses || [],
      size_multiplier: gate.size_multiplier ?? 1.0,
      gate_applied: true,
      gate_notes: gate.notes || ""
    },
    macro_summary: summarizeMacro(macroView, dedup, sizeMultiplier)
  };
  if (sizeMultiplier !== null) next.size_multiplier = sizeMultiplier;
  return next;
}

/**
 * Post a trade outcome to the macro-analyzer source-scoring endpoint.
 *
 * Expected input (MacroOutcomeReport schema v1.0.0):
 *   {
 *     trade_id, symbol, direction, entry_timestamp, exit_timestamp,
 *     outcome: "win"|"loss"|"breakeven", pnl_r,
 *     macro_view_at_entry: { direction, confidence, source_theses }
 *   }
 *
 * No-ops if MACRO_ANALYZER_URL is not set. Returns null on any failure.
 */
async function postTradeOutcome(outcomeReport) {
  if (!MACRO_ANALYZER_URL || !outcomeReport) return null;

  const url = `${MACRO_ANALYZER_URL.replace(/\/$/, "")}/source-scoring/outcome`;
  const payload = {
    contract_version: CONTRACT_VERSION,
    ...outcomeReport
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MACRO_REQUEST_TIMEOUT_MS * 2);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[macro_integration] outcome_post_non_ok status=${res.status} trade=${outcomeReport.trade_id}`);
      return null;
    }

    const ack = await res.json();
    console.log(
      `[macro_integration] outcome_recorded trade=${outcomeReport.trade_id} sources_credited=${(ack.sources_credited || []).length}`
    );
    return ack;
  } catch (err) {
    console.warn(`[macro_integration] outcome_post_error ${err.message || err}`);
    return null;
  }
}

/**
 * Compute R-multiple under the per-TP scale-out model. Each TP closes a
 * fraction of the position per `MACRO_PNL_PARTIAL_WEIGHTS` (default
 * 0.5/0.25/0.25 for tp1/tp2/tp3). The remaining fraction exits at the
 * most-advanced level reached: tp3 on a full winner, the last hit TP on
 * a partial close, or the stop on a stop-out after partial profits.
 *
 * Scenarios (r_i = sign * (tp_i - entry) / |entry - stop|):
 *   - hit_stop, no TPs:                -1.0
 *   - hit_stop after hit_tp1:          w1*r1 + (1-w1)*(-1.0)
 *   - hit_stop after hit_tp1+hit_tp2:  w1*r1 + w2*r2 + (1-w1-w2)*(-1.0)
 *   - hit_tp1 (closed at tp1):         1.0 * r1
 *   - hit_tp2 (no tp3):                w1*r1 + (1-w1)*r2
 *   - hit_tp3 (full winner):           w1*r1 + w2*r2 + w3*r3
 *
 * direction: "long" | "short". Returns null if levels insufficient or
 * direction not actionable. Returns -1.0 for a stop-out when entry/stop
 * are missing (calibrated risk unit).
 */
function computeWeightedPnlR({ direction, entry, stop, tp1, tp2, tp3, hit_stop, hit_tp1, hit_tp2, hit_tp3 } = {}) {
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
    return hit_stop ? -1.0 : null;
  }
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  const sign = direction === "long" ? 1 : direction === "short" ? -1 : 0;
  if (sign === 0) return null;

  const [w1, w2, w3] = getPartialWeights();
  const r = (price) => (sign * (price - entry)) / risk;
  const r1 = hit_tp1 && Number.isFinite(tp1) ? r(tp1) : null;
  const r2 = hit_tp2 && Number.isFinite(tp2) ? r(tp2) : null;
  const r3 = hit_tp3 && Number.isFinite(tp3) ? r(tp3) : null;

  if (hit_stop) {
    let pnl = 0;
    let consumed = 0;
    if (r1 !== null) { pnl += w1 * r1; consumed += w1; }
    if (r2 !== null) { pnl += w2 * r2; consumed += w2; }
    const remaining = Math.max(0, 1 - consumed);
    pnl += remaining * -1.0;
    return pnl;
  }

  if (r3 !== null) return w1 * (r1 ?? 0) + w2 * (r2 ?? 0) + w3 * r3;
  if (r2 !== null) {
    const consumed = r1 !== null ? w1 : 0;
    const partial = r1 !== null ? w1 * r1 : 0;
    return partial + (1 - consumed) * r2;
  }
  if (r1 !== null) return r1;
  return null;
}

/**
 * Build an outcome report from a closed setup + its lifecycle + decision
 * history. Two call shapes:
 *
 *   1) { setupId, symbol, direction, entryTimestamp, exitTimestamp,
 *        pnlR, macroViewAtEntry }
 *      Legacy path. Caller supplies pnlR directly. outcome is classified
 *      by the traditional threshold.
 *
 *   2) { setupId, symbol, direction, entryTimestamp, exitTimestamp,
 *        levels: { entry, stop, tp1, tp2, tp3, hit_stop, hit_tp1, ... },
 *        macroViewAtEntry }
 *      Weighted path. pnlR is computed via computeWeightedPnlR under the
 *      per-TP scale-out model. Preferred when the caller has level data.
 *
 * `outcome` ∈ {"win"|"loss"|"breakeven"}. Breakeven threshold of ±0.05R
 * is preserved from the prior implementation.
 */
function buildOutcomeReport({ setupId, symbol, direction, entryTimestamp, exitTimestamp, pnlR, levels, macroViewAtEntry }) {
  let resolvedPnl = pnlR;
  if ((resolvedPnl === undefined || resolvedPnl === null) && levels) {
    resolvedPnl = computeWeightedPnlR({ direction, ...levels });
  }
  const safePnl = Number.isFinite(resolvedPnl) ? resolvedPnl : 0;
  const outcome = safePnl > 0.05 ? "win" : safePnl < -0.05 ? "loss" : "breakeven";
  return {
    trade_id: setupId,
    symbol,
    direction,
    entry_timestamp: entryTimestamp,
    exit_timestamp: exitTimestamp,
    outcome,
    pnl_r: safePnl,
    macro_view_at_entry: macroViewAtEntry || {
      direction: "unknown",
      confidence: 0,
      source_theses: []
    }
  };
}

// ---------------------------------------------------------------------------
// Entry-time macro snapshots
// Capture the macro view when a setup transitions to 'trigger' or 'in_trade',
// so later — at outcome time — we can credit source attribution to what
// macro said AT ENTRY, not what macro happens to say at close time.
// ---------------------------------------------------------------------------

const macroEntrySnapshots = new Map();  // setup_id → { snapshot_at, direction, confidence, source_theses }

/**
 * Store the macro view that was live when a setup first entered trigger/in_trade.
 * Idempotent: subsequent calls for the same setup_id are ignored so we always
 * preserve the earliest-entry snapshot.
 */
function storeMacroViewAtEntry(setupId, macroView) {
  if (!setupId || !macroView) return false;
  if (macroEntrySnapshots.has(setupId)) return false;  // preserve earliest
  macroEntrySnapshots.set(setupId, {
    snapshot_at: new Date().toISOString(),
    direction: macroView.direction || "unknown",
    confidence: macroView.confidence || 0,
    source_theses: macroView.source_theses || [],
  });
  return true;
}

function getMacroViewAtEntry(setupId) {
  if (!setupId) return null;
  return macroEntrySnapshots.get(setupId) || null;
}

function clearMacroViewEntrySnapshots() {
  macroEntrySnapshots.clear();
}

// ---------------------------------------------------------------------------
// Apply a regime-change push from the macro side to active tactical setups.
// ---------------------------------------------------------------------------

/**
 * Given an incoming regime-update payload from macro and a snapshot of
 * currently-active setups, identify which setups now conflict with the
 * macro's new directional bias.
 *
 * @param regimePayload  { severity, changes, current_regime: { directional_bias: { theme: dir } } }
 * @param activeSetups   Array of { setup_id, symbol, bias, stage, theme }
 * @returns { affected_setups: [{ setup_id, reason }], unaffected_count }
 */
function applyRegimeUpdate(regimePayload, activeSetups) {
  const affected = [];
  const biases = regimePayload?.current_regime?.directional_bias || {};
  if (!Object.keys(biases).length) return { affected_setups: [], unaffected_count: (activeSetups || []).length };

  for (const setup of activeSetups || []) {
    const theme = (setup.theme || "").toLowerCase();
    const setupBias = (setup.bias || "").toLowerCase();
    const macroBias = (biases[theme] || "").toLowerCase();
    if (!macroBias || macroBias === "unknown") continue;

    const conflict =
      (setupBias === "bullish" && macroBias === "bearish") ||
      (setupBias === "bearish" && macroBias === "bullish");
    if (conflict) {
      affected.push({
        setup_id: setup.setup_id,
        symbol: setup.symbol,
        reason: `macro ${theme} shifted to ${macroBias} against setup bias ${setupBias}`,
      });
    }
  }

  return {
    affected_setups: affected,
    unaffected_count: (activeSetups || []).length - affected.length,
  };
}

module.exports = {
  fetchMacroView,
  applyMacroGate,
  postTradeOutcome,
  buildOutcomeReport,
  computeWeightedPnlR,
  getPartialWeights,
  DEFAULT_PARTIAL_WEIGHTS,
  summarizeMacro,
  storeMacroViewAtEntry,
  getMacroViewAtEntry,
  clearMacroViewEntrySnapshots,
  applyRegimeUpdate,
  CONTRACT_VERSION,
  MACRO_ANALYZER_URL
};
