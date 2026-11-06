# Superfix plan: workflow gaps from the ERPNext and Dolibarr teardowns

**Status:** Approved by Ben 2026-11-03 (all defaults D1–D7). S1–S4 and S5a written 2026-11-03, **not yet run on any database**; S5b and S6 open. See §8.
**Owner:** Ben · **Author:** Claude (Opus 5.5)
**Sources:** `research/erpnext/TEARDOWN.md` §11 and `research/dolibarr/TEARDOWN.md` §11 and §12 (written on another machine from local source copies, see the worklog; never committed and not in this repository, so not linked), [`2026-11-03-system-audit.md`](2026-11-03-system-audit.md)
**Scope:** backend workflows only (SQL functions, API routes, shared permission keys, SQL tests). Screens are a later plan. Where a slice needs a screen to be usable, a minimal one is listed under that slice.

## 1. Goal

Close the six workflow gaps that both competitors cover and our customers will hit in their first month. Do it without weakening what we already do better: approval enforced in the database (approver ≠ requester), an append-only ledger, the audit row in the same transaction, and per-organization isolation with tests.

## 2. Rules every slice follows (from agents.md)

- One numbered, rerun-safe migration per slice (`sql/040_…` onwards), ending with read-only verification queries.
- Every new table: `org_id`, RLS, `revoke all` from `anon` and `authenticated`, then `grant select` only. Writes go only through `security definer` functions that call the slice's guard. Each table has an isolation test (org B cannot read or change org A's rows).
- Every state change writes `audit_log` in the same transaction. Every stock change is a new `inv_stock_moves` row; nothing is updated in place.
- Approvals reuse the existing pattern: `decided_by <> requester_id` as a table constraint, decided in a function, and the same function for app, WhatsApp and voice (`p_channel`).
- Money is `bigint` minor units plus currency. Settings are org settings, never hard-coded.
- API: `requirePermission('module.action')` on every route, user-scoped client only.
- Applying to the live project (ggoerp): dry-run inside a transaction that is rolled back, then apply, then run the slice's SQL test on live. **Each apply needs Ben's explicit go-ahead.**

## 3. Decisions taken (defaults; Ben can overturn)

| # | Question | Default chosen | Why |
|---|---|---|---|
| D1 | Allow back-dated stock postings? | **No.** Stock is always posted now. Documents keep their own business date (invoice date etc.) | ERPNext's back-dating needs reposting that rewrites the ledger; it contradicts our append-only design |
| D2 | Per-org choice of when stock moves (on invoice vs on delivery)? | **No.** One approved flow | Dolibarr's options make behaviour differ per customer; support cost |
| D3 | Who can post into a locked period? | **Nobody.** An owner can move the lock date back; that is audited | Simpler and stricter than an exempt role |
| D4 | Count session: what if stock moves during the count? | Difference = counted − **snapshot**, applied to current stock | Movements during the count are kept (Dolibarr does the same) |
| D5 | Returned goods: at what cost? | The **unit cost of the original issue** move | ERPNext does this; average cost is not distorted |
| D6 | Due date when a customer has no terms | Org default terms (setting, default 0 days = due on invoice date) | Not hard-coded |
| D7 | Units: can stock be held in a non-base unit? | **No.** Stock and ledger stay in the base unit; other units only on order lines, converted on entry | One truth for quantities |

## 4. Slices, in build order

### S1. Lock date (stock and finance)

**Problem.** Nothing stops someone entering an invoice, expense or payment dated in a month that has been closed and reported.
**Build.**
- `organizations.settings` gains `lock_date` (date or null). Owner only: `core_set_lock_date(p_date)`, audited with old and new value.
- One helper `core__assert_open(p_org, p_date)` raises `period_locked` when `p_date <= lock_date`.
- Called in: `sal_create_invoice` (invoice date), `pur_record_supplier_invoice`, `fin_record_expense`, `fin_record_payment`, and in the void functions (`sal_void_invoice`, `fin_void_payment`, `fin_void_expense`) against the original document's date. Credit and debit notes take today's date, so they are checked against today.
- Stock moves are posted at `now()` (D1), so they cannot fall into a locked period. Nothing to add there.
**Tests (`sql/tests/035_lock_date.sql`):** each function refuses on or before the lock date and accepts after it; only the owner can set it; the audit row exists; org isolation of the setting.
**API:** `PUT /v1/core/settings/lock-date` (`core.settings.manage`); the error code is mapped to a message.

### S2. Payment terms and due dates

**Problem.** "Overdue" is a single N-days-after-invoice rule (`sql/028`), the same for every customer; there are no due dates and no ageing.
**Build.**
- `sal_customers.payment_terms_days int` (null = org default), `pur_suppliers.payment_terms_days int`, and org setting `default_payment_terms_days` (default 0).
- `sal_invoices.due_date date not null` and `pur_supplier_invoices.due_date date not null`. Backfill existing rows as `invoice_date + terms`. Set on creation from the terms, or from an explicit `p_due_date` that must be ≥ the invoice date.
- Alert `receivable_overdue` changes to "unpaid N days after the **due date**". Existing rules keep working: with no terms the due date equals the invoice date, so behaviour is unchanged.
- `GET /v1/finance/open-items` adds `due_date`, `days_overdue` and an ageing bucket (not due, 1–30, 31–60, 61–90, 90+).
**Tests (`036_due_dates.sql`):** due date derived from customer, supplier or org default; an explicit due date before the invoice date is refused; the overdue alert fires on the due date; backfill is correct; isolation.

### S3. Stock count session

**Problem.** Adjustments are one item at a time. A real count covers a whole warehouse or shelf, needs a frozen "expected" figure, and posts many differences at once.
**Build.**
- `inv_counts`: number `CNT-0001`, warehouse, status `counting → submitted → applied | rejected | cancelled`, requester, decider, comment. Same constraints as `inv_adjustments`: decider ≠ requester; applied ⇒ decided.
- `inv_count_lines`: item, batch (null for non-batch items), **expected qty snapshot**, counted qty (null until entered), unit cost at apply.
- Functions:
  - `inv_start_count(warehouse, item_ids?)` snapshots on-hand per item, or per batch for batch-tracked items.
  - `inv_set_count_line(count, item, batch, counted)` works only while counting.
  - `inv_submit_count` refuses if any line is uncounted.
  - `inv_decide_count(count, decision, comment, channel)` checks decider ≠ requester. On approve, it posts one `adjust` move per non-zero line with delta = counted − snapshot (D4), batch-aware. It refuses if a move would make stock or a batch negative, and runs in one transaction with one audit row per move plus one for the decision.
  - `inv_cancel_count`.
- The stock-move check constraint gains `count_id` as an allowed reference for `adjust`.
- The approval policies (`inv_approval_policies`) apply on the total absolute difference, like adjustments.
**Tests (`037_stock_count.sql`):** snapshot taken at start; self-approval refused; uncounted lines block submit; moves equal counted − snapshot even after a receipt during the count; negative stock refused; batch lines; audit coverage; isolation of both tables.
**API:** `/v1/inventory/counts` (list, start, lines, submit, decide, cancel); permissions `inventory.count.create` and `inventory.count.approve`. Decisions also go through the messaging layer (WhatsApp/in-app) through the same function.
**Minimal screen:** count list and a count sheet (item, expected hidden by default, counted input). In the screens plan.

### S4. Customer returns into stock

**Problem.** A credit note (`sql/037`) corrects money but goods that come back never re-enter stock.
**Build.**
- `sal_note_lines` gains `return_qty numeric` (≥ 0, ≤ the line's qty) and `return_warehouse_id`.
- On approval of a **credit** note (`sal_decide_note`), for each line with `return_qty > 0`, post a new `return_in` move:
  - the item from the invoice line;
  - the warehouse chosen;
  - the unit cost from the original issue move for that order (D5);
  - the original batch when it can be traced, otherwise a batch chosen on the line, required for batch-tracked items.
- **Limit:** the returned qty per item cannot exceed what was issued for that sales order minus what was already returned (checked at submit and again at approval).
- Stock-move `kind` gains `return_in`, with a `note_id` reference.
- Average cost: a return at the original cost goes through the same averaging as a receipt.
**Tests (`038_returns.sql`):** stock rises only on approval; over-return refused; cost equals the original issue cost; batch handling; debit notes never move stock; audit; isolation.
**Supplier returns** (goods back to the supplier, an outgoing movement that needs approval): next slice, the same shape on `pur_*`; not in this plan.

### S5. Units with conversion

**Problem.** `inv_items.uom` is free text. Businesses buy in cartons and sell in pieces.
**Build.**
- `inv_item_units`: item, unit code, `factor numeric > 0` (base units per this unit), purpose flags (purchase / sale), unique per item and unit. The base unit is the existing `inv_items.uom` with factor 1, implicit.
- `pur_order_lines`, `sal_order_lines` and `inv_request_lines` gain `unit` and `factor` (snapshotted on the line) plus `qty_in_unit`. The existing `qty` stays the **base-unit** quantity used everywhere downstream (D7), so receiving, issuing, invoicing and the ledger are unchanged.
- Prices on lines are entered per chosen unit and stored per base unit (minor units, rounded half-up, with the rounding visible on the line).
- Functions that create lines accept `unit` (optional; default base) and convert. A unit not defined for the item is refused.
**Tests (`039_units.sql`):** conversion on PO, SO and request lines; an unknown unit is refused; downstream stock moves are in base units; price conversion and rounding; isolation.
**Note:** the biggest slice by surface (three line tables, their API payloads and screens). It can be split into S5a (table and conversion functions) and S5b (line payloads).

### S6. Audit chain anchored outside the database

**Problem.** The hash chain detects edits, but someone with database owner rights could delete the newest rows, or rewrite and re-hash the whole chain, and `audit_verify` would still pass.
**Build.**
- `audit_check_all` also returns, per org, the latest sequence number and hash.
- The scheduled Worker writes these to storage **outside Supabase**. On each run it compares: if a stored (seq, hash) pair is no longer in the table, or the newest seq went down, it raises an `audit_chain_rewound` alert to the owners, through the existing alert path.
- **ADR-0007** records the choice of storage.
**Needs Ben:** the storage choice. Recommended: a Cloudflare KV namespace bound to the Worker (creating it is a deploy-side action). Later option: a keyed hash (HMAC) with the key held only by the Worker.
**Tests:** a Worker unit test with a fake store: rewound, tail-deleted and rewritten chains all alert; a normal growth does not.

### Later (not in this plan)

- Amount- and discount-based approval for purchase and sales orders, reusing the approval engine.
- Projected stock and replenishment into draft POs; credit limits and customer on hold; price lists; supplier returns; warehouse tree and locations.

## 5. Order and dependencies

S1 → S2 (both touch invoice creation) → S3 → S4 (both add move kinds; S4 also touches the notes in `sql/037`) → S5 → S6 (independent, needs the ADR).
Each slice is: migration, SQL test, API routes, shared permission keys and types, API unit tests, worklog entry. `npm run typecheck` and `npm test` pass before handoff.

## 6. Risks

- **S2 backfill on live data:** a dry-run first, with row counts reported before the apply.
- **S3/S4 add stock-move kinds:** every report that filters on `kind` (forecast, insights, alert rules) must be checked. Forecast counts only `issue`, so returns and counts don't distort demand. That is correct but must be stated.
- **S5 changes line payloads:** keep `unit` optional so the current web app keeps working before its screens are updated.
- **Each slice changes shared posting functions:** run all existing SQL tests (`sql/tests/*`) after each migration, not only the new one.

## 7. Approval

- [x] Ben approves the plan and the defaults D1–D7 (2026-11-03).
- [ ] Ben chooses the S6 storage (or defers S6).
- [x] An entry in [`checklist.md`](checklist.md) is added.

## 8. Build status and deviations from the plan (2026-11-03)

| Slice | Files | State |
|---|---|---|
| S1 lock date | `sql/040`, `sql/tests/035`, `PUT /v1/core/org/lock-date` | Written; not run |
| S2 terms and due dates | `sql/041`, `sql/tests/036`, `PUT /v1/core/org/payment-terms`, `PUT /v1/sales/customers/:id/terms`, `PUT /v1/purchasing/suppliers/:id/terms`, `dueDate` on invoice reads, `dueDate`/`daysOverdue`/`ageBucket` on `GET /v1/finance/open-items` | Written; not run |
| S3 stock counts | `sql/042`, `sql/tests/037`, `/v1/inventory/counts` (list, one, start, `PUT …/lines`, submit, approve, reject, cancel) | Written; not run |
| S4 customer returns | `sql/043`, `sql/tests/038`, `POST /v1/sales/invoices/:id/returns` | Written; not run |
| S5a units | `sql/044`, `sql/tests/039`, `/v1/inventory/items/:id/units` (GET, PUT, DELETE `…/:unit`), `GET …/to-base` | Written; not run |
| S5b units on lines | — | **Not started** (see below) |
| S6 audit anchor | — | Waiting for the storage decision |

**Deviations, each for a stated reason:**
1. **S1:** the check is a `BEFORE` trigger on the four dated tables instead of edits to seven functions. The effect is the same, and it covers future writers too.
2. **S2:** due dates come from the terms only, through a trigger. There is no `p_due_date` argument, so the invoice functions keep their signatures. A per-invoice due date can be added later.
3. **S3:** counts are per item and warehouse, not per batch. The existing batch trigger takes negative moves first-expiry-first-out, so a count cannot yet remove stock from a named batch. A count also has a single approver (like adjustments), not the N-approver policies.
4. **S3:** single adjustments still refuse a stale count ("count again"), while counts follow D4 (counted − snapshot applied to current stock). These are two different behaviours, chosen on purpose; Ben can align them.
5. **S3:** counts reuse the `inventory.adjustments.*` permission keys. No new keys, so no role changes are needed.
6. **S3:** approving a count by WhatsApp or voice token is not wired yet. In-app approval works, and managers are notified through the outbox.
7. **S4:** returns go into one batch per line, the one that supplied most of the original issue. Forecast and the "profit this month" figure count only `issue` moves, so returns lower neither demand nor cost of goods sold. State this in the reports plan.
8. **S5 split:** S5a (units, factors, conversion) is built; S5b (unit and factor stored on order and request lines) is not. Converting a price per carton into a price per piece loses money to rounding (1,000 per box of 12 becomes 83 per piece, so 996 on the order) unless each line keeps its own unit. That changes three line tables and their screens, so it needs its own review.
