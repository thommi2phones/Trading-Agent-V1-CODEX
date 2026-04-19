# Perception Agent Registry v1

The macro-analysis system is built as a **multi-tier topology**: a top-level reasoning LLM synthesizes structured outputs from one or more **perception agents**, each owning narrow tools and a small deterministic output. This file is the canonical registry of perception roles.

The envelope wrapper (`docs/perception_bus_v1.md`) is locked. **Per-role payload schemas are versioned per agent** — only `ta_charts` is fully specified here; other roles describe scope and reserved `agent_role` values, with payload shape marked TBD.

## Roles

| `agent_role` | Status | Scope | Output payload | Spec |
|---|---|---|---|---|
| `ta_charts` | shipping | TradingView charts: structure, patterns, levels, momentum, decision engine, lifecycle. This repo. | `{ per_timeframe: [{ timeframe, agent_packet, decision, event_id }] }` | this doc + `docs/trading_decision_engine_v1.md` |
| `macro_research` | reserved | Long-form: podcasts, Fed minutes, research PDFs, earnings calls. RAG-driven. | `{ regime, narratives[], citations[] }` (TBD) | TBD in macro project repo |
| `orderflow` | reserved | Options flow, dark pool prints, CFTC COT, crypto funding/OI. | `{ symbol, positioning_score, bias, flow_tags[] }` (TBD) | TBD |
| `cross_asset` | reserved | DXY, TNX, HYG, VIX, gold, oil, BTC, key spreads. | `{ risk_on_off, drivers[], correlations }` (TBD) | TBD |
| `calendar` | reserved | Econ prints, earnings, opex, token unlocks. Often deterministic, may not require an LLM. | `{ upcoming_events[], blackout_windows[] }` (TBD) | TBD |
| `sentiment` | reserved | X / Reddit / StockTwits / fear-greed / put-call. | `{ sentiment_score, extremes[], regime_label }` (TBD) | TBD |
| `fundamentals` | reserved (optional) | 10-Q/8-K/insider/13F. Equities only. | `{ quality_score, flags[] }` (TBD) | TBD |
| `reasoning` | reserved | The synthesis tier. Consumes perception outputs, emits decisions and follow-up requests. Not a perception agent itself; named so other agents can target it as `to_agent_role`. | n/a | TBD |

**Reserving a role here means:** the bus accepts `to_agent_role` values from this list, watchers can be wired to filter on them, and the envelope layout is contractually compatible. It does not mean the agent exists.

## Status legend

- **shipping** — implemented in this repo or a sibling repo, with a versioned payload schema.
- **reserved** — `agent_role` value is reserved on the bus; payload shape is TBD and will be specified by the agent's own repo when built.

## `ta_charts` payload — full schema (v1)

The `ta_charts` role is the only one whose payload is locked here. Other agents publish their own per-role payload specs in their respective repositories and link back from this table.

### Result envelope `payload`

```json
{
  "per_timeframe": [
    {
      "timeframe": "1d",
      "event_id": "string",
      "agent_packet": { ... },   // see lib/packet.js#buildAgentPacket
      "decision": { ... }        // see webhook/decision.js#evaluateDecision
    }
  ]
}
```

### `agent_packet` — produced by `lib/packet.js#buildAgentPacket`

Canonical observation type for the `ta_charts` role. Source of truth: `lib/packet.js`. Backed by the parity test in `scripts/verify_webhook_parity.js`.

```
{
  source: "tradingview_webhook" | "tv_direct_pine" | "tv_direct_raw",
  received_at, event_id, setup_id, symbol, timeframe,
  stage, bias, confluence, score,
  pattern: { manual_type, manual_bias, manual_confirmed,
             auto_type, auto_conf, auto_bias, auto_aligned },
  levels:  { entry, stop, tp1, tp2, tp3,
             near_entry, hit_entry, hit_stop, hit_tp1, hit_tp2, hit_tp3 },
  momentum: { rsi, macd_hist, squeeze_release },
  mismatch_flags: string[], missing_fields: string[], accepted: bool, reasons: string[]
}
```

### `decision` — produced by `webhook/decision.js#evaluateDecision`

```
{
  action: "LONG" | "SHORT" | "WAIT",
  confidence: "LOW" | "MEDIUM" | "HIGH",
  risk_tier: "BLOCKED" | "C" | "B" | "A",
  direction_score: -6..+6,
  reason_codes: string[],
  timestamp: ISO-8601
}
```

Hard invariants and the full rule set live in `docs/trading_decision_engine_v1.md`. Any change to `decision.js` MUST keep `scripts/verify_webhook_parity.js` green.

## Adding a new role

1. Reserve the `agent_role` value here with status `reserved` and a one-line scope.
2. Stand up the agent in its own repo; specify its payload schema at `docs/<role>_payload_v1.md` in that repo.
3. Update this registry: status becomes `shipping`, payload column links to the spec.
4. Bump `envelope_version` only if a wrapper field needs to change — adding new roles or new payload shapes does not bump.

## Related

- `docs/perception_bus_v1.md` — envelope wrapper, transport, lifecycle.
- `lib/agent_bus.js` — runtime helpers.
- `coordination/bus/` — runtime envelope storage.
