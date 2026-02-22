# Next Scope (Claude Trading Agent + UI)

## Phase 1: Ingestion Foundation (Now)
- Webhook receives TradingView events
- Normalize to `agent_packet`
- Store NDJSON + latest snapshot
- Expose API for UI:
  - `GET /events/latest`
  - `GET /events?limit=...&setup_id=...`

## Phase 2: Claude Local Interface
- Configure `AGENT_INBOX_DIR` to Claude trading-agent local files path
- Write one JSON packet per accepted event into inbox
- Claude local process picks up packet files and produces analysis artifacts

## Phase 3: Replit UI (or similar)
- UI polls backend APIs for recent events and latest state
- Display:
  - symbol/timeframe/setup_id
  - confluence/score/bias
  - manual vs auto pattern agreement
  - entry/stop/tp hit states
- Add filters by setup_id, symbol, stage

## Phase 4: Lifecycle + Outcomes
- Track setup lifecycle:
  - watch -> trigger -> in_trade -> tp_zone -> invalidated
- Persist outcomes and compute stats by:
  - pattern type
  - confluence class
  - timeframe

## Phase 5: Reliability + Ops
- Add retry queue for failed forward calls
- Add authentication/gateway controls
- Add uptime + error monitoring
