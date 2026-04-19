#!/usr/bin/env node
"use strict";

/**
 * verify_macro_regime
 *
 * End-to-end check of the regime watcher:
 *   - fetchRegime is a silent no-op when MACRO_ANALYZER_URL is unset.
 *   - Against a live mock, first poll records the regime as a "first
 *     observation" and does not flag any active setups as stale.
 *   - Identical second poll reports no change.
 *   - mock_macro.setRegime() changes the regime; next poll reports a
 *     change and lists the active (not-yet-closed) setups whose
 *     snapshot regime no longer matches.
 *   - Setups whose outcome has already been posted are excluded from
 *     the stale list (they're closed; regime change is irrelevant).
 *   - Timeout / unreachable endpoint returns { ok: false } without
 *     throwing.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "macro-regime-test-"));
fs.mkdirSync(path.join(tempRoot, "data", "macro_snapshots"), { recursive: true });

const originalCwd = process.cwd();
process.chdir(tempRoot);
process.env.MACRO_SNAPSHOT_DIR = path.join(tempRoot, "data", "macro_snapshots");
delete process.env.MACRO_ANALYZER_URL;
delete process.env.MACRO_ANALYZER_BEARER;

const macroClient = require(path.join(originalCwd, "lib", "macro_client"));
const watcher = require(path.join(originalCwd, "lib", "macro_regime_watcher"));
const snapshotStore = require(path.join(originalCwd, "lib", "macro_snapshot_store"));
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
  console.log("[regime-test] disabled: no MACRO_ANALYZER_URL -> silent no-op");
  const disabled = await macroClient.fetchRegime();
  check("disabled fetchRegime returns null", disabled === null);
  const disabledPoll = await watcher.pollOnce();
  check("disabled pollOnce returns ok=false", disabledPoll.ok === false);
  check("disabled pollOnce reason=macro_client_disabled", disabledPoll.reason === "macro_client_disabled");

  console.log("[regime-test] starting mock macro-analyzer");
  const mock = await mockMacro.start({ port: 0, regime: { regime: "risk-on" } });
  process.env.MACRO_ANALYZER_URL = mock.url;

  console.log("[regime-test] first poll — no prior state, first_observation=true");
  const pollA = await watcher.pollOnce();
  check("poll A ok", pollA.ok === true);
  check("poll A current regime=risk-on", pollA.current?.regime === "risk-on");
  check("poll A change.changed=true (first observation)", pollA.change?.changed === true);
  check("poll A change.first_observation=true", pollA.change?.first_observation === true);
  check("poll A stale_active_setups=[] (no snapshots yet)", Array.isArray(pollA.stale_active_setups) && pollA.stale_active_setups.length === 0);

  console.log("[regime-test] second poll — same regime -> no change");
  const pollB = await watcher.pollOnce();
  check("poll B ok", pollB.ok === true);
  check("poll B change.changed=false", pollB.change?.changed === false);
  check("poll B stale_active_setups=[] (no change)", pollB.stale_active_setups.length === 0);

  console.log("[regime-test] seed active setups with risk-on regime snapshots");
  snapshotStore.saveSnapshotOnce("setup_active_btc", {
    asset: "BTCUSDT", direction: "bullish", confidence: 0.7, regime: "risk-on",
    source_theses: ["thesis_btc_risk_on"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  snapshotStore.saveSnapshotOnce("setup_active_eth", {
    asset: "ETHUSDT", direction: "bullish", confidence: 0.65, regime: "risk-on",
    source_theses: ["thesis_eth_risk_on"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  snapshotStore.saveSnapshotOnce("setup_closed_gld", {
    asset: "GLD", direction: "bullish", confidence: 0.6, regime: "risk-on",
    source_theses: ["thesis_gld_risk_on"],
    gate_suggestion: { allow_long: true, allow_short: false, size_multiplier: 1.0, notes: "" }
  });
  // Mark closed-gld as already posted so the watcher skips it.
  snapshotStore.appendOutcomeLog({ setup_id: "setup_closed_gld", posted: true, at: new Date().toISOString() });

  console.log("[regime-test] regime change risk-on -> risk-off");
  mock.setRegime("risk-off");
  const pollC = await watcher.pollOnce();
  check("poll C ok", pollC.ok === true);
  check("poll C change.changed=true", pollC.change?.changed === true);
  check("poll C change.from=risk-on", pollC.change?.from === "risk-on");
  check("poll C change.to=risk-off", pollC.change?.to === "risk-off");
  const staleIds = new Set((pollC.stale_active_setups || []).map((s) => s.setup_id));
  check("poll C lists setup_active_btc as stale", staleIds.has("setup_active_btc"));
  check("poll C lists setup_active_eth as stale", staleIds.has("setup_active_eth"));
  check("poll C excludes setup_closed_gld (outcome posted)", !staleIds.has("setup_closed_gld"));
  check("poll C stale list size = 2", pollC.stale_active_setups.length === 2);
  const firstStale = pollC.stale_active_setups.find((s) => s.setup_id === "setup_active_btc");
  check("poll C stale entry has entry_regime=risk-on", firstStale?.entry_regime === "risk-on");
  check("poll C stale entry has current_regime=risk-off", firstStale?.current_regime === "risk-off");

  console.log("[regime-test] subsequent identical poll -> no change, empty stale list");
  const pollD = await watcher.pollOnce();
  check("poll D change.changed=false", pollD.change?.changed === false);
  check("poll D stale_active_setups=[]", pollD.stale_active_setups.length === 0);

  console.log("[regime-test] timeout is graceful");
  process.env.MACRO_ANALYZER_URL = "http://127.0.0.1:1";
  process.env.MACRO_ANALYZER_TIMEOUT_MS = "300";
  const timeoutPoll = await watcher.pollOnce();
  check("timeout pollOnce ok=false", timeoutPoll.ok === false);
  check("timeout pollOnce reason=macro_unavailable", timeoutPoll.reason === "macro_unavailable");
  process.env.MACRO_ANALYZER_URL = mock.url;
  delete process.env.MACRO_ANALYZER_TIMEOUT_MS;

  await mock.close();
  process.chdir(originalCwd);

  console.log("");
  if (failures.length === 0) {
    console.log("[regime-test] ALL CHECKS PASSED");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return 0;
  }
  console.error(`[regime-test] ${failures.length} CHECK(S) FAILED`);
  console.error(`[regime-test] tempRoot kept for inspection: ${tempRoot}`);
  return 1;
}

main().then((code) => process.exit(code));
