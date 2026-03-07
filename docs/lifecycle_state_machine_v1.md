# Lifecycle State Machine v1

## Goal
Convert incoming event flow into an explicit setup lifecycle for execution logic and UI.

States:
- `watch`
- `trigger`
- `in_trade`
- `tp_zone`
- `invalidated`
- `closed`

## State Derivation Priority
For each event, derive state in this order:
1. `invalidated` if `hit_stop=true` or `setup_stage=invalidated`
2. `closed` if `hit_tp3=true` or `setup_stage=closed`
3. `tp_zone` if `hit_tp1|hit_tp2|hit_tp3=true` or `setup_stage=tp_zone`
4. `in_trade` if `hit_entry=true` or `setup_stage=in_trade`
5. `trigger` if `near_entry=true` or `setup_stage=trigger`
6. `watch` otherwise

This makes hard outcome flags (`hit_stop`, `hit_tp*`) override softer stage labels.

## Allowed Transitions
- `watch -> trigger|invalidated|watch`
- `trigger -> watch|in_trade|invalidated|trigger`
- `in_trade -> in_trade|tp_zone|closed|invalidated`
- `tp_zone -> tp_zone|in_trade|closed|invalidated`
- `invalidated -> invalidated|watch`
- `closed -> closed|watch`

Any other transition is flagged as an anomaly (`invalid_transition`), but lifecycle still updates.

## API
Implemented in:
- `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/webhook/lifecycle.js`
- `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/webhook/server.js`

Endpoint:
- `GET /lifecycle/latest?limit=200`
- `GET /lifecycle/latest?setup_id=<setup_id>&limit=200`

Response (single setup):
```json
{
  "ok": true,
  "mode": "single_setup",
  "lifecycle": {
    "setup_id": "setup_001",
    "current_state": "in_trade",
    "last_event_id": "event_abc",
    "last_transition_at": "2026-03-06T21:15:10.111Z",
    "transition_count": 3,
    "anomalies": [],
    "recent_transitions": []
  }
}
```

Response (all setups):
```json
{
  "ok": true,
  "mode": "all_setups",
  "count": 2,
  "setups": []
}
```

## Notes
- v1 uses in-memory computation from persisted NDJSON events.
- v1 is deterministic and replayable from event history.
