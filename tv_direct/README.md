# tv_direct

Direct-TradingView ingestion lane for the `ta_charts` perception agent. The webhook (`webhook/server.js`) remains as a fallback. See `docs/direct_tv_ingest_v1.md` for the full spec.

## When to use

A Claude coworking session that can read a TradingView chart directly calls into this module. The module turns Pine-derived (or raw-bar) chart state into the canonical `agent_packet` shape, persists it to the same `events.ndjson` the webhook writes, and publishes a response envelope to the perception bus.

Use:
- `captureChartSnapshot({ symbol, timeframe, mode, ... })` when Claude has just read fresh chart state and wants the full pipeline.
- `ingest(payload, { source, agent_id, request_envelope })` when Claude has already assembled a complete payload (e.g. the full Pine field set).

Both paths run the same downstream:
`adapter (optional) → normalizePayload → wrapEvent → writeEvent → buildAgentPacket → evaluateDecision → buildEnvelope → publish`.

## Modes

| mode | adapter | status | accepted? |
|---|---|---|---|
| `pine` | `adapters/pine_snapshot.js` | primary | yes when caller supplies REQUIRED_FIELDS |
| `raw`  | `adapters/raw_bars.js` | **stub** | no — packets land with `accepted=false` and decision returns `BLOCKED` |

The `raw` mode is intentionally non-actionable until JS ports of EMA/RSI/MACD/TTM-squeeze/pattern detectors land. See the stub's docstring for the graduation requirements.

## Environment

| env | default | purpose |
|---|---|---|
| `TV_DIRECT_AGENT_ID` | `ta_charts_v1` | `from_agent.agent_id` on emitted envelopes |
| `TV_DIRECT_DEFAULT_MODE` | `pine` | mode used when `captureChartSnapshot` is called without `mode` |
| `TV_DIRECT_PUBLISH` | unset (publish on) | set to `0` to skip bus publishing (handy for tests) |

Bus publishing is governed by `BUS_PEERS` / `MACRO_API_URL` — see `docs/perception_bus_v1.md`.

## Verification

`node scripts/verify_tv_direct.js` exercises both modes end-to-end against a temp bus dir and asserts:
- pine mode produces an `accepted=true` packet with `source=tv_direct_pine`
- raw mode produces an `accepted=false` packet with `source=tv_direct_raw` and a `BLOCKED` decision
- both write to the shared `events.ndjson`
- both emit a properly-shaped outbound envelope to the bus outbox
