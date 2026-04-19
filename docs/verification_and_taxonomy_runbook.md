# TradingView -> Agent Verification And Taxonomy Runbook

## 1) Alert Taxonomy Standard
Use this naming convention for every TradingView alert:

`<strategy>|<pattern>|<bias>|<stage>|<tf>|<setup_id>|<version>`

Example:
`ta_codex|flag|bullish|trigger|1h|setup_014|tax_v1`

Field definitions:
- `strategy`: fixed id, e.g. `ta_codex`
- `pattern`: `flag|pennant|channel|trendline|hns|inverse_hns|cnh|wedge|arc|other`
- `bias`: `bullish|bearish|neutral`
- `stage`: `watch|trigger|in_trade|tp_zone|invalidated`
- `tf`: `5m|15m|1h|4h|1d`
- `setup_id`: your durable id for this chart idea
- `version`: taxonomy version

## 2) Required Manual Inputs In Script
Before creating the alert, set:
- `Taxonomy Version`
- `Setup ID`
- `Pattern Type`
- `Setup Stage`
- `Time Horizon`
- `Dominant Pattern Bias`
- `Pattern Confirmed (manual)`
- Fib price levels (`White`, `Yellow`, `Green`)

## 3) Verification Checklist (Dry Run)
1. Add script to chart and confirm no Pine compile errors.
2. Confirm label updates on each bar close.
3. Toggle `Pattern Bias` and verify `score` and `bias` change.
4. Enter one nearby green Fib level and confirm:
   - `fib_significance = GREEN`
   - `near_fib_green = true`
5. Force conditions on replay:
   - `squeeze_release = true` on squeeze break
   - `macd_bull_expand` or `macd_bear_expand` updates correctly
6. Confirm level behavior:
   - `break_above_level` when close breaks proxy high
   - `break_below_level` when close breaks proxy low
7. Trigger alert and inspect webhook body contains:
   - taxonomy fields
   - OHLC + candle diagnostics
   - Fib distance fields
   - confluence/bias/score fields

## 4) Minimum Webhook Validation Rules (Agent Side)
Reject payload if any are missing:
- `symbol`, `timeframe`, `bar_time`
- `setup_id`, `pattern_type`, `setup_stage`
- `pattern_bias`, `pattern_confirmed`
- `fib_significance`
- `macd_hist`, `squeeze_release`, `rsi`
- `score`, `confluence`, `bias`

## 5) Recommended Agent Merge Logic
1. Screenshot parser produces:
   - pattern geometry
   - drawn Fib levels/colors
   - blue dashed key levels
2. Payload parser produces:
   - momentum state
   - regime state
   - quantitative distances
3. Merger checks consistency:
   - if payload says `pattern_type=flag` but screenshot not flag, reduce confidence
   - if payload fib significance is `GREEN` but no green Fib seen in image, flag mismatch
4. Return final output with mismatch flags.

## 6) Suggested Mismatch Flags
- `pattern_mismatch`
- `fib_color_mismatch`
- `level_alignment_mismatch`
- `momentum_conflict`
- `taxonomy_incomplete`

## 7) Rollout Plan
1. Run paper-only for 3-5 sessions.
2. Store every payload and screenshot pair.
3. Review mismatch rates by category.
4. Tighten taxonomy and script thresholds.
5. Promote to production routing.

## 8) Verification Suites

Every integration ships with a `scripts/verify_*.js` script. All must
pass before merging to main. Run them individually or as a batch:

| script | covers |
|---|---|
| `verify_webhook_parity.js` | agent_packet byte-equivalence to golden snapshot |
| `verify_bus_contract.js` | perception bus envelope schema + registry |
| `verify_tv_direct.js` | tv_direct ingest lane + adapters |
| `verify_bus_watcher.js` | bus peer polling + request lifecycle |
| `verify_macro_client.js` | macro HTTP client + gate + snapshots + outcome poster + asset_class threading |
| `verify_macro_sizing.js` | `computeSizingFromMacroView` agreement-boost formula |
| `verify_docs.js` | doc references resolve; every listed verify script exists |

Operational context (processes, env vars, graceful-degradation contract)
lives in [`operations.md`](./operations.md).

