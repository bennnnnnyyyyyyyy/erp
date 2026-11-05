# Roadmap: from warehouse app to full accounting suite

**Status:** Draft, written 2026-11-05. Waiting for Ben's approval and answers to section 5.
**Owner:** Ben. **Sources:** Ben's meeting with Joe and Amir (an accountant at a warehouse who works on
Miracle every day), Ben's demo notes, and a read of the code on 5 Nov. Both notes are kept in
the [appendix](#appendix-source-notes).

Each phase below becomes its own module plan (from
[`MODULE_PLAN_TEMPLATE.md`](MODULE_PLAN_TEMPLATE.md)) and its own checklist entry before it is
built. This file sets the order and the scope.

## 1. Goal

A general-purpose ERP that a warehouse's accountant can use **instead of** Miracle:
- the full accounting suite;
- the inventory we already have, made deeper;
- reports that answer the questions the accountant asks every day.

It stays modular and multi-tenant (`agents.md`). Packaging for installs on a company's own servers,
and SaaS billing, come **after** this roadmap (Ben, 5 Nov).

**What the accountant described as the core of the job:** "I bought item A from supplier B into
warehouse C." They enter that once, and the ERP does the stock movement, the accounting and the
reporting. Today we do the stock movement and part of the reporting, but **none of the accounting
entries**.

**Where we can beat Miracle** (from the notes):
- **Suggestions instead of pure manual entry.** On a return, offer the price the customer actually
  paid, from their past invoices. Miracle makes you look it up.
- **Approvals that really block, and an audit log that cannot be edited.** We already have both.
- **Arabic and English, in the browser.** Miracle needs a USB token to sign in.

## 2. What exists today (5 Nov)

| Area | Today |
|---|---|
| Items | SKU (typed by hand), name in English and Arabic, unit, average cost, tax rate, ETA codes, batches, storage condition, reorder level |
| Units | S5a (extra units with a conversion) is in [PR #1](https://github.com/bennnnnnyyyyyyyy/erp/pull/1). Units on order lines (S5b) are not built |
| Item groups | **None** (no categories, no hierarchy) |
| Suppliers and customers | Name, contact, city, phone. **No code, no internal reference** |
| Purchasing | Purchase order → receive (stock in) → supplier bill. **No one-step purchase invoice that receives stock** |
| Sales | Sales order → stock request with approval → delivery → customer invoice. **No cash sale, no cashier screen** |
| Returns | Customer returns on credit notes: S4, in PR #1. **No returns to suppliers. No price suggestion** |
| Tax | Tax rates and ETA data (`sql/036`), on items. **VAT is not calculated on invoice lines**; there is no VAT report |
| Money | Expenses, payments in and out, open items, ageing (S2 in PR #1). **No treasury: no cash boxes or bank accounts** |
| Accounting | **None:** no chart of accounts, journal, trial balance, income statement or balance sheet |
| Periods | Lock date: S1, in PR #1. **No fiscal years, no year-end closing** |
| Reports | Owner home, stock on hand, forecast, alerts. **No account statements, no daily journals, no item movement card** |
| Users and roles | Owner, admin, member, viewer, with permissions. **No custom roles** |
| Warehouse conditions | Optional in the database (`sql/026`). Check whether the wizard or screens make them look required (demo note) |

## 3. Phases

### Phase 0: land what's built, and quick fixes from the demo

> **Status, 5 Nov (see the worklog):** CI SQL tests passed; the dry run on live passed and was rolled
> back; demo fixes 2 are done in code (not deployed); the Miracle write-up is drafted in
> [`../planning/DRAFT_miracle-egypt_TEARDOWN.md`](../planning/DRAFT_miracle-egypt_TEARDOWN.md).
> **040–044 applied to live** the same day, tests 035–039 pass there. **Waiting on:** Ben commits and
> merges PR #1 into `main`. The ERPNext and Dolibarr teardowns and the Odoo study
> are not started.

1. **PR #1** (S1 lock date, S2 payment terms and ageing, S3 stock counts, S4 customer returns,
   S5a units):
   - CI SQL tests pass;
   - dry run on live, rolled back;
   - apply migrations 040–044 with Ben's yes;
   - then Ben merges.
2. **Demo fixes:**
   - Inputs too narrow: widen form fields and table cells.
   - Warehouses without a condition: make it clear the condition is optional, in the wizard and the
     forms.
   - Optional fields that can be left empty: mark them as optional, not required.
3. **Research, kept for reference:**
   - Write up the meeting notes as observed Miracle behaviour (Ben copies them into
     `documentation/research/miracle-egypt/`, because agents cannot edit that folder).
   - Find or redo the lost ERPNext and Dolibarr teardowns.
   - Do an Odoo inventory study for phase 8.

### Phase 1: accounting foundation (the general ledger)

*Notes: "basically the full accounting suite", "software needs an accountant who knows what he's
doing".*

- **Chart of accounts** for each company:
  - hierarchical (account, sub-account, sub-sub-account), each level coded;
  - seeded from a template the company can edit;
  - marked as assets, liabilities, equity, income or expenses.
- **Journal entries:**
  - double-entry, balanced, append-only, posted only through a database function;
  - an audit row in the same transaction;
  - corrections by reversal only, never by editing.
- **Automatic posting from every document we already have:**
  - goods received (stock / goods received not billed);
  - supplier bill;
  - delivery (cost of goods sold);
  - customer invoice;
  - payment in and out;
  - expense;
  - stock adjustment and count;
  - credit and debit notes;
  - returns.
  The posting rules (which document posts to which accounts) are settings, not code.
- **Manual journal entries**, for the accountant, with approval (approver ≠ requester, as for stock).
- **Fiscal years and periods.** This builds on the S1 lock date: open, closed and locked per period.
- **Opening balances**, for a company moving off another system.
- **Trial balance**, to check that everything balances.
- **ADR** before any code: posting in the same transaction, the reversal rule, how existing data
  is backfilled, and how money is rounded.

### Phase 2: treasury, parties and account statements

*Notes: "cash sale gets tracked on the treasury immediately", "it can have multiple accounts",
"account statement (كشف حساب) per period, per item, per supplier/customer", "debit and credit
(مدين ودائن)".*

- **Treasury:**
  - several cash boxes and bank accounts, each tied to a ledger account;
  - every payment, receipt and expense goes through one;
  - transfers between them;
  - running balance per box or account.
- **Codes for parties:**
  - a supplier or customer code, either automatic or typed;
  - an internal reference number on documents;
  - search by code everywhere.
- **Account statement (كشف حساب)** for a supplier, a customer, a ledger account or an item:
  - for a chosen period;
  - columns: date, document, debit, credit, running balance;
  - opening and closing balance;
  - printable and exportable.
- **Cheques** (common in Egypt): received and issued, due date, under collection, cleared or
  bounced. **To confirm** with the accountant before building.

### Phase 3: taxes

*Notes: "VAT 14", "need to understand all types of taxes on all goods".*

- **Research first**, recorded with sources:
  - Egyptian VAT (14%, and the exempt and zero-rated goods);
  - table tax;
  - withholding tax (خصم وإضافة) on payments;
  - stamp duty;
  - which of these the ETA e-invoice carries.
- **Tax on document lines:** purchase and sales lines carry their tax, either computed from the
  item's rate or chosen on the line. Totals are shown before and after tax, and tax posts to its
  ledger accounts.
- **VAT return report** for a period: output VAT, input VAT, the difference.
- **Finish ETA e-invoicing**
  ([ETA_EINVOICING_PLAN.md](ETA_EINVOICING_PLAN.md)): screens, signing, submission.
  - **Note:** Miracle "needs a USB token". In Egypt that is usually the ETA e-signature token.
    Confirm whether it is the token for signing invoices or a licence key; it decides how we sign.

### Phase 4: master data and coding

*Notes: "item, sub-item and sub-sub-item, each with coding", "auto SKU or our own (best for the
Egyptian Tax Authority)", "SKU as the supplier knows it differs from the SKU the customer knows",
"price gets added or updated automatically".*

- **Item groups:** three or more levels, each with a code. The item code can be built from the group
  codes.
- **Item codes:** a company setting, either automatic (a pattern such as group code plus sequence)
  or typed. Show the ETA code next to it.
- **Supplier and customer item codes:** a table of the item's code as each supplier or customer
  knows it, searchable on documents and printed on them.
- **Prices:**
  - last purchase price per supplier, filled in automatically;
  - a sales price per item, with optional price lists per customer group;
  - a setting for whether a new purchase price updates the item's price automatically or only
    suggests it.
- **Units on document lines** (S5b: buying in boxes, selling in pieces). Each line keeps its own
  unit and factor so no money is lost to rounding.

### Phase 5: faster purchase and sale entry

*Notes: "all he does: I bought item A from supplier B in warehouse C", "connect purchases to
inventory", "it has a cashier system", "returns … the ERP should suggest [the price]".*

- **One-step purchase invoice:**
  - supplier, warehouse, then lines by item code (quantity, price, tax);
  - posting it receives the stock, books the bill and posts the accounting;
  - the purchase-order flow stays available for companies that want it.
- **One-step sale and cash sale:**
  - customer or "cash customer", warehouse, lines;
  - posting it issues the stock (through the approval rules if the company has them), books the
    invoice and records the cash in the chosen cash box at once.
- **Smart returns, from both customers and to suppliers:**
  - pick the customer, then the item;
  - the ERP shows the invoices it was sold on, at what price and how much is still returnable;
  - pick one and the return fills itself in.
  This is our differentiator.
- **Cashier screen:** a fast sales screen for a counter, using the same cash-sale function.
  **Depends on Q1** (is point of sale in scope?).

### Phase 6: reports and analytics

*Notes: "analytics and reports are the most crucial", "detailed overview", "daily purchases and
transactions, full amount can be detailed, same for sales", "income statements", "reports for
profit and loss", "track a single item's movement across warehouses", "current item stock in
warehouse".*

- **Financial statements:**
  - income statement (profit and loss) for a period, with comparison to an earlier period;
  - balance sheet;
  - trial balance;
  - general ledger by account.
- **Daily journals:**
  - purchases, sales and cash, by day;
  - each total opens the documents, and each document opens its lines (drill-down).
- **Item movement card (كارت الصنف):**
  - every movement of one item across all warehouses or one;
  - in, out, balance and cost.
- **Stock by warehouse** and stock valuation at a date.
- **Account statements** (from phase 2) and **ageing** (S2).
- Every report filters by period, warehouse, party, item and group, and exports to Excel and PDF.
- **Report builder** (choose columns, group, save): only if the fixed reports are not enough.

### Phase 7: year-end closing

*Notes: "closing between fiscal years can be automatic from the ERP; I can choose which balances
to move automatically and which to enter manually".*

- A closing wizard:
  - checks that the year balances and that every period is locked;
  - posts the closing entries (income and expenses into retained earnings);
  - carries forward the balances the accountant ticks;
  - leaves the others for manual entry;
  - opens the new year.
- Everything goes through approval and the audit log, and can be undone only by a reversing entry.

### Phase 8: inventory depth (Odoo study)

*Note: "Odoo inventory features are very good; take them all, as detailed as they are (not
identical)".*

Study how Odoo's inventory behaves (behaviour only: Odoo Community is LGPL, so we never read or port
its code). Record the study in `documentation/research/odoo/` (a folder already exists). Then
choose features to build, for example:
- receipts and deliveries in one, two or three steps;
- putaway rules;
- reordering rules with replenishment;
- product variants and packaging;
- serial numbers;
- landed costs;
- scrap;
- a stock moves analysis;
- valuation layers.

The single-item movement card (phase 6) and stock per warehouse already answer the most urgent
notes.

### Phase 9: usability (from the demo)

- **Choose columns** on every list:
  - show, hide and order them;
  - saved per person;
  - a column the person cannot open is shown read-only rather than hidden, if that is what "even if
    I can't access" means (Q7).
- Wider inputs and tables (phase 0 covers the first pass).
- Search by code everywhere (items, parties, accounts).
- Optional fields are clearly marked; nothing is required unless the data really needs it.

### After this roadmap (not now)

- Branches (Q2).
- Custom roles.
- Backup and export per company (the notes say "can backup as a…", which is cut off).
- Installs on a company's own servers, and SaaS billing.

## 4. Order and dependencies

```
Phase 0 → Phase 1 (ledger) → Phase 2 (treasury, statements) → Phase 3 (taxes)
                  ↘ Phase 4 (codes, prices) → Phase 5 (one-step entry, smart returns)
Phase 6 (reports) grows with each phase; its financial statements need phase 1.
Phase 7 (closing) needs phases 1 and 2.
Phase 8 (inventory depth) and phase 9 (usability) can run alongside, between phases.
```

Phases 1 and 3 change how every document is saved, so each needs an ADR and a migration plan for
the companies' existing data.

## 5. Decisions only Ben can make

- **Q1. Scope:** is a cashier screen (point of sale) in? Are CRM, HR and payroll still out?
  Should `PRODUCT_BRIEF.md` and `agents.md` be reworded to "general purpose"?
- **Q2. Branches:** Miracle gives each branch its own organization and database. We can do either:
  - **(a) branches inside one company**, with reports per branch and combined (recommended: one
    login, consolidated reports, branch permissions); or
  - **(b) one company per branch**, as Miracle does.
- **Q3. Chart of accounts template:** the Egyptian Unified Accounting System, a simple small-business
  chart, or the company's choice from both?
- **Q4. Pilot:** can Joe and Amir's warehouse be the first real customer? Can we sit with their
  accountant again with a list of questions (cheques, taxes, closing, reports they print)?
- **Q5. Approvals on accounting:** should manual journal entries and year-end closing need a second
  person, as stock does?
- **Q6. Prices:** should a new purchase price update the item price automatically, or only suggest
  it?
- **Q7. "Customise the columns even if I can't access":** what did you mean?
- **Q8. USB token:** is it Miracle's licence key or the ETA signing token?

## Appendix: source notes

Kept as written (lightly formatted), so later work can check the plan against them.

**Meeting with Joe and Amir (Miracle, used live by a warehouse accountant):**
> Miracle accounting ERP: he logs in but needs a USB token for it to work. First: locked periods,
> financial periods. It's a whiteboard that asks for actions. All suppliers and customers are
> assigned an ID, then there are internal reference numbers. Then I add the item via the code, then
> the amount and price. I also add tax (VAT 14). Either the price gets added or updated
> automatically. A cash sale gets tracked on the treasury immediately; it can have multiple
> accounts. The main idea behind the ERP: I can track a single item's movement across warehouses.
> Each branch is its own organization with its own database. Current item stock in warehouse. All he
> does: "I bought item A from supplier B in warehouse C", and then the ERP does the movement and the
> reporting. Give companies the option to auto SKU or do their own (best for the Egyptian Tax
> Authority). Users, admin, roles. Account statement (كشف حساب) per period, per item, per
> supplier/customer. The treasury. Account statement, debit and credit (مدين ودائن). Analytics and
> reports are the most crucial. Detailed overview. Daily purchases and transactions; the full amount
> can be detailed; same for sales. Basically the full accounting suite. Income statements. The
> software needs an accountant who knows what he's doing. Reports for profit and loss. It has a
> cashier system. Item, sub-item and sub-sub-item, each with coding. Closing between fiscal years can
> be automatic from the ERP; I can choose which to move automatically and what to enter manually.
> Returns: it doesn't give me a suggestion, it's all manual entry; it could be automated. I copy the
> item SKUs when I write the return sheet; I don't remember how much I sold him the item for, and the
> ERP should suggest that (Miracle doesn't have this; we want to add it). SKU as the supplier knows
> it differs from the SKU the customer knows. Can backup as a … The ERP we're making will probably
> replace this.

**Demo notes:**
> Not all warehouses need conditions. The columns for all the inputs are very little. I can leave
> them empty. More options: need to customize the columns even if I can't access. VAT needed. Need
> to understand all types of taxes on all goods. Connect purchases to inventory. Odoo inventory
> features are very good: take them all, as detailed as they are (not identically).
