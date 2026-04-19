"use strict";

/**
 * macro_decision
 *
 * Glue between the pure base decision and the macro HTTP gate. Used by
 * both webhook/server.js and tv_direct/index.js so there's one wiring
 * point for macro integration. Keeps webhook/decision.js itself pure and
 * synchronous.
 *
 * When MACRO_ANALYZER_URL is unset, this function short-circuits: it
 * runs applyMacroGate with view=null (graceful passthrough) and does NOT
 * make any HTTP call — so behavior is byte-equivalent to the pre-macro
 * code path except for one unconditional reason-code annotation the
 * gate function explicitly suppresses when MACRO_ANALYZER_URL is unset.
 */

const macroClient = require("./macro_client");
const { applyMacroGate } = require("./macro_gate");
const snapshotStore = require("./macro_snapshot_store");
const { getAssetClass } = require("./asset_class");

async function gateDecisionWithMacro(baseDecision, agentPacket) {
  let view = null;
  if (macroClient.isEnabled() && agentPacket?.symbol) {
    const asset_class = getAssetClass(agentPacket.symbol);
    const args = { asset: agentPacket.symbol };
    if (asset_class) args.asset_class = asset_class;
    view = await macroClient.fetchMacroView(args);
  }

  const gated = applyMacroGate(baseDecision, agentPacket, view);

  if (gated.macro_view_at_entry && agentPacket?.setup_id) {
    try {
      snapshotStore.saveSnapshotOnce(agentPacket.setup_id, gated.macro_view_at_entry);
    } catch (err) {
      console.warn(`[macro-decision] snapshot_save_failed setup_id=${agentPacket.setup_id} message="${err.message}"`);
    }
  }

  return gated;
}

module.exports = { gateDecisionWithMacro };
