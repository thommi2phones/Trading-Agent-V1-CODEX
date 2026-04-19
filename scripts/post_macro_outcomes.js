#!/usr/bin/env node
"use strict";

/**
 * post_macro_outcomes
 *
 * Scans events.ndjson for setups that have reached a terminal lifecycle
 * state (hit_stop, hit_tp3, or stage=closed/invalidated), builds a
 * MacroOutcomeReport per setup, and POSTs each to the macro-analyzer's
 * /source-scoring/outcome endpoint. Successfully-posted setups are
 * logged in data/macro_snapshots/_outcomes.ndjson so they are never
 * re-posted.
 *
 * Usage:
 *   node scripts/post_macro_outcomes.js                    # loop, poll every 60s
 *   node scripts/post_macro_outcomes.js --once             # one pass and exit
 *   node scripts/post_macro_outcomes.js --poll-ms 30000    # override poll interval
 *   node scripts/post_macro_outcomes.js --dry-run          # show what would be posted; no HTTP
 *
 * Env:
 *   MACRO_ANALYZER_URL       enables posting; unset = no-op
 *   MACRO_ANALYZER_BEARER    optional bearer
 *   MACRO_ANALYZER_TIMEOUT_MS request timeout (default 3000)
 */

const macroClient = require("../lib/macro_client");
const snapshotStore = require("../lib/macro_snapshot_store");
const { buildPendingOutcomeReports } = require("../lib/outcome_report");

function parseArgs(argv) {
  const args = { once: false, pollMs: 60000, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") args.once = true;
    else if (a === "--poll-ms") args.pollMs = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: post_macro_outcomes.js [--once] [--poll-ms N] [--dry-run]");
      process.exit(0);
    } else {
      console.error(`post_macro_outcomes: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  return args;
}

async function runOnce({ dryRun }) {
  const reports = buildPendingOutcomeReports();
  if (reports.length === 0) {
    return { scanned: 0, posted: 0, skipped: 0 };
  }

  let posted = 0;
  let skipped = 0;

  for (const report of reports) {
    const meta = report._meta;
    delete report._meta;

    if (dryRun) {
      console.log(`[post-macro] dry_run trade_id=${report.trade_id} direction=${report.direction} outcome=${report.outcome} pnl_r=${report.pnl_r}`);
      skipped++;
      continue;
    }

    if (!macroClient.isEnabled()) {
      console.log(`[post-macro] skipped trade_id=${report.trade_id} reason=MACRO_ANALYZER_URL_unset`);
      skipped++;
      continue;
    }

    const ack = await macroClient.postTradeOutcome(report);
    const success = !!(ack && ack.recorded === true);

    snapshotStore.appendOutcomeLog({
      setup_id: report.trade_id,
      posted: success,
      posted_at: new Date().toISOString(),
      event_id: meta?.event_id,
      terminal_kind: meta?.terminal_kind,
      ack: ack || null
    });

    if (success) {
      console.log(`[post-macro] posted trade_id=${report.trade_id} outcome=${report.outcome} pnl_r=${report.pnl_r} sources_credited=${(ack?.sources_credited || []).join(",")}`);
      posted++;
    } else {
      console.warn(`[post-macro] post_failed trade_id=${report.trade_id}; will retry on next scan`);
      skipped++;
    }
  }

  return { scanned: reports.length, posted, skipped };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[post-macro] starting once=${args.once} poll_ms=${args.pollMs} dry_run=${args.dryRun} enabled=${macroClient.isEnabled()}`);

  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[post-macro] ${sig} received, draining`);
      running = false;
    });
  }

  if (args.once) {
    const stats = await runOnce(args);
    console.log(`[post-macro] done scanned=${stats.scanned} posted=${stats.posted} skipped=${stats.skipped}`);
    return 0;
  }

  while (running) {
    try {
      const stats = await runOnce(args);
      if (stats.scanned > 0) {
        console.log(`[post-macro] pass scanned=${stats.scanned} posted=${stats.posted} skipped=${stats.skipped}`);
      }
    } catch (err) {
      console.error(`[post-macro] scan_error message="${err?.message || err}"`);
    }
    await sleep(args.pollMs);
  }
  console.log("[post-macro] stopped");
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0));
}

module.exports = { runOnce };
