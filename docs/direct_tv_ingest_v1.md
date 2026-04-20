# Direct-TV Ingestion v1

Spec for the `tv_direct/` module — the primary ingestion lane for the `ta_charts` perception agent. The webhook (`webhook/server.js`) remains as a fallback for TradingView alert push.

## Why this exists

When a Claude coworking session can read a TradingView chart directly, we want a path that:

1. Skips the alert/webhook hop entirely.
2. Produces the **same** `agent_packet` shape the webhook produces, so all downstream code (decision engine, lifecycle engine, `/events`, `/lifecycle/latest`, `/decision/latest`) stays unchanged.
3. Publishes responses on the perception bus so the reasoning LLM and other perception agents see the result.

## Flow

```
Claude coworking session reads TV chart
            │
            ▼
captureChartSnapshot({symbol, timeframe, mode, ...})    ingest(payload, {source})
            │                                                       │
            └──────────────► tv_direct/index.js ◄───────────────────┘
                                    │
                          adapter (pine | raw)
                                    │
                          lib/packet.js
                            normalizePayload
                            wrapEvent  (sets event.source)
                                    │
                          lib/events_store.js
                            writeEvent → events.ndjson, latest.json
                                    │
                          lib/packet.js
                            buildAgentPacket  (source: tv_direct_pine | tv_direct_raw)
                                    │
                          webhook/decision.js
                            evaluateDecision
                                    │
                          lib/agent_bus.js
                            buildEnvelope (outbound, ta_charts → reasoning)
                            publish (file + HTTP)
```

## Entry points

### `captureChartSnapshot(opts)`

Used when the caller has fresh chart state and wants the full pipeline.

```js
const { captureChartSnapshot } = require("./tv_direct");

await captureChartSnapshot({
  mode: "pine",                  // "pine" | "raw" (default from TV_DIRECT_DEFAULT_MODE)
  symbol: "BTCUSD",
  timeframe: "1d",
  bar_time: "1734567890000",
  // ...all Pine fields the caller pulled off the chart
  request_envelope: incomingReq, // optional — links the response back to a bus request
  agent_id: "ta_charts_v1"       // optional — overrides TV_DIRECT_AGENT_ID
});
```

Returns `{ event, agent_packet, decision, envelope, bus }`.

### `ingest(payload, opts)`

Used when the caller already assembled a complete payload (e.g. parsed from a chart screenshot or copied from a Pine alert).

```js
const { ingest } = require("./tv_direct");

await ingest(fullPayload, {
  source: "tv_direct_pine",      // "tv_direct_pine" | "tv_direct_raw"
  agent_id: "ta_charts_v1",
  request_envelope: incomingReq
});
```

## Modes

### `pine` — primary

Adapter: `tv_direct/adapters/pine_snapshot.js`. Accepts the full Pine field set (REQUIRED_FIELDS plus optional extras) and normalizes it. Packets land with `accepted=true` if the caller supplies the required keys (`symbol`, `timeframe`, `bar_time`, `setup_id`, `pattern_type`, `setup_stage`, `pattern_bias`, `pattern_confirmed`, `fib_significance`, `macd_hist`, `squeeze_release`, `rsi`, `score`, `confluence`, `bias`).

### `raw` — STUB

Adapter: `tv_direct/adapters/raw_bars.js`. Populates only `symbol`, `timeframe`, `bar_time`, OHLC and a bars lookback count. Indicator fields are null. Packets land with `accepted=false`, `missing_fields` populated, and `evaluateDecision` returns `BLOCKED` with `gate_missing_required_fields`. **Intentional** — we don't act on incomplete data.

Graduating raw mode out of stub status requires:

1. JS ports of EMA / RSI / MACD / TTM squeeze and the seven pattern detectors that match the Pine implementation in `tradingview/structure_confluence_engine_v1.pine`.
2. A Pine-vs-JS reconciliation harness with <0.5% drift on a rolling 100-bar window per symbol/timeframe.
3. A spec doc at `docs/raw_bars_compute_v1.md` describing the JS-side computation contract.

## Source tagging

`agent_packet.source` distinguishes the ingestion lane:

| value | lane |
|---|---|
| `tradingview_webhook` | classic webhook path (`webhook/server.js`) |
| `tv_direct_pine` | direct-TV via pine adapter |
| `tv_direct_raw` | direct-TV via raw adapter (stub) |

Decision and lifecycle engines do not branch on this field — it's purely for downstream attribution.

## Bus envelope

Every successful ingestion emits an outbound envelope:

```json
{
  "envelope_version": "1",
  "direction": "outbound",
  "envelope_id": "ENV-...",
  "from_agent": { "agent_id": "ta_charts_v1", "agent_role": "ta_charts" },
  "to_agent_role": "<requester role, default 'reasoning'>",
  "created_at": "ISO-8601",
  "reply_to_request_id": "REQ-...",        // present iff request_envelope was passed in
  "symbol": "BTCUSD",
  "timeframes": ["1d"],
  "payload": {
    "per_timeframe": [
      { "timeframe": "1d", "event_id": "...", "agent_packet": {...}, "decision": {...} }
    ]
  }
}
```

The envelope is dropped to `coordination/bus/outbox/` and POSTed to `BUS_PEERS[to_agent_role]` if mapped. See `docs/perception_bus_v1.md`.

## Environment

| env | default | purpose |
|---|---|---|
| `TV_DIRECT_AGENT_ID` | `ta_charts_v1` | `from_agent.agent_id` on emitted envelopes |
| `TV_DIRECT_DEFAULT_MODE` | `pine` | mode when `captureChartSnapshot` is called without `mode` |
| `TV_DIRECT_PUBLISH` | unset (publish on) | set to `0` to skip bus publishing (handy for tests) |
| `BUS_DIR` | `coordination/bus` | bus root override |
| `BUS_PEERS` | unset | JSON map `{ <role>: <url> }` for HTTP delivery |
| `BUS_BEARER` | unset | shared bearer for peer POSTs |
| `MACRO_API_URL` | unset | back-compat for the `reasoning` peer |

## Verification

`scripts/verify_tv_direct.js` exercises both modes end-to-end against a temp bus dir and asserts:
- pine mode: `accepted=true`, `source=tv_direct_pine`, decision present
- raw mode: `accepted=false`, `source=tv_direct_raw`, decision is `BLOCKED`
- both write to the shared `events.ndjson`
- both emit a properly-shaped outbound envelope to the bus outbox
- envelope linkage via `request_envelope` round-trips through `reply_to_request_id`

## Multi-source compatibility

Direct-TV events share `webhook/data/events.ndjson` with webhook events. The lifecycle engine (`webhook/lifecycle.js`) reads `event.payload` and is source-agnostic, so a setup whose `trigger` arrives via webhook and whose `in_trade` arrives via tv_direct produces a single coherent transition history. The decision engine consumes `agent_packet` and is also source-agnostic.

## Limitations

- Single-process only: webhook and tv_direct must run in the same Node process to safely share the events file. Cross-process would need file locking or a split events store with merge-on-read; out of scope.
- Raw mode is a stub. Until graduated, raw-mode packets never trigger an actionable decision.
- The bus inbox watcher that *consumes* incoming requests and calls `captureChartSnapshot` is a separate slice (`scripts/bus_watcher.js`).
