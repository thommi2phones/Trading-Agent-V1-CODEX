"use strict";

/**
 * macro_gate
 *
 * Pure function that layers a MacroPositioningView over a base decision
 * from webhook/decision.js. Never mutates inputs.
 *
 * Policy (per macro-analyzer integration contract):
 *   - If the gate has no opinion (view === null or direction === "unknown"),
 *     the decision passes through unchanged. A reason code is added noting
 *     macro was consulted but had no view.
 *   - If the gate disallows the direction of a would-be LONG/SHORT action,
 *     downgrade action to WAIT and emit macro_disagrees_long|short.
 *   - If the gate agrees with direction, emit macro_agrees_long|short and
 *     delegate sizing to lib/macro_sizing.js. The resulting size_multiplier
 *     (if any) is attached as decision.size_multiplier with a matching
 *     reason code: macro_size_boost:<x.xx>, macro_size_hold, or
 *     macro_size_cap:<x.xx>.
 *
 * Note: webhook/decision.js stays a pure synchronous function with a stable
 * signature. applyMacroGate is invoked by call sites (server.js,
 * tv_direct/index.js) after the base decision is computed, so the parity
 * test against buildAgentPacket remains untouched.
 */

const { computeSizingFromMacroView } = require("./macro_sizing");

function summarizeMacro(decision, macroView) {
  const reasons = Array.isArray(decision.reason_codes) ? decision.reason_codes : [];

  if (!macroView || typeof macroView !== "object") {
    const unavailable = reasons.includes("macro_unavailable");
    return {
      consulted: unavailable,
      direction: null,
      agreement: unavailable ? "unavailable" : "not_consulted",
      size_effect: "none",
      size_multiplier: null
    };
  }

  const direction = macroView.direction || "unknown";
  let agreement;
  if (reasons.includes("macro_disagrees_long") || reasons.includes("macro_disagrees_short")) {
    agreement = "disagree";
  } else if (reasons.includes("macro_agrees_long") || reasons.includes("macro_agrees_short")) {
    agreement = "agree";
  } else if (direction === "unknown") {
    agreement = "unknown";
  } else {
    agreement = "neutral";
  }

  let sizeEffect = "none";
  const boostReason = reasons.find((r) => r.startsWith("macro_size_boost:"));
  const capReason = reasons.find((r) => r.startsWith("macro_size_cap:"));
  if (boostReason) sizeEffect = "boost";
  else if (capReason) sizeEffect = "cap";
  else if (reasons.includes("macro_size_hold")) sizeEffect = "hold";

  return {
    consulted: true,
    direction,
    agreement,
    size_effect: sizeEffect,
    size_multiplier: Number.isFinite(decision.size_multiplier) ? decision.size_multiplier : null
  };
}

function cloneDecision(d) {
  return {
    ...d,
    reason_codes: Array.isArray(d.reason_codes) ? [...d.reason_codes] : []
  };
}

function addReason(decision, code) {
  if (!decision.reason_codes.includes(code)) {
    decision.reason_codes.push(code);
  }
}

function applyMacroGate(baseDecision, agentPacket, macroView) {
  const decision = cloneDecision(baseDecision);

  if (!macroView || typeof macroView !== "object") {
    // Macro unreachable or disabled — graceful passthrough.
    if (process.env.MACRO_ANALYZER_URL) {
      addReason(decision, "macro_unavailable");
    }
    decision.macro_view_at_entry = null;
    decision.macro_summary = summarizeMacro(decision, null);
    return decision;
  }

  const direction = macroView.direction || "unknown";
  const gate = macroView.gate_suggestion || {};
  const allowLong = gate.allow_long !== false;
  const allowShort = gate.allow_short !== false;
  const sizeMultiplier = Number.isFinite(gate.size_multiplier) ? gate.size_multiplier : 1.0;

  decision.macro_view_at_entry = {
    asset: macroView.asset || agentPacket?.symbol,
    asset_class: macroView.asset_class || null,
    direction,
    confidence: Number.isFinite(macroView.confidence) ? macroView.confidence : 0,
    horizon: macroView.horizon || null,
    regime: macroView.regime || null,
    source_theses: Array.isArray(macroView.source_theses) ? macroView.source_theses : [],
    last_updated: macroView.last_updated || null,
    gate_suggestion: {
      allow_long: allowLong,
      allow_short: allowShort,
      size_multiplier: sizeMultiplier,
      notes: gate.notes || ""
    }
  };

  if (direction === "unknown") {
    addReason(decision, "macro_view_unknown");
    decision.macro_summary = summarizeMacro(decision, macroView);
    return decision;
  }

  // Direction alignment tagging (informational; does not change action).
  if (decision.action === "LONG") {
    addReason(decision, direction === "bullish" ? "macro_agrees_long" : "macro_direction_" + direction);
  } else if (decision.action === "SHORT") {
    addReason(decision, direction === "bearish" ? "macro_agrees_short" : "macro_direction_" + direction);
  }

  // Hard block — only applied when base action is actionable.
  if (decision.action === "LONG" && !allowLong) {
    addReason(decision, "macro_disagrees_long");
    decision.action = "WAIT";
    decision.risk_tier = "BLOCKED";
  } else if (decision.action === "SHORT" && !allowShort) {
    addReason(decision, "macro_disagrees_short");
    decision.action = "WAIT";
    decision.risk_tier = "BLOCKED";
  }

  // Sizing — delegated to macro_sizing. Only attaches size_multiplier when
  // the base action is actionable (LONG/SHORT) after the direction gate.
  const sizing = computeSizingFromMacroView(macroView, decision.action);
  if (sizing.size_multiplier !== null) {
    decision.size_multiplier = sizing.size_multiplier;
    decision.macro_size_multiplier = gate.size_multiplier;
    addReason(decision, sizing.reason);
  }

  decision.macro_summary = summarizeMacro(decision, macroView);
  return decision;
}

module.exports = { applyMacroGate, summarizeMacro };
