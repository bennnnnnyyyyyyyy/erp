# Accounting Plan (phase 1: the general ledger)

**Module key:** `accounting` (table prefix `acc_`)
**Status:** `[📝 Draft / RFC]`, reviewed 2026-11-05; open questions settled without the pilot
accountant at Ben's instruction. Building starts with `sql/045` on branch `accounting-phase1`;
nothing is applied without Ben's yes.
**Owner:** Ben · **Reviewers:** Ben; the pilot accountant for the chart (§3.1) and the posting
rules (§7)
**Decisions it rests on:**
- [ADR-0004 draft](../architecture/decisions/DRAFT_ADR-0004-general-ledger.md);
- roadmap [Q3 and Q5](ROADMAP_ACCOUNTING_SUITE.md#5-decisions-only-ben-can-make).

**Research:**
- [Egyptian unified chart of accounts](../reference/egypt-accounting/UNIFIED_CHART_OF_ACCOUNTS.md);
- [Miracle teardown](../research/miracle-egypt/TEARDOWN.md).

**Depends on modules:** core, inventory, purchasing, sales, finance.

---

## 1. Goal

Every finalised document the company already enters (receipts, supplier bills, deliveries, customer
invoices, expenses, payments, stock adjustments and counts, credit notes, returns) produces a
balanced journal entry automatically, in the same transaction. The accountant gets:
- a chart of accounts built on the Egyptian unified system;
- manual journal entries, approved by a second person;
- opening balances;
- a trial balance that proves everything balances.

Users: the company's accountant and head accountant, and the owner.

## 2. Scope

**In (phase 1):**
- **A.** Chart of accounts, seeded from an Egyptian template, every level editable, Arabic and
  English names.
- **B.** Journal entries: append-only, balanced, leaf accounts only, reversal for corrections.
- **C.** Automatic posting from every existing document type (§7).
- **D.** Account roles: which account each kind of posting uses, per company.
- **E.** Switch-on with verified historical backfill, or a controlled opening-balance cutover for
  incomplete legacy history (ADR-0004 §6).
- **F.** Manual journal entries with approval, and the head-accountant flag.
- **G.** Fiscal years and opening balances for an approved cutover only.
- **H.** Journal list (with a link to the source document), account drill-down and trial balance,
  exported to CSV.

**Out (later phases):**
- treasury (cash boxes, bank accounts, transfers) and cheque lifecycle: phase 2. Until then, cash
  and bank use their roles and cards, cheques and other methods use separate clearing roles;
- account statements per party or item: phase 2;
- VAT and other taxes on lines: phase 3;
- income statement and balance sheet: phase 6;
- year-end closing: phase 7;
- cost centres and branches;
- foreign-currency conversion.

**Won't:** editing or deleting a posted entry, ever.

## 3. Data model

Every table has `id`, `org_id`, `created_at`, RLS, an index leading with `org_id`, `revoke all`
from `anon` and `authenticated`, and `grant select` only to `authenticated` (ADR-0003). Business
configuration records are soft-deleted where appropriate; `acc_entries` and `acc_entry_lines` are
the deliberate exception and have **no** `deleted_at` or other deletion path because they are
append-only ledger evidence. Isolation tests cover every table.

### 3.1 Seeded chart (Egyptian unified structure)

**Coding rule (Ben, 5 Nov).** Official codes come from the official Egyptian source: ETA item codes
(already in `sql/036`); customs tariff (HS) codes from customs.gov.eg, added to items in phase 4.
Internal codes (accounts, SKUs, item groups) are **set by each company**. We only seed defaults,
and every one is editable. The pilot accountant is not available, so phase 1 proceeds without
their input; their chart, when it comes, is a check, not a blocker.

The group and sub-group codes come from the
[research note](../reference/egypt-accounting/UNIFIED_CHART_OF_ACCOUNTS.md). The rest are **our
defaults**, placed in the Egyptian groups. Rows marked ⚠ are defaults the Egyptian source did not
cover. Every row is editable after seeding.

| Code | Arabic | English | Role it fills |
|---|---|---|---|
| 1 | الأصول | Assets | |
| 11 | أصول ثابتة | Fixed assets | |
| 16 | مخزون | Inventory | |
| 161 | مخزون بضائع بغرض البيع | Goods for resale | `inventory` |
| 17 | عملاء وأوراق قبض | Customers and notes receivable | |
| 171 | العملاء | Customers | `receivables` |
| 172 ⚠ | شيكات تحت التحصيل | Cheques under collection | `cheque_in_clearing` |
| 19 | نقدية بالبنوك والصندوق | Cash at banks and on hand | |
| 191 | النقدية بالصندوق | Cash on hand | `cash` |
| 192 | النقدية بالبنوك | Cash at banks | `bank` |
| 193 ⚠ | مدفوعات البطاقات تحت التسوية | Card payments awaiting settlement | `card_clearing` |
| 194 ⚠ | مدفوعات أخرى تحت التسوية | Other payments awaiting settlement | `other_clearing` |
| 2 | حقوق الملكية والالتزامات | Equity and liabilities | |
| 21 | رأس المال المدفوع | Paid-up capital | |
| 211 ⚠ | رأس المال المدفوع | Paid-up capital (posting account) | |
| 23 | الأرباح والخسائر المرحلة | Retained earnings (losses) | |
| 231 | أرصدة افتتاحية | Opening balances | `opening_balance` |
| 28 | موردون وأوراق دفع وحسابات دائنة | Suppliers and payables | |
| 281 | الموردون | Suppliers | `payables` |
| 282 | بضاعة مستلمة لم ترد بشأنها فواتير | Goods received not invoiced | `grni` |
| 283 | مصروفات مستحقة ودائنون متنوعون | Accrued expenses and other payables | `expense_payables` |
| 284 ⚠ | الحسابات الجارية للشركاء | Partners' current accounts | |
| 285 ⚠ | أوراق الدفع | Notes payable | |
| 286 ⚠ | شيكات صادرة لم تصرف | Issued cheques not yet cashed | `cheque_out_clearing` |
| 3 | التكاليف والمصروفات | Costs and expenses | |
| 33 | مصروفات | Expenses | |
| 331 | مصروفات عامة | General expenses | default for expense categories |
| 332 | عجز وفروق جرد المخزون | Stock shortages and count differences | `stock_adjustment` |
| 333 | استخدامات داخلية من المخزون | Internal use of inventory | `internal_use` (fallback only) |
| 334 | فروق أسعار المشتريات | Purchase price differences | `price_variance` |
| 34 ⚠ | تكلفة المبيعات | Cost of sales | |
| 341 ⚠ | تكلفة البضاعة المباعة | Cost of goods sold | `cogs` |
| 4 | الإيرادات | Revenues | |
| 41 ⚠ | إيرادات النشاط | Operating revenue | |
| 411 ⚠ | المبيعات | Sales | `sales_revenue` |
| 412 ⚠ | مردودات ومسموحات المبيعات | Sales returns and allowances | `sales_returns` |
| 42 ⚠ | إيرادات أخرى | Other income | |

Every role has a seeded account, so a new company can switch accounting on without first editing
the chart. Each company recodes or renames any row in the chart screen.

### 3.2 Tables

| Table | Key columns | Rules |
|---|---|---|
| `acc_accounts` | `code` text, `name`, `name_ar`, `parent_id`, `kind` (`asset`, `liability`, `equity`, `expense`, `revenue`), `active`, `deleted_at` | `unique (org_id, code)`. The code starts with the parent's code. The kind is inherited from the top group. An account with lines cannot get children or be deleted, only made inactive. |
| `acc_account_roles` | `role_key`, `account_id` | One row per role per company. The account must be an active leaf. Changing a role is audited and affects future entries only. |
| `fin_categories` (existing) | add `account_id` | The expense account for that category; null means the default role. |
| `acc_fiscal_years` | `name`, `starts_on`, `ends_on`, `status` (`open`, `closed`) | Years don't overlap. Phase 1 only opens years; closing is phase 7. |
| `acc_entries` | `number` (per company, `JE-000001`), `entry_date`, `currency`, `source_type`, `source_id`, `event`, `memo`, `reverses_entry_id`, `is_backfill`, `posted_by`, `approved_by` | **Append-only.** `unique (org_id, source_type, source_id, event)`. Dated after the lock date unless backfill. A source's post and reversal events both link to the source and to each other. |
| `acc_entry_lines` | `entry_id`, `account_id`, `debit_minor`, `credit_minor`, `party_type`, `party_id`, `item_id`, `warehouse_id`, `memo` | **Append-only.** `debit_minor >= 0`, `credit_minor >= 0`, exactly one of them > 0. Leaf accounts only. Balance per entry is checked at commit. |
| `acc_manual_journals` | `number` (`MJ-000001`), `entry_date`, `currency`, `memo`, `status` (`draft`, `posted`, `rejected`), `created_by`, `decided_by`, `entry_id` | `check (decided_by is distinct from created_by)` unless posted directly by the owner or head accountant (then `decided_by` is null and `direct = true`). |
| `acc_manual_journal_lines` | `journal_id`, `account_id`, `debit_minor`, `credit_minor`, `party_type`, `party_id`, `memo` | Editable only while the journal is a draft, through functions. |
| `memberships` (existing) | add `is_head_accountant boolean not null default false` | Only the owner can set it, and only on an owner or admin membership. Audited. |
| `acc_receipt_costs` | `stock_move_id`, `unit_cost_minor`, `rationale`, `set_by` | **Append-only.** The documented cost of a receipt that had none (P2). One row per uncosted receipt move. Set by the owner or head accountant, audited. A zero cost needs a rationale. Switch-on refuses while any receipt move has neither a cost-log row nor a row here. |
| `acc_issue_reasons` | `name`, `name_ar`, `account_id`, `active` | The company's list of internal-use reasons, each pointing to an expense account (O4). |
| `inv_requests` (existing) | add `issue_reason_id` (nullable) | The reason for a request that is not a sale. Without one, P5 uses the `internal_use` fallback. |
| manual receive functions (existing) | new optional `p_unit_cost_minor` | When accounting is on, a manual receipt without a cost is refused (P2); the receive screens show a cost field. When accounting is off, nothing changes. |

Entry party: `party_type` in (`customer`, `supplier`), with `party_id`. Phase 2's account
statements read from these columns, so the posting fills them now.

A draft may be saved without a journal entry only while it has no financial or stock effect. The
action that posts, approves, issues, receives, invoices, records a payment, or otherwise finalises
the source must fail atomically if its entry cannot be created. A draft may not be used to bypass
posting.

**Migrations (each rerun-safe, ending with read-only checks):**
- `sql/045_accounting_core.sql`: accounts, roles, fiscal years, entries, lines, balance and
  append-only triggers, the head-accountant flag, the chart seed function.
- `sql/046_accounting_posting.sql`: posting triggers and the posting functions (§7); issue reasons;
  the cost parameter on manual receipts; the `acc_receipt_costs` table.
- `sql/047_accounting_switch_on.sql`: the function that fills `acc_receipt_costs`, switch-on and
  backfill.

As built (046): supplier invoices today always bill at the order's cost (`sql/018`), so the
price-difference line is zero until a later slice lets a bill carry its own price.

**Build status (6 Nov):**
- 045 to 049 are applied to live (048 and 049 on 6 Nov). No company has accounting on yet.
- Added while building:
  - P17: a cost changed by hand revalues the stock on hand (047);
  - accounts used by expense categories or internal-use reasons are protected (048).
- Built on branch `accounting-phase1`, not yet deployed: the permission keys (§4), the API routes (§5) and the screens (§6), with
  Arabic, and a unit-cost field on the batch receipt and new-item (opening stock) forms. Still to do: an issue-reason picker on
  stock requests (`inv_set_request_reason`; without one, internal issues post to the `internal_use` role's account).
- `sql/048_accounting_manual_journals.sql`: manual journals and opening balances.
- `sql/049_accounting_reports.sql`: trial balance and account drill-down.

## 4. Permissions

| Key | Granted to by default | Allows |
|---|---|---|
| `accounting.ledger.view` | owner, admin | See the chart, entries, trial balance (named `.view`, not `.read`, because every `.read` key is granted to members automatically; see `packages/shared/src/permissions.ts`) |
| `accounting.chart.manage` | owner, head accountant | Add and edit accounts and account roles |
| `accounting.journal.create` | owner, admin | Draft manual entries and opening balances |
| `accounting.journal.approve` | owner, admin | Approve someone else's draft (never one's own) |
| `accounting.journal.post_direct` | owner, head accountant | Post without approval (Ben's Q5) |
| `accounting.module.switch_on` | owner | Switch accounting on (runs the backfill) |

Members and viewers see nothing in accounting, matching the finance tables' RLS today (`sql/024`:
owner and admin only). Phase 1 deliberately has no regular-member accountant access: the intended
head accountant must already be an owner or admin, and the owner must understand that promoting
them to admin also grants the existing non-accounting admin access. The database re-checks every
one of these keys.

## 5. API

All routes are behind `requirePermission(...)` and call one database function with the caller's
JWT (ADR-0003).

**As built (6 Nov).** Set-up routes work before accounting is on (`openBeforeEnabled` in `packages/shared/src/modules.ts`:
`/setup`, `/accounts`, `/roles`, `/fiscal-years`, `/category-accounts`, `/issue-reasons`); the rest answer `module_disabled` until
switch-on. The Apps toggle refuses accounting (`switchOnOnly`): it is switched on only by `/setup/switch-on`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/v1/accounting/setup/preview` | `accounting.ledger.view` | What switch-on would post; missing roles; uncosted receipts |
| POST | `/v1/accounting/setup/prepare` | `accounting.chart.manage` | Adds the default chart (only what is missing) |
| GET | `/v1/accounting/setup/uncosted-receipts` | `accounting.ledger.view` | Receipts with no cost from anywhere |
| PUT | `/v1/accounting/setup/receipt-costs/:moveId` | `accounting.chart.manage` | Owner or head accountant (database) |
| POST | `/v1/accounting/setup/switch-on` | `accounting.module.switch_on` | Owner (database); backfill and enable; returns counts and totals |
| GET/PUT | `/v1/accounting/setup/head-accountants[/:membershipId]` | view / `accounting.module.switch_on` | Owner sets the flag (database) |
| GET/POST | `/v1/accounting/accounts` | view / `accounting.chart.manage` | Flat list with `isLeaf`; add under a parent |
| PATCH | `/v1/accounting/accounts/:id` | `accounting.chart.manage` | Name, Arabic name, active |
| GET | `/v1/accounting/accounts/:id/lines` | `accounting.ledger.view` | `from`, `to`, `currency`; running balance |
| GET / PUT | `/v1/accounting/roles` / `roles/:role` | view / `accounting.chart.manage` | Account roles |
| GET / PUT | `/v1/accounting/category-accounts` / `:id` | view / `accounting.chart.manage` | Expense category to account |
| GET / POST / PUT | `/v1/accounting/issue-reasons` / `:id` | view / `accounting.chart.manage` | Internal-use reasons |
| GET/POST | `/v1/accounting/fiscal-years` | view / `accounting.chart.manage` | |
| GET | `/v1/accounting/entries` and `/entries/:id` | `accounting.ledger.view` | Filters: dates, source type; newest 300 |
| GET | `/v1/accounting/journals` and `/journals/:id` | `accounting.ledger.view` | `?status=draft` lists approvals waiting |
| POST / PUT | `/v1/accounting/journals` / `:id` | `accounting.journal.create` | Draft; `"post": true` also needs `post_direct` (owner or head accountant in the database) |
| POST | `/v1/accounting/journals/:id/approve` and `/reject` | `accounting.journal.approve` | Not one's own |
| POST | `/v1/accounting/journals/:id/cancel` | `accounting.journal.create` | The author's own draft |
| POST | `/v1/accounting/journals/:id/reverse` | `accounting.journal.post_direct` | Manual journals only, once; documents reverse by voiding |
| GET | `/v1/accounting/trial-balance` | `accounting.ledger.view` | `from`, `to`, `currency`; `format=csv` |

Existing routes changed: `POST /v1/inventory/items` passes the opening stock's cost into the receipt; `POST /v1/inventory/batches`
takes an optional `unitCostMinor` (required by the database once accounting is on).

New error codes: `ACCOUNT_ROLE_MISSING` (names the role), `UNBALANCED`, `NOT_LEAF`, `APPEND_ONLY`,
`SELF_APPROVAL`. `PERIOD_LOCKED` is reused.

## 6. Screens

All new text is in Arabic and English. Accounting terms use Egyptian usage (مدين، دائن، قيد يومية،
ميزان المراجعة، دليل الحسابات), for Ben's review.

| Screen | Route | Notes |
|---|---|---|
| Chart of accounts | `/accounting/accounts` | Tree with codes, search by code or name, add a child, edit names, deactivate |
| Accounting setup | `/accounting/setup` | Account roles (pre-filled), expense categories to accounts, head accountant, switch-on button with a preview of the backfill or cutover it will post |
| Journal | `/accounting/entries` | List with filters; each entry opens its lines and its source document |
| Manual entry | `/accounting/journals/new` | Lines with running debit and credit totals; Save as draft, or Post if allowed |
| Approvals | `/accounting/journals` | Drafts waiting for someone else |
| Trial balance | `/accounting/trial-balance` | Period, currency; opening, period debits and credits, closing; each account opens its lines; CSV |

## 7. Posting rules

Each row is one event. **Dr** means debit and **Cr** means credit. "Role" means the account the
company set for that role. All amounts are the document's own rounded amounts (ADR-0004 §4).

| # | Source (table, trigger) | Event | Entry |
|---|---|---|---|
| P1 | Purchase receipt (`inv_cost_log` row with source `purchase_receipt`) | `received` | Dr `inventory` / Cr `grni`; qty × unit cost |
| P2 | Other receipt with no cost (manual receive, opening stock: `inv_stock_moves` kind `receipt` without a cost-log row) | `received_other` | **Refuse finalisation until an explicit, documented unit cost is supplied** (zero only if deliberately chosen with a rationale). Then Dr `inventory` / Cr `opening_balance`. Never invent a cost from the current average; existing uncosted history needs accountant remediation before switch-on. |
| P3 | Supplier invoice (`pur_supplier_invoices`, deferred) | `billed` | Match each billed quantity to received, unbilled cost-log layers; Dr `grni` at those received costs; Dr or Cr `price_variance` for the difference; Cr `payables` (party: supplier) for the invoice total. Refuse an unmatched or over-billed quantity. |
| P4 | Stock issue for a sales order (`inv_stock_moves` kind `issue`, request linked from `sal_orders.request_id`) | `issued_sale` | Dr `cogs` / Cr `inventory`; qty × the move's unit cost |
| P5 | Stock issue not for a sale | `issued_internal` | Dr the expense account selected for the mandatory internal-use reason / Cr `inventory`; use `internal_use` only as the phase-1 default where the accountant accepts that classification. |
| P6 | Adjustment or count (`kind` `adjust`) | `adjusted` | Loss: Dr `stock_adjustment` / Cr `inventory`. Gain: the reverse |
| P7 | Transfer (`transfer_out`, `transfer_in`) | none | Same company, one inventory account; no entry in phase 1 |
| P8 | Customer invoice (`sal_invoices`, deferred) | `invoiced` | Dr `receivables` (party: customer) / Cr `sales_revenue`; sum of the rounded lines |
| P9 | Credit note approved (`sal_notes`) | `credited` | Dr `sales_returns` / Cr `receivables` (party: customer) |
| P10 | Debit note approved (`sal_notes`) | `debited` | Dr `receivables` / Cr `sales_revenue` |
| P11 | Return into stock (`kind` `return_in`) | `returned_in` | Dr `inventory` / Cr `cogs`, at the move's unit cost |
| P12 | Expense recorded (`fin_expenses`) | `expensed` | Dr the category's account / Cr `payables` (party: supplier) if a supplier is given, else `expense_payables` |
| P13 | Payment in (`fin_payments`, direction `in`) | `paid_in` | Dr `cash`, `bank`, `card_clearing`, `cheque_in_clearing` or `other_clearing` (by method) / Cr `receivables` (party: customer). `other` requires a memo. |
| P14 | Payment out for a supplier invoice | `paid_out` | Dr `payables` (party: supplier) / Cr the payment-method role: `cash`, `bank`, `card_clearing`, `cheque_out_clearing` or `other_clearing` |
| P15 | Payment out for an expense | `paid_out` | Dr `payables` or `expense_payables` (as P12 credited) / Cr the payment-method role as P14 |
| P16 | A postable source is voided, cancelled after posting, returned, or otherwise corrected | `reversed` | Its posting function creates a linked, balanced reversing event dated on the correction date. A source must expose this event or reject correction; no postable stock, purchase, sales, note, expense, or payment path may bypass it. |

Payment methods: `cash` → `cash`; `bank` → `bank`; `card` → card clearing; `cheque` → cheques
under collection when received, issued cheques not yet cashed when paid; `other` → other-payment
clearing and a mandatory memo. Treating card, cheque or
unknown payments as cash in the bank would falsely say the money has cleared. Phase 2 adds real
cash boxes, bank accounts, settlement and cheque lifecycles; it reclassifies these clearing
balances rather than changing the phase-1 history.

### Worked example (EGP)

1. Receive 10 cartons at 120.00 each: P1, Dr Inventory 1,200.00 / Cr GRNI 1,200.00.
2. The supplier bills 10 at 125.00: P3, Dr GRNI 1,200.00, Dr Purchase price differences 50.00 /
   Cr Suppliers 1,250.00.
3. Sell 4 (average cost 120.00), and the delivery is approved: P4, Dr COGS 480.00 / Cr Inventory
   480.00.
4. Invoice the 4 at 199.99: P8, line 4 × 199.99 = 799.96, Dr Customers 799.96 / Cr Sales 799.96.
5. The customer pays in cash: P13, Dr Cash on hand 799.96 / Cr Customers 799.96.

The trial balance then shows:
- debits: Inventory 720.00, Purchase price differences 50.00, COGS 480.00, Cash 799.96;
- credits: GRNI 0, Suppliers 1,250.00, Sales 799.96.

Both sides total 2,049.96.

## 8. Org settings this module adds

- account roles and expense category accounts;
- fiscal years;
- the head-accountant flag per member.

The chart template is seed data, not code, so other templates can be added later.

## 9. Tests

SQL tests (`sql/tests/040` onward), each rolled back:
- **isolation:** another company cannot read or change any `acc_` row;
- **append-only:** update or delete of entries and lines fails, including for the owner;
- **balance:** an unbalanced entry fails at commit; a non-leaf account is refused;
- **posting:** each of P1–P16 produces the expected lines on a small company; voids reverse; the
  same event cannot post twice;
- **failure:** a missing role makes the document's own transaction fail, and the document does not
  exist afterwards;
- **lock date:** an entry on or before it is refused; backfill is allowed;
- **approvals:** an author cannot approve their own journal; the owner and the head accountant post
  directly; a plain admin cannot;
- **backfill:** on a copy of the demo data the trial balance balances, and the receivables per
  customer equal the open amounts the finance screens already show;
- **uncosted receipts:** with accounting on, a manual receipt without a cost is refused; switch-on is
  refused while an uncosted historical receipt has no `acc_receipt_costs` row; a zero cost without a
  rationale is refused;
- **supplier invoices:** billing more than was received, or a line with no received layer, is
  refused;
- **payment methods:** card, cheque and other post to their clearing accounts, cheques by direction;
  `other` without a memo is refused;
- **internal use:** an issue with a reason posts to that reason's account; without one, to the
  fallback.

API tests: the permission checks, the error codes, and CSV export.

## 10. Rollout (slices, each its own dry run, apply and worklog entry)

1. **045:** core tables and seed. Dry run on live, rolled back; Ben's yes; apply. No company is
   affected until switch-on.
2. **046 + 047:** posting and switch-on. Dry run on live including a switch-on of the demo
   company, timed, then rolled back.
3. API and screens; deploy. Includes the "uncosted receipts" screen, where the owner or head
   accountant enters a documented cost for each old receipt that has none.
4. Ben costs the demo company's uncosted receipts, switches accounting on, and checks the trial
   balance in the browser.
5. **048 + 049:** manual journals, opening balances, reports.
6. When the pilot accountant is available: they check the default codes and the posting rules
   against what they do in Miracle. This is a check, not a blocker.

## 11. Open questions (for Ben, or the pilot accountant)

### Settled without the pilot accountant (Ben, 5 Nov: "work without his input")

- **O1 ⚠ codes:** our defaults in §3.1, placed in the Egyptian groups, editable per company.
- **O2 GRNI:** kept, because P3's receipt matching and over-billing check need it. A company that
  prefers to credit the supplier on receipt can point the `grni` role at its supplier account.

When the accountant is available, show them §3.1 and §7 as a check.

### Decisions recorded by this review (O3–O6)

- **O3 Receipts with no cost:** require an explicit documented cost before finalisation; do not
  derive it from a current average. Historical exceptions block switch-on until remediated.
- **O4 Internal use:** follow the mandatory reason to an expense account; retain one
  `internal_use` default only for a deliberate phase-1 fallback.
- **O5 Year-end:** it follows manual-journal approval: a second person approves it, except that an
  owner or head accountant may post directly.
- **O6 Who switches on:** owner only. The head accountant may prepare and review the preview, but
  cannot run the irreversible backfill.
