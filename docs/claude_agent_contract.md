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

## Macro Reason Codes (since v1.1)

When the macro-analyzer integration is enabled (`MACRO_ANALYZER_URL` set),
`webhook/macro_integration.applyMacroGate` annotates every gated
decision with reason codes from the vocabulary below. Downstream
consumers (LLM prompts, order routers, dashboards) should treat this
set as stable.

The macro-analyzer `direction` enum has six values:
`bullish | bearish | neutral | mixed | watchful | unknown`.

| code | meaning | decision effect |
|---|---|---|
| `macro_aligns_long` | base action `LONG`, `allow_long=true`, direction `bullish` | annotation only |
| `macro_aligns_short` | base action `SHORT`, `allow_short=true`, direction `bearish` | annotation only |
| `macro_blocks_long` | base action `LONG` but `allow_long=false` | action → `WAIT`; risk_tier → `BLOCKED`; confidence → `LOW` |
| `macro_blocks_short` | base action `SHORT` but `allow_short=false` | action → `WAIT`; risk_tier → `BLOCKED`; confidence → `LOW` |
| `macro_direction_neutral` | direction `neutral` — no net bias | annotation only |
| `macro_direction_mixed` | direction `mixed` — both sides present | annotation only |
| `macro_direction_watchful` | direction `watchful` — macro reducing risk | annotation; typically pairs with `macro_size_cap:0.50` |
| `macro_no_view` | direction `unknown`, or `MACRO_ANALYZER_URL` set but view is null | no size_multiplier |
| `macro_size_boost:<x.xx>` | agreement + confidence produced `size_multiplier > 1.0` | `decision.size_multiplier` set |
| `macro_size_hold` | agreement but sizing resolves to 1.0 | `decision.size_multiplier = 1.0` |
| `macro_size_cap:<x.xx>` | sizing < 1.0 (gate base < 1.0 or non-directional view with downscale) | `decision.size_multiplier` set |

### Sizing formula (see `lib/macro_sizing.js`)

```
base   = gate.size_multiplier (fallback 1.0)
scale  = confidence <= 0.5   -> 1.0
         confidence <= 0.75  -> 1.25
         confidence >  0.75  -> 1.5
final  = min(base * scale, base * 2.0, 2.0)
```

### Derived summary — `decision.macro_summary`

Every gated decision carries a small, stable summary so dashboards
and LLMs don't parse reason codes:

```
{
  consulted:       bool,
  direction:       "bullish"|"bearish"|"neutral"|"mixed"|"watchful"|"unknown"|null,
  agreement:       "agree"|"disagree"|"neutral"|"unknown"|"unavailable"|"not_consulted",
  size_effect:     "boost"|"hold"|"cap"|"none",
  size_multiplier: number|null
}
```

### Authoritative schema

Bounds on every field above come from
[`integration_schema/macro_schema_v1.0.0.json`](https://github.com/thommi2phones/macro-analyzer/blob/main/integration_schema/macro_schema_v1.0.0.json)
on the macro-analyzer side (`size_multiplier` is `0.0-2.0`,
`confidence` is `0.0-1.0`). If the narrative integration doc
disagrees with the JSON schema, the schema wins.

## pnl_r accounting (per-TP partial exits)

`webhook/macro_integration.computeWeightedPnlR` uses a scale-out model.
Each TP closes a fraction of the position per
`MACRO_PNL_PARTIAL_WEIGHTS` (default `0.5,0.25,0.25` for tp1/tp2/tp3).
The remaining fraction exits at the most-advanced level reached.

| scenario | formula |
|---|---|
| stop, no TPs | `-1.0` |
| stop after hit_tp1 | `w1*r1 + (1-w1)*(-1.0)` |
| stop after hit_tp1+hit_tp2 | `w1*r1 + w2*r2 + (1-w1-w2)*(-1.0)` |
| hit_tp1 (closed at tp1) | `1.0 * r1` |
| hit_tp2 (no tp3) | `w1*r1 + (1-w1)*r2` |
| hit_tp3 (full winner) | `w1*r1 + w2*r2 + w3*r3` |

Where `r_i = sign * (tp_i - entry) / |entry - stop|` and `sign = +1` for
long, `-1` for short.
