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
