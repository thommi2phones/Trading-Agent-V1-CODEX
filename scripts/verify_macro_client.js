#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macro-test-"));
fs.mkdirSync(path.join(tempRoot, "webhook", "data"), { recursive: true });
fs.mkdirSync(path.join(tempRoot, "data", "macro_snapshots"), { recursive: true });

const originalCwd = process.cwd();
process.chdir(tempRoot);

process.env.MACRO_SNAPSHOT_DIR = path.join(tempRoot, "data", "macro_snapshots");
process.env.TV_DIRECT_PUBLISH = "0"; // keep bus out of this test
delete process.env.BUS_PEERS;
delete process.env.MACRO_ANALYZER_URL;
delete process.env.MACRO_ANALYZER_BEARER;

const macroClient = require(path.join(originalCwd, "lib", "macro_client"));
const { applyMacroGate } = require(path.join(originalCwd, "lib", "macro_gate"));
const { gateDecisionWithMacro } = require(path.join(originalCwd, "lib", "macro_decision"));
const snapshotStore = require(path.join(originalCwd, "lib", "macro_snapshot_store"));
const mockMacro = require(path.join(originalCwd, "scripts", "mock_macro"));
const { ingest } = require(path.join(originalCwd, "tv_direct"));
const { writeEvent } = require(path.join(originalCwd, "lib", "events_store"));
const { wrapEvent, normalizePayload } = require(path.join(originalCwd, "lib", "packet"));
const poster = require(path.join(originalCwd, "scripts", "post_macro_outcomes"));

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(originalCwd, "docs", "webhook_payload_example.json"), "utf8"));

  console.log("[macro-test] graceful disabled: no URL set");
  const disabledView = await macroClient.fetchMacroView({ asset: "BTCUSDT" });
  check("disabled fetchMacroView returns null", disabledView === null);
  check("disabled isEnabled === false", macroClient.isEnabled() === false);
  const disabledAck = await macroClient.postTradeOutcome({ trade_id: "x", symbol: "BTC", direction: "long", entry_timestamp: "", exit_timestamp: "", outcome: "win", pnl_r: 1.0, macro_view_at_entry: {} });
  check("disabled postTradeOutcome returns null", disabledAck === null);

  console.log("[macro-test] starting mock macro-analyzer");
  const mock = await mockMacro.start({ port: 0, views: {
    AAPL: {
      contract_version: "1.0.0", asset: "AAPL", asset_class: "equities",
      direction: "bearish", confidence: 0.7, horizon: "2-4 weeks",
      source_theses: ["thesis_bearish_equities"], regime: "late-cycle",
      last_updated: new Date().toISOString(),
      gate_suggestion: { allow_long: false, allow_short: true, size_multiplier: 0.8, notes: "Bearish macro on equities" }
    },
    BTCUSDT: {
      contract_version: "1.0.0", asset: "BTCUSDT", asset_class: "crypto",
      direction: "bullish", confidence: 0.72, horizon: "4-8 weeks",
      source_theses: ["thesis_btc_1"], regime: "risk-on",
      last_updated: new Date().toISOString(),
      gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "BTC bullish" }
    }
  } });
  process.env.MACRO_ANALYZER_URL = mock.url;

  console.log("[macro-test] fetchMacroView against mock");
  const btcView = await macroClient.fetchMacroView({ asset: "BTCUSDT" });
  check("btc view returned", !!btcView);
  check("btc direction bullish", btcView?.direction === "bullish");
  check("btc allow_long=true", btcView?.gate_suggestion?.allow_long === true);

  const appleView = await macroClient.fetchMacroView({ asset: "AAPL" });
  check("apple view returned", !!appleView);
  check("apple direction bearish", appleView?.direction === "bearish");
  check("apple allow_long=false", appleView?.gate_suggestion?.allow_long === false);
  check("apple size_multiplier=0.8", appleView?.gate_suggestion?.size_multiplier === 0.8);

  console.log("[macro-test] applyMacroGate — disagreement blocks LONG");
  const packetApple = { symbol: "AAPL", setup_id: "setup_apple_test", bias: "BULLISH" };
  const baseLong = { action: "LONG", confidence: "HIGH", risk_tier: "A", direction_score: 5, reason_codes: ["manual_pattern_confirmed"], timestamp: "" };
  const gatedApple = applyMacroGate(baseLong, packetApple, appleView);
  check("apple gated: action WAIT", gatedApple.action === "WAIT");
  check("apple gated: risk_tier BLOCKED", gatedApple.risk_tier === "BLOCKED");
  check("apple gated: reason macro_disagrees_long", gatedApple.reason_codes.includes("macro_disagrees_long"));
  check("apple gated: macro_view_at_entry populated", gatedApple.macro_view_at_entry?.direction === "bearish");

  console.log("[macro-test] applyMacroGate — agreement passes LONG with annotations");
  const packetBtc = { symbol: "BTCUSDT", setup_id: "setup_btc_test", bias: "BULLISH" };
  const gatedBtc = applyMacroGate(baseLong, packetBtc, btcView);
  check("btc gated: action remains LONG", gatedBtc.action === "LONG");
  check("btc gated: reason macro_agrees_long", gatedBtc.reason_codes.includes("macro_agrees_long"));
  check("btc gated: no macro_disagrees", !gatedBtc.reason_codes.some((r) => r.startsWith("macro_disagrees")));

  console.log("[macro-test] applyMacroGate — unknown direction yields unknown reason");
  const xView = await macroClient.fetchMacroView({ asset: "ZZZZ" });
  const gatedX = applyMacroGate(baseLong, { symbol: "ZZZZ", setup_id: "x" }, xView);
  check("zzzz gated: action LONG preserved", gatedX.action === "LONG");
  check("zzzz gated: reason macro_view_unknown", gatedX.reason_codes.includes("macro_view_unknown"));

  console.log("[macro-test] applyMacroGate — null view + URL set yields macro_unavailable");
  const gatedNull = applyMacroGate(baseLong, { symbol: "X", setup_id: "x2" }, null);
  check("null view: reason macro_unavailable (URL set)", gatedNull.reason_codes.includes("macro_unavailable"));

  console.log("[macro-test] gateDecisionWithMacro + snapshot persistence");
  const gatedWithStore = await gateDecisionWithMacro(baseLong, packetApple);
  check("gated decision via helper: action WAIT", gatedWithStore.action === "WAIT");
  check("snapshot file written", snapshotStore.hasSnapshot("setup_apple_test"));
  const snapRecord = snapshotStore.readSnapshot("setup_apple_test");
  check("snapshot: direction bearish", snapRecord?.snapshot?.direction === "bearish");

  const firstSnap = JSON.stringify(snapRecord);
  const gatedAgain = await gateDecisionWithMacro(baseLong, packetApple);
  const snapRecord2 = snapshotStore.readSnapshot("setup_apple_test");
  check("snapshot immutable after first save", JSON.stringify(snapRecord2) === firstSnap);

  console.log("[macro-test] end-to-end via tv_direct.ingest (macro consulted inline)");
  // Supply entry/stop/tp so base decision produces LONG; macro then blocks.
  const appleFixture = {
    ...fixture,
    symbol: "AAPL",
    setup_id: "setup_apple_e2e",
    taxonomy_version: "tax_v1",
    entry_price: 182.50,
    stop_price: 179.80,
    tp1_price: 186.00,
    tp2_price: 188.50,
    tp3_price: 191.00,
    near_entry: true
  };
  const ingestResult = await ingest(appleFixture, { source: "tv_direct_pine" });
  check("tv_direct ingest: macro_view_at_entry populated (macro consulted)", ingestResult.decision.macro_view_at_entry?.direction === "bearish");
  check("tv_direct ingest: decision WAIT (macro bearish blocks long)", ingestResult.decision.action === "WAIT");
  check("tv_direct ingest: risk_tier BLOCKED", ingestResult.decision.risk_tier === "BLOCKED");
  check("tv_direct ingest: macro_disagrees_long reason", ingestResult.decision.reason_codes.includes("macro_disagrees_long"));
  check("tv_direct ingest: snapshot stored for setup", snapshotStore.hasSnapshot("setup_apple_e2e"));

  console.log("[macro-test] outcome poster — terminal event + stored snapshot");
  // write an additional event marking tp3 hit for a winning BTC long
  const btcPayload = normalizePayload({
    ...fixture,
    symbol: "BTCUSDT",
    setup_id: "setup_btc_winner",
    bias: "BULLISH",
    entry_price: 65000,
    stop_price: 64000,
    tp1_price: 66000,
    tp2_price: 67000,
    tp3_price: 68000,
    hit_entry: true,
    hit_tp1: true,
    hit_tp2: true,
    hit_tp3: true,
    setup_stage: "closed"
  });
  // save macro snapshot matching what tv_direct would have captured
  snapshotStore.saveSnapshotOnce("setup_btc_winner", {
    asset: "BTCUSDT", direction: "bullish", confidence: 0.72,
    source_theses: ["thesis_btc_1"], regime: "risk-on",
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  // write an entry event then a terminal event
  writeEvent(wrapEvent({ payload: { ...btcPayload, setup_stage: "in_trade", hit_tp3: false, hit_tp2: false, hit_tp1: false }, source: "tv_direct_pine", event_id: "evt-btc-entry", received_at: "2026-04-15T14:00:00.000Z" }));
  writeEvent(wrapEvent({ payload: btcPayload, source: "tv_direct_pine", event_id: "evt-btc-closed", received_at: "2026-04-18T20:30:00.000Z" }));

  const stats = await poster.runOnce({ dryRun: false });
  check("poster scanned >= 1", stats.scanned >= 1);
  check("poster posted >= 1", stats.posted >= 1);
  check("mock macro received outcome", mock.outcomes.length >= 1);
  const posted = mock.outcomes.find((r) => r.trade_id === "setup_btc_winner");
  check("posted: outcome=win", posted?.outcome === "win");
  check("posted: direction=long", posted?.direction === "long");
  check("posted: pnl_r ~= 3.0", posted && Math.abs(posted.pnl_r - 3.0) < 0.01);
  check("posted: macro_view_at_entry.direction=bullish", posted?.macro_view_at_entry?.direction === "bullish");
  check("posted: contract_version=1.0.0", posted?.contract_version === "1.0.0");
  check("outcomes log records post", snapshotStore.outcomeAlreadyPosted("setup_btc_winner"));

  console.log("[macro-test] idempotency — second run does not repost");
  const stats2 = await poster.runOnce({ dryRun: false });
  check("second run posts 0", stats2.posted === 0);
  check("mock macro still has only one outcome for this trade",
    mock.outcomes.filter((r) => r.trade_id === "setup_btc_winner").length === 1);

  console.log("[macro-test] macro timeout is graceful");
  process.env.MACRO_ANALYZER_URL = "http://127.0.0.1:1"; // connection refused
  process.env.MACRO_ANALYZER_TIMEOUT_MS = "300";
  const timeoutView = await macroClient.fetchMacroView({ asset: "BTCUSDT" });
  check("timeout view returns null, no throw", timeoutView === null);
  process.env.MACRO_ANALYZER_URL = mock.url;
  delete process.env.MACRO_ANALYZER_TIMEOUT_MS;

  await mock.close();
  process.chdir(originalCwd);

  console.log("");
  if (failures.length === 0) {
    console.log("[macro-test] ALL CHECKS PASSED");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return 0;
  }
  console.error(`[macro-test] ${failures.length} CHECK(S) FAILED`);
  console.error(`[macro-test] tempRoot kept for inspection: ${tempRoot}`);
  return 1;
}

main().then((code) => process.exit(code));
