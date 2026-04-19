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
 * ## pnl_r (per-TP partial exits)
 *
 * pnl_r is computed as a weighted sum of per-TP R-multiples. Each TP
 * scales out a fraction of the position per MACRO_PNL_PARTIAL_WEIGHTS
 * (default 0.5/0.25/0.25 for tp1/tp2/tp3). The remaining fraction exits
 * at the most-advanced level reached: tp3 on a full winner, the last
 * hit TP on a partial close, or the stop on a stop-out after partial
 * profits were taken.
 *
 * Scenarios:
 *   - hit_stop, no TPs:                 -1.0
 *   - hit_stop after hit_tp1:           w1*r1 + (1-w1)*(-1.0)
 *   - hit_stop after hit_tp1+hit_tp2:   w1*r1 + w2*r2 + (1-w1-w2)*(-1.0)
 *   - hit_tp1 + setup_stage=closed:     1.0*r1 (full exit at tp1)
 *   - hit_tp2 + setup_stage=closed:     w1*r1 + (1-w1)*r2
 *   - hit_tp3 (full winner):            w1*r1 + w2*r2 + w3*r3
 *
 * Direction is inferred from the packet: BULLISH -> "long", BEARISH ->
 * "short". NEUTRAL or undefined packets are skipped (no report).
 *
 * outcome field values follow macro contract: "win" | "loss" | "breakeven".
 */

const { readRecentEvents } = require("./events_store");
const snapshotStore = require("./macro_snapshot_store");
const { buildAgentPacket } = require("./packet");

const DEFAULT_PARTIAL_WEIGHTS = [0.5, 0.25, 0.25];

function getPartialWeights() {
  const raw = process.env.MACRO_PNL_PARTIAL_WEIGHTS;
  if (!raw) return DEFAULT_PARTIAL_WEIGHTS;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x) || x < 0)) {
    console.warn(`[outcome-report] invalid MACRO_PNL_PARTIAL_WEIGHTS="${raw}" — falling back to default`);
    return DEFAULT_PARTIAL_WEIGHTS;
  }
  const sum = parts[0] + parts[1] + parts[2];
  if (Math.abs(sum - 1.0) > 1e-6) {
    console.warn(`[outcome-report] MACRO_PNL_PARTIAL_WEIGHTS sums to ${sum} (must be 1.0) — falling back to default`);
    return DEFAULT_PARTIAL_WEIGHTS;
  }
  return parts;
}

function pickDirection(packet) {
  if (packet?.bias === "BULLISH") return "long";
  if (packet?.bias === "BEARISH") return "short";
  return null;
}

function rMultiple(entry, exit, risk, sign) {
  return (sign * (exit - entry)) / risk;
}

function computePnlR(packet) {
  const levels = packet.levels || {};
  const { entry, stop, tp1, tp2, tp3, hit_stop, hit_tp1, hit_tp2, hit_tp3 } = levels;

  if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
    return hit_stop ? -1.0 : null;
  }
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  const direction = pickDirection(packet);
  const sign = direction === "long" ? 1 : direction === "short" ? -1 : 0;
  if (sign === 0) return null;

  const [w1, w2, w3] = getPartialWeights();
  const r1 = hit_tp1 && Number.isFinite(tp1) ? rMultiple(entry, tp1, risk, sign) : null;
  const r2 = hit_tp2 && Number.isFinite(tp2) ? rMultiple(entry, tp2, risk, sign) : null;
  const r3 = hit_tp3 && Number.isFinite(tp3) ? rMultiple(entry, tp3, risk, sign) : null;

  if (hit_stop) {
    let pnl = 0;
    let consumed = 0;
    if (r1 !== null) { pnl += w1 * r1; consumed += w1; }
    if (r2 !== null) { pnl += w2 * r2; consumed += w2; }
    const remaining = Math.max(0, 1 - consumed);
    pnl += remaining * -1.0;
    return pnl;
  }

  if (r3 !== null) {
    return w1 * (r1 ?? 0) + w2 * (r2 ?? 0) + w3 * r3;
  }
  if (r2 !== null) {
    const consumed = r1 !== null ? w1 : 0;
    const partial = r1 !== null ? w1 * r1 : 0;
    return partial + (1 - consumed) * r2;
  }
  if (r1 !== null) {
    return r1; // single-TP close — remaining fraction exits at tp1 = full r1
  }
  return null;
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
    if (outcome === null) continue;

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
  buildPendingOutcomeReports,
  getPartialWeights,
  DEFAULT_PARTIAL_WEIGHTS
};
