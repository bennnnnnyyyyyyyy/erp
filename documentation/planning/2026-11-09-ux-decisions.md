# UX audit, 9 Nov 2026: what was fixed, and what needs your answer

**How to use this file:** each question below has options. Put an `x` in the box you want (`[x]`), or write your own answer on the
`Your answer:` line, then tell Claude "answers are in the UX decisions file". Anything left blank is not built.

Branch `fix/ux-audit` (pull request linked in the worklog). Three reviewers read every screen's code on 9 Nov and found about 80
problems. Everything that did not need a decision from you is fixed below; everything that does is in "Your decisions".

---

## Your decisions

> **Answered by Ben on 9 Nov 2026** (in chat, recorded here). Follow-ups he also chose: long dropdowns become type-to-search
> boxes (name, code or phone, Arabic or English), and each record's History box asks the server for its own complete history with
> readable labels. Build order and status: see the worklog.

### D1. A company with only one owner can never issue stock

The rule "the person who asks for stock cannot approve it" is enforced by the database (agents.md, non-negotiable). A one-person
company therefore gets stuck: the owner's own requests can never be approved. The screen now says so ("You made this request, so
someone else must approve it"), but a solo owner still has no way forward.

- [ ] **A.** Keep the rule. Tell new owners during setup: "you need a second manager to issue stock".
- [x] **B.** Let an owner approve their own request **only when nobody else in the company can approve**, and mark it in the audit
      log as "self-approved, no second approver". (Changes a non-negotiable rule: needs your explicit yes.)
- [ ] **C.** Make it a company setting, off by default: "allow the owner to approve their own requests".

Your answer: B, only while the company has **no other active owner or manager**. As soon as one is added, the normal rule returns. Each self-approval is marked in the audit log ("self-approved: no second approver in the company"). Ben gave the explicit yes this rule change needs.

Built in batch 3 (`sql/063_sole_approver.sql`), for **stock requests only**.

**Follow-up question (D1b):** the same "someone else must approve" rule also applies to stock adjustments, transfers, stock counts,
credit notes and manual journals. A solo owner is still stuck on those. Should the same exception apply to them?

- [x] **A.** Yes, all of them, the same way (only while there is no other owner or manager; marked in the history).
- [ ] **B.** Only stock ones (adjustments, transfers, counts); keep money ones (credit notes, journals) strict.
- [ ] **C.** No, stock requests only.

Your answer: A. Built in `sql/065_sole_approver_more.sql` for stock adjustments, transfers, counts and credit/debit notes. Manual
journals are left as they are: the owner can already post a journal directly (decision of 5 Nov), so a solo owner is not stuck there.

### D2. Arabic text: say it is still being reviewed, or not?

All screens now say "Some wording is still being reviewed" (it used to say large parts were English only, which was no longer true).

- [ ] **A.** Keep that one short line until you have reviewed the Arabic.
- [x] **B.** Remove it now.

Your answer: B: remove the "still being reviewed" line now.

### D3. Receiving a short delivery

"Receive goods" on a purchase order receives every line in full; it now warns before doing so. Receiving part of an order (and entering
batch and expiry at the same time) needs a database change.

- [x] **A.** Build partial receipts (enter the received quantity per line; the order stays open for the rest).
- [ ] **B.** Not now.

Your answer: A, and after a part delivery **ask each time**: "Is the rest still coming?" Yes keeps the order open ("Partly received, 40 to come"); No closes it at what came.

### D4. Editing customers, suppliers and items

Today a typo in a customer's name or phone cannot be fixed: there is no edit screen and no API for it.

- [x] **A.** Build edit screens for customers, suppliers and items (name, phone, city; changes recorded in the audit log).
- [ ] **B.** Not now.

Your answer: A: everything except codes is editable (name, phone, city, address, payment terms, contact). Customer and supplier codes and item SKUs stay fixed. Every change is recorded with the old and new value.

### D5. Adding a customer or supplier while making an order

Today you must leave the order (losing what you typed) to add a new customer or supplier.

- [x] **A.** Add a "New customer" / "New supplier" button inside the order form.
- [ ] **B.** Not now.

Your answer: A: a small pop-up asking for **name and phone** only; the new customer or supplier is selected in the order straight away and nothing typed is lost.

### D6. Who sees Online orders (Sales)

It needs the same permission as its API route today, so only owners and admins see it.

- [x] **A.** Keep it to owners and admins.
- [ ] **B.** Let sales staff (members) see it too (a permission change on the server).

Your answer: A: owners and admins only.

### D7. Recording an expense that is paid on the spot

Today you record the expense, then go to Payments, find it in a list of "Expense EXP-…" lines and pay it.

- [x] **A.** Add "Paid now from [cash box]" to the expense form, and show category and supplier in the payment list.
- [ ] **B.** Not now.

Your answer: A: "Paid now from [cash box or bank]", starting on the box this person used last; the payment is recorded at the same moment and linked to the expense.

### D8. Stock value correction: where it lives

It is inside Accounting setup today, which is where it was found. It is a tool you will use again.

- [x] **A.** Move it to Accounting as its own page ("Stock value"), with the profit effect shown before posting.
- [ ] **B.** Leave it in Accounting setup.

Your answer: A: its own Accounting page, "Stock value", showing the profit effect before posting. Only the owner and the head accountant can post (as today); everyone with accounting access can see the check.

### D9. Setup wizard length

The first-run wizard has 11 steps, asks for language a third time, and has a cold-room "storage conditions" step before warehouses.

- [x] **A.** Shorten it: drop the language step and move storage conditions out (to Batches and expiry).
- [ ] **B.** Leave it.

Your answer: Neither A nor B: the wizard first asks **"What do you sell?"** (shop, food or drinks, medicine, cosmetics, building materials, something else) and shows only the steps that fit; the storage-conditions step appears only for food, medicine and cosmetics. Drop the language step (already asked twice before).

Built 10 Nov (branch `ux/d9-wizard`): the question is step 2, one click chooses and moves on; the storage step appears only for food,
medicine and cosmetics; the items step shows a unit hint for the business (for example "ton, bag, m² or m³" for building materials).
The answer is kept with the wizard's progress in this browser (no database change). Using it elsewhere in the app (for example
default units or which apps to switch on) would need it saved as a company setting: a later question.

### D10. Settings for staff

Workers open Settings and see greyed-out company, users, apps and audit pages they cannot use.

- [x] **A.** Show staff only "My language" (and their own account) in Settings.
- [ ] **B.** Leave it.

Your answer: A, and staff Settings holds: **My language, My account** (name, email, change password), **My notifications**, and **Connect my phone**. Nothing else.

### D11. Dates around midnight

Default dates on forms come from the computer's clock in UTC, so just after midnight in Egypt they show yesterday.

- [x] **A.** Use the company's time zone everywhere (small change, touches many forms).
- [ ] **B.** Not now.

Your answer: A: use the company's time zone for every default date.

---

## Fixed on this branch (no decision needed)

**Broken**

- Orders: the warehouse started on a placeholder, so an order for the first (or only) warehouse could not be saved. It now starts on the first real warehouse.
- Money and quantities: "1,500", "1,500.75" and Arabic digits ("١٥٠٠", "١٬٥٠٠٫٥") are read correctly (they became 0 before). Blank prices are refused with a message ("Type 0 if it is free") instead of saving a free order. Decimal quantities (2.5 kg) are accepted on orders and stock requests.
- Finance: Expenses and Payments no longer load forever when Sales or Purchasing is switched off.
- Journals: a half-typed currency no longer blanks the page (currency is now a list, and money formatting can never crash a screen).
- Server refusals: six database codes that showed "Something went wrong on our side" now have plain messages (for example "This expense has payments: void its payments first").
- Errors in Arabic: every server message has Arabic, and an offline network shows "Cannot reach the server…" instead of "Failed to fetch".
- Setup wizard: "Invitation sent" was false (nothing is emailed). It now shows the sign-in link to copy and send, like Settings → Users.
- Setup wizard: "Not now" lasted only for one browser tab; it now sticks on that device.

**Buttons people cannot use**

- Orders, invoices, suppliers, stock requests, cycle counts, receiving and cancelling now show only to people the server allows (they used to show to everyone except viewers, who were then refused after filling the form).
- Accounting setup, the chart of accounts and Treasury: admins who are not the head accountant now see them read-only instead of being refused after clicking.
- Getting started: workers no longer see the setup wizard or checklist steps that lead to "Page not found".
- A manager opening their own stock request sees why they cannot approve it instead of an Approve button that fails.

**Permanent actions now confirm first** (harmless ones were confirming while these did not): posting a journal, approving and posting a journal, issuing stock, cancelling a request, an order or a task, receiving a purchase order (with "for a short delivery, do not receive it here yet"), changing someone's role, setting the lock date.

**Dead ends**

- A sales order whose stock request was rejected now says so, links to the reason, and lets you request again (it silently went back to "New").
- A delivered sales order has "Create invoice", which opens the invoice form with that order chosen and every quantity filled with what is left to invoice.
- "Orders to invoice" no longer lists orders that are not delivered yet.
- The stock request number on a sales order is the real one (it was built from random id characters).
- Stock ledger: movements say "Transfer out", "Customer return" and so on instead of codes, and the reference column no longer says "opening stock" for everything.
- Phone confirmation: a wrong code shows as an error, not a green success.
- Manual journals open on all journals instead of only "Waiting for approval".
- Batch receipts list only items that track batches.

**Wording**

- AI: "The owner must accept the AI notice below first" (said to the owner, about a notice that was not below) is now "Accept the AI notice first" with a link that opens it. The cross-company "USD 100 across all companies" line is gone. The "Try it" box shows only when an AI provider is on, and its example no longer mentions cooking oil.
- Integrations: one word, "Test mode", instead of "simulated" and "Test mode"; the test-mode line shows only when the integration is on; the payment and shipping callback is a full address to copy; "Frankfurter" is gone; Telegram and email no longer tell you to save a webhook they do not have.
- Owner home and Profit: "COGS", "operating expenses", "supplier concentration" and "not statutory" are plain words. The supplier card is information, not a permanent red "Action required".
- Tour: "segregation of duties", "append-only", "same transaction" and "enforced by the database" are plain sentences.
- Help: the outdated "Arabic covers only menus…" and "WhatsApp is not connected" paragraphs are corrected; examples no longer assume a cosmetics business ("creams, oils", "Glycerin").
- Message outbox: kinds and statuses in words; the run button says "Send waiting messages now" with a plain result.
- Trial balance: "Tell the owner: this should never happen" is now "contact support and do not post until it is fixed".

All new and changed text has Arabic machine drafts in `apps/web/src/lib/i18nUxAudit.ts` and `apps/web/src/lib/i18nErrors.ts` for your review.

---

## Found, not fixed yet (larger; say the word for any of them)

- A record's History box searches only the company's latest 200 audit entries, so busy companies see "No history yet" on older records (needs a server filter by record).
- Customer statements with accounting off show a closing balance of 0.00.
- Outstanding amounts on payments ignore credit notes.
- Lists of payments and invoices have no search, date or customer filter; invoices show no paid/unpaid or due date.
- Long dropdowns (accounts, customers, items) have no search.
- A reversed journal still shows "Posted" and offers Reverse again.
- Accounting setup shows its "saved" and error notices at the top of a long page, off screen.
- Bell notifications for low stock and overdue invoices open nothing (they carry no link).
- "Switch organization" with one company bounces straight back; "Create a new company" cannot be reached.
- Trial balance lists every account, mostly zeros (no "hide zero" option).
- Treasury: a new cash box needs a made-up code and cannot be given a starting balance.
- Reorder levels are company-wide but compared against one warehouse, so a warehouse filter shows false "Low".
- Bosta shipments can be created before the stock is approved; the cash-on-delivery amount starts blank.
- Roles and words drift: Manager/Admin, Member/Staff, company/organization, app/module.
