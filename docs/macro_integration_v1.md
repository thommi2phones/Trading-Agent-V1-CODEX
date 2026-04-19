# Macro Integration v1 (Trading Agent side)

This is the Trading-Agent-V1-CODEX side of the integration contract with
the [macro-analyzer](https://github.com/thommi2phones/macro-analyzer)
repo. Their side of the contract lives at
[macro-analyzer `docs/integration_with_trading_agent.md`](https://github.com/thommi2phones/macro-analyzer/blob/main/docs/integration_with_trading_agent.md)
and [`integration_schema/macro_schema_v1.0.0.json`](https://github.com/thommi2phones/macro-analyzer/blob/main/integration_schema/macro_schema_v1.0.0.json).

**Schema contract version:** `1.0.0` (tracked in `lib/macro_client.js#CONTRACT_VERSION`).

## Design principle — graceful degradation

Both sides **must work without the other**. When `MACRO_ANALYZER_URL` is
unset, every macro-client call is a silent no-op that returns `null`.
When it is set but the remote is unreachable (timeout, 4xx, 5xx,
malformed JSON), each call logs a warning and returns `null`. Callers
treat `null` as "no macro view" and proceed unchanged. The macro
integration never crashes the decision path.

## Flow — read side (macro view → tactical gate)

```
┌──────────────────────────┐
│ webhook POST             │      ┌───────────────────────┐
│ or tv_direct.ingest      │      │  macro-analyzer        │
└──────────┬───────────────┘      │  GET /positioning/view │
           │                      └──────────▲─────────────┘
           ▼                                 │
  lib/packet.js                              │
  buildAgentPacket                           │
           │                                 │
           ▼                                 │
  webhook/decision.js                        │
  evaluateDecision (pure, sync)              │
           │                                 │
           ▼                                 │
  lib/macro_decision.js                      │
  gateDecisionWithMacro ──── macro_client ──►┤
           │                                 │
           ▼                                 │
  lib/macro_gate.js                          │
  applyMacroGate (pure)                      │
   - annotate macro_view_at_entry            │
   - add reason codes                        │
   - force WAIT/BLOCKED on disagreement      │
   - record size_multiplier                  │
           │                                 │
           ▼                                 │
  lib/macro_snapshot_store.js                │
  saveSnapshotOnce(setup_id, view)           │
           │                                 │
           ▼                                 │
  final decision returned to caller
```

## Flow — write side (trade outcome → source scoring)

```
events.ndjson terminal transition (hit_stop / hit_tp3 / stage in {closed, invalidated})
           │
           ▼
scripts/post_macro_outcomes.js  (long-running or --once)
           │  reads events via lib/events_store.readRecentEvents
           ▼
lib/outcome_report.js
  buildPendingOutcomeReports()
   - skip if macro snapshot missing
   - skip if already posted (outcomes log)
   - compute pnl_r from entry/stop/tp levels
   - classify outcome win|loss|breakeven
   - attach macro_view_at_entry snapshot
           │
           ▼
lib/macro_client.js postTradeOutcome → macro-analyzer POST /source-scoring/outcome
           │
           ▼
lib/macro_snapshot_store.js appendOutcomeLog({setup_id, posted, ack})
```

Subsequent runs skip setups already marked `posted: true` in the outcomes
log, so the poster is idempotent and safe to run on a cron or as a
long-lived process.

## Gate semantics

`lib/macro_gate.js#applyMacroGate(baseDecision, agentPacket, macroView)`
is a pure function. It returns a **new** decision object. Rules:

| condition | effect |
|---|---|
| `macroView === null` and `MACRO_ANALYZER_URL` set | add reason `macro_unavailable`; pass through |
| `macroView === null` and `MACRO_ANALYZER_URL` unset | silent pass through |
| `direction === "unknown"` | add `macro_view_unknown`; pass through |
| base action `LONG` and `gate_suggestion.allow_long === false` | action → `WAIT`; risk_tier → `BLOCKED`; add `macro_disagrees_long` |
| base action `SHORT` and `gate_suggestion.allow_short === false` | action → `WAIT`; risk_tier → `BLOCKED`; add `macro_disagrees_short` |
| base action `LONG` and direction `bullish` | add `macro_agrees_long` |
| base action `SHORT` and direction `bearish` | add `macro_agrees_short` |
| action `LONG|SHORT` and `size_multiplier < 1.0` | add `macro_size_cap:<x.xx>`; set `decision.macro_size_multiplier` |

In all cases the resolved view (or a sentinel for missing) is attached
to `decision.macro_view_at_entry`. That field is persisted via
`lib/macro_snapshot_store.js` keyed by `setup_id`, write-once — the
first snapshot for a setup is preserved as the canonical "at entry"
record even if later events are processed.

## Environment

| env | default | purpose |
|---|---|---|
| `MACRO_ANALYZER_URL` | unset | base URL of the macro-analyzer HTTP service. Unset = integration disabled. |
| `MACRO_ANALYZER_BEARER` | unset | optional bearer token |
| `MACRO_ANALYZER_TIMEOUT_MS` | `3000` | per-request timeout |
| `MACRO_SNAPSHOT_DIR` | `data/macro_snapshots` | where to persist view-at-entry snapshots and outcome logs |

## Files

| path | role |
|---|---|
| `lib/macro_client.js` | HTTP client; `fetchMacroView`, `postTradeOutcome`, `isEnabled` |
| `lib/macro_gate.js` | pure `applyMacroGate` |
| `lib/macro_decision.js` | glue used by webhook and tv_direct to fetch + gate + snapshot |
| `lib/macro_snapshot_store.js` | snapshot + outcome-log persistence |
| `lib/outcome_report.js` | build MacroOutcomeReport from events |
| `scripts/post_macro_outcomes.js` | long-running poster / `--once` / `--dry-run` |
| `scripts/mock_macro.js` | test-only HTTP mock mirroring the contract |
| `scripts/verify_macro_client.js` | end-to-end verification suite |
| `docs/macro_integration_v1.md` | this document |

## Not in scope (yet)

- Per-TP partial exit accounting. `pnl_r` today reflects the most advanced
  TP hit (or -1.0 on stop). Multi-TP scaling remains a follow-up.
- Confidence-aware sizing. Today, `size_multiplier` is captured and
  annotated but does not change the risk tier beyond the existing
  A/B/C/BLOCKED mapping.
- Macro regime change → active-setup invalidation. Future extension listed
  in macro-analyzer's integration doc.
