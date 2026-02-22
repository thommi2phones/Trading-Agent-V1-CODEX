# TradingView Webhook Receiver

## What this does
- Accepts TradingView alert POSTs at `/tv-webhook`
- Validates required payload fields
- Adds mismatch flags
- Logs every event to `webhook/data/events.ndjson`
- Optionally forwards events to your agent endpoint

## 1) Run locally
```bash
cd "/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex"
TV_WEBHOOK_TOKEN="replace_me" PORT=8787 node webhook/server.js
```

Health check:
```bash
curl http://localhost:8787/health
```

## 2) Test with sample payload
```bash
curl -X POST "http://localhost:8787/tv-webhook?token=replace_me" \
  -H "Content-Type: application/json" \
  --data-binary @"/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/docs/webhook_payload_example.json"
```

## 3) TradingView alert setup
1. Open your chart with `TA Codex - Structure Confluence Engine v1`.
2. Create Alert.
3. Condition: select the indicator alert (`Confluence Payload`) or `Any alert() function call`.
4. Check `Webhook URL`.
5. Set URL:
   - Local test: `http://<public-tunnel-host>/tv-webhook?token=replace_me`
   - Server: `https://your-domain.com/tv-webhook?token=replace_me`
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

The receiver will POST this event envelope:
```json
{
  "received_at": "...",
  "source": "tradingview",
  "missing_fields": [],
  "mismatch_flags": [],
  "payload": { "...": "original TradingView payload" }
}
```

## 6) Troubleshooting
- `401 Invalid token`: token in query string doesn’t match `TV_WEBHOOK_TOKEN`.
- `400 Invalid JSON`: alert body is not valid JSON.
- `accepted: false`: required fields are missing; inspect `missing_fields`.
- No TradingView calls received: webhook URL not public or alert not firing.

