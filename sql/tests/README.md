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
| `013_purchasing_receiving.sql` | suppliers and purchase orders, receiving adds stock through the ledger, roles, isolation |
| `014_supplier_invoices.sql` | supplier bills against received orders, billed quantity capped at received, duplicate invoice number refused, isolation |
| `015_sales_orders.sql` | sales orders raise stock requests through the approval, cancel rules, isolation |
| `016_sales_retry.sql` | Sales: retry after rejection, no second live request, delivered order not cancellable |
| `017_enable_all_modules.sql` | all apps on, audited, repeat no-op, closed to users |
| `018_customer_invoices.sql` | delivered-only, no over-invoicing, price from order line, void, isolation, audit |
| `019_item_cost.sql` | average cost, issue cost snapshot, cost hidden from members, owner/admin only |
| `020_finance_expenses_payments.sql` | expenses, payments, no overpayment, void rules, owner/admin only, isolation |
| `022_batches_expiry_storage.sql` | FEFO, quarantine, expiry, storage mismatch (including a warehouse with no condition set, which needs 035), batch total equals ledger, roles, isolation |
| `023_owner_insights.sql` | known-answer test for the owner numbers (revenue, cost, expenses, net, owed), roles, isolation |
| `024_alert_rules.sql` | rules fire only for the right people (team, role, person), no repeat inside the interval, repeat after it, new items fire on their own, isolation |
| `025_stock_forecast.sql` | known-answer forecast (usage per day, days of cover, run-out date), thin-history label, isolation |
| `026_forecast_alert_rule.sql` | the forecast alert rule fires and repeats as configured |
| `027_org_language.sql` | company language set only by owner or admin, validated, audited |
| `028_signup.sql` | sign-up creates a company for a confirmed email, caller becomes owner, at most 3 owned companies, validated inputs |
| `029_inventory_transfers.sql` | transfers: approval blocks the ledger (direct inserts refused), no self-approval, roles, in-transit, reserve and release, batches and expiry carried across, quarantined batch never moved, storage conditions (cold to ambient, **cold to a warehouse with no condition (needs 034)**, cold to cold, plain item to a conditioned warehouse), another organization sees nothing, append-only records, two-approval policy, audit chain |
| `030_einvoicing_tax_data.sql` | module switch, roles, ETA mode (default simulated, production refused), ETA code pairs, EGS code format, default-rate uniqueness, soft delete and in-use guard, customer and item fields, column grants, audit, no direct writes, other organization (needs 036) |
| `031_credit_debit_notes.sql` | who requests and decides, credit cap per line and cumulative, debit notes, self-approval blocked in function and data, reject and cancel free the quantity, void blocked with active notes, immutability, other organization (needs 037) |
| `032_user_language.sql` | save, change and clear a person's language, validation, each person sees only their own row, no direct writes, no anonymous use, no save without sign-in (needs 038) |
| `033_org_tour.sql` | the tour switch is off by default, owner/admin only, audited, a no-op writes no audit row, leaves the tutorial flag alone, never affects another company, no anonymous use (needs 039) |
| `021_security_audit_fixes.sql` | existing accounts must accept an invitation, invitations isolated, member role rules and audit in the database, sign-in link refused across organizations, no user-claimed 'whatsapp' channel, per-org delivery closed to users |
| `034_isolation_gaps.sql` | System audit finding 2: the 7 business tables no test named yet (warehouses, counters, request lines, suppliers, storage conditions, team members, rule recipients): org B sees none of org A's rows and cannot write to them directly |
| `035_lock_date.sql` | S1: owner only, no future date, audit, dated rows on or before the lock refused (create and void), removal reopens, isolation (needs 040) |
| `036_due_dates.sql` | S2: due date from customer terms, company default or 0; who may set terms; due before invoice refused; overdue alert counts from the due date; isolation (needs 041) |
| `037_stock_counts.sql` | S3: snapshot, uncounted lines block submit, starter/submitter cannot approve, counted − snapshot applied after a receipt during the count, ledger guard, reserved stock protected, rejection, cancel, isolation (needs 042) |
| `038_customer_returns.sql` | S4: no stock move before approval, requester cannot approve, return at the original issue cost, average cost recomputed and logged, limit = delivered − returned or waiting, rejection, append-only, isolation (needs 043) |
| `039_item_units.sql` | S5a: owner/admin only, base unit refused, case-insensitive conversion, unknown unit refused, removal keeps history, audit, isolation (needs 044) |
| `040_accounting_core.sql` | Accounting slice 1: chart seed and edits by owner or head accountant only, head-accountant flag owner-only, account code and role rules, balanced at commit, idempotent posting, leaf and active accounts only, missing role named, append-only even for the database owner, lock date (backfill allowed), reversal, accounting module on only via switch-on and never off, fiscal years, isolation, no anonymous use (needs 045) |
| `041_accounting_posting.sql` | Accounting slice 2, through the real document functions: receipts need a cost with accounting on; purchase receipt, sale issue (COGS), internal issue by reason, count difference, customer and supplier invoices, payments by method ("other" needs a note), voids reverse, credit note; the books balance and customers, GRNI and inventory tie out; a company without accounting posts nothing (needs 046) |
| `042_accounting_switch_on.sql` | Accounting slice 3: switch-on of a company with history: preview; owner only; refused while a receipt is uncosted or a role is missing; entering a receipt cost; backfill of every document kind, marked backfill, allowed before the lock date; the books balance and customers, GRNI, card clearing and inventory tie out; cannot run twice or be switched off; new documents post normally; a cost changed by hand revalues the stock on hand (P17) (needs 047) |

Not covered here: the real-login path through PostgREST. That is checked by [`scripts/real-login-check.mjs`](../../scripts/real-login-check.mjs) (needs a real user; see its header).

Status: all files 001-012 pass via CLI (re-run 2026-10-30 after the last migration). Also `scripts/concurrency-check.mjs` (parallel actions through real logins, 12 checks, passed 2026-10-30). Run with `supabase db query --linked -f sql/tests/<file>`. Re-run after every change to `sql/`. Record each run in `documentation/operations/WORKLOG.md`.
