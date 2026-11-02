# Odoo benchmark: gap against our P1 set

**Source.** The 64-row list in `Trial_capture_workbook_v12.xlsx`, tab "9 Odoo feature inventory" (Claude's general-knowledge descriptions; not yet confirmed in Ben's Odoo trial). Our status is what the code does as of 2026-11-02, checked against `sql/` and `apps/web/src`. Evidence level: **claimed** for Odoo behaviour until tab 9 column F is filled from the trial; **seen** for our own status.

**Counts (64 rows).** P1 23, P2 21, P3 14, Cut 5, Decision 1 (ETA e-invoicing).

## 1. P1 features not fully built (7 of 23)

| Feature | Odoo does (claimed) | Where we are | What is missing |
|---|---|---|---|
| Operation types | Receipts, deliveries, internal transfers as configurable types | Partial: issue (stock request) and receive exist as fixed flows | Configurable types; **internal transfer between warehouses does not exist** (`sql/026` says "none exist yet") |
| Quotations to sales orders | Quote, confirm, deliver, invoice | Partial: orders, request stock, invoice | A quotation stage and conversion |
| Payments and reconciliation | Match payments to invoices | Partial: payments recorded against invoices | Matching of one payment to several invoices, bank lines |
| Activities and chatter | Tasks plus a note log on every document | Partial: tasks and audit log | Per-record notes/history panel on each document |
| WhatsApp app (**star**) | Messages from documents to customers | Partial: our own channel, never run on a real phone | Meta account, real-phone test, approvals by reply |
| Automated actions | When X, do Y rules | Partial: alert rules exist | Rules that *do* things (create a task, change a status), not only notify |
| Languages and RTL | Full translation, right-to-left | Partial: menus only (11 strings) | Every screen; see UI audit finding 1 |

## 2. Workbook status that overstates what is built (correct these)

| Row | Workbook says | Code shows |
|---|---|---|
| Multi-warehouse and locations (P1) | Built (warehouses) | **Warehouses only.** No locations, bins or shelves (`inv_warehouses` has no parent; no location table). Should read Partial. |
| Customer invoices, credit notes (P1) | Built | Invoices can be **voided** (`status in ('issued','void')`); there are **no credit notes**. Should read Partial. |
| Import / export CSV, Excel (P2) | No | List screens already **export CSV**. Import does not exist. Should read Partial. |

Counting the first two (both P1), **9 of 23 P1 rows are not fully built**.

## 3. Things our P1 set does not include at all (Odoo has them; not among the 64 rows)

Marked *claimed*, from general knowledge of Odoo; confirm each in the trial before adding to the plan.

| Candidate row to add | Why it matters to a warehouse-first ERP | Suggested priority |
|---|---|---|
| Inter-warehouse transfers (with approval) | Core stock movement; our approval story fits it well | **P1** |
| Product categories and per-item units of measure with conversion (box to piece) | Items currently have one free-text unit; no categories | P1 |
| Returns (customer and supplier) and credit notes | Every stocking business has returns | P1 |
| Stock reports: valuation, ageing, movement history | Owners ask for these first | P2 |
| Payment terms and tax rates on orders | Needed before real invoicing in Egypt/GCC | P2 |
| Packages / kits | Selling bundles | P3 |
| Sales order approval above a limit | Reuses our approval engine | P2 |
| Customer and supplier statements | Common ask | P2 |

## 4. Apps we do not have that Odoo does

| App | Our status | Note |
|---|---|---|
| Barcode | Not built | P2 in the workbook; for warehouse staff on phones it is probably P1 |
| Manufacturing | Not built | Workbook: P2 DECISION. Needed for the cosmetics sample to be accurate |
| Documents / PDF printing (delivery slips, invoices) | Not built | P2 |
| Egypt e-invoicing (ETA) | Not built | Decision with management |
| Import / onboarding | Not built | Import from CSV is how a customer actually gets their items in |
| CRM, Helpdesk, Project, HR, Payroll, eCommerce, POS | Deliberately out of scope | Cut |

## 5. Where we are ahead (keep the claim)
Approval that blocks the stock movement in the database, self-approval refused, append-only hash-chained audit log, true multi-tenant isolation with tests, expiry/FEFO with quarantine, forecast with a "thin data" label. Odoo's own docs describe stock validation without a mandatory approval step (tab 8, row 1: confirm in the trial).

## 6. Open
Tab 8 (16 checks) and tab 9 column F are still empty. Nothing above changes the plan until the trial results are in.
