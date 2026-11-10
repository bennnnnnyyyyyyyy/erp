# Manufacturing Plan

**Module key:** `manufacturing` (table prefix `mfg_`)
**Status:** `[📝 Draft / RFC]`: written 10 November 2026 at Ben's request ("plan for this immediately"); waiting for Ben's answers in §11.
**Owner:** Ben · **Reviewers:** Ben, an accountant for §7.3
**Research:** [Dynamics 365 SCM teardown](../research/dynamics-365-scm/TEARDOWN.md) (gap 6, MRP basics). Behaviour only; no
competitor code read or copied.
**Depends on modules:** core, inventory (items, warehouses, stock ledger, batches and expiry from `sql/026`), approvals; accounting
optional (postings only when it is on).

---

## 1. Goal

Let a small factory (the demo company is a cosmetics factory) say what goes into each product (a recipe, or "bill of materials"),
plan a production run, take the materials out of stock with an approval, record what came out (with batch number and expiry), and know
what each finished unit really cost. The same approval, audit and stock-ledger rules as the rest of the product apply.

Who uses it: the owner or production manager (recipes, plans, approvals), the store keeper (issues materials), the production
supervisor (records output, from a phone on the floor), the accountant (cost and postings).

## 2. Scope

**In (version 1):**
- **F1 Recipes (bills of materials).** A finished item, the quantity one recipe makes (e.g. 100 jars), its components (item, quantity,
  expected scrap %), an optional conversion cost per unit (labour and overhead, see §7.2). Versions: one active recipe per item; a
  recipe used by an order is never changed, a new version is made instead.
- **F2 Production orders.** Item, quantity, recipe version, material warehouse, output warehouse, planned date. Statuses: draft →
  submitted → approved → in progress → done; cancelled from draft, submitted or approved. Numbered `MO-0001` per company.
- **F3 Approval before materials leave stock.** Releasing an order needs approval by someone other than the requester, enforced in the
  database, like stock requests (the one-owner exception D1 applies, flagged `self_decided`).
- **F4 Issue materials.** The store keeper issues the components (full or partial, batch by batch, first expiry first for batch-tracked
  items); unused material can be returned. Each is a stock-ledger move linked to the order.
- **F5 Record output.** Good quantity and scrap, batch number and expiry date for the finished goods; part outputs allowed; "finish"
  closes the order.
- **F6 Cost.** Each finished unit's cost = materials actually issued (at average cost) + conversion cost, over the good quantity.
  Planned vs actual shown per component (more or less material used than the recipe says).
- **F7 Accounting (when on).** Work in progress, finished goods and variance postings, in the same transaction as the stock moves (§7.3).
- **F8 What to make and what to buy.** Material needs for open orders (needed − on hand − on order), shown on the order and fed into the
  stock forecast's suggested purchase orders.
- **F9 Phone.** "Record output" and "Issue materials" as big buttons on the phone, like the inventory phone bar.

**Out (later), and why:**
- Routings, work centres, machine capacity and scheduling: small factories plan by hand first; needs a pilot to say what they need.
- Automatic explosion of multi-level recipes: v1 lets a component be a manufactured item (e.g. cream base, then filled jars), with a
  "make this first" link to create its own order; automatic chains later.
- Quality checks and lab release (quarantine already exists from `sql/026` and can hold a batch until it is released by hand).
- Co-products and by-products; subcontracting; labour time sheets; standard costing.

**Won't:** copy any competitor's code (Odoo, ERPNext are GPL/LGPL/AGPL; behaviour only).

## 3. Data model

Every table has `id`, `org_id uuid not null references organizations(id)`, `created_at`, `updated_at`, `deleted_at`, RLS (read for
members of the company with the module on), an index leading with `org_id`, `revoke all` from `anon` and `authenticated` then `grant
select` only; writes only through database functions, each writing `audit_log` in the same transaction.

| Table | Main columns | Rules |
|---|---|---|
| `mfg_boms` | `item_id`, `version int`, `output_qty numeric`, `conversion_cost_minor bigint` (per output unit, default 0), `currency`, `active bool`, `note` | One active per item; locked once an order uses it (new version instead) |
| `mfg_bom_lines` | `bom_id`, `item_id`, `qty numeric` (for `output_qty`), `scrap_pct numeric` (0–50) | Component ≠ finished item; no loops (A needs B needs A) |
| `mfg_orders` | `number`, `item_id`, `bom_id`, `qty`, `material_warehouse_id`, `output_warehouse_id`, `planned_date`, `status`, `requester_id`, `decided_by`, `decided_at`, `self_decided`, `good_qty`, `scrap_qty`, `cost_minor` | Status rule as F2; decider ≠ requester unless `self_decided` (table rule, as `sql/063`) |
| `mfg_order_lines` | `order_id`, `item_id`, `planned_qty`, `issued_qty`, `returned_qty` | Copied from the recipe when submitted (later recipe changes do not touch it) |
| `mfg_outputs` | `order_id`, `qty_good`, `qty_scrap`, `batch_code`, `expiry_date`, `unit_cost_minor`, `posted_by` | Append-only |

Stock ledger: new move kinds `production_issue`, `production_return`, `production_receipt` on `inv_stock_moves`, with `source_type =
'mfg_order'` and `source_id`. Direct inserts stay revoked; only the manufacturing posting functions write them.

**Migration files:** `sql/069_mfg_boms_orders.sql` (F1–F3), `sql/070_mfg_issue_output.sql` (F4–F6), `sql/071_mfg_accounting.sql` (F7),
each with its own SQL test, rerun-safe, ending in read-only checks. (Numbers are the next free ones today; they shift if other
migrations land first.)

## 4. Permissions

| Key | Default | Allows |
|---|---|---|
| `manufacturing.recipes.view` | all members | See recipes |
| `manufacturing.recipes.manage` | owner, admin | Create and change recipes |
| `manufacturing.orders.view` | all members | See production orders |
| `manufacturing.orders.create` | owner, admin, member | Draft and submit orders |
| `manufacturing.orders.approve` | owner, admin | Approve or reject (never one's own, except D1) |
| `manufacturing.orders.issue` | owner, admin, member | Issue and return materials |
| `manufacturing.orders.output` | owner, admin, member | Record output, finish |

The route check rejects early; the database function checks again.

## 5. API (`/v1/manufacturing/...`)

| Method | Path | Permission | Does |
|---|---|---|---|
| GET/POST | `/recipes` | view / manage | List; create a recipe (new version if one is active) |
| GET/PUT | `/recipes/:id` | view / manage | One recipe; change it (only while unused) |
| GET/POST | `/orders` | view / create | List (filters: status, item, date); create a draft |
| GET | `/orders/:id` | view | Order, lines, moves, outputs, cost, material needs |
| POST | `/orders/:id/submit` · `/approve` · `/reject` · `/cancel` | create / approve | Status steps |
| POST | `/orders/:id/issue` · `/return` | issue | `[{itemId, qty, batchId?}]` |
| POST | `/orders/:id/output` · `/finish` | output | Good qty, scrap, batch, expiry |
| GET | `/needs` | view | Materials needed for open orders vs on hand and on order |

Every function audits: `manufacturing.recipe.saved`, `manufacturing.order.submitted/approved/rejected/self_approved/cancelled`,
`manufacturing.materials.issued/returned`, `manufacturing.output.recorded`, `manufacturing.order.finished`.

## 6. Screens

| Screen | Route | Notes |
|---|---|---|
| Recipes | `/manufacturing/recipes` | List, search; a recipe page with its components and the cost of one unit at today's average costs |
| Production orders | `/manufacturing/orders` | List by status; "Needs you" for approvers |
| One order | `/manufacturing/orders/:id` | Plan vs issued vs used per material, output history, cost, the approval, the audit trail |
| What to make | `/manufacturing/needs` | Materials short for open orders; "Create purchase order" |
| Phone bar | in Inventory and the order | Issue materials, Record output |

Arabic and English from the first screen; logical CSS only.

## 7. Business rules and calculations

### 7.1 Quantities
Planned material = recipe qty × (order qty ÷ recipe output qty) × (1 + scrap %), rounded up to the item's unit precision. Issuing more
than planned is allowed with a reason (shown as a variance); output cannot exceed what the issued materials allow by more than the
company's tolerance (setting, default 0%).

### 7.2 Cost (worked example, in EGP)
Recipe "Face cream 50 ml", makes 100 jars, conversion cost 2.00 per jar:

| Material issued | Qty | Average cost | Cost |
|---|---|---|---|
| Cream base | 5 kg | 200.00 / kg | 1,000.00 |
| Jars | 100 | 3.00 | 300.00 |
| Labels | 100 | 0.50 | 50.00 |
| **Materials** | | | **1,350.00** |
| Conversion (100 planned × 2.00) | | | 200.00 |
| **Total** | | | **1,550.00** |

Output: 98 good jars, 2 scrapped. Unit cost = 1,550.00 ÷ 98 = 15.8163 → **15.82** (all amounts in piastres; the 0.36 rounding difference
goes to the variance account, so the books equal the money spent exactly). The 98 jars enter stock at 15.82 and the item's average
cost updates as for any receipt.

### 7.3 Accounting (when accounting is on; accounts to be confirmed by the accountant)
| Event | Debit | Credit |
|---|---|---|
| Materials issued (1,350.00) | Work in progress | Inventory (raw materials) |
| Conversion cost applied (200.00) | Work in progress | Production overhead applied |
| Output received (98 × 15.82 = 1,550.36) | Inventory (finished goods) | Work in progress |
| Order finished: what is left in work in progress (−0.36) | Work in progress | Production variance |
| Materials returned | Inventory | Work in progress |

Work in progress, Production overhead applied and Production variance accounts are created on first use under the right parents of
the Egyptian unified chart (as Bank charges is in `sql/068`), names in English and Arabic.

### 7.4 Rules that keep it safe
- Materials leave stock only through the issue function, only on an approved order (F3), only up to what is on hand (no negative stock).
- Batch-tracked materials are issued first expiry first unless a batch is chosen; expired or quarantined batches are refused.
- Output of a batch-tracked finished item needs a batch code and, if the item has a shelf life, an expiry date (default: today + shelf
  life).
- A finished order is locked; corrections are new moves with a reason, never edits.
- Lock dates (`core__assert_open`) apply to every move and posting.

## 8. Company settings this module adds
- Module on or off (`org_modules`).
- Who may approve production orders (default owner and admin), and an amount above which approval is needed (default: always).
- Output tolerance over plan (default 0%).
- Order number prefix (default `MO-`).
- Batch code pattern for finished goods (default `<item code>-<yymmdd>-<n>`).

## 9. Tests
- SQL tests per migration: recipe rules (no loops, versions locked), approval (requester cannot approve; D1 sole owner flagged), issue
  limits (no negative stock, first expiry first, no expired batch), output and cost (the worked example above to the piastre), postings
  balance (debits = credits; work in progress returns to zero on finish), lock dates, audit rows, and **a second company cannot read or
  change any of it**.
- The full business-day test (`061`) gains a production run: buy materials, make, sell the finished goods, check the books.
- API auth tests for every route; shared unit tests for the quantity and cost calculations; screen wiring checks.

## 10. Rollout
In slices, each its own pull request; each migration dry-run on live (rolled back) and applied by Ben **before** its pull request is
merged:
1. Recipes (F1) and orders with approval (F2, F3).
2. Issue and output with batches and cost (F4–F6), phone bar (F9).
3. Accounting postings (F7), after the accountant confirms §7.3.
4. What to make and buy (F8).
5. Turn the module on for the demo cosmetics factory; click-through in English and Arabic, on a phone; then a pilot factory.

**Expected time** (from how fast similar work went this week, e.g. both bank import parts in one day): slices 1–4 about 4–5 working
days after approval, plus a day for the click-through and fixes. If approved on 11 November: ready for a pilot factory around 18–19
November.

## 11. Open questions for Ben (recommendation first)
1. **Approve the plan as written?** (Recommended.)
2. **Conversion cost in v1:** a fixed amount per unit on the recipe (recommended: simple and enough for small factories), or materials
   only for now?
3. **Approval:** every production order (recommended, matches the product's rule), or only above an amount?
4. **Accounts (§7.3):** the accountant confirms the three accounts and where they sit in the chart.
5. **Pilot:** is there a factory customer in view? Their recipes would be the first real test.
