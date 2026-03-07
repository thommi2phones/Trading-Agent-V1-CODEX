# Trading Decision Engine v1

## Goal
Map each normalized `agent_packet` into a deterministic decision:
- `LONG`
- `SHORT`
- `WAIT`

The engine is conservative by default and blocks action when risk or structure is incomplete.

## Input Contract
Primary fields consumed from `agent_packet`:
- `accepted`
- `missing_fields[]`
- `mismatch_flags[]`
- `stage`
- `bias`
- `confluence`
- `score`
- `pattern.manual_bias`
- `pattern.manual_confirmed`
- `pattern.auto_type`
- `pattern.auto_bias`
- `pattern.auto_aligned`
- `levels.entry`, `levels.stop`
- `levels.near_entry`, `levels.hit_entry`, `levels.hit_stop`
- `momentum.rsi`, `momentum.macd_hist`, `momentum.squeeze_release`

## Output Contract
```json
{
  "action": "LONG|SHORT|WAIT",
  "confidence": "LOW|MEDIUM|HIGH",
  "risk_tier": "BLOCKED|C|B|A",
  "direction_score": -6,
  "reason_codes": ["string"],
  "timestamp": "ISO-8601"
}
```

## Hard Gates (Always Apply First)
Return `WAIT`, `risk_tier=BLOCKED`, `confidence=LOW` when any gate fails.

1. `accepted` must be `true`.
2. `levels.entry` and `levels.stop` must be present and numeric.
3. `missing_fields` must not include: `setup_id`, `pattern_type`, `setup_stage`, `pattern_bias`, `score`, `confluence`, `bias`.
4. `mismatch_flags` must not contain `confidence_vs_pattern_conflict` or `bias_conflict`.
5. If `levels.hit_stop=true`, force `WAIT` (setup already invalidated).

## Direction Scoring
Compute `direction_score` using weighted votes.

Bullish votes:
- `bias == BULLISH`: `+2`
- `pattern.manual_bias == bullish`: `+2`
- `pattern.manual_confirmed == true`: `+1`
- `pattern.auto_aligned == true` and `pattern.auto_bias == bullish`: `+1`
- `momentum.rsi >= 52`: `+1`
- `momentum.macd_hist > 0`: `+1`
- `momentum.squeeze_release == true` and `momentum.macd_hist > 0`: `+1`

Bearish votes:
- `bias == BEARISH`: `-2`
- `pattern.manual_bias == bearish`: `-2`
- `pattern.manual_confirmed == true`: `-1`
- `pattern.auto_aligned == true` and `pattern.auto_bias == bearish`: `-1`
- `momentum.rsi <= 48`: `-1`
- `momentum.macd_hist < 0`: `-1`
- `momentum.squeeze_release == true` and `momentum.macd_hist < 0`: `-1`

## Stage Guardrail
Allowed decision stages for actionable calls:
- `trigger`
- `in_trade`
- `tp_zone`

If stage is outside this set, return `WAIT` and reason `stage_not_actionable`.

## Action Mapping
After hard gates + stage guardrail:

1. `LONG` when:
- `direction_score >= +4`
- `confluence == HIGH` or (`confluence == MEDIUM` and `score >= 70`)

2. `SHORT` when:
- `direction_score <= -4`
- `confluence == HIGH` or (`confluence == MEDIUM` and `score >= 70`)

3. Otherwise `WAIT`.

## Confidence Mapping
- `HIGH`:
  - `abs(direction_score) >= 5`
  - `confluence == HIGH`
  - `pattern.manual_confirmed == true`
- `MEDIUM`:
  - `abs(direction_score) >= 4`
  - `confluence in {HIGH, MEDIUM}`
- `LOW`:
  - all remaining cases

## Risk Tier Mapping
- `BLOCKED`:
  - any hard gate fails
- `A`:
  - `confidence=HIGH` and `confluence=HIGH`
- `B`:
  - `confidence=MEDIUM`
- `C`:
  - `confidence=LOW` while still passing gates

## Reason Codes
Include concise reason codes for auditability:
- `gate_missing_required_fields`
- `gate_missing_levels`
- `gate_conflict_flags`
- `stage_not_actionable`
- `score_below_threshold`
- `long_alignment_strong`
- `short_alignment_strong`
- `momentum_confirms`
- `momentum_conflicts`

## v1 Non-Goals
- No ML/probabilistic model.
- No dynamic threshold tuning.
- No position sizing in this engine (handled by risk module).

## Implementation Notes
1. Keep this engine pure/deterministic (no side effects).
2. Emit the same output for the same input.
3. Log `direction_score` and `reason_codes` for post-trade analysis.

## Runtime Integration
Implemented module:
- `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/webhook/decision.js`

API endpoint:
- `GET /decision/latest?limit=200`
- `GET /decision/latest?setup_id=<setup_id>&limit=200`
