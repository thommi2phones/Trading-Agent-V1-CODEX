#!/usr/bin/env node
"use strict";

/**
 * verify_partial_fill_pnl
 *
 * Table-driven test of lib/outcome_report.computePnlR under the
 * per-TP weighted partial-exit model. Default weights are
 * w1=0.5, w2=0.25, w3=0.25 (sums to 1.0, matches a common
 * "scale out" convention used by retail trading educators).
 *
 * Levels used throughout: entry=100, stop=95, tp1=105, tp2=110,
 * tp3=115 on a LONG. So risk = 5 and r1=1, r2=2, r3=3.
 * Symmetric for SHORT: entry=100, stop=105, tp1=95, tp2=90, tp3=85.
 */

const path = require("path");
const { computePnlR } = require(path.join(process.cwd(), "lib", "outcome_report"));

// Clear any external env so defaults apply.
delete process.env.MACRO_PNL_PARTIAL_WEIGHTS;

function longPacket(flags) {
  return {
    bias: "BULLISH",
    levels: {
      entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 115,
      hit_stop: false, hit_tp1: false, hit_tp2: false, hit_tp3: false,
      ...flags
    }
  };
}

function shortPacket(flags) {
  return {
    bias: "BEARISH",
    levels: {
      entry: 100, stop: 105, tp1: 95, tp2: 90, tp3: 85,
      hit_stop: false, hit_tp1: false, hit_tp2: false, hit_tp3: false,
      ...flags
    }
  };
}

function approxEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

const CASES = [
  // --- Stop-out scenarios ---
  {
    name: "LONG full stop, no TP hits -> -1.0",
    packet: longPacket({ hit_stop: true }),
    expect: -1.0
  },
  {
    name: "LONG stop after hit_tp1 -> 0.5*1 + 0.5*(-1) = 0 (mathematically breakeven at default weights)",
    packet: longPacket({ hit_stop: true, hit_tp1: true }),
    expect: 0
  },
  {
    name: "LONG stop after hit_tp1+hit_tp2 -> 0.5*1 + 0.25*2 + 0.25*(-1) = 0.75",
    packet: longPacket({ hit_stop: true, hit_tp1: true, hit_tp2: true }),
    expect: 0.75
  },
  // --- Winning scenarios ---
  {
    name: "LONG hit_tp3 full winner -> 0.5*1 + 0.25*2 + 0.25*3 = 1.75",
    packet: longPacket({ hit_tp1: true, hit_tp2: true, hit_tp3: true }),
    expect: 1.75
  },
  {
    name: "LONG hit_tp2 only (closed) -> 0.5*1 + 0.5*2 = 1.5",
    packet: longPacket({ hit_tp1: true, hit_tp2: true }),
    expect: 1.5
  },
  {
    name: "LONG hit_tp1 only (closed) -> full exit at tp1 = 1.0",
    packet: longPacket({ hit_tp1: true }),
    expect: 1.0
  },
  // --- Direction symmetry: SHORT ---
  {
    name: "SHORT full stop -> -1.0",
    packet: shortPacket({ hit_stop: true }),
    expect: -1.0
  },
  {
    name: "SHORT hit_tp3 full winner -> 1.75",
    packet: shortPacket({ hit_tp1: true, hit_tp2: true, hit_tp3: true }),
    expect: 1.75
  },
  {
    name: "SHORT stop after tp1+tp2 -> 0.75",
    packet: shortPacket({ hit_stop: true, hit_tp1: true, hit_tp2: true }),
    expect: 0.75
  },
  // --- Degenerate inputs ---
  {
    name: "missing entry/stop AND no TP hits -> null",
    packet: { bias: "BULLISH", levels: { hit_tp1: true } },
    expect: null
  },
  {
    name: "missing bias -> null (cannot infer direction)",
    packet: { bias: "NEUTRAL", levels: { entry: 100, stop: 95, tp1: 105, hit_tp1: true } },
    expect: null
  },
  {
    name: "stop without entry defaults to -1.0 (calibrated risk unit)",
    packet: { bias: "BULLISH", levels: { hit_stop: true } },
    expect: -1.0
  },
  {
    name: "no TP flags at all -> null",
    packet: longPacket({}),
    expect: null
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
  const got = computePnlR(tc.packet);
  let ok;
  if (tc.expect === null) ok = got === null;
  else if (got === null) ok = false;
  else ok = approxEq(got, tc.expect);
  check(tc.name, ok, `expected=${tc.expect} got=${got}`);
}

// --- Env-var override path ---
console.log("");
console.log("[partial-pnl-test] MACRO_PNL_PARTIAL_WEIGHTS override");
process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.33,0.33,0.34";
const override = computePnlR(longPacket({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("0.33/0.33/0.34 winner ~= 0.33*1 + 0.33*2 + 0.34*3 = 2.01", approxEq(override, 2.01, 1e-6), `got=${override}`);
process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.8,0.8,0.8"; // sums to 2.4, invalid
const invalidSum = computePnlR(longPacket({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("invalid weight sum falls back to defaults -> 1.75", approxEq(invalidSum, 1.75));
process.env.MACRO_PNL_PARTIAL_WEIGHTS = "0.5,0.5"; // too few entries
const badShape = computePnlR(longPacket({ hit_tp1: true, hit_tp2: true, hit_tp3: true }));
check("wrong arity falls back to defaults -> 1.75", approxEq(badShape, 1.75));
delete process.env.MACRO_PNL_PARTIAL_WEIGHTS;

console.log("");
if (failures.length === 0) {
  console.log("[partial-pnl-test] ALL CHECKS PASSED");
  process.exit(0);
}
console.error(`[partial-pnl-test] ${failures.length} CHECK(S) FAILED`);
process.exit(1);
