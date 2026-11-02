# Odoo review: what it does, where we are different, what we build next

**Prepared for:** management · **Date:** 2 November 2026 · **By:** Ben Arthur, with Claude (AI assistant)
**What we looked at:** a hands-on trial of Odoo 20 Enterprise (23 apps switched on), tested with a sample cosmetics company's data. All data was fake. The trial runs for about 14 more days.

---

## The short version

1. **Odoo is broad and mature.** It covers stock, buying, selling, accounting and Egypt's e-invoicing, and has a phone app. Most of the features on our list exist in it, usually as optional switches.
2. **Odoo does not control who can move stock.** In our tests one person created and completed a delivery with no approval, and a single barcode count cut a product from 435 units to 1 with no approval. Odoo has an Approvals app, but it is a separate request form and we found nothing linking it to stock.
3. **Our product is built around exactly that gap.** In ours, outgoing stock cannot move until a different person approves it, and the system itself refuses otherwise. Every approval and stock movement is also written to a log that cannot be edited.
4. **We are behind on breadth.** Nine of our original 23 most important features are not fully built yet. The biggest gaps are moving stock between warehouses, importing data, returns and credit notes, and Arabic on every screen.

**What we are asking for:** agreement on the build order in section 5, and decisions on the four questions in section 6.

## 1. What Odoo does well (seen in the trial)

- **Warehouse:** receipts, deliveries, reordering rules, barcode scanning on the phone, lots and expiry, scrap, returns, and stock reports. Many advanced options exist but are off until someone switches them on.
- **Buying and selling:** request for quotation to purchase order in one click, vendor price lists, quotations, price lists and discounts, a customer portal.
- **Accounting:** invoices, credit notes, payments, and a full set of reports (balance sheet, profit and loss, aged receivables and payables, tax).
- **Egypt:** Egypt's chart of accounts is installed, and Egypt E-Invoicing (the Tax Authority integration) is available to switch on. We did not try it.
- **Everyday tools:** an import wizard that previews and tests a file before importing; a history on every record; tasks that can be assigned to a person or a role; user roles with per-app permissions; a phone app.
- **Also on offer:** WhatsApp messaging, phone calls, Studio (no-code customisation) and more. We saw them listed as available but did not install or test them.

## 2. Where we are different

These are results from tests we ran in the trial, not claims from Odoo's website.

| What we did | What Odoo did | What ours does |
|---|---|---|
| Created a delivery of 10 items and completed it | Done in one click by the same person, no approval | Cannot be completed until a different person approves it |
| Counted a product by barcode | Stock went from 435 to 1 straight away, no approval, no reason shown | Stock changes are reviewed by a manager first |
| Used Odoo's Approvals app | Works, but is a separate form; nothing ties it to stock | Approval is part of the stock movement and blocks it |
| Looked at the record history | Tracks selected fields; imported records start blank | Every approval and stock movement is logged, cannot be edited, and is written in the same step as the change |

**Caution:** we tested Odoo as delivered. Odoo can be customised (for example with Studio or automation rules, or by an Odoo partner) to add approvals. We did not test that, and we should not claim Odoo "cannot" do it, only that it does not out of the box.

## 3. Where we are behind

Of our original 23 most important features, **9 are not fully built** (and file import has since been added to that list). In plain terms:
- Moving stock **between warehouses** does not exist yet (Odoo has it, behind a switch).
- **Importing** a customer's items from a file does not exist (Odoo's import is good and we should copy the idea, not the code).
- **Returns and credit notes** are missing (we can only cancel an invoice).
- **Arabic and right-to-left** covers the menus only; the rest of the screens are English. A person can now choose their language in Settings, but the translations are not written yet.
- Smaller gaps: quotations before orders, matching one payment to several invoices, a notes/history panel on each record, and automation rules that do something rather than just notify.

Three entries in our own feature list overstated what we had (warehouse locations, credit notes, file import) and have been corrected.

## 4. What we have not proven

- **WhatsApp approvals.** Odoo offers WhatsApp messaging. Ours has never been tested on a real phone, so we cannot call it a strength until it is.
- **Price.** Odoo's own page shows about US$9 to US$16 per user per month for its two paid plans, but other sources quote US$31 to US$58, and prices appear to differ by region. We have not confirmed what Egypt pays. The "Buy a subscription" screen in the trial should show it.
- **Phone approvals in Odoo** were tested once by a person on the phone app and worked, but only the request-and-approve form, not stock.

## 5. Recommended build order

1. **Transfers between warehouses, with approval.** Our clearest advantage in a demo. A draft plan is written ([plans/INVENTORY_TRANSFERS_PLAN.md](../../plans/INVENTORY_TRANSFERS_PLAN.md)).
2. **File import with a test step** (Odoo's best idea): customers need it to load their items.
3. **Returns and credit notes.**
4. **Product categories and units** (box to piece).
5. **Arabic on every screen**, after a native speaker is chosen to review it.
6. Then quotations, payment matching, record history, and automation rules; barcode scanning on phones is probably next after those.

Left out on purpose: point of sale, CRM, HR and payroll, online shop, subscriptions, internal chat.

## 6. Decisions needed

1. **Approve the transfers plan** and its open questions (what happens when fewer items arrive than were sent).
2. **Egypt e-invoicing:** build it ourselves, connect through a third-party service, or leave it out for now? It needs Tax Authority registration and a USB token.
3. **Manufacturing:** include it? Without it, profit figures for a factory customer stay approximate.
4. **WhatsApp:** can we set up a Meta business account so we can test approvals by reply on a real phone?
5. **Arabic:** who reviews the Arabic text?

---

*Detail and evidence:* [ODOO_REVIEW_DETAIL.md](ODOO_REVIEW_DETAIL.md) (full feature notes, evidence levels), [P1_GAP.md](P1_GAP.md) (feature gap table), and `Trial_capture_workbook_v13.xlsx` (66 features checked, with what was seen in the trial).

