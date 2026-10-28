# ADR-0003: Business mutations go through database functions called with the user's own JWT

**Status:** Proposed
**Date:** 2026-10-28
**Deciders:** {{DECIDERS}}

## Context

The foundation carried over from the previous internal ERP has the API Worker use one Supabase
secret-key client, which bypasses row level security. Tenant scoping therefore depends on every
query remembering `org_id`, and the audit row is written in a second call after the change.

This product's core promises are that an approval really blocks the stock movement and that every
change has an audit record. With the carried-over pattern a stock change could exist without its audit
row, and an approval check lives only in application code.

## Decision

- **Request routes use a user-scoped client** (publishable key plus the caller's JWT), so RLS and
  `auth.uid()` applies. The active organization is sent as the `X-Org-Id` header and accepted only after the
  database confirms the caller is an active member (`current_org_id()`); it is a request, never proof of access,
  and is never read from the request body.
- **Business tables allow `select` through RLS and no direct `insert/update/delete`** for application
  roles. Writes happen only through `security definer` Postgres functions with a pinned `search_path`.
- **Audit rows for stock and approvals are written inside those functions and by triggers**, in the same
  transaction as the change. Events that are not user-scoped database changes (Auth-admin paths such as invites) use `audit_append_admin`,
  which only the service role can call so signed-in users cannot forge audit rows. Nothing inserts into `audit_log` directly.
- **The secret-key (admin) client** is limited to provisioning, webhook ingestion and scheduled jobs, in
  clearly named files. A test fails the build if a request route imports it.
- The Worker still checks `requirePermission(...)` for fast failure and clear errors, but passing it
  grants nothing: the database function re-checks.

## Consequences

- Approval and audit guarantees hold even if the API or a channel adapter has a bug or is bypassed.
- More logic lives in SQL: it needs SQL-level tests (state machine, self-approval refusal, isolation) and
  reviewed, rerun-safe migrations.
- `apps/api/src/lib/db.ts` and `audit.ts` are replaced (`db.user.ts`, `db.admin.ts`, `rpc.ts`, a reduced
  `audit.ts`). No custom login-token hook is needed: membership is checked in the database on every call.- Slightly more round-trip structure for simple CRUD; accepted, because stock and approvals are the product.

## Alternatives considered

- **Keep the secret-key client and check everything in the Worker**: simplest, but the guarantees would
  rest on every route being correct. Rejected for stock and approvals.
- **Secret-key client plus RLS-style checks in each query helper**: still two calls for audit, and no
  protection if a route forgets the helper.
- **Database triggers only, no functions**: cannot express multi-step approval and reservation rules
  cleanly, and gives poor error reasons to callers.
