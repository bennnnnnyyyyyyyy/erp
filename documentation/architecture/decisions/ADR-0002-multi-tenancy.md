# ADR-0002: Multi-tenancy model

**Status:** Proposed (carried from the previous internal ERP; re-confirm on first commit)
**Date:** 2026-10-28
**Deciders:** {{DECIDERS}}

## Context

Every customer is a separate company that must be fully isolated from the others from the first
customer on. Retrofitting tenancy into an ERP after the fact is one of the most expensive rewrites there is.

## Decision

- **One shared database; every business row carries `org_id`.** An `organizations` row is a
  tenant (a customer company).
- A user can belong to several organizations through `memberships` (role per org). The client
  sends the active org in `X-Org-Id`; the API checks the membership on every request.
- **The API enforces isolation** (service-role client, every query filtered by
  `c.var.tenant.orgId`). **RLS is enabled on every table** as a second line of defence, using
  `is_org_member(org_id)`.
- **Modules are switched on per org** in `org_modules`. This is the hook for pricing tiers.
- Per-org configuration (currency, time zone, numbering, branding, tax rules) lives in
  `organizations.settings` or module settings tables, never in code.

## Consequences

- Cheap to run many small customers; one migration upgrades everyone.
- A missing `org_id` filter in the API is a data leak. Mitigations: RLS as backstop, code review
  rule in `agents.md`, and (planned) a test helper that runs every route as two orgs and checks
  neither sees the other's data.
- A very large or regulated customer who needs a separate database can be served later with a
  dedicated Supabase project running the same migrations.

## Alternatives considered

- **Schema per tenant**: stronger isolation, but migrations multiply per customer and Supabase
  tooling assumes `public`.
- **Database per tenant**: strongest isolation, highest cost and operational load; keep it as
  the enterprise option only.
