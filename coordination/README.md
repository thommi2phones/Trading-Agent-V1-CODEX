# Coordination

This directory hosts two distinct cross-agent channels:

- **`tasks/`** — low-rate, human-readable handoff log between collaborating Claude/Codex sessions on this repo.
- **`bus/`** — runtime perception bus carrying high-rate request/response envelopes between the reasoning LLM and perception agents (this repo's `ta_charts` role plus future `macro_research`, `orderflow`, `cross_asset`, `calendar`, `sentiment`, `fundamentals`).

## Structure

```
coordination/
├── README.md
├── tasks/
│   ├── pending/
│   ├── in_progress/
│   └── completed/
└── bus/
    ├── inbox/        # incoming requests waiting to be claimed
    ├── outbox/       # outgoing envelopes (results or queries)
    ├── processing/   # claimed envelopes currently being handled
    ├── completed/    # successfully handled requests
    ├── failed/       # errored requests (sibling .err.txt holds the reason)
    └── archive/      # rotation target for old completed/failed envelopes
```

`bus/*/*` is gitignored at runtime; `.gitkeep` files preserve the structure.

## tasks/ protocol

1. **Creating tasks**: Write a JSON file to `tasks/pending/` with a descriptive filename
2. **Claiming tasks**: Move from `pending/` to `in_progress/`
3. **Completing tasks**: Move from `in_progress/` to `completed/`

## Task JSON Schema

```json
{
  "task_id": "CE-YYYY-MM-DD-NNN",
  "created_by": "claude-exec | codex-pm",
  "created_at": "ISO-8601",
  "type": "status_update | feature_request | bug_fix | handoff",
  "title": "Short description",
  "summary": "Detailed description",
  "branch": "branch name if applicable",
  "changes": ["list of changes made"],
  "next_steps": ["suggested follow-ups"],
  "status": "pending_review | in_progress | completed | blocked"
}
```

## bus/ protocol

The perception bus is documented in detail at `docs/perception_bus_v1.md`. Reserved `agent_role` values live in `docs/perception_agent_registry_v1.md`. Runtime helpers are in `lib/agent_bus.js`.

In short:

- A publisher writes the envelope to `bus/inbox/` (for incoming requests) or `bus/outbox/` (for outgoing) and optionally HTTP-POSTs to a peer URL declared in `BUS_PEERS`.
- A watcher with `--role <agent_role>` filters `bus/inbox/`, moves the picked-up file to `bus/processing/`, runs its handler, and finally moves the file to `bus/completed/` or `bus/failed/`.
- Result envelopes are written to `bus/outbox/` and HTTP-POSTed to `BUS_PEERS[from_agent.agent_role]` if mapped.

## Branches

- `main` — Codex content: Pine Script indicator, webhook server, docs, coordination
- `dashboard` — Trading Agent dashboard: Next.js UI, Python CLI agent, Alpaca integration
