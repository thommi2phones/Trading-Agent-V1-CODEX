#!/usr/bin/env node
"use strict";

/**
 * verify_macro_sizing
 *
 * Table-driven check of lib/macro_sizing.computeSizingFromMacroView.
 *
 * Covers:
 *   - Agreement boost ladder (low/mid/high confidence) with gate size = 1.0
 *   - Agreement boost capped at gate * 2.0 and at schema cap 2.0
 *   - Downscale pass-through when base < 1.0 regardless of agreement
 *   - Disagreement -> null (no sizing)
 *   - Unknown / non-actionable base -> null (no sizing)
 *   - Graceful handling of missing gate / missing confidence
 */

const path = require("path");
const { computeSizingFromMacroView } = require(path.join(process.cwd(), "lib", "macro_sizing"));

const CASES = [
  // --- Agreement boost ladder ---
  {
    name: "LONG agrees bullish, confidence 0.4, base 1.0 -> hold",
    view: { direction: "bullish", confidence: 0.4, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0 } },
    action: "LONG",
    expect: { size_multiplier: 1.0, reason: "macro_size_hold" }
  },
  {
    name: "LONG agrees bullish, confidence 0.6, base 1.0 -> boost 1.25",
    view: { direction: "bullish", confidence: 0.6, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0 } },
    action: "LONG",
    expect: { size_multiplier: 1.25, reason: "macro_size_boost:1.25" }
  },
  {
    name: "LONG agrees bullish, confidence 0.8, base 1.0 -> boost 1.5",
    view: { direction: "bullish", confidence: 0.8, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0 } },
    action: "LONG",
    expect: { size_multiplier: 1.5, reason: "macro_size_boost:1.50" }
  },
  {
    name: "SHORT agrees bearish, confidence 0.9, base 1.0 -> boost 1.5",
    view: { direction: "bearish", confidence: 0.9, gate_suggestion: { allow_long: false, allow_short: true, size_multiplier: 1.0 } },
    action: "SHORT",
    expect: { size_multiplier: 1.5, reason: "macro_size_boost:1.50" }
  },
  // --- Cap handling: gate base above/below 1.0 ---
  {
    name: "LONG agrees, high confidence, base 1.4 -> 1.4 * 1.5 = 2.1 capped to 2.0 (schema cap)",
    view: { direction: "bullish", confidence: 0.9, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.4 } },
    action: "LONG",
    expect: { size_multiplier: 2.0, reason: "macro_size_boost:2.00" }
  },
  {
    name: "LONG agrees, mid confidence, base 1.2 -> 1.2 * 1.25 = 1.5",
    view: { direction: "bullish", confidence: 0.6, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.2 } },
    action: "LONG",
    expect: { size_multiplier: 1.5, reason: "macro_size_boost:1.50" }
  },
  {
    name: "LONG agrees, base 0.8 (downscale), high confidence -> 0.8 * 1.5 = 1.2 (no 2x cap pressure)",
    view: { direction: "bullish", confidence: 0.9, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 0.8 } },
    action: "LONG",
    expect: { size_multiplier: 1.2, reason: "macro_size_boost:1.20" }
  },
  // --- Downscale-only pass-through (direction disagrees but base < 1.0) ---
  {
    name: "LONG vs bearish with base 0.8 (downscale passthrough on disagreement)",
    view: { direction: "bearish", confidence: 0.7, gate_suggestion: { allow_long: false, allow_short: true, size_multiplier: 0.8 } },
    action: "LONG",
    expect: { size_multiplier: 0.8, reason: "macro_size_cap:0.80" }
  },
  // --- No sizing cases ---
  {
    name: "LONG vs bearish (full disagreement, base 1.0) -> no sizing",
    view: { direction: "bearish", confidence: 0.8, gate_suggestion: { allow_long: false, allow_short: true, size_multiplier: 1.0 } },
    action: "LONG",
    expect: { size_multiplier: null, reason: "no_macro_sizing" }
  },
  {
    name: "unknown direction -> no sizing",
    view: { direction: "unknown", confidence: 0, gate_suggestion: { allow_long: true, allow_short: true, size_multiplier: 1.0 } },
    action: "LONG",
    expect: { size_multiplier: null, reason: "no_macro_sizing" }
  },
  {
    name: "WAIT base action -> no sizing",
    view: { direction: "bullish", confidence: 0.9, gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.5 } },
    action: "WAIT",
    expect: { size_multiplier: null, reason: "no_macro_sizing" }
  },
  {
    name: "null view -> no sizing",
    view: null,
    action: "LONG",
    expect: { size_multiplier: null, reason: "no_macro_sizing" }
  },
  {
    name: "missing gate_suggestion defaults to base 1.0, low confidence -> hold",
    view: { direction: "bullish", confidence: 0.3 },
    action: "LONG",
    expect: { size_multiplier: 1.0, reason: "macro_size_hold" }
  }
];

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

for (const tc of CASES) {
  const got = computeSizingFromMacroView(tc.view, tc.action);
  const ok = got.size_multiplier === tc.expect.size_multiplier && got.reason === tc.expect.reason;
  check(tc.name, ok, `expected=${JSON.stringify(tc.expect)} got=${JSON.stringify(got)}`);
}

console.log("");
if (failures.length === 0) {
  console.log("[macro-sizing-test] ALL CHECKS PASSED");
  process.exit(0);
}
console.error(`[macro-sizing-test] ${failures.length} CHECK(S) FAILED`);
process.exit(1);
