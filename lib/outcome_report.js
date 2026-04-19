"use strict";

/**
 * outcome_report
 *
 * Builds MacroOutcomeReport payloads from events.ndjson + saved
 * macro snapshots. Consumed by scripts/post_macro_outcomes.js.
 *
 * Terminal lifecycle states (from webhook/lifecycle.js):
 *   - invalidated:  hit_stop=true OR setup_stage=invalidated
 *   - closed:       hit_tp3=true OR setup_stage=closed
 *
 * We also treat hit_tp1 / hit_tp2 as closeable if a later event doesn't
 * promote to tp3 within the dataset — only counted as "closed" if
 * followed by an explicit stage=closed marker, otherwise the setup is
 * still in tp_zone. Per-TP partial exits are future work.
 *
 * pnl_r is computed from the agent_packet's entry/stop/tp levels:
 *   - hit_stop           -> -1.0R (by definition of risk unit)
 *   - hit_tp3 (full win) -> (tp3 - entry) / |entry - stop|   (signed by direction)
 *   - hit_tp2 only       -> (tp2 - entry) / |entry - stop|
 *   - hit_tp1 only       -> (tp1 - entry) / |entry - stop|
 *
 * Direction is inferred from the packet: BULLISH -> "long", BEARISH ->
 * "short". NEUTRAL or undefined packets are skipped (no report).
 *
 * outcome field values follow macro contract: "win" | "loss" | "breakeven".
 */

const { readRecentEvents } = require("./events_store");
const snapshotStore = require("./macro_snapshot_store");
const { buildAgentPacket } = require("./packet");

function pickDirection(packet) {
  if (packet?.bias === "BULLISH") return "long";
  if (packet?.bias === "BEARISH") return "short";
  return null;
}

function computePnlR(packet) {
  const { entry, stop, tp1, tp2, tp3, hit_stop, hit_tp1, hit_tp2, hit_tp3 } = packet.levels || {};
  if (hit_stop) return -1.0;

  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  const direction = pickDirection(packet);
  const sign = direction === "long" ? 1 : direction === "short" ? -1 : 0;
  if (sign === 0) return null;

  let exit = null;
  if (hit_tp3 && Number.isFinite(tp3)) exit = tp3;
  else if (hit_tp2 && Number.isFinite(tp2)) exit = tp2;
  else if (hit_tp1 && Number.isFinite(tp1)) exit = tp1;

  if (exit == null) return null;
  return (sign * (exit - entry)) / risk;
}

function classifyOutcome(pnlR) {
  if (pnlR === null || pnlR === undefined) return null;
  if (Math.abs(pnlR) < 1e-6) return "breakeven";
  return pnlR > 0 ? "win" : "loss";
}

function terminalKind(payload) {
  if (payload?.hit_stop === true) return "stop";
  if (payload?.setup_stage === "invalidated") return "invalidated";
  if (payload?.hit_tp3 === true) return "tp3";
  if (payload?.setup_stage === "closed") return "closed";
  return null;
}

/**
 * Walks events.ndjson, returns a list of setups whose last event is
 * terminal AND we have a macro_snapshot for AND we haven't already
 * posted. Each entry is a fully-constructed MacroOutcomeReport.
 */
function buildPendingOutcomeReports({ maxEvents = 2000 } = {}) {
  const events = readRecentEvents(maxEvents, "");
  // readRecentEvents returns newest-first; we want per-setup latest
  const bySetup = new Map();
  for (const e of events) {
    const setupId = e?.payload?.setup_id;
    if (!setupId) continue;
    if (!bySetup.has(setupId)) bySetup.set(setupId, e);
  }

  const reports = [];
  for (const [setupId, latestEvent] of bySetup.entries()) {
    const payload = latestEvent.payload || {};
    const kind = terminalKind(payload);
    if (!kind) continue;
    if (snapshotStore.outcomeAlreadyPosted(setupId)) continue;

    const snapRecord = snapshotStore.readSnapshot(setupId);
    const macroView = snapRecord?.snapshot || null;

    const packet = buildAgentPacket(latestEvent);
    const direction = pickDirection(packet);
    if (!direction) continue;

    const pnlR = computePnlR(packet);
    const outcome = classifyOutcome(pnlR);
    if (!outcome) continue;

    const entryEvent = findEntryEvent(events, setupId);

    const report = {
      trade_id: setupId,
      symbol: packet.symbol,
      direction,
      entry_timestamp: entryEvent?.received_at || latestEvent.received_at,
      exit_timestamp: latestEvent.received_at,
      outcome,
      pnl_r: Number(pnlR.toFixed(4)),
      macro_view_at_entry: macroView
        ? {
            direction: macroView.direction || "",
            confidence: Number.isFinite(macroView.confidence) ? macroView.confidence : 0,
            source_theses: Array.isArray(macroView.source_theses) ? macroView.source_theses : []
          }
        : { direction: "", confidence: 0, source_theses: [] },
      _meta: {
        terminal_kind: kind,
        event_id: latestEvent.event_id
      }
    };
    reports.push(report);
  }

  return reports;
}

function findEntryEvent(newestFirst, setupId) {
  // events are newest-first; walk oldest-first to find the first hit_entry
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const e = newestFirst[i];
    if (e?.payload?.setup_id === setupId && e.payload.hit_entry === true) return e;
  }
  return null;
}

module.exports = {
  computePnlR,
  classifyOutcome,
  terminalKind,
  buildPendingOutcomeReports
};
