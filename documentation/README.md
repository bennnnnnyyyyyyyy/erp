# {{PRODUCT_NAME}} Documentation

The canonical documentation index for {{PRODUCT_NAME}}.

## 1. Folder authorities

Several people and AI agents (Claude, Codex, Antigravity, Cursor) work on this codebase. To
prevent context drift and conflicting implementations, **every contributor follows this
division**:

| Directory | Purpose | Lifecycle & authority |
|---|---|---|
| [`architecture/`](architecture/) | The system as it is built today, plus decision records (ADRs) | **Authoritative (live state)** |
| [`plans/`](plans/) | Approved roadmaps and module specifications | **Authoritative (target state)** |
| [`research/`](research/) | Teardowns of existing online systems we are studying to rebuild their features | **Evidence**: what the other system does, not what we will do |
| [`planning/`](planning/) | Working checklists, scratch investigation, drafts | **Ephemeral (WIP)**: safe to iterate; may be superseded |
| [`operations/`](operations/) | Dated worklog, migration runs, deployment handoffs | **Authoritative (historical evidence)** |
| [`reference/`](reference/) | Background material, external specs, legacy designs | **Reference only**: do not assume active |
| [`reviews/`](reviews/) | Audits, security reviews, test sweeps | **Guardrails**: lessons learned |

How work flows through them:

```text
research/<system>/   →   plans/<MODULE>_PLAN.md   →   code + sql/   →   operations/WORKLOG.md   →   architecture/
 (what exists)          (what we'll build, approved)   (built)          (what was done, dated)      (how it works now)
```

## 2. Where to start

1. **System map**: [Architecture](architecture/ARCHITECTURE.md): API, web, database and tenancy boundaries.
2. **Decisions**: [ADRs](architecture/decisions/): why the stack and the tenancy model are what they are.
3. **Roadmap**: the product brief (`PRODUCT_BRIEF.md` at the repo root), plans in [`plans/`](plans/) and the live [checklist](plans/checklist.md).
4. **Studying a system**: [Research guide](research/README.md) and its [teardown template](research/_TEMPLATE/TEARDOWN.md).
5. **Adding a module**: [Module plan template](plans/MODULE_PLAN_TEMPLATE.md).
6. **What has happened**: [Worklog](operations/WORKLOG.md).

## 3. Rules for every agent

1. **Documentation lives only in `documentation/`.** Not in `apps/`, not in the repo root (the
   root keeps only `README.md`, `agents.md`, `CLAUDE.md` and `PLANS.md`).
2. **Consult `operations/WORKLOG.md` before assuming state.** A plan says what is intended. If
   it isn't in the worklog, it hasn't been run or deployed.
3. **Log live changes.** Any schema change, migration run, deployment or data operation gets a
   dated worklog entry.
4. **Status markers** used across plans and the checklist:
   `[✅ Live]` `[🟡 In Progress]` `[📋 Approved / Ready]` `[📝 Draft / RFC]` `[💡 Backlog]` `[⛔ Superseded]`.
5. **Respect repository boundaries**: API `apps/api/`, web `apps/web/`, shared `packages/shared/`,
   migrations `sql/`, scripts `scripts/`.
