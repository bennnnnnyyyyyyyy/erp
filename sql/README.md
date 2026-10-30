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
| `007_tasks_and_outbox.sql` | slice 2: tasks, transactional outbox, in-app notifications, retry/expiry, reminders and escalation; delivery outcomes audited | Run via CLI 2026-10-29; verified; tests 001-003 pass |
| `008_identity_binding.sql` | S2: phone/address binding with hashed one-time codes; secret message text hidden and wiped after sending | Run via CLI 2026-10-30; test 004 passes |
| `009_decision_tokens.sql` | S3: single-use hashed decision tokens; `msg_decide_by_token` (approve/reject by reply, audited) | Run via CLI 2026-10-30; test 005 passes |
| `010_task_replies.sql` | S4: reply to a task message to acknowledge or complete it (refusals audited, never raised) | Run via CLI 2026-10-30; test 006 passes |
| `011_approval_policies.sql` | I5: N approvals above a quantity, one per approver | Run via CLI 2026-10-30; test 007 passes |
| `012_stock_adjustments.sql` | I3: counted-vs-system adjustments, approval required, stale count refused | Run via CLI 2026-10-30; test 008 passes |
| `013_reorder_levels.sql` | I6: reorder levels and low-stock messages in the chasing pass | Run via CLI 2026-10-30; test 009 passes |
| `014_audit_check.sql` | O3: hash-chain verification job, hourly, alerts owners | Run via CLI 2026-10-30; test 010 passes |
| `015_outbox_retention.sql` | O9: `msg_cleanup`, dry run by default, NOT scheduled (needs owner approval) | Run via CLI 2026-10-30; test 011 passes |
| `016_org_people.sql` | X7: `core_org_people()` names for any member | Run via CLI 2026-10-30; test 012 passes |
| `017_purchasing_core.sql` | Purchasing slice 1: suppliers, purchase orders and inventory receipts | Run via CLI 2026-10-30; test 013 passes |
| `018_supplier_invoices.sql` | Supplier bills against received purchase orders; cumulative billed quantity capped at received quantity | Run via CLI 2026-10-30; test 014 passes |
| `020_sales_retry.sql` | sales: retry after a rejected/cancelled request, no cancel after delivery | Run via CLI 2026-10-30; test 016 passes |
| `021_enable_all_modules.sql` | `core_enable_all_modules(org)`, service role only | Run via CLI 2026-10-30; test 017 passes |
| `022_customer_invoices.sql` | sales: customer invoices, partial invoicing, void | Run via CLI 2026-10-30; test 018 passes |
| `023_item_cost.sql` | slice F: average cost per item, cost log, cost hidden from members | Run via CLI 2026-10-30; test 019 passes |
| `024_finance_expenses_payments.sql` | slice F: finance module, expenses, payments (never above what is owed) | Run via CLI 2026-10-30; test 020 passes |
| `025_security_audit_fixes.sql` | security audit 2026-10-30: member functions with audit (no secret key), invitations that must be accepted, decision channel vouched by the webhook, WhatsApp across organizations, per-org delivery pass | **Not run yet**; run on staging, then test 021 |

Run order: 001 to 025. Apply with `supabase db query --linked -f sql/NNN_name.sql` (project linked via `supabase link`). Run on a staging project first and record each run in the worklog.

Tests: [`tests/`](tests/) holds scripts that prove the rules on a real database (run 2026-10-29: all passed).

Planned next (see `documentation/plans/` once approved): more SQL tests in `sql/tests/` (state machine,
self-approval refusal, cross-organization isolation, audit chain), then module files named
`NNN_<key>_*.sql` with tables prefixed by module.
