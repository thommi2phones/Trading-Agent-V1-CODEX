# Operations

Operational surface of Trading-Agent-V1-CODEX. Covers the processes that
need to be running in production, the environment variables that
configure them, and the graceful-degradation guarantees we rely on.

## Processes

The agent is composed of three independent processes, any of which can
run or be stopped without affecting the others. All state is durable
in `webhook/data/events.ndjson` and `data/macro_snapshots/`.

| process | entry | role | required? |
|---|---|---|---|
| Webhook server | `node webhook/server.js` | Receives TradingView webhook POSTs, builds `agent_packet`, writes events, serves read APIs. | Yes |
| Bus watcher (optional) | `node scripts/bus_watcher.js` | Reads perception-bus envelopes from peers and turns them into events. | Only when `BUS_PEERS` configured |
| Outcome sidecar | `node scripts/post_macro_outcomes.js --poll-ms 60000` | Long-running. Scans terminal events and POSTs `MacroOutcomeReport` to macro-analyzer for source scoring. | Only when `MACRO_ANALYZER_URL` set |

The outcome sidecar is safe to restart. It uses `data/macro_snapshots/outcomes.ndjson`
as its idempotency ledger — setups already marked `posted: true` are
skipped. Running on a cron (every 5-10 minutes with `--once`) is
equivalent, but the long-running form has lower per-run overhead.

### Recommended Render worker layout

One web service per process. The webhook server is the public HTTP
surface; the sidecars run as private workers on the same Render account,
pointed at the same persistent disk (so they read the same
`webhook/data/` and `data/macro_snapshots/`).

```
render.yaml (sketch)
services:
  - type: web
    name: trading-agent-webhook
    startCommand: node webhook/server.js

  - type: worker
    name: trading-agent-outcome-sidecar
    startCommand: node scripts/post_macro_outcomes.js --poll-ms 60000

  - type: worker       # only when peer repos publish onto the bus
    name: trading-agent-bus-watcher
    startCommand: node scripts/bus_watcher.js
```

## Environment variables

### Webhook + events

| env | default | purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port for webhook server |
| `MAX_EVENTS_FILE_BYTES` | `5000000` | rotate `events.ndjson` to `events.prev.ndjson` at this size |
| `AGENT_FORWARD_URL` | unset | optional HTTP forward of `{ event, agent_packet }` |
| `AGENT_INBOX_DIR` | unset | optional local dir for file handoff |

### Perception bus (internal)

| env | default | purpose |
|---|---|---|
| `BUS_PEERS` | unset | comma-separated peer base URLs |
| `BUS_AGENT_ID` | `trading-agent-v1` | identifier emitted in envelopes |
| `TV_DIRECT_PUBLISH` | `1` | publish tv_direct events onto the bus |

### Macro-analyzer integration

| env | default | purpose |
|---|---|---|
| `MACRO_ANALYZER_URL` | unset | base URL of macro-analyzer. Unset = integration disabled. |
| `MACRO_ANALYZER_BEARER` | unset | optional bearer token |
| `MACRO_ANALYZER_TIMEOUT_MS` | `3000` | per-request timeout |
| `MACRO_SNAPSHOT_DIR` | `data/macro_snapshots` | snapshot + outcome-log directory |
| `MACRO_PNL_PARTIAL_WEIGHTS` | `0.5,0.25,0.25` | scale-out weights for tp1,tp2,tp3 in `pnl_r`. Must sum to 1.0 or we fall back to default. |

## Graceful-degradation contract

Every integration is a silent no-op when its URL env is unset, and
returns `null` on any failure (timeout, 4xx, 5xx, malformed JSON).
The webhook is never blocked on an upstream. Concretely:

| upstream | failure mode | observed effect |
|---|---|---|
| macro-analyzer unreachable | `fetchMacroView` returns `null` | decision adds `macro_unavailable` reason; pass through unchanged |
| macro-analyzer timeout | same as above | same |
| outcome POST fails | `postTradeOutcome` returns `null` | outcome not marked posted; retried next sidecar run |
| bus peer down | envelope not delivered | local event still written; peer will re-sync from its own source |
| `MACRO_ANALYZER_URL` unset | all macro_client calls return `null` | no reason codes emitted; behavior byte-equivalent to pre-macro |

This is the reason the project ships with **six** independent
verification suites rather than a single test bundle — each suite
exercises one process/integration under real failure injection.

## Verification suites

All scripts live in `scripts/` and run without arguments. Each exits
non-zero on failure. The full set:

| script | covers |
|---|---|
| `verify_webhook_parity.js` | `agent_packet` byte-equivalent against golden snapshot |
| `verify_bus_contract.js` | perception-bus envelope schema + registry |
| `verify_tv_direct.js` | tv_direct ingest lane + adapters |
| `verify_bus_watcher.js` | peer polling + request lifecycle |
| `verify_macro_client.js` | macro HTTP client, gate, snapshot store, outcome poster, asset_class threading |
| `verify_macro_sizing.js` | `computeSizingFromMacroView` formula across confidence x direction x gate-base matrix |
| `verify_macro_regime.js` | regime watcher: fetchRegime, change detection, stale-setup listing |
| `verify_partial_fill_pnl.js` | per-TP weighted `pnl_r` formula under the scale-out model |

`scripts/verify_docs.js` complements these by checking doc references
don't rot (every file referenced in docs exists; every verify script
listed in the runbook exists).
