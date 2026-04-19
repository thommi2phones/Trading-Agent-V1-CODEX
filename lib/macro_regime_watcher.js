"use strict";

/**
 * macro_regime_watcher
 *
 * Polls the macro-analyzer's /positioning/regime endpoint, detects when
 * the regime string changes, and surfaces the list of active setups
 * whose snapshot regime is now stale relative to the current regime.
 *
 * Stateless helpers plus a lightweight on-disk cache at
 * MACRO_SNAPSHOT_DIR/_regime.json so multiple processes (webhook,
 * sidecars) can share a consistent "last observed regime" without
 * needing a database.
 *
 * Callers:
 *   - A regime-change sidecar would loop pollOnce() on an interval and
 *     emit an event onto events.ndjson when detectRegimeChange returns
 *     a change.
 *   - The gating decision path does NOT consult regime directly today;
 *     it consults the per-asset MacroPositioningView, which already
 *     contains the regime string at its `.regime` field. This module
 *     exists to close the future work item "regime change ->
 *     active-setup invalidation" from docs/macro_integration_v1.md.
 */

const fs = require("fs");
const path = require("path");
const macroClient = require("./macro_client");
const snapshotStore = require("./macro_snapshot_store");

function regimeCachePath() {
  return path.join(snapshotStore.storeDir(), "_regime.json");
}

function readLastRegime() {
  const p = regimeCachePath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeLastRegime(regime, lastUpdated) {
  fs.mkdirSync(snapshotStore.storeDir(), { recursive: true });
  const payload = {
    regime: regime || null,
    last_updated: lastUpdated || null,
    observed_at: new Date().toISOString()
  };
  fs.writeFileSync(regimeCachePath(), JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function detectRegimeChange(prev, curr) {
  if (!curr || !curr.regime) return null;
  if (!prev || !prev.regime) {
    return { changed: true, from: null, to: curr.regime, first_observation: true };
  }
  if (prev.regime !== curr.regime) {
    return { changed: true, from: prev.regime, to: curr.regime, first_observation: false };
  }
  return { changed: false, from: prev.regime, to: curr.regime, first_observation: false };
}

function listActiveSetupsWithStaleRegime(currentRegime) {
  const dir = snapshotStore.storeDir();
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    if (entry.startsWith("_")) continue;
    const setupId = entry.slice(0, -5);
    if (snapshotStore.outcomeAlreadyPosted(setupId)) continue;
    const record = snapshotStore.readSnapshot(setupId);
    const entryRegime = record?.snapshot?.regime;
    if (!entryRegime) continue;
    if (entryRegime !== currentRegime) {
      results.push({ setup_id: setupId, entry_regime: entryRegime, current_regime: currentRegime });
    }
  }
  return results;
}

async function pollOnce() {
  if (!macroClient.isEnabled()) {
    return { ok: false, reason: "macro_client_disabled" };
  }
  const current = await macroClient.fetchRegime();
  if (!current) {
    return { ok: false, reason: "macro_unavailable" };
  }
  const prev = readLastRegime();
  const delta = detectRegimeChange(prev, current);
  const next = writeLastRegime(current.regime, current.last_updated);
  const stale = delta.changed ? listActiveSetupsWithStaleRegime(current.regime) : [];
  return {
    ok: true,
    current: next,
    previous: prev,
    change: delta,
    stale_active_setups: stale
  };
}

module.exports = {
  regimeCachePath,
  readLastRegime,
  writeLastRegime,
  detectRegimeChange,
  listActiveSetupsWithStaleRegime,
  pollOnce
};
