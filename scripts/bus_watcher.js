#!/usr/bin/env node
"use strict";

/**
 * bus_watcher
 *
 * Long-running process that claims inbound envelopes targeted at a
 * specific perception agent role, dispatches them, and publishes
 * responses back onto the perception bus.
 *
 * Usage:
 *   node scripts/bus_watcher.js --role ta_charts [--poll-ms 1000] [--once]
 *
 * Flow:
 *   1. Poll coordination/bus/inbox/ for envelopes with matching
 *      to_agent_role.
 *   2. Atomically move to processing/.
 *   3. Dispatch by request_type + embedded payload shape.
 *   4. On success, move original request to completed/; the response
 *      envelope is published by the dispatcher.
 *   5. On failure, move to failed/ and drop a sibling .err.txt with
 *      the error message.
 *
 * Dispatch rules for role ta_charts:
 *
 *   - If envelope.payload.pine_snapshot is present (object with
 *     symbol/timeframe/bar_time), call tv_direct.ingest() with
 *     source=tv_direct_pine. This is the "macro already provided chart
 *     state" path and is fully automated.
 *
 *   - Otherwise, the request requires a live TradingView read from a
 *     Claude coworking session. The watcher writes a marker file to
 *     tv_direct/pending/<request_id>.json and moves the original to
 *     processing/. A separate Claude session is expected to pick up
 *     the marker, call tv_direct.ingest, and then move the original
 *     from processing/ to completed/.
 *
 *     If --require-payload is passed, the watcher instead fails the
 *     request immediately with reason "needs_live_read". Useful in
 *     automated environments where no Claude session is attached.
 */

const fs = require("fs");
const path = require("path");
const {
  ensureBusDirs,
  readInboxFor,
  moveEnvelope,
  busDir
} = require("../lib/agent_bus");
const { ingest } = require("../tv_direct");

function parseArgs(argv) {
  const args = { role: null, pollMs: 1000, once: false, requirePayload: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role") args.role = argv[++i];
    else if (a === "--poll-ms") args.pollMs = Number(argv[++i]);
    else if (a === "--once") args.once = true;
    else if (a === "--require-payload") args.requirePayload = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: bus_watcher.js --role <role> [--poll-ms N] [--once] [--require-payload]");
      process.exit(0);
    } else {
      console.error(`bus_watcher: unknown arg '${a}'`);
      process.exit(2);
    }
  }
  if (!args.role) {
    console.error("bus_watcher: --role is required");
    process.exit(2);
  }
  return args;
}

function writeErrSibling(failedPath, message) {
  const errPath = failedPath.replace(/\.json$/, ".err.txt");
  fs.writeFileSync(errPath, String(message) + "\n", "utf8");
}

function writePendingMarker(envelope) {
  const markerDir = path.join(process.cwd(), "tv_direct", "pending");
  fs.mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, `${envelope.envelope_id}.json`);
  fs.writeFileSync(markerPath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  return markerPath;
}

async function dispatchForTaCharts(envelope, { requirePayload }) {
  const snap = envelope?.payload?.pine_snapshot;
  if (snap && typeof snap === "object") {
    return {
      kind: "auto_ingest",
      result: await ingest(snap, {
        source: "tv_direct_pine",
        request_envelope: envelope
      })
    };
  }

  if (requirePayload) {
    throw new Error("needs_live_read: request has no embedded pine_snapshot and --require-payload is set");
  }

  const markerPath = writePendingMarker(envelope);
  return { kind: "queued_for_claude", marker: markerPath };
}

async function dispatch(envelope, opts) {
  if (envelope.to_agent_role === "ta_charts") {
    return dispatchForTaCharts(envelope, opts);
  }
  throw new Error(`bus_watcher: no dispatcher registered for role '${envelope.to_agent_role}'`);
}

async function processOne(match, opts) {
  const { filePath, envelope } = match;
  const processingPath = moveEnvelope(filePath, "processing");

  try {
    const outcome = await dispatch(envelope, opts);

    if (outcome.kind === "queued_for_claude") {
      // Leave in processing/ — Claude session will complete it.
      console.log(`[bus-watcher] queued_for_claude envelope=${envelope.envelope_id} marker=${outcome.marker}`);
      return outcome;
    }

    const completedPath = moveEnvelope(processingPath, "completed");
    console.log(`[bus-watcher] completed envelope=${envelope.envelope_id} at=${completedPath}`);
    return outcome;
  } catch (err) {
    const failedPath = moveEnvelope(processingPath, "failed");
    writeErrSibling(failedPath, err?.message || String(err));
    console.error(`[bus-watcher] failed envelope=${envelope.envelope_id} reason="${err?.message || err}"`);
    return { kind: "failed", reason: err?.message || String(err) };
  }
}

async function scanOnce(opts) {
  ensureBusDirs();
  const matches = readInboxFor(opts.role);
  const outcomes = [];
  for (const m of matches) {
    outcomes.push(await processOne(m, opts));
  }
  return outcomes;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[bus-watcher] starting role=${args.role} bus_dir=${busDir()} poll_ms=${args.pollMs}${args.once ? " once" : ""}`);

  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[bus-watcher] ${sig} received, draining`);
      running = false;
    });
  }

  if (args.once) {
    const outcomes = await scanOnce(args);
    console.log(`[bus-watcher] --once scan processed=${outcomes.length}`);
    return 0;
  }

  while (running) {
    try {
      await scanOnce(args);
    } catch (err) {
      console.error(`[bus-watcher] scan_error message="${err?.message || err}"`);
    }
    await sleep(args.pollMs);
  }
  console.log("[bus-watcher] stopped");
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0));
}

module.exports = { scanOnce, processOne, dispatch };
