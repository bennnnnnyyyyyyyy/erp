# SQL migrations

Numbered, rerun-safe, and each ends with read-only verification queries. Run them in order in the
Supabase SQL editor (or via the CLI against a staging project first). **Nothing here has been run
against any Supabase project yet.** Log every run in
[`documentation/operations/WORKLOG.md`](../documentation/operations/WORKLOG.md).

| File | Purpose | Status |
|---|---|---|
| `001_tenancy_core.sql` | organizations, memberships, org_modules, append-only audit_log, RLS | Carried over, not run |
| `002_core_user_lookup.sql` | user lookup helper for invites | Carried over, not run |
| `003_audit_chain_and_core_rpc.sql` | audit hash chain, `audit_verify`, `audit_append_admin`, `current_org_id`, `core_set_module`, `core_update_org` (ADR-0003) | Written, not run, untested |

Run order: 001, 002, 003. Run on a staging project first and record each run in the worklog.

Planned next (see `documentation/plans/` once approved): SQL tests in `sql/tests/` (state machine,
self-approval refusal, cross-organization isolation, audit chain), then module files named
`NNN_<key>_*.sql` with tables prefixed by module.
