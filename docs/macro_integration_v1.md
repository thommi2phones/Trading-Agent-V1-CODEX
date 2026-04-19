# Macro Integration v1 (Trading Agent side)

This is the Trading-Agent-V1-CODEX side of the integration contract with
the [macro-analyzer](https://github.com/thommi2phones/macro-analyzer)
repo. Their side of the contract lives at
[macro-analyzer `docs/integration_with_trading_agent.md`](https://github.com/thommi2phones/macro-analyzer/blob/main/docs/integration_with_trading_agent.md)
and [`integration_schema/macro_schema_v1.0.0.json`](https://github.com/thommi2phones/macro-analyzer/blob/main/integration_schema/macro_schema_v1.0.0.json).

**Schema contract version:** `1.0.0` (tracked in `lib/macro_client.js#CONTRACT_VERSION`).

**Authoritative source:** the JSON schema, not the narrative doc. Field
bounds we rely on (per `integration_schema/macro_schema_v1.0.0.json`
and the Pydantic models in `src/macro_positioning/integration/contracts.py`):
`gate_suggestion.size_multiplier` is `0.0-2.0`, `confidence` is `0.0-1.0`,
`direction` is one of `bullish|bearish|neutral|mixed|watchful|unknown`.
If the narrative doc disagrees with any of these, the schema wins.

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
| agreement + confidence-scaled sizing (see `lib/macro_sizing.js`) | set `decision.size_multiplier`; add `macro_size_boost:<x.xx>` \| `macro_size_hold` \| `macro_size_cap:<x.xx>` |

The sizing formula lives in `lib/macro_sizing.js`:

```
base   = gate_suggestion.size_multiplier (fallback 1.0)
scale  = confidence <= 0.5   -> 1.0
         confidence <= 0.75  -> 1.25
         confidence >  0.75  -> 1.5
final  = min(base * scale, base * 2.0, 2.0)
```

`decision.size_multiplier` is only emitted on agreement (bullish+LONG or
bearish+SHORT) OR on disagreement where `base < 1.0` (downscale
passthrough). The full reason-code vocabulary is documented in
[`claude_agent_contract.md`](./claude_agent_contract.md#macro-reason-codes-since-v11).

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

## Regime watcher

`lib/macro_regime_watcher.js` exposes the plumbing for the "regime
change → active-setup invalidation" flow. Key functions:

| function | purpose |
|---|---|
| `pollOnce()` | Fetches `/positioning/regime`, compares to the cached last regime, returns `{ ok, current, previous, change, stale_active_setups }` |
| `readLastRegime()` / `writeLastRegime()` | JSON cache at `${MACRO_SNAPSHOT_DIR}/_regime.json` |
| `detectRegimeChange(prev, curr)` | Pure diff; returns `{ changed, from, to, first_observation }` |
| `listActiveSetupsWithStaleRegime(currentRegime)` | Scans snapshot store for setups whose entry regime != current AND whose outcome has not yet been posted |

What the watcher does NOT do: it does not re-gate or cancel anything on
its own. It surfaces the list of stale setups so a caller (future
regime-change sidecar) can decide policy — re-gate, demote risk_tier,
emit a warning event, etc. The gating decision path itself still relies
on per-asset `MacroPositioningView` (which already carries `regime` in
the view payload, snapshotted at entry).

## pnl_r accounting (per-TP partial exits)

`lib/outcome_report.js#computePnlR` uses a scale-out model. Each TP
closes a fraction of the position per
`MACRO_PNL_PARTIAL_WEIGHTS` (default `0.5,0.25,0.25` for tp1/tp2/tp3).
The remaining fraction exits at the most-advanced level reached:

| scenario | formula |
|---|---|
| stop, no TPs | `-1.0` |
| stop after hit_tp1 | `w1*r1 + (1-w1)*(-1.0)` |
| stop after hit_tp1+hit_tp2 | `w1*r1 + w2*r2 + (1-w1-w2)*(-1.0)` |
| hit_tp1 (closed at tp1) | `1.0 * r1` (remaining fraction exits at tp1) |
| hit_tp2 (no tp3) | `w1*r1 + (1-w1)*r2` |
| hit_tp3 (full winner) | `w1*r1 + w2*r2 + w3*r3` |

`r_i = sign * (tp_i - entry) / |entry - stop|` where `sign = +1` for
long, `-1` for short.

Weights must sum to 1.0 across three entries; malformed env values
warn and fall back to the default.

## Not in scope (yet)

- A long-running regime-change sidecar. `pollOnce()` is in place; the
  loop that invokes it on a cron / with graceful shutdown is a small
  follow-up script.
- Order-router consumption of `decision.size_multiplier`. The field is
  emitted and persisted in snapshots; no execution layer reads it yet.
- Trailing-stop / breakeven-after-tp1 policy. The current pnl_r model
  assumes the original stop is static; if a setup would have trailed
  the stop after hit_tp1, the formula under-reports the runner's pnl
  on a subsequent stop-out.
