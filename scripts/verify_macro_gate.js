#!/usr/bin/env node
"use strict";

/**
 * verify_macro_gate
 *
 * Tests webhook/macro_integration.applyMacroGate against the full
 * macro-analyzer direction enum: bullish, bearish, neutral, mixed,
 * watchful, unknown. Also verifies decision.macro_summary shape and
 * sizing side effects.
 */

const path = require("path");
delete process.env.MACRO_ANALYZER_URL;
const { applyMacroGate } = require(path.join(process.cwd(), "webhook", "macro_integration"));

function baseDecision(action = "LONG") {
  return { action, confidence: "HIGH", risk_tier: "A", direction_score: 5, reason_codes: [], timestamp: "" };
}

function view(direction, { conf = 0.6, allowLong = true, allowShort = true, size = 1.0 } = {}) {
  return {
    contract_version: "1.0.0", asset: "BTCUSDT", asset_class: "crypto",
    direction, confidence: conf, horizon: "2-4 weeks",
    source_theses: ["thesis_test"], regime: "test",
    last_updated: new Date().toISOString(),
    gate_suggestion: { allow_long: allowLong, allow_short: allowShort, size_multiplier: size, notes: "" }
  };
}

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`); failures.push(name); }
}

function assertSummary(label, got, expected) {
  for (const k of Object.keys(expected)) {
    check(`${label}: macro_summary.${k}=${JSON.stringify(expected[k])}`, got[k] === expected[k], `got=${JSON.stringify(got[k])}`);
  }
}

console.log("[gate-test] direction agreement + sizing");

const bullishAgree = applyMacroGate(baseDecision("LONG"), view("bullish", { conf: 0.9 }));
check("bullish + LONG: action remains LONG", bullishAgree.action === "LONG");
check("bullish + LONG: reason macro_aligns_long", bullishAgree.reason_codes.includes("macro_aligns_long"));
check("bullish + LONG: size_multiplier 1.5", bullishAgree.size_multiplier === 1.5);
check("bullish + LONG: reason macro_size_boost:1.50", bullishAgree.reason_codes.includes("macro_size_boost:1.50"));
assertSummary("bullish + LONG", bullishAgree.macro_summary, { consulted: true, direction: "bullish", agreement: "agree", size_effect: "boost", size_multiplier: 1.5 });

const bearishBlocks = applyMacroGate(baseDecision("LONG"), view("bearish", { allowLong: false }));
check("bearish + LONG: action WAIT", bearishBlocks.action === "WAIT");
check("bearish + LONG: risk_tier BLOCKED", bearishBlocks.risk_tier === "BLOCKED");
check("bearish + LONG: reason macro_blocks_long", bearishBlocks.reason_codes.includes("macro_blocks_long"));
check("bearish + LONG: no size_multiplier (blocked)", bearishBlocks.size_multiplier === undefined);
assertSummary("bearish + LONG", bearishBlocks.macro_summary, { consulted: true, direction: "bearish", agreement: "disagree", size_effect: "none", size_multiplier: null });

console.log("[gate-test] non-directional views");

const watchful = applyMacroGate(baseDecision("LONG"), view("watchful", { size: 0.5 }));
check("watchful + LONG: action preserved", watchful.action === "LONG");
check("watchful + LONG: reason macro_direction_watchful", watchful.reason_codes.includes("macro_direction_watchful"));
check("watchful + LONG: size_multiplier 0.5", watchful.size_multiplier === 0.5);
check("watchful + LONG: reason macro_size_cap:0.50", watchful.reason_codes.includes("macro_size_cap:0.50"));
assertSummary("watchful + LONG", watchful.macro_summary, { consulted: true, direction: "watchful", agreement: "neutral", size_effect: "cap", size_multiplier: 0.5 });

const neutral = applyMacroGate(baseDecision("LONG"), view("neutral"));
check("neutral + LONG: reason macro_direction_neutral", neutral.reason_codes.includes("macro_direction_neutral"));
check("neutral + LONG: no size_multiplier", neutral.size_multiplier === undefined);
assertSummary("neutral + LONG", neutral.macro_summary, { consulted: true, direction: "neutral", agreement: "neutral", size_effect: "none", size_multiplier: null });

const mixed = applyMacroGate(baseDecision("SHORT"), view("mixed"));
check("mixed + SHORT: reason macro_direction_mixed", mixed.reason_codes.includes("macro_direction_mixed"));
assertSummary("mixed + SHORT", mixed.macro_summary, { consulted: true, direction: "mixed", agreement: "neutral", size_effect: "none", size_multiplier: null });

console.log("[gate-test] unknown + unavailable + not_consulted");

const unknown = applyMacroGate(baseDecision("LONG"), view("unknown"));
check("unknown + LONG: action preserved", unknown.action === "LONG");
check("unknown + LONG: reason macro_no_view", unknown.reason_codes.includes("macro_no_view"));
check("unknown + LONG: no size_multiplier", unknown.size_multiplier === undefined);
assertSummary("unknown + LONG", unknown.macro_summary, { consulted: true, direction: "unknown", agreement: "unknown", size_effect: "none", size_multiplier: null });

delete process.env.MACRO_ANALYZER_URL;
const notConsulted = applyMacroGate(baseDecision("LONG"), null);
check("null view, no URL: no macro_no_view reason", !notConsulted.reason_codes.includes("macro_no_view"));
assertSummary("null view, no URL", notConsulted.macro_summary, { consulted: false, direction: null, agreement: "not_consulted", size_effect: "none", size_multiplier: null });

// Need to re-require with URL set to exercise the "unavailable" branch.
process.env.MACRO_ANALYZER_URL = "http://127.0.0.1:1";
delete require.cache[require.resolve(path.join(process.cwd(), "webhook", "macro_integration"))];
const { applyMacroGate: applyWithUrl } = require(path.join(process.cwd(), "webhook", "macro_integration"));
const unavailable = applyWithUrl(baseDecision("LONG"), null);
check("null view, URL set: reason macro_no_view", unavailable.reason_codes.includes("macro_no_view"));
assertSummary("null view, URL set", unavailable.macro_summary, { consulted: false, direction: null, agreement: "unavailable", size_effect: "none", size_multiplier: null });
delete process.env.MACRO_ANALYZER_URL;

console.log("");
if (failures.length === 0) { console.log("[gate-test] ALL CHECKS PASSED"); process.exit(0); }
console.error(`[gate-test] ${failures.length} CHECK(S) FAILED`); process.exit(1);
