# Odoo review: what it does well, what we have, what to build next

**Date:** 2026-11-02 · **Studied:** Odoo 20.0 Enterprise free trial (`wazowski.odoo.com`, 23 apps installed, 14 days left), by Ben and Claude.
**Evidence:** **seen** = observed in the trial (screens, settings, or a test we ran with fake data). **claimed** = Odoo's own pages or general knowledge, not yet seen. Full row-by-row detail: `Trial_capture_workbook_v13.xlsx` (tab 8 deep dive, tab 9 inventory of 66 rows). Behaviour only: never copy Odoo's code, assets or text (see `../README.md`).

---

## 1. Odoo's strong features (seen in the trial)

**Inventory and warehouse**
- Operation types (Receipts, Delivery Orders, Manufacturing), with internal transfers appearing only after **Storage Locations** is switched on. Locations, multi-step routes, batch/wave picking, lots and serials, packages, landed costs, units of measure and packagings, dropshipping: each is a settings switch, all off by default.
- Reordering rules with an Auto/Manual trigger and an **Order** button (creates RFQs).
- Barcode app (phone camera). A real barcode scan worked; a made-up one did nothing, since nothing matched.
- Physical inventory: counted quantities applied through an **Apply** step that asks for an inventory reason and counting date.
- Stock reservation: a delivery showed "Available" and reserved the quantity before validating.
- Scrap, returns, Moves History and Moves Analysis reports. No valuation report under Inventory > Reporting (valuation lives in Accounting settings).

**Buying, selling, money**
- RFQ to purchase order in one click, with a receipt created automatically; vendor pricelists with lead times; blanket orders; 3-way matching; purchase-order approval above an amount (a setting, off by default).
- Quotations with validity, signature and online payment; pricelists and discounts; invoicing policy (ordered vs delivered quantities); customer portal.
- Accounting: invoices, credit notes, payments, a full report list (balance sheet, P&L, cash flow, trial balance, general ledger, partner ledger, customer statement, aged receivable/payable, tax report), bank import, budgets, analytic accounts.
- **Egypt:** Egypt Accounting is installed; **Egypt E-Invoicing** (Tax Authority integration) and E-Receipts are available to install.

**Platform**
- **Import wizard on every list**: column mapping, template download, a Test step before Import, and a "prevent import" option for unmatched names. (Template download failed with a plugin error in our browser.)
- **Chatter on every record** (status and field changes with user and time) and **Activities** (To-Do, Email, Call, Meeting, Document, Signature Request; assign to a user or a role; Activity Types and Plans).
- Roles (Light / User / Administrator) plus per-app access rights; multi-company; automation rules; API keys; an MCP OAuth setting so outside AI clients can connect; Studio (no-code customisation) listed.
- **Approvals app**: standalone request-and-approve forms (9 sample categories such as Procurement = "Create RFQ's"). Works once approvers are set (request from admin to Benny, accepted).
- Apps listed as available but not installed: WhatsApp Messaging, Phone (VoIP, with an AI add-on), Studio, Subscriptions, Quality, Maintenance, PLM, POS, CRM, eCommerce, Helpdesk, Payroll.
- Mobile app: receipts validated, barcode scan and approval request worked for Ben.
- Pricing (claimed, conflicting sources): official page shows Standard about US$8.95 and Custom about US$16.40 per user per month; third parties quote higher and say it varies by region. Confirm the Egypt price in the trial's **Buy a subscription** screen.

## 2. Where Odoo is weak, and where we are ahead (keep this claim)

| Test in the trial | What Odoo did | Our design |
|---|---|---|
| Validate an outgoing delivery (10 x Shampoo) | Draft > Ready > Done in one click, same user who created it, **no approval** | Outgoing stock posts only through a database function that needs an approved request and an approver other than the requester |
| Barcode count on Aloe vera extract | On hand cut from **435 to 1** (a -434 write-off), no approval, no reason or user shown in Moves History | Adjustments are manager-reviewed in the database |
| Approvals app | A separate request form; no link to a stock movement was seen | Approval is part of the stock transaction and blocks it |
| Chatter / history | Tracks selected fields; imported records start with empty history | Append-only, hash-chained audit log written in the same transaction as every stock move and approval |

Also ahead, from our own checks: true multi-tenant isolation with tests, expiry/FEFO with quarantine, forecast with a "thin data" label.
**Not yet proven:** anything involving WhatsApp (Odoo's app is available but not installed; ours has never run on a real phone).

## 3. What we are already implementing (our status)

Built or mostly built, matching an Odoo capability: multiple warehouses; batches with expiry and FEFO; reorder levels; manager-reviewed adjustments; stock reservation; purchase orders with approval policies; supplier invoices with duplicate and over-billing guards; average-cost valuation; roles and organisation isolation (multi-tenant); notifications outbox; audit log; owner home dashboard; CSV export from lists.

Partial: operation types (fixed issue/receive flows), sales orders (no quotation stage), payments (one payment to one invoice), activities (tasks plus audit log, no per-record notes panel), alert rules (notify only), Arabic/RTL (menus only: 11 strings), units/categories (one free-text unit, no categories), API.

**Three workbook rows overstated what is built** and should read Partial: locations (warehouses only, no bins or shelves), credit notes (invoices can be voided, no credit notes), CSV (export only, no import).

## 4. What to continue implementing (recommended order)

**Do next (P1, each fits our approval and audit story)**
1. **Inter-warehouse transfers with approval.** Does not exist yet; Odoo needs a settings switch to offer it. Our strongest demonstration.
2. **CSV import with a test/preview step** (mapping, Test, then Import; clear errors for unmatched names). Ben likes this flow; it is how a customer loads their items.
3. **Returns and credit notes** (customer and supplier).
4. **Product categories and units of measure with conversion** (box to piece).
5. **Arabic on every screen** (UI audit findings 1 and 2: 38 of 40 screens are hard-coded English). Needs a decision on native-speaker review.
6. **Quotation stage** for sales, **payment matching** (one payment to many invoices), a **per-record history/notes panel**, and **automation rules that act** (create a task, change a status), not only notify.

**Then (P2)**
- Barcode scanning on phones (probably P1 for warehouse staff; test with real barcodes on products).
- PDF printing (delivery slips, invoices); stock valuation/ageing reports; payment terms and tax rates on orders; sales-order approval above a limit; customer and supplier statements; locations/bins; apply-step wizard for counts (reason and counting date).
- Make approval visibly part of an adjustment too: a large write-down (like 435 to 1) should need a manager.

**Decisions needed from management**
- **Egypt e-invoicing (ETA):** Odoo offers it as a module. Build, integrate or skip? Needs ETA registration and a USB token.
- **Manufacturing:** the cosmetics sample is only approximate without it.
- **WhatsApp:** needs a Meta account and a real-phone test before it can be called a strength.

**Leave out (out of scope or low value)**: POS, CRM, helpdesk, HR/payroll, eCommerce, subscriptions, internal chat, dropshipping, Studio, VoIP for now.

## 5. Open items
- Blank workbook rows: putaway rules, vendor portal, mobile responsive layout, and a real subscription price for Egypt.
- Notification delivery (activity/approval push) and the warehouse-only user view were not tested.
- Trial test records (fake): delivery `WH/OUT/00001`, purchase order `P00001`, receipt `WH/IN/00001`, a barcode count on Aloe vera extract. The trial expires in about 14 days.
- Import files for our cosmetics sample data: `import/` in this folder.

