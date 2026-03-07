# CLAUDE MEMORY: Trading-Agent-V1-CODEX

## Purpose
This file is a machine-ingestible memory snapshot for Claude/Codex of the current project state, design intent, and integration plan.

## Project Goal
Create a pattern-first trading analysis pipeline:
1. TradingView indicator computes structure/momentum/level context.
2. TradingView alerts POST JSON to Render webhook.
3. Webhook validates, normalizes, persists, and forwards data.
4. Claude trading agent consumes normalized packets and produces analysis.
5. UI (Replit or similar) reads event APIs and lifecycle state.

## What Is Implemented

### 1) Pine Script (single composite engine)
File:
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/tradingview/structure_confluence_engine_v1.pine`

Capabilities:
- EMA cluster (Thanos) context
- RSI regime + shifts
- MACD histogram + TTM squeeze logic
- Historical key-level proxies
- Manual Fib levels by significance (white/yellow/green)
- Manual trade levels (entry/stop/TP1/TP2/TP3)
- Confluence scoring + bias classification
- Alert payload JSON generation
- Named alert conditions (entry/stop/tp/confluence)
- Auto-pattern heuristics:
  - bear/bull flag
  - bear/bull pennant
  - head and shoulders
  - double top
  - cup and handle
- Compression-over-time logic for pennant detection

Important constraint:
- Pine cannot read manual chart drawings directly (blue lines/arcs/Fib tool objects). Manual pattern/fib context remains user inputs.

### 2) Webhook Service (Render)
File:
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/webhook/server.js`

Active behavior:
- Accepts POST at:
  - `/webhook`
  - `/webhook/`
  - `/tv-webhook`
  - `/tv-webhook/`
- Validates required fields
- Logs request lifecycle with debug lines
- Rejects invalid JSON with raw preview snippet
- Writes full event history to:
  - `webhook/data/events.ndjson`
- Writes latest event snapshot to:
  - `webhook/data/latest.json`
- Builds normalized `agent_packet` for downstream agent usage
- Optional forward to external endpoint via `AGENT_FORWARD_URL`
- Optional local file handoff via `AGENT_INBOX_DIR`
- Exposes read APIs for UI:
  - `GET /health`
  - `GET /events/latest`
  - `GET /events?limit=...&setup_id=...`

Security note:
- Token requirement was removed for simplicity/alignment.
- Current setup relies on endpoint secrecy + gateway controls (recommended to add stricter auth later).

### 3) Documentation
Files:
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/webhook/README.md`
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/docs/step_by_step_tv_to_agent.md`
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/docs/verification_and_taxonomy_runbook.md`
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/docs/claude_agent_contract.md`
- `/Users/thom/Documents/GitHub/Trading Agent V1 CODEX/docs/project_scope_next.md`

## Why It Was Designed This Way
1. Pattern-first strategy required preserving manual chart interpretation.
2. Pine offers reliable numeric context but not reliable direct drawing ingestion.
3. Webhook is required for low-latency push from TradingView.
4. Normalized `agent_packet` separates transport format from decision format.
5. `/events` APIs provide immediate backend contract for a thin UI.

## Current Verified Status
- TradingView alerts successfully hitting Render endpoint.
- Invalid text alerts were diagnosed and corrected.
- JSON alerts are now accepted and processed.
- Render logs show request processed with setup/symbol/confluence.
- Pattern detection now identifies bear/bull pennants in tested examples.

## Latest Accomplishments (Most Recent Session)
0. Session update (March 6, 2026)
- Added `docs/trading_decision_engine_v1.md` as the canonical deterministic policy for `agent_packet -> LONG|SHORT|WAIT`.
- Defined:
  - hard safety gates (missing/conflicting data blocks action),
  - weighted direction scoring,
  - stage guardrail,
  - confidence/risk-tier mapping,
  - reason code contract for auditability.
- This is the active baseline for Decision Engine v1 implementation.

0. Session update (March 6, 2026)
- Added repository hygiene guardrails:
  - Created root `.gitignore` with runtime exclusions for `webhook/data/*` while keeping `webhook/data/.gitkeep`.
- Added webhook event file retention control:
  - New env var `MAX_EVENTS_FILE_BYTES` (default `5_000_000`).
  - When `webhook/data/events.ndjson` reaches limit, server rotates it to `webhook/data/events.prev.ndjson` before appending new events.
- Updated webhook docs to document retention and gitignored runtime artifacts.

1. Stabilized TradingView -> Render relay
- Confirmed live webhook processing with TradingView source IPs
- Added robust request lifecycle logging
- Added invalid JSON raw preview logging for fast troubleshooting
- Removed token dependency from runtime flow to match current TV usage
- Added flexible webhook routes (`/webhook`, `/tv-webhook`, with/without trailing slash)

2. Expanded Pine strategy engine to one composite system
- Added manual entry/stop/TP level model with proximity/hit tracking
- Added risk/reward fields (`rr_tp1`, `rr_tp2`, `rr_tp3`)
- Added dedicated alertconditions for entry/stop/tp and confluence states
- Added auto pattern detection module for:
  - flags/pennants (bull + bear)
  - head and shoulders
  - double tops
  - cup and handle
- Tuned pattern logic to reduce false double-top calls in downtrend compression
- Added explicit compression-over-time feature for pennant recognition

3. Improved event backend for agent + UI consumption
- Added normalized `agent_packet` generation per accepted webhook
- Added persistence APIs:
  - `GET /events/latest`
  - `GET /events?limit=...&setup_id=...`
- Added latest snapshot storage (`webhook/data/latest.json`)
- Added optional local file inbox integration via `AGENT_INBOX_DIR`
- Added CORS headers for frontend clients (Replit-compatible integration path)

4. Documentation and operational clarity
- Updated setup/runbook docs for no-token webhook flow
- Documented integration scope and next-phase architecture
- Added this memory layer so Claude can ingest project state quickly

## New Operational Baseline
- Indicator on chart: `TA Codex - Structure Confluence Engine v1`
- Alert mode: `Any alert() function call` (or explicit named conditions)
- Webhook URL:
  - `https://trading-agent-v1-codex.onrender.com/webhook`
- Expected Render success log:
  - `[webhook] request_processed ... accepted=true ...`

## Required User Alert Configuration
Use alert condition from this indicator:
- `TA Codex - Structure Confluence Engine v1`
- Event: `Any alert() function call` (or specific named alertcondition)
- Webhook URL:
  - `https://trading-agent-v1-codex.onrender.com/webhook`
- Message: blank when using `alert(payload, ...)` flow

## Data Contract (Important Fields)
High-value fields for agent:
- `setup_id`, `symbol`, `timeframe`, `setup_stage`
- `pattern_type`, `pattern_bias`, `pattern_confirmed`
- `auto_pattern`, `auto_pattern_conf`, `auto_pattern_aligned`
- `fib_significance`
- `entry_price`, `stop_price`, `tp1_price`, `tp2_price`, `tp3_price`
- `near_entry`, `hit_entry`, `hit_stop`, `hit_tp1/2/3`
- `score`, `confluence`, `bias`
- `mismatch_flags`, `missing_fields`

## Integration Vision

### A) Claude Local Trading Agent
Two integration modes:
1. HTTP mode:
   - Set `AGENT_FORWARD_URL` to local/hosted gateway endpoint.
   - Receiver posts `{ event, agent_packet }`.
2. Local file inbox mode:
   - Set `AGENT_INBOX_DIR` to Claude-agent readable folder.
   - Receiver writes one packet JSON per accepted webhook.
   - Claude process watches folder and produces analysis outputs.

Recommended first:
- Start with file inbox mode for deterministic local workflows.

### B) UI Layer (Replit or similar)
Backend already supports read APIs:
- `GET /events/latest`
- `GET /events?limit=50`

UI MVP should show:
1. Latest setup card (symbol, stage, confluence, bias)
2. Pattern panel (manual vs auto + agreement)
3. Trade-level panel (entry/stop/TP hit states)
4. Event feed table filterable by `setup_id`

## Known Gaps / Next Work
1. Add auth/gateway controls for production.
2. Add retry queue/dead-letter for failed forward calls.
3. Add persistent database (SQLite/Postgres) beyond ndjson.
4. Add lifecycle engine: watch -> trigger -> in_trade -> tp_zone -> invalidated.
5. Tune pattern thresholds with larger sample set.

## Immediate Next Step
Push latest commit to GitHub and redeploy Render so ingestion API/local-inbox features are live, then connect Claude local files via `AGENT_INBOX_DIR`.
