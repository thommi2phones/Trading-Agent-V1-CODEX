# OpenClaw Operating Playbook (Trading Agent Project)

## What This Bot Is
Trading Agent Project Manager and accountability engine.

## What This Bot Is Not
- Not a trade signal oracle
- Not discretionary prediction engine
- Not an execution bridge by itself

## Daily Workflow
1. Start of day:
   - review `/milestone` status
   - list top 3 `/task` items
   - check open `/blocker` items
2. During session:
   - record each test with `/backtest`
   - validate all setups with `/risk`
   - capture psychology with `/journal`
3. End of day:
   - summarize progress by bucket
   - define next action for tomorrow

## Weekly Workflow (Sunday)
Run `/review` with `Window: weekly` and produce:
1. Win rate
2. R-multiple distribution
3. Setup performance by pattern type
4. Confluence-class performance
5. Discipline violations (missing stop, risk oversize, revenge behavior)
6. 3 corrective actions for next week

## Integration With Current Stack
Current pipeline:
1. TradingView -> webhook (`/webhook`)
2. webhook -> event store (`events.ndjson`, `latest.json`)
3. webhook -> normalized `agent_packet`
4. webhook -> optional forward (`AGENT_FORWARD_URL`) or local inbox (`AGENT_INBOX_DIR`)

OpenClaw should consume:
1. `/events/latest` for live state
2. `/events?limit=...` for recent history
3. optional local inbox files for deterministic local workflows

## Minimal Operational Rules
1. No execution advice if stop/risk/invalidation is missing.
2. After 3 consecutive losses, enforce cooldown recommendation.
3. Any setup with `confluence=LOW` defaults to no-action unless user explicitly overrides.
4. If manual pattern and auto pattern conflict, flag for review before escalation.

## Immediate Setup Checklist
1. Load system prompt from:
   - `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/docs/openclaw_trading_pm_system_prompt.md`
2. Load command templates from:
   - `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/docs/openclaw_telegram_commands.md`
3. Confirm Render endpoint health:
   - `https://trading-agent-v1-codex.onrender.com/health`
4. Confirm event API:
   - `https://trading-agent-v1-codex.onrender.com/events/latest`
5. Use Telegram command flow daily.

