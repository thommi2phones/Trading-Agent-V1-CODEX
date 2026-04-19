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
 *   - If the gate's size_multiplier < 1.0, annotate with macro_size_cap
 *     (size logic itself lives outside this module for now).
 *   - If the gate agrees with direction, emit macro_agrees_long|short.
 *
 * Note: webhook/decision.js stays a pure synchronous function with a stable
 * signature. applyMacroGate is invoked by call sites (server.js,
 * tv_direct/index.js) after the base decision is computed, so the parity
 * test against buildAgentPacket remains untouched.
 */

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

  if (sizeMultiplier < 1.0 && ["LONG", "SHORT"].includes(decision.action)) {
    addReason(decision, `macro_size_cap:${sizeMultiplier.toFixed(2)}`);
    decision.macro_size_multiplier = sizeMultiplier;
  }

  return decision;
}

module.exports = { applyMacroGate };
