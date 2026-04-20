#!/usr/bin/env node
"use strict";

/**
 * verify_partial_fill_pnl
 *
 * Table-driven test of webhook/macro_integration.computeWeightedPnlR
 * under the per-TP scale-out model. Default weights are
 * w1=0.5, w2=0.25, w3=0.25.
 *
 * Levels used throughout: entry=100, stop=95, tp1=105, tp2=110,
 * tp3=115 on a LONG (risk=5; r1=1, r2=2, r3=3). Symmetric for SHORT.
 */

const path = require("path");
const { computeWeightedPnlR } = require(path.join(process.cwd(), "webhook", "macro_integration"));

delete process.env.MACRO_PNL_PARTIAL_WEIGHTS;

function longLevels(flags) {
  return {
    direction: "long",
    entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 115,
    hit_stop: false, hit_tp1: false, hit_tp2: false, hit_tp3: false,
    ...flags
  };
}

function shortLevels(flags) {
  return {
    direction: "short",
    entry: 100, stop: 105, tp1: 95, tp2: 90, tp3: 85,
    hit_stop: false, hit_tp1: false, hit_tp2: false, hit_tp3: false,
    ...flags
  };
}

function approxEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

const CASES = [
  { name: "LONG full stop, no TP hits -> -1.0",
    args: longLevels({ hit_stop: true }), expect: -1.0 },
  { name: "LONG stop after hit_tp1 -> 0.5*1 + 0.5*(-1) = 0",
    args: longLevels({ hit_stop: true, hit_tp1: true }), expect: 0 },
  { name: "LONG stop after hit_tp1+hit_tp2 -> 0.75",
    args: longLevels({ hit_stop: true, hit_tp1: true, hit_tp2: true }), expect: 0.75 },
  { name: "LONG hit_tp3 full winner -> 1.75",
    args: longLevels({ hit_tp1: true, hit_tp2: true, hit_tp3: true }), expect: 1.75 },
  { name: "LONG hit_tp2 (closed) -> 1.5",
    args: longLevels({ hit_tp1: true, hit_tp2: true }), expect: 1.5 },
  { name: "LONG hit_tp1 (closed at tp1) -> 1.0",
    args: longLevels({ hit_tp1: true }), expect: 1.0 },
  { name: "SHORT full stop -> -1.0",
    args: shortLevels({ hit_stop: true }), expect: -1.0 },
  { name: "SHORT hit_tp3 full winner -> 1.75",
    args: shortLevels({ hit_tp1: true, hit_tp2: true, hit_tp3: true }), expect: 1.75 },
  { name: "SHORT stop after tp1+tp2 -> 0.75",
    args: shortLevels({ hit_stop: true, hit_tp1: true, hit_tp2: true }), expect: 0.75 },
  { name: "missing entry/stop AND no TP flags -> null",
    args: { direction: "long" }, expect: null },
  { name: "missing direction -> null",
    args: { entry: 100, stop: 95, tp1: 105, hit_tp1: true }, expect: null },
  { name: "stop without entry defaults to -1.0",
    args: { direction: "long", hit_stop: true }, expect: -1.0 },
  { name: "no TP flags at all -> null",
    args: longLevels({}), expect: null }
];

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`); failures.push(name); }
}

for (const tc of CASES) {
  const got = computeWeightedPnlR(tc.args);
  let ok;
  if (tc.expect === null) ok = got === null;
  else if (got === null) ok = false;
  else ok = approxEq(got, tc.expect);
  check(tc.name, ok, `expected=${tc.expect} got=${got}`);
}

console.log("");
console.log("[partial-pnl-test] MACRO_PNL_PARTIAL_WEIGHTS override");
process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.33,0.33,0.34";
const override = computeWeightedPnlR(longLevels({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("0.33/0.33/0.34 winner ~= 2.01", approxEq(override, 2.01, 1e-6), `got=${override}`);

process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.8,0.8,0.8";
const invalidSum = computeWeightedPnlR(longLevels({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("invalid sum falls back to default -> 1.75", approxEq(invalidSum, 1.75));

process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.5,0.5";
const badShape = computeWeightedPnlR(longLevels({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("wrong arity falls back -> 1.75", approxEq(badShape, 1.75));
delete process.env.MACRO_PNL_PARTIAL_WEIGHTS;

console.log("");
if (failures.length === 0) { console.log("[partial-pnl-test] ALL CHECKS PASSED"); process.exit(0); }
console.error(`[partial-pnl-test] ${failures.length} CHECK(S) FAILED`); process.exit(1);
