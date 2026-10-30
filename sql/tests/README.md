# SQL tests

Scripts you paste into the Supabase SQL Editor (run as the default `postgres` role) to prove database rules on a real
database. They create their own throwaway users and organizations and **always roll back**: they finish by raising an
error on purpose, so nothing is left behind and your real data is never changed.

How to read the result:

- `ERROR: ... ALL TESTS PASSED (everything rolled back)` means **pass**.
- `ERROR: ... FAIL T<n>: <what went wrong>` means that check failed. Paste the full text to Claude.
- Any other error (for example about `auth.users`) means the script itself could not set up; paste it too.

Run the whole file at once with nothing else in the editor.

| File | Proves |
|---|---|
| `001_core_isolation_and_audit.sql` | Organization isolation (RLS), the `X-Org-Id` header check, role checks, no direct writes, admin-only functions, append-only and chained audit log, TRUNCATE refused |
| `002_inventory_approval.sql` | Inventory slice: approval blocks stock (even for direct inserts), no self-approval, reservation, ledger append-only, audit per step, isolation, module switch |
| `003_tasks_and_outbox.sql` | Slice 2: outbox in the same transaction, idempotency, retry with backoff, expiry, reminders and escalation once, task rules, who sees what, no direct writes, a channel cannot change stock, isolation |
| `004_identity_binding.sql` | S2: codes hashed and unreadable, 10 minutes, 5 tries, secret text wiped, isolation |
| `005_decision_tokens.sql` | S3: single-use hashed tokens, expiry, wrong sender refused, refusals audited, no direct stock change |
| `006_task_replies.sql` | S4: reply acknowledges/completes only the sender's own task, refusals audited |
| `007_approval_policies.sql` | I5: N approvals, no double approval by one person, policy changes audited |
| `008_stock_adjustments.sql` | I3: adjustments need approval, stale count refused, ledger append-only |
| `009_reorder_levels.sql` | I6: low-stock messages once, reorder level rules |
| `010_audit_check.sql` | O3: chain check runs, hourly skip, alert on a broken chain |
| `011_outbox_retention.sql` | O9: dry run default, only old finished rows, audit kept, minimum 7 days, closed to users |
| `012_org_people.sql` | X7: names of own organization's active members only |
| `016_sales_retry.sql` | Sales: retry after rejection, no second live request, delivered order not cancellable |
| `017_enable_all_modules.sql` | all apps on, audited, repeat no-op, closed to users |
| `018_customer_invoices.sql` | delivered-only, no over-invoicing, price from order line, void, isolation, audit |
| `019_item_cost.sql` | average cost, issue cost snapshot, cost hidden from members, owner/admin only |
| `020_finance_expenses_payments.sql` | expenses, payments, no overpayment, void rules, owner/admin only, isolation |
| `022_batches_expiry_storage.sql` | FEFO, quarantine, expiry, storage mismatch, batch total equals ledger, roles, isolation |
| `023_owner_insights.sql` | known-answer test for the owner numbers (revenue, cost, expenses, net, owed), roles, isolation |

Not covered here: the real-login path through PostgREST. That is checked by [`scripts/real-login-check.mjs`](../../scripts/real-login-check.mjs) (needs a real user; see its header).

Status: all files 001-012 pass via CLI (re-run 2026-10-30 after the last migration). Also `scripts/concurrency-check.mjs` (parallel actions through real logins, 12 checks, passed 2026-10-30). Run with `supabase db query --linked -f sql/tests/<file>`. Re-run after every change to `sql/`. Record each run in `documentation/operations/WORKLOG.md`.
