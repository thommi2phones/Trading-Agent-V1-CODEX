# Macro Analyzer ↔ Tactical Executor Integration

This directory contains the integration contract with the **macro-analyzer**
repo ([thommi2phones/macro-analyzer](https://github.com/thommi2phones/macro-analyzer)).

## Contract

**Source of truth**: `macro_schema.json` in this directory.
**Mirrors**: `macro-analyzer/integration_schema/macro_schema_v{VERSION}.json`.

Current contract version: **1.0.0**

## How this repo consumes it

See `../webhook/macro_integration.js`. Two directions:

### 1. Tactical pulls macro view (decision gate)

When evaluating a decision, we call `fetchMacroView(symbol)` which hits:

```
GET ${MACRO_ANALYZER_URL}/positioning/view?asset={ticker}
```

Response shape (`MacroPositioningView`):
```json
{
  "contract_version": "1.0.0",
  "asset": "GLD",
  "asset_class": "commodities",
  "direction": "bullish",
  "confidence": 1.0,
  "horizon": "2-12 weeks",
  "source_theses": ["<thesis_id>", ...],
  "regime": "...",
  "gate_suggestion": {
    "allow_long": true,
    "allow_short": false,
    "size_multiplier": 1.5,
    "notes": "Macro bullish on commodities"
  }
}
```

`applyMacroGate(decision, macroView)` then mutates the decision:
- If action=LONG but `allow_long=false` → action=WAIT, reason="macro_blocks_long"
- If action=SHORT but `allow_short=false` → action=WAIT, reason="macro_blocks_short"
- Otherwise annotates decision with `macro_context`

### 2. Tactical pushes outcome (source scoring)

When a setup closes (`hit_stop`, `hit_tp3`, or `setup_stage === "closed"/"invalidated"`):

```
POST ${MACRO_ANALYZER_URL}/source-scoring/outcome
```

Payload shape (`MacroOutcomeReport`):
```json
{
  "contract_version": "1.0.0",
  "trade_id": "setup_abc123",
  "symbol": "GLD",
  "direction": "long",
  "entry_timestamp": "...",
  "exit_timestamp": "...",
  "outcome": "win",
  "pnl_r": 2.1,
  "macro_view_at_entry": { "direction": "bullish", "confidence": 0.75, "source_theses": [...] }
}
```

Response (`MacroOutcomeAck`):
```json
{
  "recorded": true,
  "sources_credited": ["doomberg", "macromicro"],
  "source_weights_updated": { ... }
}
```

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `MACRO_ANALYZER_URL` | Base URL of macro-analyzer (e.g. `http://localhost:8000`) | empty (integration disabled) |
| `MACRO_REQUEST_TIMEOUT_MS` | Per-request timeout | `3000` |

If `MACRO_ANALYZER_URL` is empty, all integration calls no-op cleanly and
tactical decisions proceed without the macro gate. Graceful degradation
is mandatory — the tactical side MUST work standalone.

## Keeping in sync

When macro-analyzer bumps `CONTRACT_VERSION`:

1. In macro-analyzer: run `python scripts/export_integration_schema.py`
2. Copy the new JSON file to `/integration/macro_schema.json` in this repo
3. Update `CONTRACT_VERSION` in `../webhook/macro_integration.js`
4. Run the sanity test and confirm the gate still works

The integration module logs a warning if it receives a response with a
contract version that doesn't match expected — loud failure on drift.
