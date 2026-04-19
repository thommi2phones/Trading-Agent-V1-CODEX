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

const MACRO_ANALYZER_URL = process.env.MACRO_ANALYZER_URL || "";
const MACRO_REQUEST_TIMEOUT_MS = Number(process.env.MACRO_REQUEST_TIMEOUT_MS || 3000);
const CONTRACT_VERSION = "1.0.0";

/**
 * Fetch the current macro view for a symbol.
 * Returns null on any failure — tactical proceeds unfiltered.
 */
async function fetchMacroView(symbol) {
  if (!MACRO_ANALYZER_URL || !symbol) return null;

  const url = `${MACRO_ANALYZER_URL.replace(/\/$/, "")}/positioning/view?asset=${encodeURIComponent(symbol)}`;

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
 * Apply macro gate to a decision.
 *
 * Rules:
 *  - If macroView is null (service unavailable), return decision unchanged
 *  - If macro direction is "unknown", return decision unchanged
 *  - If decision is LONG but macro blocks longs → downgrade to WAIT
 *  - If decision is SHORT but macro blocks shorts → downgrade to WAIT
 *  - If macro aligns but suggests size_multiplier < 1, annotate (decision stays)
 *  - Always add a reason_code documenting the macro gate outcome
 */
function applyMacroGate(decision, macroView) {
  if (!decision) return decision;
  if (!macroView) return decision;
  if (macroView.direction === "unknown") {
    return {
      ...decision,
      reason_codes: [...(decision.reason_codes || []), "macro_no_view"],
      macro_context: {
        direction: "unknown",
        confidence: 0,
        gate_applied: false
      }
    };
  }

  const gate = macroView.gate_suggestion || {};
  const action = decision.action;
  const mutatedReasons = [...(decision.reason_codes || [])];
  let mutatedAction = action;
  let mutatedRiskTier = decision.risk_tier;
  let mutatedConfidence = decision.confidence;

  if (action === "LONG" && gate.allow_long === false) {
    mutatedAction = "WAIT";
    mutatedRiskTier = "BLOCKED";
    mutatedConfidence = "LOW";
    mutatedReasons.push("macro_blocks_long");
  } else if (action === "SHORT" && gate.allow_short === false) {
    mutatedAction = "WAIT";
    mutatedRiskTier = "BLOCKED";
    mutatedConfidence = "LOW";
    mutatedReasons.push("macro_blocks_short");
  } else if (action === "LONG" && gate.allow_long === true) {
    mutatedReasons.push("macro_aligns_long");
  } else if (action === "SHORT" && gate.allow_short === true) {
    mutatedReasons.push("macro_aligns_short");
  }

  return {
    ...decision,
    action: mutatedAction,
    confidence: mutatedConfidence,
    risk_tier: mutatedRiskTier,
    reason_codes: [...new Set(mutatedReasons)],
    macro_context: {
      direction: macroView.direction,
      confidence: macroView.confidence,
      horizon: macroView.horizon,
      source_theses: macroView.source_theses || [],
      size_multiplier: gate.size_multiplier ?? 1.0,
      gate_applied: true,
      gate_notes: gate.notes || ""
    }
  };
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
 * Build an outcome report from a closed setup + its lifecycle + decision history.
 *
 * Called when a setup transitions to "closed" or "invalidated".
 */
function buildOutcomeReport({ setupId, symbol, direction, entryTimestamp, exitTimestamp, pnlR, macroViewAtEntry }) {
  const outcome = pnlR > 0.05 ? "win" : pnlR < -0.05 ? "loss" : "breakeven";
  return {
    trade_id: setupId,
    symbol,
    direction,
    entry_timestamp: entryTimestamp,
    exit_timestamp: exitTimestamp,
    outcome,
    pnl_r: pnlR,
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
  storeMacroViewAtEntry,
  getMacroViewAtEntry,
  clearMacroViewEntrySnapshots,
  applyRegimeUpdate,
  CONTRACT_VERSION,
  MACRO_ANALYZER_URL
};
