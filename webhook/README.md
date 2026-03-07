# TradingView Webhook Receiver

## What this does
- Accepts TradingView alert POSTs at `/tv-webhook`
- Validates required payload fields
- Adds mismatch flags
- Logs every event to `webhook/data/events.ndjson`
- Writes latest event snapshot to `webhook/data/latest.json`
- Exposes event APIs for UI (`/events`, `/events/latest`)
- Optionally forwards events to your agent endpoint
- Optionally writes normalized agent packets to a local inbox directory

## 1) Run locally
```bash
cd "/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex"
PORT=8787 node webhook/server.js
```

Health check:
```bash
curl http://localhost:8787/health
```

Event APIs:
```bash
curl "http://localhost:8787/events/latest"
curl "http://localhost:8787/events?limit=20"
curl "http://localhost:8787/events?limit=50&setup_id=setup_001"
curl "http://localhost:8787/lifecycle/latest?limit=200"
curl "http://localhost:8787/lifecycle/latest?setup_id=setup_001&limit=200"
```

## 2) Test with sample payload
```bash
curl -X POST "http://localhost:8787/tv-webhook" \
  -H "Content-Type: application/json" \
  --data-binary @"/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/docs/webhook_payload_example.json"
```

## 3) TradingView alert setup
1. Open your chart with `TA Codex - Structure Confluence Engine v1`.
2. Create Alert.
3. Condition: select the indicator alert (`Confluence Payload`) or `Any alert() function call`.
4. Check `Webhook URL`.
5. Set URL:
   - Local test: `http://<public-tunnel-host>/tv-webhook`
   - Server: `https://your-domain.com/tv-webhook`
6. Alert message can be blank if your script uses `alert(payload, ...)`.

## 4) Expose local server to TradingView
TradingView cannot reach `localhost`. Use a tunnel:
- `ngrok http 8787`
- then put the generated `https://...` URL in TradingView webhook URL

## 5) Optional: forward to your agent
Set these env vars before starting server:
```bash
AGENT_FORWARD_URL="https://your-agent-gateway.example.com/inbound"
AGENT_FORWARD_BEARER="your_api_token"
```

Optional event file rotation limit (default 5 MB):
```bash
MAX_EVENTS_FILE_BYTES=5000000
```

Optional local file handoff to Claude trading-agent files:
```bash
AGENT_INBOX_DIR="/absolute/path/to/claude-trading-agent/inbox"
```

Forwarded body now includes both raw event + normalized agent packet:
```json
{
  "event": { "...": "raw webhook event" },
  "agent_packet": { "...": "normalized agent-ready structure" }
}
```

## 6) Troubleshooting
- `400 Invalid JSON`: alert body is not valid JSON.
- `accepted: false`: required fields are missing; inspect `missing_fields`.
- No TradingView calls received: webhook URL not public or alert not firing.

## 7) Repo hygiene
- Runtime files under `webhook/data/` are gitignored.
- `webhook/data/.gitkeep` keeps the folder structure in the repository.
