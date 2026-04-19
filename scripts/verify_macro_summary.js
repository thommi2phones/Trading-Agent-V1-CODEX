#!/usr/bin/env node
"use strict";

/**
 * verify_macro_summary
 *
 * Table-driven check of lib/macro_gate.summarizeMacro. macro_summary is
 * the UI-facing derived field that collapses reason_codes + macro_view
 * into a small, stable shape:
 *   {
 *     consulted: bool,
 *     direction: "bullish"|"bearish"|"neutral"|"mixed"|"watchful"|"unknown"|null,
 *     agreement: "agree"|"disagree"|"neutral"|"unknown"|"unavailable"|"not_consulted",
 *     size_effect: "boost"|"hold"|"cap"|"none",
 *     size_multiplier: number|null
 *   }
 */

const path = require("path");
const { applyMacroGate } = require(path.join(process.cwd(), "lib", "macro_gate"));

function baseDecision(action = "LONG") {
  return { action, confidence: "HIGH", risk_tier: "A", direction_score: 5, reason_codes: [], timestamp: "" };
}

function view(direction, { conf = 0.6, allowLong = true, allowShort = true, size = 1.0 } = {}) {
  return {
    contract_version: "1.0.0",
    asset: "BTCUSDT",
    asset_class: "crypto",
    direction,
    confidence: conf,
    horizon: "2-4 weeks",
    source_theses: ["thesis_test"],
    regime: "test",
    last_updated: new Date().toISOString(),
    gate_suggestion: { allow_long: allowLong, allow_short: allowShort, size_multiplier: size, notes: "" }
  };
}

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

function assertSummary(label, got, expected) {
  for (const k of Object.keys(expected)) {
    check(`${label}: ${k}=${JSON.stringify(expected[k])}`, got[k] === expected[k], `got=${JSON.stringify(got[k])}`);
  }
}

// Reset env for deterministic runs.
delete process.env.MACRO_ANALYZER_URL;

// --- Consulted + agreement outcomes ---
const packet = { symbol: "BTCUSDT", setup_id: "s1", bias: "BULLISH" };

assertSummary(
  "bullish + LONG (agree + boost)",
  applyMacroGate(baseDecision("LONG"), packet, view("bullish", { conf: 0.9 })).macro_summary,
  { consulted: true, direction: "bullish", agreement: "agree", size_effect: "boost", size_multiplier: 1.5 }
);

assertSummary(
  "bullish + LONG low confidence (agree + hold)",
  applyMacroGate(baseDecision("LONG"), packet, view("bullish", { conf: 0.3 })).macro_summary,
  { consulted: true, direction: "bullish", agreement: "agree", size_effect: "hold", size_multiplier: 1.0 }
);

assertSummary(
  "bearish + LONG (disagree, blocked)",
  applyMacroGate(baseDecision("LONG"), packet, view("bearish", { allowLong: false, allowShort: true })).macro_summary,
  { consulted: true, direction: "bearish", agreement: "disagree", size_effect: "none", size_multiplier: null }
);

assertSummary(
  "watchful + LONG (neutral agreement, size cap 0.5)",
  applyMacroGate(baseDecision("LONG"), packet, view("watchful", { size: 0.5 })).macro_summary,
  { consulted: true, direction: "watchful", agreement: "neutral", size_effect: "cap", size_multiplier: 0.5 }
);

assertSummary(
  "neutral + LONG (neutral agreement, no sizing)",
  applyMacroGate(baseDecision("LONG"), packet, view("neutral")).macro_summary,
  { consulted: true, direction: "neutral", agreement: "neutral", size_effect: "none", size_multiplier: null }
);

assertSummary(
  "mixed + SHORT (neutral agreement)",
  applyMacroGate(baseDecision("SHORT"), packet, view("mixed")).macro_summary,
  { consulted: true, direction: "mixed", agreement: "neutral", size_effect: "none", size_multiplier: null }
);

assertSummary(
  "unknown direction + LONG (agreement=unknown, early return)",
  applyMacroGate(baseDecision("LONG"), packet, view("unknown")).macro_summary,
  { consulted: true, direction: "unknown", agreement: "unknown", size_effect: "none", size_multiplier: null }
);

// --- Not consulted paths ---
assertSummary(
  "null view, MACRO_ANALYZER_URL unset -> not_consulted",
  applyMacroGate(baseDecision("LONG"), packet, null).macro_summary,
  { consulted: false, direction: null, agreement: "not_consulted", size_effect: "none", size_multiplier: null }
);

process.env.MACRO_ANALYZER_URL = "http://example.test";
assertSummary(
  "null view, MACRO_ANALYZER_URL set -> unavailable",
  applyMacroGate(baseDecision("LONG"), packet, null).macro_summary,
  { consulted: true, direction: null, agreement: "unavailable", size_effect: "none", size_multiplier: null }
);
delete process.env.MACRO_ANALYZER_URL;

// --- Shape stability ---
const sample = applyMacroGate(baseDecision("LONG"), packet, view("bullish", { conf: 0.9 })).macro_summary;
const expectedKeys = ["consulted", "direction", "agreement", "size_effect", "size_multiplier"].sort();
check("macro_summary has exactly the documented keys", JSON.stringify(Object.keys(sample).sort()) === JSON.stringify(expectedKeys));

console.log("");
if (failures.length === 0) {
  console.log("[macro-summary-test] ALL CHECKS PASSED");
  process.exit(0);
}
console.error(`[macro-summary-test] ${failures.length} CHECK(S) FAILED`);
process.exit(1);
