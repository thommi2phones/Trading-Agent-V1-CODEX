"use strict";

/**
 * macro_snapshot_store
 *
 * Persists the macro_view_at_entry attached to a setup when the decision
 * engine first gates it. Later, when the setup closes (hit_tp* or
 * hit_stop), the outcome poster reads the snapshot back to fill
 * MacroOutcomeReport.macro_view_at_entry per the macro integration
 * contract.
 *
 * Layout:
 *   data/macro_snapshots/{setup_id}.json      — single per-setup snapshot
 *   data/macro_snapshots/_outcomes.ndjson     — append-only log of posts
 *
 * Keyed by setup_id. Once written, NOT overwritten — the "at entry"
 * snapshot is stable. Callers should only save once per setup_id.
 */

const fs = require("fs");
const path = require("path");

function storeDir() {
  return process.env.MACRO_SNAPSHOT_DIR
    || path.join(process.cwd(), "data", "macro_snapshots");
}

function snapshotPath(setupId) {
  const safe = String(setupId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
  return path.join(storeDir(), `${safe}.json`);
}

function ensureDir() {
  fs.mkdirSync(storeDir(), { recursive: true });
}

function hasSnapshot(setupId) {
  return fs.existsSync(snapshotPath(setupId));
}

function saveSnapshotOnce(setupId, snapshot) {
  if (!setupId) return null;
  ensureDir();
  const p = snapshotPath(setupId);
  if (fs.existsSync(p)) return p;
  fs.writeFileSync(p, JSON.stringify({
    setup_id: setupId,
    saved_at: new Date().toISOString(),
    snapshot
  }, null, 2) + "\n", "utf8");
  return p;
}

function readSnapshot(setupId) {
  if (!setupId) return null;
  const p = snapshotPath(setupId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function outcomesLogPath() {
  return path.join(storeDir(), "_outcomes.ndjson");
}

function appendOutcomeLog(entry) {
  ensureDir();
  fs.appendFileSync(outcomesLogPath(), JSON.stringify(entry) + "\n", "utf8");
}

function readOutcomesLog() {
  const p = outcomesLogPath();
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function outcomeAlreadyPosted(setupId) {
  return readOutcomesLog().some((e) => e.setup_id === setupId && e.posted);
}

module.exports = {
  storeDir,
  snapshotPath,
  hasSnapshot,
  saveSnapshotOnce,
  readSnapshot,
  appendOutcomeLog,
  readOutcomesLog,
  outcomeAlreadyPosted
};
