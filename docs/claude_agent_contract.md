# Claude Agent Chart Contract (TradingView -> Agent)

## Objective
Use TradingView webhook payload as structured confirmation data, and keep screenshot interpretation pattern-first.

## Priority Order
1. Pattern context (manual/visual)
2. Fibonacci confluence (green/yellow/white)
3. Historical key levels (blue dashed)
4. MACD histogram + TTM squeeze
5. RSI structure
6. EMA cluster / SRChannel as secondary context

## Input Channels
1. Chart screenshot (for visual patterns, drawings, arcs, trend geometry)
2. TradingView JSON payload (for objective momentum/context fields)

## Required Taxonomy Fields
- `taxonomy_version`
- `setup_id`
- `pattern_type`
- `setup_stage`
- `time_horizon`

## Required Output Format
1. Dominant Pattern
2. Fib Confluence (with color significance)
3. Historical Level Alignment
4. MACD + TTM Squeeze State
5. RSI Structure State
6. Confluence Assessment (`LOW|MEDIUM|HIGH`)
7. Bias (`BULLISH|BEARISH|NEUTRAL`)
8. Invalidation Level
9. Most Probable Next Move

## Decision Rules
1. Do not generate a strong trade call from momentum indicators alone.
2. Pattern + Fib must be present for a high-confidence setup.
3. Green Fib reactions carry highest weight.
4. If MACD/TTM and RSI conflict with structure, reduce confidence one tier.
5. If key level breaks against setup and holds, mark setup invalid.

## Suggested Agent Logic
1. Parse screenshot for pattern classification and drawn levels.
2. Parse payload and map fields to confirmation checks.
3. Assign confidence:
   - `HIGH`: pattern confirmed + green/yellow fib + level alignment + momentum support
   - `MEDIUM`: pattern + fib + at least one momentum support
   - `LOW`: missing structure/fib confluence or conflicting momentum
4. Return the 9-part output block exactly.
5. If taxonomy fields are missing or contradictory with image interpretation, emit mismatch flags and downgrade confidence.

## Macro reason codes (since v1.1)

When the macro-analyzer integration is enabled (`MACRO_ANALYZER_URL` set),
`lib/macro_gate.js#applyMacroGate` annotates every gated decision with
reason codes from the vocabulary below. Downstream consumers (LLM
prompts, order routers, observability dashboards) should treat this set
as stable.

The macro-analyzer's `direction` enum has six values
(`bullish|bearish|neutral|mixed|watchful|unknown`). The table below
covers all six.

| code | meaning | decision effect |
|---|---|---|
| `macro_agrees_long` | view `direction=bullish`, base action `LONG`, `allow_long=true` | annotation only |
| `macro_agrees_short` | view `direction=bearish`, base action `SHORT`, `allow_short=true` | annotation only |
| `macro_direction_bullish` | view bullish but base action is `SHORT` | annotation only (no block on its own; the `allow_short` flag drives the block) |
| `macro_direction_bearish` | view bearish but base action is `LONG` | annotation only |
| `macro_direction_neutral` | view direction is `neutral` — macro has no net bias | annotation only; gate defaults (`allow_long=true`, `allow_short=true`, size=1.0) |
| `macro_direction_mixed` | view direction is `mixed` — macro sees both sides | annotation only; gate defaults as above |
| `macro_direction_watchful` | view direction is `watchful` — macro is reducing risk across the board | annotation + typically pairs with `macro_size_cap:0.50` |
| `macro_disagrees_long` | base action `LONG` but `allow_long=false` | action → `WAIT`; risk_tier → `BLOCKED` |
| `macro_disagrees_short` | base action `SHORT` but `allow_short=false` | action → `WAIT`; risk_tier → `BLOCKED` |
| `macro_view_unknown` | view returned with `direction=unknown` | early return; no direction annotation, no sizing |
| `macro_unavailable` | `MACRO_ANALYZER_URL` set but view is `null` (timeout/5xx/malformed) | none |
| `macro_size_boost:<x.xx>` | agreement + confidence > 0.5 produced `size_multiplier > 1.0` | `decision.size_multiplier` set |
| `macro_size_hold` | agreement but sizing resolves to 1.0 | `decision.size_multiplier = 1.0` |
| `macro_size_cap:<x.xx>` | sizing resolved below 1.0 (gate base < 1.0 or disagreement with downscale) | `decision.size_multiplier` set |

Sizing formula (see `lib/macro_sizing.js`):

```
base   = gate.size_multiplier (fallback 1.0)
scale  = confidence <= 0.5   -> 1.0
         confidence <= 0.75  -> 1.25
         confidence >  0.75  -> 1.5
final  = min(base * scale, base * 2.0, 2.0)
```

`final` is only emitted when the base action is `LONG`/`SHORT` and either
agrees with direction (boost path) or disagrees with `base < 1.0`
(downscale passthrough). In all other cases `decision.size_multiplier`
is absent and no size reason is emitted.

When the integration is disabled (`MACRO_ANALYZER_URL` unset), none of
these codes appear and behavior is byte-equivalent to pre-macro.

### Authoritative schema

The bounds on every field above come from
[`integration_schema/macro_schema_v1.0.0.json`](https://github.com/thommi2phones/macro-analyzer/blob/main/integration_schema/macro_schema_v1.0.0.json)
on the macro-analyzer side (`size_multiplier` is bounded `0.0-2.0`;
`confidence` is bounded `0.0-1.0`). If the narrative integration doc
disagrees with the JSON schema, the schema wins — it's what the
Pydantic contracts in `src/macro_positioning/integration/contracts.py`
actually enforce.
