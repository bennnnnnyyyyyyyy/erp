# Ben's walkthrough, 10 November 2026: findings and plan

**Source:** Ben's notes (`notes.md`, outside the repo), his ticks and notes in
[`2026-11-11-click-through-checklist.md`](../operations/2026-11-11-click-through-checklist.md), and Claude looking at the test company
"Test 2" on the live app in Chrome (read-only). The live app is the version **before** branch `feat/po-approval`.

## 1. Fixed or being fixed (no decision needed)

| # | Ben's note | What is done | Where |
|---|---|---|---|
| 1 | "ui box for supplier and anything with a box is broken" | **Cause found and fixed:** pop-ups were drawn inside the page, and the page's animation turned "fixed to the window" into "fixed inside the list", so Add supplier opened squeezed to two rows with its own scrollbar. Pop-ups now draw on the whole window. Fixes every pop-up | `apps/web/src/components/Modal.tsx`, `feat/po-approval` |
| 2 | Owner should be able to approve their own transfers | Company setting "owners may approve their own", for every approval; off by default; owners only; each one flagged in the audit log; a single owner unchanged (decision D1c) | `sql/077`, `feat/po-approval` |
| 3 | Time zone is free text; currency should be a dropdown | Dropdowns | agent: `fix/walkthrough-setup` |
| 4 | "it's fixed in the main setup, why 2 pages" | One place asks each thing | agent: `fix/walkthrough-setup` |
| 5 | No Arabic name for warehouses | Field removed from the forms | agent: `fix/walkthrough-setup` |
| 6 | Mistyped a warehouse name; no way to edit | Warehouses editable; setup shows the one added with Edit | agent: `fix/walkthrough-setup` |
| 7 | Can't change my name; settings menu badly arranged | Own name checked; Settings grouped (Company, Your account, Connections, Records); company options (blind counts, tour, self-approval) in one card | agent: `fix/walkthrough-setup` |
| 8 | Errors shown as plain text: "give me a popup" | Error pop-ups (toasts) on the main forms | agent: `fix/walkthrough-setup` |
| 9 | Items: two code columns, too few columns; SKU should fill itself with a format chosen once; unit a dropdown; setup's items and warehouses steps ask too little | All of it | agent: `fix/walkthrough-items` |
| 10 | Suppliers need more info ("a full scale ERP") | Tax number, commercial registry, email, address, bank, IBAN, currency, notes | agent: `fix/walkthrough-items` |
| 11 | Paying a supplier should show the unpaid bills | Pick from that supplier's unpaid bills; "Unpaid bills" list under Purchases | agent: `fix/walkthrough-items` |
| 12 | "Not enough stock available: 0.000 available, 1.000 requested"; "why use decimal" | Whole numbers shown without decimals; plain message ("you asked for 1, and 0 are available in this warehouse"). Decimals stay possible for kg and litres | agent: `fix/walkthrough-items` |

## 2. Seen in Chrome, not yet assigned

- **Suppliers list:** "Payment terms" is an input box in every row, with its placeholder cut off ("Company defau"). Move it into the
  supplier's Edit form; show the number of days as text in the list.
- **Stock on hand:** the "Arabic name" column is empty for most companies and pushes "Actions" off the screen (sideways scrollbar).
  Hide empty columns; keep Actions visible; short explanations for "Reserved" and "Waiting for approval".
- **Apps page:** descriptions are written for developers ("Delivery goes through channels; approvals stay in the database"); Tasks and
  Messaging are filed under "Warehouse".
- **Accounting setup:** "Where each kind of document posts" with "Roles" and account numbers is accountant language and almost never
  needs changing.

## 3. Needs Ben's decision (recommendation first)

**R1. Inventory, "a whole mess for anyone who has no idea what he is doing", and "workflows are very very confusing".**
The menu has 11 entries named after records (requests, adjustments, ledger, policies) instead of things a person wants to do.
- **A (recommended):** a task-first Inventory: the overview asks "What do you want to do?" with five big actions: **Receive goods**,
  **Send goods out**, **Move between warehouses**, **Count stock**, **Correct a quantity**. Each opens one short guided form that says
  in plain words what happens next ("Your manager will be asked to approve this"). The record lists (requests, transfers, counts,
  adjustments, ledger) move under one "History" group; reorder levels, forecast, batches and approval rules under "Settings and
  planning". Same database and rules; screens only.
- **B:** keep the structure, rename entries and add help text.

**R2. Turning on Accounting.** "Confusing and not ordered by the tutorial; don't give me the option to skip the tutorial from the
beginning."
- **A (recommended):** switching Accounting on opens a three-step guide (opening date → check the chart of accounts → opening
  balances), with the "where each document posts" table hidden under "Advanced (for your accountant)". The first-run tutorial cannot be
  skipped on its first screen (it can be closed after the first step), and its order follows the order a company starts:
  company → warehouses and items → suppliers and customers → buying → selling → money → accounting.
- **B:** only reorder the tutorial; leave the accounting screens as they are.

**Ben's answers (10 Nov 2026): R1 A (task-first Inventory), R2 A (guided accounting setup and the tutorial in a fixed order that
cannot be skipped at the start).** Built after the two walkthrough-fix branches are merged, since they touch the same screens; the
items in §2 go with them (Stock on hand columns and supplier payment terms with R1; the Apps page wording and accounting setup with R2).

**R3. Credit note approval** ("if I can get an online reference id this step would be unneeded"). A payment reference proves money
moved; the approval stops staff lowering what a customer owes without a manager knowing. With decision D1c an owner can now approve
their own. **Recommended:** keep approval for staff; nothing more.

## 4. Checklist lines not done yet

Stock counts, adjustments, transfers, batches, stock ledger, partial receipt, supplier payment, credit note, statements of account,
expenses, cash transfers, bank statements, all accounting reports, messages and tasks, the second company, staff limits, Arabic and
phone. Claude can go through them in Chrome on the test company once tonight's branch is live (otherwise they test the old version).
