# Architecture Decision Records

One file per decision that is expensive to reverse: `ADR-NNNN-short-title.md`. An ADR is never
edited after it is accepted. To change course, write a new ADR that supersedes it and mark the
old one `Superseded by ADR-NNNN`.

| ADR | Title | Status |
|---|---|---|
| [0001](ADR-0001-stack.md) | Stack: TypeScript monorepo, Hono on Cloudflare Workers, React + Vite, Supabase | Proposed |
| [0002](ADR-0002-multi-tenancy.md) | Multi-tenancy: shared database, `org_id` on every row | Proposed |

## Template

```markdown
# ADR-NNNN: <title>

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Deciders:** <names>

## Context
## Decision
## Consequences
## Alternatives considered
```
