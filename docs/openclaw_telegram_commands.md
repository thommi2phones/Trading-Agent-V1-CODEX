# OpenClaw Telegram Commands (Trading Agent PM)

## `/milestone`
Purpose: define or update a project milestone.

Required fields:
- `Title`
- `Bucket`
- `Definition of Done`
- `Due`

Template:
```text
/milestone
Title: Pine v2 pattern module
Bucket: Strategy Design
Definition of Done: Flag/pennant/HnS/DT/CnH detection stable on BTC 4H sample set
Due: 2026-03-01
```

## `/task`
Purpose: create an actionable task under a milestone.

Required fields:
- `Task`
- `Bucket`
- `Owner`
- `Priority` (P1/P2/P3)

Template:
```text
/task
Task: Tune false-positive double-top filter
Bucket: Strategy Design
Owner: Thom
Priority: P1
```

## `/backtest`
Purpose: log a structured backtest result.

Required fields:
- `Asset`
- `Timeframe`
- `Setup`
- `Result_R`
- `Notes`

Template:
```text
/backtest
Asset: BTC
Timeframe: 4H
Setup: Bear pennant breakdown + MACD expand
Result_R: +1.8
Notes: Good follow-through after compression break
```

## `/risk`
Purpose: validate risk model before execution.

Required fields:
- `Asset`
- `Entry`
- `Stop`
- `RiskPct`
- `Invalidation`

Template:
```text
/risk
Asset: BTC
Entry: 67120
Stop: 67840
RiskPct: 0.75
Invalidation: Close back inside broken pennant with positive MACD flip
```

## `/journal`
Purpose: capture discretionary context and discipline.

Required fields:
- `State`
- `Decision`
- `Reason`

Template:
```text
/journal
State: Calm
Decision: Skip setup
Reason: Confluence low and no momentum expansion
```

## `/review`
Purpose: force a structured checkpoint.

Template:
```text
/review
Window: weekly
Focus: Strategy Design, Risk Modeling
```

Expected output:
- Win rate
- R distribution
- Drift flags
- Discipline notes
- 3 priority actions

## `/blocker`
Purpose: escalate blockers with ownership.

Required fields:
- `Blocker`
- `Impact`
- `Owner`
- `Needed By`

Template:
```text
/blocker
Blocker: TradingView alert mismatch on wrong condition type
Impact: Invalid payloads block agent ingestion quality
Owner: Thom
Needed By: 2026-02-25
```

