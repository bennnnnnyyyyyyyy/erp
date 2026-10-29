# SQL migrations

Numbered, rerun-safe, and each ends with read-only verification queries. Run them in order in the
Supabase SQL editor (or via the CLI against a staging project first). Status of each file is in the table below.
Log every run in
[`documentation/operations/WORKLOG.md`](../documentation/operations/WORKLOG.md).

| File | Purpose | Status |
|---|---|---|
| `001_tenancy_core.sql` | organizations, memberships, org_modules, append-only audit_log, RLS | Carried over; run by Ben (reported) |
| `002_core_user_lookup.sql` | user lookup helper for invites | Carried over; run by Ben (reported) |
| `003_audit_chain_and_core_rpc.sql` | audit hash chain, `audit_verify`, `audit_append_admin`, `current_org_id`, `core_set_module`, `core_update_org` (ADR-0003) | Run by Ben; verified on a database 2026-10-29 (see worklog), except the browser path and cross-organization refusal |
| `004_revoke_extra_privileges.sql` | revoke TRUNCATE/REFERENCES/TRIGGER from `authenticated`, refuse TRUNCATE on audit_log | Run by Ben; verified 2026-10-29 (no non-SELECT privileges; three audit_log triggers) |
| `005_advisor_fixes.sql` | pin search_path on three trigger functions; wrap auth.uid() in the memberships policy (Supabase advisors) | Run via CLI 2026-10-29; verified (search_path set, test passes) |
| `006_inventory_core.sql` | inventory slice 1: warehouses, items, ledger, balances, requests, approvals; seven functions; approval enforced in the data | Run via CLI 2026-10-29; verified; tests pass |

Run order: 001 to 006. Apply with `supabase db query --linked -f sql/NNN_name.sql` (project linked via `supabase link`). Run on a staging project first and record each run in the worklog.

Tests: [`tests/`](tests/) holds scripts that prove the rules on a real database (run 2026-10-29: all passed).

Planned next (see `documentation/plans/` once approved): more SQL tests in `sql/tests/` (state machine,
self-approval refusal, cross-organization isolation, audit chain), then module files named
`NNN_<key>_*.sql` with tables prefixed by module.
