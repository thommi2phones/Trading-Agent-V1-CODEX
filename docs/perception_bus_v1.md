# Perception Bus v1

The perception bus is the request/response channel between a top-tier reasoning LLM and one or more **perception agents**. This repository implements the `ta_charts` perception agent (technical analysis); other roles (`macro_research`, `orderflow`, `cross_asset`, `calendar`, `sentiment`, `fundamentals`) are reserved slots — see `docs/perception_agent_registry_v1.md`.

## Transport

Two interchangeable transports, used together:

1. **File drop** under `coordination/bus/` — reliable, replayable, inspectable.
2. **HTTP POST** — peer URLs declared via `BUS_PEERS` env var.

A publisher writes the file *and* attempts the HTTP post. Either alone is a valid delivery.

## Directory layout

```
coordination/bus/
├── inbox/        # incoming requests waiting for the right perception agent to pick them up
├── outbox/       # outgoing envelopes (results or requests this repo emits)
├── processing/   # envelopes claimed by a watcher, currently being handled
├── completed/    # successfully handled requests (archive of inbox)
├── failed/       # requests that errored; envelope plus a sibling .err.txt
└── archive/      # rotation target for old completed/failed envelopes
```

Runtime envelopes are gitignored; the directory structure is tracked via `.gitkeep`.

## Envelope schema

```json
{
  "envelope_version": "1",
  "direction": "inbound | outbound",
  "envelope_id": "REQ-<ts>-<rand> | ENV-<ts>-<rand>",
  "from_agent": { "agent_id": "string", "agent_role": "string" },
  "to_agent_role": "string",
  "created_at": "ISO-8601",

  "request_type": "chart_check | signal_verify | multi_tf_scan | ...",
  "reply_to_request_id": "optional",
  "reply_to_envelope_id": "optional",

  "symbol": "BTCUSD",
  "timeframes": ["1d", "1w", "1M"],
  "context": { "macro_regime": "risk_off", "why": "free text", "reply_to": "agent_id" },

  "payload": { ... }
}
```

**Required fields:** `envelope_version`, `direction`, `envelope_id`, `from_agent`, `to_agent_role`, `created_at`.

**Optional fields** are written only when supplied — `lib/agent_bus.js#buildEnvelope` strips undefined keys so envelopes stay diff-friendly.

### Field semantics

| field | meaning |
|---|---|
| `direction` | `inbound` = a request arriving for some perception agent. `outbound` = a result or query this repo emits. |
| `from_agent.agent_id` | unique identifier for the sender instance (e.g. `ta_charts_v1`, `reasoner_v1`). |
| `from_agent.agent_role` | one of the registered roles in `docs/perception_agent_registry_v1.md`. |
| `to_agent_role` | role that should pick up the envelope. A watcher with `--role <X>` filters the inbox by this field. |
| `request_type` | semantic verb of the request, role-specific. For `ta_charts` see `docs/direct_tv_ingest_v1.md`. |
| `reply_to_*` | populate when sending a response so the caller can correlate. |
| `payload` | role-specific body. For `ta_charts` results: `{ per_timeframe: [{ timeframe, agent_packet, decision, event_id }] }`. |

## Filename convention

`{created_at_with_dashes}_{envelope_id}.json` — chronological sort, collision-free.

## Lifecycle (request side)

```
inbox/<file>.json
   │  watcher with matching role picks it up
   ▼
processing/<file>.json
   │  watcher invokes the role-specific handler
   ▼
completed/<file>.json   (success)
   or
failed/<file>.json      (handler threw; .err.txt sibling holds the reason)
```

The result envelope is independently written to `outbox/` and POSTed to `BUS_PEERS[from_agent.agent_role]` if mapped.

## Configuration

| env var | purpose |
|---|---|
| `BUS_DIR` | override default `coordination/bus/` location. |
| `BUS_PEERS` | JSON map of `{ "<agent_role>": "<https://url>" }` for HTTP delivery. |
| `BUS_BEARER` | shared bearer token sent on every peer POST. |
| `MACRO_API_URL` | back-compat: used as the `reasoning` peer when `BUS_PEERS` is unset. |
| `MACRO_API_BEARER` | back-compat bearer for the legacy `MACRO_API_URL`. |

## Versioning

`envelope_version` is required on every envelope. Breaking changes bump the major (`"1"` → `"2"`); readers MUST reject envelopes whose major they do not understand. Additive changes (new optional fields, new `request_type` values, new `to_agent_role` enum entries) do not bump.

When v2 is introduced, both versions are produced in parallel for one release before v1 is retired.

## Example envelopes

### Inbound — reasoner asks the TA agent to check a daily/weekly setup

```json
{
  "envelope_version": "1",
  "direction": "inbound",
  "envelope_id": "REQ-1734567890123-ab12cd",
  "from_agent": { "agent_id": "reasoner_v1", "agent_role": "reasoning" },
  "to_agent_role": "ta_charts",
  "created_at": "2026-04-19T10:00:00.000Z",
  "request_type": "multi_tf_scan",
  "symbol": "BTCUSD",
  "timeframes": ["1d", "1w"],
  "context": {
    "macro_regime": "risk_off",
    "why": "DXY breakout; check BTC structural levels"
  }
}
```

### Outbound — TA agent returns per-timeframe packets and decisions

```json
{
  "envelope_version": "1",
  "direction": "outbound",
  "envelope_id": "ENV-1734567892456-ef78gh",
  "from_agent": { "agent_id": "ta_charts_v1", "agent_role": "ta_charts" },
  "to_agent_role": "reasoning",
  "created_at": "2026-04-19T10:00:02.000Z",
  "reply_to_request_id": "REQ-1734567890123-ab12cd",
  "symbol": "BTCUSD",
  "payload": {
    "per_timeframe": [
      { "timeframe": "1d", "event_id": "...", "agent_packet": { ... }, "decision": { ... } },
      { "timeframe": "1w", "event_id": "...", "agent_packet": { ... }, "decision": { ... } }
    ]
  }
}
```

## Verification

Run `node scripts/verify_bus_contract.js` to round-trip an envelope through `buildEnvelope → dropToInbox → readInboxFor → moveEnvelope → dropToOutbox` and assert the envelope reads back identical to what was written.
