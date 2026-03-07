# Trade Memory + Vector Store Ops

## Purpose
Maintain one continuously updated master memory file of chart analyses and outcomes, and keep the OpenAI vector store in sync for `file_search`.

## Canonical Files
- Memory file: `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/data/trade_memory/master_trade_memory.jsonl`
- Schema: `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/data/trade_memory/trade_memory.schema.json`
- Sync state: `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/data/trade_memory/vector_sync_state.json`

## Append Workflow
Append one record after each analysis/trade outcome:

```bash
node scripts/append_trade_memory.js --json '{"record_id":"rec_20260307_0002","created_at":"2026-03-07T22:00:00Z","setup_id":"setup_abc_002","symbol":"TSLA","timeframe":"4H","pattern":"bear_flag","regime":"trend","image_ref":"s3://charts/tsla_20260307_2200.png","agent_bias":"BEARISH","trade_grade":"B","recommendations":["Wait for retest rejection","Avoid entry in middle of range"],"entry":201.4,"stop":205.2,"tp1":196.5,"tp2":192.0,"tp3":188.7,"actual_outcome":"pending","rr_realized":null,"post_trade_notes":"Awaiting close.","lessons":["Respect invalidation distance before sizing"]}'
```

## Vector Store Sync
Manual run:

```bash
OPENAI_API_KEY=sk-... \
OPENAI_VECTOR_STORE_ID=vs_... \
node scripts/sync_vector_store.js
```

Behavior:
1. Hashes `master_trade_memory.jsonl`.
2. Skips if unchanged since last sync.
3. Uploads file to OpenAI Files.
4. Attaches it to the vector store via file batch.
5. Waits for indexing completion.
6. Removes stale vector-store file entries (keeps latest attached file).

## GitHub Automation
Workflow:
- `/Users/thom/Documents/Personal/Codex Projects/Trading Agent Codex/.github/workflows/sync-trade-memory-vector-store.yml`

Schedule:
- Every 15 minutes, plus manual `workflow_dispatch`.

Required repo secrets:
- `OPENAI_API_KEY`
- `OPENAI_VECTOR_STORE_ID`

## Agent Prompt Requirement
In Agent Builder instructions, include:
- "Before final grading, use `file_search` to retrieve up to 3 historical matches from trade memory."
