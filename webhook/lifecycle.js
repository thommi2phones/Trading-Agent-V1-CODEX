"use strict";

const ACTIONABLE_STATES = new Set(["watch", "trigger", "in_trade", "tp_zone", "invalidated", "closed"]);

function toTs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
}

function allowedTransition(fromState, toState) {
  if (!fromState || fromState === toState) return true;
  const allowed = {
    watch: new Set(["trigger", "invalidated", "watch"]),
    trigger: new Set(["watch", "in_trade", "invalidated", "trigger"]),
    in_trade: new Set(["in_trade", "tp_zone", "closed", "invalidated"]),
    tp_zone: new Set(["tp_zone", "in_trade", "closed", "invalidated"]),
    invalidated: new Set(["invalidated", "watch"]),
    closed: new Set(["closed", "watch"])
  };
  return (allowed[fromState] || new Set()).has(toState);
}

function stateFromEvent(event) {
  const p = event?.payload || {};
  const stage = String(p.setup_stage || "").toLowerCase();

  if (p.hit_stop || stage === "invalidated") {
    return { state: "invalidated", reason: "stop_hit_or_stage_invalidated" };
  }
  if (p.hit_tp3 || stage === "closed") {
    return { state: "closed", reason: "tp3_hit_or_stage_closed" };
  }
  if (p.hit_tp1 || p.hit_tp2 || p.hit_tp3 || stage === "tp_zone") {
    return { state: "tp_zone", reason: "tp_level_hit_or_stage_tp_zone" };
  }
  if (p.hit_entry || stage === "in_trade") {
    return { state: "in_trade", reason: "entry_hit_or_stage_in_trade" };
  }
  if (p.near_entry || stage === "trigger") {
    return { state: "trigger", reason: "near_entry_or_stage_trigger" };
  }
  if (stage === "watch") {
    return { state: "watch", reason: "stage_watch" };
  }

  return { state: "watch", reason: "fallback_watch" };
}

function computeSetupLifecycle(events, setupId) {
  const ordered = [...events]
    .filter((e) => String(e?.payload?.setup_id || "") === setupId)
    .sort((a, b) => toTs(a.received_at) - toTs(b.received_at));

  if (ordered.length === 0) {
    return {
      setup_id: setupId,
      current_state: null,
      last_event_id: null,
      transition_count: 0,
      anomalies: [],
      recent_transitions: []
    };
  }

  const anomalies = [];
  const transitions = [];
  let prev = null;

  for (const event of ordered) {
    const next = stateFromEvent(event);
    if (prev && !allowedTransition(prev.state, next.state)) {
      anomalies.push({
        event_id: event.event_id,
        ts: event.received_at,
        from: prev.state,
        to: next.state,
        reason: "invalid_transition"
      });
    }
    if (!prev || prev.state !== next.state) {
      transitions.push({
        event_id: event.event_id,
        ts: event.received_at,
        from: prev ? prev.state : null,
        to: next.state,
        reason: next.reason
      });
    }
    prev = next;
  }

  const latestEvent = ordered[ordered.length - 1];
  return {
    setup_id: setupId,
    current_state: prev?.state || null,
    last_event_id: latestEvent.event_id || null,
    last_transition_at: transitions.length ? transitions[transitions.length - 1].ts : null,
    transition_count: transitions.length,
    anomalies,
    recent_transitions: transitions.slice(-10).reverse()
  };
}

function computeLifecycleLatest(events, setupId = "") {
  if (setupId) {
    return {
      mode: "single_setup",
      lifecycle: computeSetupLifecycle(events, setupId)
    };
  }

  const setupIds = new Set();
  for (const event of events) {
    const id = String(event?.payload?.setup_id || "");
    if (id) setupIds.add(id);
  }

  const setups = [];
  for (const id of setupIds) {
    const lifecycle = computeSetupLifecycle(events, id);
    if (ACTIONABLE_STATES.has(lifecycle.current_state)) {
      setups.push(lifecycle);
    }
  }

  setups.sort((a, b) => toTs(b.last_transition_at) - toTs(a.last_transition_at));

  return {
    mode: "all_setups",
    count: setups.length,
    setups
  };
}

module.exports = {
  computeLifecycleLatest,
  stateFromEvent
};
