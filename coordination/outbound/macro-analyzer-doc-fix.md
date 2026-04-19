# Macro-Analyzer Doc Fix — Patch Suggestion

**Status:** Drafted on the trading-agent side (2026-04-19) for forwarding
to `thommi2phones/macro-analyzer`. Not yet filed — this repo's GitHub
MCP scope blocks cross-repo issue/PR creation. Paste the body below into
a new issue or PR description on the macro-analyzer repo when you switch
contexts.

---

## Suggested issue title

> Docs: integration_with_trading_agent.md disagrees with the canonical schema (size_multiplier bounds + direction enum)

## Suggested issue body

While wiring the trading-agent integration (matching `contract_version
= 1.0.0`) we hit two doc-vs-code mismatches in
`docs/integration_with_trading_agent.md`. The Pydantic models in
`src/macro_positioning/integration/contracts.py` and the JSON schema in
`integration_schema/macro_schema_v1.0.0.json` are correct; the narrative
doc is stale.

### 1. `size_multiplier` bounds

Doc currently says:

> `gate_suggestion.size_multiplier: 0.0–1.0`

But `GateSuggestion` enforces:

```python
size_multiplier: float = Field(default=1.0, ge=0.0, le=2.0)
```

…and the JSON schema has `minimum: 0.0, maximum: 2.0`. The
`/positioning/view` handler also emits values up to 1.5
(`min(1.0 + dominant_confidence * 0.5, 1.5)`) on bullish/bearish.

**Suggested fix:** change the doc text to `0.0–2.0` (matching the
schema). The trading-agent side currently treats this as an
"agreement-boost" channel — when macro is confident in agreement we
scale up to a hard cap of 2.0 so the doc bound matters.

### 2. Direction enum is incomplete in the doc

Doc currently lists:

> `direction: "bullish" | "bearish" | "unknown"`

The Pydantic model declares:

```python
direction: Literal["bullish", "bearish", "neutral", "mixed", "watchful", "unknown"] = "unknown"
```

…and `/positioning/view` actively emits all six. We confirmed by reading
the handler:

| direction | gate (allow_long, allow_short, size_multiplier) | notes |
|---|---|---|
| bullish | true, false, `min(1.0 + conf*0.5, 1.5)` | `Macro bullish on {asset_class}` |
| bearish | false, true, `min(1.0 + conf*0.5, 1.5)` | `Macro bearish on {asset_class}` |
| watchful | true, true, `0.5` | `Macro watchful — reduce size` |
| neutral | true, true, `1.0` (default) | `Macro neutral/mixed — no gate preference` |
| mixed | true, true, `1.0` (default) | `Macro neutral/mixed — no gate preference` |
| unknown | true, true, `1.0` (default) | `No macro view for this asset — tactical proceeds unfiltered` |

**Suggested fix:** in the doc's `MacroPositioningView` schema section,
list all six values and add a short table (or paragraph) describing the
gate shape per direction. Downstream consumers need to know `watchful`
exists and what it means — without that, integrations either treat it
as "unknown" (losing the size cap) or hit a Literal-validation surprise.

### 3. Optional: minor consistency

The narrative doc shows `MacroOutcomeReport` schema without
`contract_version`, but the Pydantic model includes it (and the
trading-agent's `lib/macro_client.js` always wraps with
`contract_version: "1.0.0"`). Worth adding for completeness.

---

## Suggested doc patch (apply on top of `main`)

```diff
--- a/docs/integration_with_trading_agent.md
+++ b/docs/integration_with_trading_agent.md
@@
-direction: "bullish" | "bearish" | "unknown"
+direction: "bullish" | "bearish" | "neutral" | "mixed" | "watchful" | "unknown"
 confidence: 0.0–1.0 (float)
 horizon: string (e.g., "2-8 weeks")
 source_theses: array of IDs
 gate_suggestion:
   - allow_long: boolean
   - allow_short: boolean
-  - size_multiplier: 0.0–1.0
+  - size_multiplier: 0.0–2.0
   - notes: string
 last_updated: ISO 8601 timestamp
 regime: string (narrative context)
@@
-## MacroPositioningView Schema
-- **direction:** bearish/bullish/unknown
-- **confidence:** 0–1.0 scale
-- **horizon:** human-readable timeframe (weeks/months)
-- **gate_suggestion.allow_long/short:** binary gates
-- **gate_suggestion.size_multiplier:** position-sizing adjustment (0–1.0)
+## MacroPositioningView Schema
+- **direction:** bullish | bearish | neutral | mixed | watchful | unknown
+- **confidence:** 0–1.0 scale
+- **horizon:** human-readable timeframe (weeks/months)
+- **gate_suggestion.allow_long/short:** binary gates
+- **gate_suggestion.size_multiplier:** position-sizing adjustment (0.0–2.0)
+
+### Gate semantics per direction
+
+| direction | allow_long | allow_short | size_multiplier | typical notes |
+|---|---|---|---|---|
+| bullish | true | false | up to 1.5 (boost on confidence) | "Macro bullish on {asset_class}" |
+| bearish | false | true | up to 1.5 (boost on confidence) | "Macro bearish on {asset_class}" |
+| watchful | true | true | 0.5 | "Macro watchful — reduce size" |
+| neutral | true | true | 1.0 | "Macro neutral/mixed — no gate preference" |
+| mixed | true | true | 1.0 | "Macro neutral/mixed — no gate preference" |
+| unknown | true | true | 1.0 | "No macro view for this asset — tactical proceeds unfiltered" |
```

---

## How the trading-agent currently handles each direction

For context (so the macro-analyzer team can confirm intent):

| direction | trading-agent reason code emitted | sizing outcome |
|---|---|---|
| bullish (LONG) | `macro_agrees_long` | confidence boost up to schema cap 2.0 |
| bullish (SHORT) | `macro_direction_bullish` + `macro_disagrees_short` (via `allow_short=false`) | action → WAIT, BLOCKED |
| bearish (SHORT) | `macro_agrees_short` | confidence boost up to schema cap 2.0 |
| bearish (LONG) | `macro_direction_bearish` + `macro_disagrees_long` | action → WAIT, BLOCKED |
| watchful | `macro_direction_watchful` + `macro_size_cap:0.50` | size reduced to 0.5 |
| neutral | `macro_direction_neutral` | no size attached |
| mixed | `macro_direction_mixed` | no size attached |
| unknown | `macro_view_unknown` | early return; no further annotation |

Trading-agent verification suite covering all six directions:
`scripts/verify_macro_sizing.js` and `scripts/verify_macro_client.js`
on `claude/direction-vocabulary-fix` branch.
