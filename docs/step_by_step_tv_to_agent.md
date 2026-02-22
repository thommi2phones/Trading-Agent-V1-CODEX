# Step-By-Step: TradingView Alerts To Your Agent

## Flow
1. TradingView script emits JSON payload on bar close.
2. TradingView alert sends POST to webhook URL.
3. Webhook validates/logs event.
4. Webhook forwards event to your agent endpoint.
5. Agent merges payload + screenshot analysis.

## Step 1: Start webhook receiver
```bash
cd "/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex"
TV_WEBHOOK_TOKEN="replace_me" PORT=8787 node webhook/server.js
```

## Step 2: Verify receiver works
```bash
curl http://localhost:8787/health
```

Expected:
```json
{"ok":true,...}
```

## Step 3: Dry-run payload locally
```bash
curl -X POST "http://localhost:8787/tv-webhook?token=replace_me" \
  -H "Content-Type: application/json" \
  --data-binary @"/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/docs/webhook_payload_example.json"
```

Expected:
```json
{"ok":true,"accepted":true,...}
```

## Step 4: Make webhook URL reachable from TradingView
Use tunnel:
```bash
ngrok http 8787
```

Copy the HTTPS URL from ngrok:
`https://<id>.ngrok-free.app`

## Step 5: Configure TradingView alert
1. Add `TA Codex - Structure Confluence Engine v1` to chart.
2. Fill script manual fields (`setup_id`, `pattern_type`, `setup_stage`, Fib levels).
3. Create alert:
   - Condition: `Confluence Payload` or `Any alert() function call`
   - Trigger: once per bar close
   - Webhook URL: `https://<id>.ngrok-free.app/tv-webhook?token=replace_me`
4. Save alert.

## Step 6: Confirm end-to-end delivery
1. Wait for bar close or use replay to force trigger.
2. Check webhook server console for request.
3. Check event log:
   - `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/webhook/data/events.ndjson`

## Step 7: Forward into your agent
Restart server with forward config:
```bash
TV_WEBHOOK_TOKEN="replace_me" \
PORT=8787 \
AGENT_FORWARD_URL="https://your-agent-gateway.example.com/inbound" \
AGENT_FORWARD_BEARER="your_api_token" \
node webhook/server.js
```

## Step 8: Production hardening
1. Deploy receiver on HTTPS domain (no tunnel).
2. Keep token secret and rotate periodically.
3. Add IP allowlisting/rate limits at gateway.
4. Persist payload + screenshot references for audit.

