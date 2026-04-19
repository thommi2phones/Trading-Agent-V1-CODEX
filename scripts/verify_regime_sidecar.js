#!/usr/bin/env node
"use strict";

/**
 * verify_regime_sidecar
 *
 * End-to-end check of scripts/poll_macro_regime.runOnce():
 *   - Disabled (no MACRO_ANALYZER_URL) returns ok=false, reason=macro_client_disabled.
 *   - First observation logs without writing an event.
 *   - Second poll (same regime) reports no change, no event.
 *   - Regime change triggers a single event with the expected shape,
 *     including the list of stale active setups.
 *   - Closed setups (outcome already posted) are excluded from the
 *     stale list.
 *   - --dry-run path detects a change but does not write an event.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "regime-sidecar-test-"));
fs.mkdirSync(path.join(tempRoot, "webhook", "data"), { recursive: true });
fs.mkdirSync(path.join(tempRoot, "data", "macro_snapshots"), { recursive: true });

const originalCwd = process.cwd();
process.chdir(tempRoot);
process.env.MACRO_SNAPSHOT_DIR = path.join(tempRoot, "data", "macro_snapshots");
delete process.env.MACRO_ANALYZER_URL;

const sidecar = require(path.join(originalCwd, "scripts", "poll_macro_regime"));
const snapshotStore = require(path.join(originalCwd, "lib", "macro_snapshot_store"));
const { readRecentEvents } = require(path.join(originalCwd, "lib", "events_store"));
const mockMacro = require(path.join(originalCwd, "scripts", "mock_macro"));

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
  console.log("[regime-sidecar-test] disabled: no URL set -> ok=false");
  const disabled = await sidecar.runOnce();
  check("disabled runOnce ok=false", disabled.ok === false);
  check("disabled reason=macro_client_disabled", disabled.reason === "macro_client_disabled");

  console.log("[regime-sidecar-test] starting mock macro-analyzer");
  const mock = await mockMacro.start({ port: 0, regime: { regime: "risk-on" } });
  process.env.MACRO_ANALYZER_URL = mock.url;

  console.log("[regime-sidecar-test] first observation: no event write");
  const first = await sidecar.runOnce();
  check("first ok=true", first.ok === true);
  check("first change.changed=true (first observation)", first.change?.changed === true);
  check("first first_observation=true", first.change?.first_observation === true);
  check("first event_written=false (first observation skipped)", first.event_written === false);
  let events = readRecentEvents(50, "");
  check("no events written after first observation", events.length === 0);

  console.log("[regime-sidecar-test] unchanged poll: no event write");
  const unchanged = await sidecar.runOnce();
  check("unchanged change.changed=false", unchanged.change?.changed === false);
  check("unchanged event_written=false", unchanged.event_written === false);
  events = readRecentEvents(50, "");
  check("still no events", events.length === 0);

  console.log("[regime-sidecar-test] seeding active + closed setups");
  snapshotStore.saveSnapshotOnce("setup_active_btc", {
    asset: "BTCUSDT", direction: "bullish", confidence: 0.7, regime: "risk-on",
    source_theses: ["thesis_btc"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  snapshotStore.saveSnapshotOnce("setup_active_eth", {
    asset: "ETHUSDT", direction: "bullish", confidence: 0.6, regime: "risk-on",
    source_theses: ["thesis_eth"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  snapshotStore.saveSnapshotOnce("setup_closed_gld", {
    asset: "GLD", direction: "bullish", confidence: 0.6, regime: "risk-on",
    source_theses: ["thesis_gld"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  snapshotStore.appendOutcomeLog({ setup_id: "setup_closed_gld", posted: true, at: new Date().toISOString() });

  console.log("[regime-sidecar-test] --dry-run change detection: no event write");
  mock.setRegime("risk-off");
  const dry = await sidecar.runOnce({ dryRun: true });
  check("dry change.changed=true", dry.change?.changed === true);
  check("dry event_written=false (dry run)", dry.event_written === false);
  check("dry stale_count=2", dry.stale_count === 2);
  events = readRecentEvents(50, "");
  check("no event yet (dry run)", events.length === 0);

  console.log("[regime-sidecar-test] live change detection writes event");
  mock.setRegime("risk-off-deep");
  const changed = await sidecar.runOnce();
  check("changed ok=true", changed.ok === true);
  check("changed event_written=true", changed.event_written === true);
  check("changed change.from=risk-off", changed.change?.from === "risk-off");
  check("changed change.to=risk-off-deep", changed.change?.to === "risk-off-deep");
  check("changed stale_count=2", changed.stale_count === 2);

  console.log("[regime-sidecar-test] event shape");
  events = readRecentEvents(50, "");
  check("exactly one regime event written", events.length === 1);
  const evt = events[0];
  check("event source=macro_regime_watcher", evt.source === "macro_regime_watcher");
  check("event accepted=true", evt.accepted === true);
  check("payload.event_kind=macro_regime_change", evt.payload?.event_kind === "macro_regime_change");
  check("payload.from_regime=risk-off", evt.payload?.from_regime === "risk-off");
  check("payload.to_regime=risk-off-deep", evt.payload?.to_regime === "risk-off-deep");
  check("payload.first_observation=false", evt.payload?.first_observation === false);
  const staleIds = new Set(evt.payload?.stale_active_setups || []);
  check("stale setup list includes setup_active_btc", staleIds.has("setup_active_btc"));
  check("stale setup list includes setup_active_eth", staleIds.has("setup_active_eth"));
  check("stale setup list excludes setup_closed_gld", !staleIds.has("setup_closed_gld"));
  const detailBtc = (evt.payload?.stale_active_setups_detail || []).find((s) => s.setup_id === "setup_active_btc");
  check("detail entry has entry_regime=risk-on", detailBtc?.entry_regime === "risk-on");
  check("detail entry has current_regime=risk-off-deep", detailBtc?.current_regime === "risk-off-deep");

  await mock.close();
  process.chdir(originalCwd);

  console.log("");
  if (failures.length === 0) {
    console.log("[regime-sidecar-test] ALL CHECKS PASSED");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return 0;
  }
  console.error(`[regime-sidecar-test] ${failures.length} CHECK(S) FAILED`);
  console.error(`[regime-sidecar-test] tempRoot kept for inspection: ${tempRoot}`);
  return 1;
}

main().then((code) => process.exit(code));
