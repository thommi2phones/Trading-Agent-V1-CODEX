# Coordination Bus

Cross-agent coordination directory for the Trading Agent V1 CODEX project.

## Structure

```
coordination/
├── README.md           # This file
└── tasks/
    ├── pending/        # Tasks awaiting review or handoff
    ├── in_progress/    # Currently being worked on
    └── completed/      # Done tasks (archived)
```

## Protocol

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

## Branches

- `main` — Codex content: Pine Script indicator, webhook server, docs, coordination
- `dashboard` — Trading Agent dashboard: Next.js UI, Python CLI agent, Alpaca integration
