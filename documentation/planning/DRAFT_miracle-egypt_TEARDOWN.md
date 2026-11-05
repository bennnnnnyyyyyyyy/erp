# Teardown: Miracle (Egypt) — DRAFT for Ben to copy

> **Draft.** Agents cannot write to `documentation/research/`. Ben: copy this file to
> `documentation/research/miracle-egypt/TEARDOWN.md` (and delete this draft) when you are happy with it.

**Slug:** `miracle-egypt`
**URL:** not recorded (Ben to add the vendor's public site)
**Studied by:** Ben, with Joe and Amir; written up by Claude · **Dates:** 2026-11-05 to 2026-11-05
**Access used:** a meeting with an accountant at a warehouse who uses Miracle every day. No account of ours, no screenshots.
**Status:** In progress (one meeting only)
**Feeds plan(s):** [`ROADMAP_ACCOUNTING_SUITE.md`](../plans/ROADMAP_ACCOUNTING_SUITE.md)

> Record what the system does, in our own words. No copied code, assets or copy text.
> **Evidence labels used here:** *(told)* = the accountant said so in the meeting; *(inferred)* = our
> reading of what was said; nothing is *(seen)* yet, because we have no screenshots or trial. The raw
> notes are in the roadmap's appendix.

---

## 1. Summary

- An accounting-first ERP used by Egyptian companies; the accountant described it as covering the
  full accounting suite plus stock across warehouses *(told)*.
- Maps to our modules: inventory, purchasing, sales, finance, and the accounting module we do not
  yet have.
- Pricing: unknown.

## 2. Users and roles

- Users, admins and roles exist *(told)*. Whether roles are custom or fixed is unknown.
- Sign-in needs a **USB token** *(told)*. Whether it is a licence key or the ETA e-signature token is
  unknown (roadmap Q8).

## 3. Navigation and screen inventory

Not recorded. The accountant described the main screen as "a whiteboard that asks for actions"
*(told)*: *(inferred)* a home screen of action shortcuts.

## 4. Data model (as described)

| Entity | What we heard | Label |
|---|---|---|
| Supplier / customer | Each gets an ID (code); documents also carry internal reference numbers | told |
| Item | Coded; grouped as item → sub-item → sub-sub-item, each level with its own code | told |
| Item code | The company can let the system make it, or type its own (preferred for the Egyptian Tax Authority) | told |
| Party item codes | The code a supplier uses for an item differs from the code a customer uses | told (as a need; unclear if Miracle stores both) |
| Treasury | Cash sales post to the treasury at once; there can be several treasury accounts | told |
| Fiscal periods | Financial periods that can be locked | told |
| Branch | Each branch is its own organization with its own database | told |

## 5. Workflows

### W1: Purchase

1. Pick the supplier (by ID) and the warehouse.
2. Add lines by item code, with quantity and price.
3. Add tax (VAT 14%).
4. The system moves the stock, posts the accounting and updates the reports *(told)*.

**Business rules:** the item's price is either added or updated automatically from the purchase
*(told; which of the two is a setting is unknown)*.

### W2: Cash sale

A cash sale is recorded on the treasury at once *(told)*. There is a cashier screen *(told)*.

### W3: Return

All manual: the accountant copies the item codes onto the return sheet and has to remember or look up
the price the customer paid. **No suggestion from past invoices** *(told)*. This is our planned
differentiator (roadmap phase 5).

### W4: Year-end closing

Can be done automatically by the system; the accountant chooses which balances to carry forward
automatically and which to enter by hand *(told)*.

## 6. Reports and dashboards

| Report | What we heard | Label |
|---|---|---|
| Account statement (كشف حساب) | Per period, per item, per supplier or customer; debit and credit columns | told |
| Item movement across warehouses | "The main idea": follow one item's movement across warehouses | told |
| Stock per warehouse | Current stock of an item in a warehouse | told |
| Daily purchases and sales | Daily totals that can be opened into detail | told |
| Income statement / profit and loss | Present | told |

The accountant called analytics and reports "the most crucial" part *(told)*.

## 7. Integrations, imports and exports

- Backup: "can back up as a …" (cut off in the notes).
- ETA e-invoicing: not discussed; *(inferred)* the USB token may be for it.

## 8. Settings and configuration

Automatic or typed item codes; locked financial periods; several treasury accounts *(told)*.

## 9. Notifications

Not discussed.

## 10. UX observations

- Needs a USB token to work: a barrier we do not have (browser sign-in).
- Returns are slow and error-prone (manual price lookup).
- The accountant said the software "needs an accountant who knows what he's doing": it assumes
  accounting knowledge.

## 11. Parity matrix

| # | Feature | Seen in | Priority | Our module | Notes |
|---|---|---|---|---|---|
| F1 | Chart of accounts, journal, automatic posting | W1, W2 | Must | accounting (phase 1) | |
| F2 | Treasury with several cash and bank accounts | W2 | Must | finance (phase 2) | |
| F3 | Account statement per party, item, account | §6 | Must | reports (phase 2, 6) | |
| F4 | VAT on document lines | W1 | Must | tax (phase 3) | |
| F5 | Item groups with coded levels; auto or typed codes | §4 | Must | inventory (phase 4) | |
| F6 | One-step purchase invoice that receives stock | W1 | Must | purchasing (phase 5) | |
| F7 | Cash sale and cashier screen | W2 | Should | sales (phase 5) | Q1 |
| F8 | Item movement card across warehouses | §6 | Must | reports (phase 6) | |
| F9 | Year-end closing with chosen carry-forwards | W4 | Must | accounting (phase 7) | |
| F10 | Branches | §4 | Should | core | Q2: we prefer branches inside one company |
| F11 | Return price suggestion | W3 | Must (differentiator) | sales/purchasing (phase 5) | Miracle does not have it |

## 12. Open questions

- What is the USB token (licence or ETA signing)?
- Are cheques handled, and how (received, issued, under collection, bounced)?
- Which taxes besides VAT 14% does it handle (table tax, withholding, stamp duty)?
- Which reports does the accountant print every day or month? Get examples (made-up data).
- Is the price update after a purchase automatic or a suggestion, and is it a setting?
- Pricing and licensing model.
