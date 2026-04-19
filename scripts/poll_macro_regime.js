#!/usr/bin/env node
"use strict";

/**
 * poll_macro_regime
 *
 * Long-running sidecar that periodically calls
 * lib/macro_regime_watcher.pollOnce() and, on every detected change,
 * writes a synthetic `macro_regime_change` event into
 * webhook/data/events.ndjson. The event carries the from/to regime
 * strings and the list of active (not-yet-closed) setups whose entry
 * snapshot regime no longer matches current.
 *
 * Downstream consumers read the event via the existing
 * `GET /events/latest` + `GET /events?setup_id=...` APIs. This module
 * does NOT re-gate or cancel setups on its own — that's a future
 * policy layer.
 *
 * Usage:
 *   node scripts/poll_macro_regime.js                    # loop, 60s interval
 *   node scripts/poll_macro_regime.js --once             # one pass and exit
 *   node scripts/poll_macro_regime.js --poll-ms 30000    # override interval
 *   node scripts/poll_macro_regime.js --dry-run          # no event writes
 *
 * Env:
 *   MACRO_ANALYZER_URL        enables polling; unset = no-op
 *   MACRO_ANALYZER_BEARER     optional bearer
 *   MACRO_ANALYZER_TIMEOUT_MS request timeout (default 3000)
 *   MACRO_SNAPSHOT_DIR        snapshot + cache dir (default data/macro_snapshots)
 */

const macroClient = require("../lib/macro_client");
const watcher = require("../lib/macro_regime_watcher");
const { writeEvent } = require("../lib/events_store");

function parseArgs(argv) {
  const args = { once: false, pollMs: 60000, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") args.once = true;
    else if (a === "--poll-ms") args.pollMs = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: poll_macro_regime.js [--once] [--poll-ms N] [--dry-run]");
      process.exit(0);
    } else {
      console.error(`poll_macro_regime: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  return args;
}

function buildRegimeChangeEvent(poll) {
  const change = poll.change;
  const changeEventId = `regime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    event_id: changeEventId,
    received_at: new Date().toISOString(),
    source: "macro_regime_watcher",
    accepted: true,
    payload: {
      event_kind: "macro_regime_change",
      from_regime: change.from,
      to_regime: change.to,
      first_observation: !!change.first_observation,
      observed_at: poll.current?.observed_at || null,
      last_updated: poll.current?.last_updated || null,
      stale_active_setups: (poll.stale_active_setups || []).map((s) => s.setup_id),
      stale_active_setups_detail: poll.stale_active_setups || []
    }
  };
}

async function runOnce({ dryRun } = {}) {
  const poll = await watcher.pollOnce();
  if (!poll.ok) {
    return { ok: false, reason: poll.reason, change: null, event_written: false };
  }

  const change = poll.change;
  if (!change?.changed) {
    return { ok: true, change, event_written: false, stale_count: 0 };
  }

  // Skip event emission on first-observation — there's no prior-regime
  // context, so there's no invalidation to report. Dashboard can still
  // read the cache directly if it wants the current regime.
  if (change.first_observation) {
    console.log(`[regime-sidecar] first_observation regime=${change.to}`);
    return { ok: true, change, event_written: false, stale_count: 0 };
  }

  const staleCount = (poll.stale_active_setups || []).length;
  console.log(`[regime-sidecar] regime_change from=${change.from} to=${change.to} stale_active=${staleCount}`);

  if (dryRun) {
    return { ok: true, change, event_written: false, stale_count: staleCount, dry_run: true };
  }

  const event = buildRegimeChangeEvent(poll);
  writeEvent(event);
  return { ok: true, change, event_written: true, stale_count: staleCount };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[regime-sidecar] starting once=${args.once} poll_ms=${args.pollMs} dry_run=${args.dryRun} enabled=${macroClient.isEnabled()}`);

  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[regime-sidecar] ${sig} received, draining`);
      running = false;
    });
  }

  if (args.once) {
    const result = await runOnce(args);
    console.log(`[regime-sidecar] done ok=${result.ok} changed=${result.change?.changed || false} stale=${result.stale_count || 0}`);
    return 0;
  }

  while (running) {
    try {
      await runOnce(args);
    } catch (err) {
      console.error(`[regime-sidecar] poll_error message="${err?.message || err}"`);
    }
    await sleep(args.pollMs);
  }
  console.log("[regime-sidecar] stopped");
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0));
}

module.exports = { runOnce, buildRegimeChangeEvent };
