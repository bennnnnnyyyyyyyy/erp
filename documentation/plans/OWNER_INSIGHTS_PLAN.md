# Owner Insights, Triggers, Forecast and Expiry Plan

**Module keys:** `insights` (new), plus additions to `inventory`, `messaging`, `purchasing`, `sales`; new `finance` (basic accounting)
**Status:** 📝 Draft, needs Ben's approval before any code
**Owner:** Ben Arthur · **Source:** notes from the boss (2026-10-30) and Ben's brief
**Depends on:** core, inventory, purchasing, sales, messaging, tasks

---

## 1. Goal

The person who signs off on the ERP is the **company owner**, not the warehouse team. Picture a non-technical owner in his fifties, who runs a factory, is short on time and does not want to learn software. He opens the app and in ten seconds knows:

1. **Am I making or losing money** (this month, this year)?
2. **What needs my decision today** (a few cards, not a menu of 30 apps)?
3. **What will go wrong soon**: stock running out, stock expiring, one supplier the factory depends on, customers who owe money.

Everything else in the ERP exists to feed these answers. This plan makes that the **heart of the app**: the home page.

## 2. Boss's requirements, mapped

| Boss note | Where it lands |
|---|---|
| Owners must know if they are making or losing, basic accounting formula | §4 Finance + §5 Home "Profit" card |
| Trigger: if my factory is built on a certain supplier, or an item is at a certain quantity, notify purchasing / the team | §6 Triggers |
| Setting for who gets which notification | §6 Notification settings |
| Forecast per selling trend: when will it be out of stock, from the org's own history | §7 Forecast |
| Insights / sales / revenue | §5 Home + Sales cards |
| Expiration triggers | §8 Batches and expiry |
| Way to store: temperature / warehouse options | §8 Storage conditions |
| Fill the program with fake data: items, suppliers, based on a cosmetics factory in Egypt | §10 Demo data |

## 3. What exists today and what is missing

Exists: inventory ledger, reserve / approve / issue, adjustments, reorder level (a number per item), purchasing and receiving, supplier invoices (billed vs received), sales orders and delivery, customer invoices (with void), messaging outbox with retry and escalation, tasks, audit log, per-org module switches.

Missing, and these gaps decide the order of work:

- **No cost per item.** Without cost there is no cost of goods sold, so no profit. Purchasing has a cost per order line but it never reaches the stock.
- **No payments.** Invoices exist, but nothing records money received or paid, so "cash" and "who owes me" cannot be shown.
- **No expenses.** Rent, salaries, utilities. Profit is wrong without them.
- **No batches or expiry dates, no storage conditions.**
- **No consumption history view** and no forecast.
- **No rules engine.** Today only one hard-wired low-stock message exists.
- **No manufacturing** (raw materials in, finished goods out). A cosmetics factory needs it. See open question Q1.

## 4. Finance: the basic accounting formula (slice F)

Keep it simple and honest. Money stays integer minor units plus ISO currency (EGP default, from organization settings).

```
Revenue            = sum of issued (not void) customer invoices in the period
- Cost of goods    = quantity sold x cost per unit (weighted average cost, see below)
= Gross profit
- Expenses         = recorded expenses in the period (rent, salaries, utilities, transport...)
= Net profit  (positive = making, negative = losing)

Also shown:  Money owed to me   = issued customer invoices - payments received
             Money I owe        = supplier invoices - payments made
             Stock value        = on-hand quantity x average cost
             Cash movement      = payments received - payments made - expenses paid
```

Important limits, stated on screen so the owner is not misled: this is a **management view, not statutory accounts**. No tax/VAT, no depreciation, no accruals. Egypt e-invoicing (ETA) is a separate open decision (ADR-0005).

New data (all with `org_id`, RLS select-only, changes through audited DB functions):

- `inv_items.avg_cost_minor` (weighted average cost, updated on every receipt), ledger rows keep the unit cost at the time of the move.
- `fin_expenses` (date, category, amount, supplier optional, note), categories are org settings.
- `fin_payments` (direction in/out, amount, date, method, links to a customer invoice or a supplier invoice or an expense). Payments are never edited, only voided.

## 5. Owner home page (slice H)

Replaces the current apps-grid as the landing page; the apps grid stays one click away ("All apps").

Design rules (these are requirements, not suggestions):

- **Big numbers, plain words, five to seven cards, no tables on the first screen.** No jargon ("reservation", "ledger") on the home page.
- **One traffic-light per card** (green fine, amber watch, red act), always with words as well as colour.
- **Every card is a button** that opens the exact list behind it.
- **Arabic first** option with right-to-left, large type, one-tap light/dark.
- **A "Needs your decision" list** at the top: approvals waiting, expiring batches, purchase proposals. Approve or reject in place.
- Numbers always say **what period** and **since when**; never a number without its date.

Cards (first version):

1. **Making or losing**: net profit this month vs last month, one line why ("sales up 8%, expenses up 21%").
2. **Money coming in / going out**: owed to me, I owe, overdue.
3. **Sales**: revenue this month, top 5 products, orders waiting to be delivered.
4. **Stock health**: stock value, items low, items out of stock soon (forecast), items expiring in 30 / 60 / 90 days.
5. **Supplier risk**: suppliers that more than X% of purchases or of key items depend on; late deliveries.
6. **Needs your decision**: approvals, adjustments, purchase proposals.
7. **Alerts sent**: what the system told whom today (trust and audit).

Computation lives in database functions (`insights_*`), read-only, org-scoped, permission `insights.read`, returned by one API call `GET /v1/insights/home`. Heavy numbers are computed on demand from the ledger and invoices first; add summary tables only if it gets slow (measure, do not guess).

## 6. Triggers and notification settings (slice T)

A **rule** says: *when this happens, tell these people, this way.* Built on the existing outbox (retry, expiry, escalation, audit already exist). Messages are notifications only; a channel never changes stock or approves (unchanged rule).

Rule kinds (v1):

| Kind | Fires when | Example |
|---|---|---|
| `stock_below` | an item's available quantity falls to/below a number (default: its reorder level) | glycerin below 200 kg, tell Purchasing |
| `forecast_stockout` | forecast says cover is under N days | shea butter will run out in 12 days |
| `expiry_within` | a batch expires within N days | lotion batch L-2411 expires in 45 days |
| `supplier_dependency` | an item that depends on one supplier is low, or that supplier has a late/overdue order | "single-source" flagged items |
| `receivable_overdue` | customer invoice unpaid after N days | |
| `profit_negative` | month-to-date net profit below zero | tell the owner |

Rule data: kind, scope (all items / one item / category / supplier / warehouse), threshold, **recipients** (a person, a role, or a named team), channel(s), quiet hours, repeat interval (do not spam: at most once per N hours per subject, re-fires only if it gets worse), enabled.

**Notification settings screen**: per organization, a table of rules, who receives each, and a "send me a test" button. People also set their own channels (in-app now; WhatsApp/voice later when the star feature lands; **not started here**, stays on the plan).

Teams: a small `core_teams` / members list (Purchasing, Warehouse, Management), so a rule can say "Purchasing" instead of naming people.

Evaluation: the existing five-minute job evaluates rules; each firing writes an outbox row with an idempotency key (`rule + subject + day/bucket`) and an audit entry.

## 7. Forecast (slice P)

From the organization's **own movement history**, per item (and per warehouse where it matters):

- **Daily usage** = issued quantity over a window (default 90 days), with a recency-weighted average; seasonality shown only if 12+ months exist.
- **Days of cover** = available quantity / daily usage → "runs out around 14 Nov".
- **Reorder suggestion** = usage x supplier lead time + safety stock - available - on order.
- **Confidence label**: "based on 3 months of sales / only 2 weeks of data, treat as a guess". Never show a precise date from thin data.

Simple, explainable statistics first (moving average, linear trend). No machine learning until there is real history and a reason. The method is shown to the owner in one sentence per forecast.

Needs per-item `lead_time_days` and `safety_stock` (new item settings) and purchasing "on order" quantity (already derivable).

## 8. Batches, expiry and storage (slice B)

For cosmetics and any regulated stock, quantity alone is not enough.

- **Batches / lots**: `inv_batches` (item, batch number, manufacture date, **expiry date**, supplier, received quantity). Ledger moves reference a batch; balances per item per warehouse per batch.
- **FEFO**: issue suggests the batch that expires first; the approver sees which batch will go.
- **Quarantine status**: a batch can be blocked (QC hold, recall); blocked stock is not available.
- **Storage conditions**: a warehouse (or a zone inside it) has a condition: `ambient`, `cool (15-25 C)`, `cold (2-8 C)`, `frozen`, `hazardous`; each item declares the condition it needs; the system **refuses or warns** when stock is moved to a place that does not match. Condition names and ranges are organization data, not hard-coded.
- **Expiry triggers**: see §6 `expiry_within`; expired stock is flagged and cannot be issued.
- Temperature **logs** (sensor readings) are out of scope; a manual "temperature check" entry could come later.

Existing screens, tests and the ledger must keep working for organizations that do not use batches (batches optional per item: `tracks_batches`).

## 9. Manufacturing (not in boss's list, but a factory needs it)

A cosmetics factory buys raw materials and packaging, makes finished goods, sells finished goods. Without a bill of materials the system sees raw stock that never decreases and finished goods that appear from nowhere, and the profit number is wrong. Proposed later slice **M**: bill of materials per finished product, production orders (consume raw by batch, produce finished batch with expiry), yield and waste. **It is large and not in the boss's notes. See Q1.**

## 10. Demo data: a cosmetics factory in Egypt

A **seed script** (not a migration), loaded only into a clearly named demo organization such as "Demo Cosmetics Factory (sample data)". All names are **invented**; no real companies, people, phone numbers, tax numbers or addresses. Currency EGP, time zone Africa/Cairo, Arabic and English item names.

- **Warehouses / zones:** Raw materials (ambient), Packaging (ambient), Cold room (2-8 C) for actives and natural extracts, Finished goods (ambient), Quarantine.
- **Raw materials (~25):** glycerin, cetyl alcohol, stearic acid, shea butter, sweet almond oil, argan oil, aloe vera extract, panthenol, niacinamide, titanium dioxide (sunscreen), zinc oxide, preservatives, fragrance oils, SLES, cocamidopropyl betaine, citric acid, colorants.
- **Packaging (~15):** PET and HDPE bottles (100/250/500 ml), jars, pumps, caps, tubes, cartons, labels, shrink sleeves.
- **Finished goods (~15):** shampoo, conditioner, body lotion, hand cream, face wash, serum, sunscreen SPF 50, lip balm, shower gel, hair oil.
- **Suppliers (~12, invented):** local chemical traders, a packaging printer, two importers for actives and fragrance, one **single-source** supplier on purpose (to exercise supplier-risk), one that is often late.
- **Customers (~10, invented):** pharmacy chains, supermarket distributors, an export buyer, online sellers.
- **History:** 12 months of purchases, receipts with batches and expiry dates (some near expiry, some expired), sales orders, deliveries, customer and supplier invoices, payments, monthly expenses, a few adjustments, with realistic seasonality (sunscreen up in summer, hand cream up in winter, Ramadan and back-to-school peaks), so the forecast has something real to learn from.
- Deterministic generator (fixed random seed) so a rerun gives the same data; safe to rerun (does nothing if the demo organization exists); never touches other organizations.
- The home page shows a visible "Sample data" label for this organization. No fake claims that a channel delivered anything.

## 11. Data model summary (new / changed)

`inv_items` + `avg_cost_minor`, `lead_time_days`, `safety_stock`, `tracks_batches`, `storage_condition`; `inv_batches`; ledger + `batch_id`, `unit_cost_minor`; warehouses/zones + `storage_condition`; `fin_expenses`, `fin_payments`, `fin_categories`; `core_teams`, `core_team_members`; `trg_rules`, `trg_firings`; summary views / functions `insights_*`. Migrations numbered from `sql/023`, one file per slice, rerun-safe, each with read-only verification and a SQL test. Existing tests 001-018 must keep passing.

## 12. Permissions

`insights.read` (owner, admin; viewer optional per org), `finance.read`, `finance.manage` (expenses, payments), `triggers.read`, `triggers.manage` (rules, teams), `inventory.batches.read/manage`. Money numbers (profit, cost) are **hidden from members/viewers by default**: only roles with `finance.read` see them, enforced in the database function, not in the screen.

## 13. Build order (each slice: plan section, migration, DB tests, API, screen, unit tests, worklog; nothing is deployed until Ben says)

| # | Slice | Why this order |
|---|---|---|
| 0 | UI foundation fixes (Ben's list, see Q3), shared components | owner will judge everything by how it looks |
| 1 | **B** batches, expiry, storage conditions | demo data and triggers need them |
| 2 | **F** cost per item, expenses, payments | profit needs cost and expenses |
| 3 | **D** demo data generator (cosmetics factory) | everything after is built against real-looking data |
| 4 | **H** owner home page + insights functions | the heart; first complete version needs 1-3 |
| 5 | **T** rules, teams, notification settings | |
| 6 | **P** forecast and reorder suggestions | needs history from 3 |
| 7 | **M** manufacturing (BOM, production) if approved | |

## 14. Testing

SQL tests per slice (isolation, refusals, audit chain, no direct writes, hidden money for members), unit tests for formulas (profit, average cost, days of cover, FEFO order, expiry buckets), the concurrency script extended for batch issue races, real-login checks for owner / manager / requester. The demo data gives a **known answer test**: the generator is built so that the expected profit and stock-out dates are computed independently and compared with what the functions return.

## 15. Risks

- **Wrong money is worse than no money.** Every figure shows its basis and date; cost method is documented; a "how is this calculated" link on each card.
- **Forecast from thin data misleads.** Confidence labels; hide below a minimum history.
- **Scope.** This is months of work if done fully; slices 1-4 are the minimum for the boss's demo.
- **Legal.** Egyptian accounting/tax rules and e-invoicing are not covered; not a statutory accounting system.
- **Fake data confusion.** Demo organization is labelled; seed never runs against a real organization.

## 16. Questions for Ben (answered 2026-10-30, see `QUESTIONS_FOR_BEN.md` in the repo root)

Decisions: average cost; manufacturing later (slice M); language is an organization-wide setting chosen at sign-up (replaces the per-browser switch); teams are named groups with Purchasing, Warehouse and Management by default; EGP changeable per organization; profit excludes VAT; UI problem list still missing; no more notes from the boss yet. Original questions:

1. **Manufacturing (BOM and production orders):** in scope for the boss's demo or later? Without it a factory's profit is only approximate.
2. **Cost method:** weighted average (assumed, simplest) or FIFO by batch?
3. **UI issues:** Ben said "ui has a lot of issues". Please list the worst five (screenshots in a folder are fine) so slice 0 fixes the real ones; I have not seen them in a browser.
4. **Languages:** Arabic first for the owner's home page? Who reviews the Arabic text (a native speaker must)?
5. **Who is "purchasing" and "the team":** are teams just named groups of users (assumed)?
6. **Currency / VAT:** EGP only for now, VAT excluded from profit (assumed). Confirm.
7. **Boss's accounting notes:** do you have the actual list/screenshots of what he wants on the first screen? This plan is my reading of a short note.
