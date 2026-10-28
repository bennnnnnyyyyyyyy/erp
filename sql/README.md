# SQL migrations

Numbered, rerun-safe, and each ends with read-only verification queries. Run them in order in the
Supabase SQL editor (or via the CLI against a staging project first). **Nothing here has been run
against any Supabase project yet.** Log every run in
[`documentation/operations/WORKLOG.md`](../documentation/operations/WORKLOG.md).

| File | Purpose | Status |
|---|---|---|
| `001_tenancy_core.sql` | organizations, memberships, org_modules, append-only audit_log, RLS | Carried over, not run |
| `002_core_user_lookup.sql` | user lookup helper for invites | Carried over, not run |

Planned next (see `documentation/plans/` once approved): JWT claims hook, audit v2 (same-transaction
triggers, hash chain), then module files named `NNN_<key>_*.sql` with tables prefixed by module.
