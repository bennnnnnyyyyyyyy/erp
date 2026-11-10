# Click-through checklist: the whole app as owner and as staff

**For:** Ben (or whoever runs it), on the live app. Written 10 November 2026 for the click-through of 11 November.
**Why:** every rule is tested automatically (database tests including a full business day, API and screen tests), but nobody has
clicked through the screens as owner and as staff. This list does that, in the order a new company would use the app.

## Before you start

- [ ] **Three test accounts:** owner A (new email), staff B (invited by A as *member*), and owner C of a *second* company (another
      new email). Use test emails, not real customers.
- [ ] Two browsers or one normal and one private window, so A and B are signed in at the same time.
- [ ] A phone (or the browser's phone view, F12 → device toolbar) for the phone checks.
- [ ] A small CSV or Excel bank statement you make up (date, description, amount, balance), 5–10 lines.
- [ ] Write down anything wrong with: screen, what you did, what you expected, what happened, a screenshot. Send the list to Claude.

Mark each line ✅ works, ❌ broken, or ⚠️ works but confusing.

## 1. Sign-up and set-up (owner A)

- [ ] Sign up with A's email; the sign-in link arrives and works.
- [ ] Set up your company: name, currency EGP, time zone Cairo, "What do you sell?" answered; the right apps are switched on.
- [ ] Settings → General: company details save; the language switch changes everything to Arabic and back.
- [ ] Settings → Branches: add one branch.
- [ ] Settings → Users: invite B as member; B gets the email, signs in, accepts, and lands in A's company.
- [ ] Settings → Apps: switch Accounting and Treasury on. Accounting → Accounting setup: finish it (opening date, chart of accounts).
- [ ] My settings (as A and as B): change own name; change password.

## 2. Inventory (owner A unless stated)

- [ ] Inventory opens on the Overview: four numbers and "Needs you today" make sense for an empty company.
- [ ] Add 3 items (one batch-tracked with expiry). Item page opens from Stock on hand; edit an item's name (English and Arabic).
- [ ] Add a second warehouse.
- [ ] Reorder levels: set one; Stock forecast shows the item.
- [ ] Approval policies: open it; the default rule makes sense.
- [ ] **As staff B:** New stock request for an item with no stock: refused with a clear message.
- [ ] (After §3 receiving) **As B:** request stock out → **as A:** approve it → stock goes down; B cannot approve own request.
- [ ] Stock transfers: A creates a transfer between warehouses; it needs approval by someone else; after approval both warehouses show it.
- [ ] Stock adjustments: A records a loss of 1 with a reason; approval rule applies.
- [ ] Stock counts: start a count for a warehouse, enter quantities (one different from the books), submit, approve as the other
      person; the difference becomes a stock move.
- [ ] Settings → General: switch **blind counts** on; **as B** start a count: the expected quantity is hidden; as A it is shown.
- [ ] Batches and expiry: the batch-tracked item shows its batch and expiry date.
- [ ] Stock ledger: every move above is listed, with who and when.
- [ ] **Phone:** Stock on hand shows one row per item and warehouse; the big buttons Request, Receive, Count work.

## 3. Buying (owner A, staff B where stated)

- [ ] Suppliers: add one; edit its phone.
- [ ] New purchase order: 2 items from the supplier.
- [ ] Receive **part** of it ("rest coming"): the order shows partly received; stock goes up.
- [ ] Receive the rest: the order closes as received.
- [ ] Purchase invoice from the order: cannot bill more than arrived.
- [ ] Payments: pay the supplier from the bank account (Cash and banks must have one; add it if not).

## 4. Selling

- [ ] Customers: add one; edit it.
- [ ] New sales order **as B**; approval by **A**; issue the goods; stock goes down.
- [ ] Sales invoice from the order; open it; the totals are right.
- [ ] Payments: record the customer's payment into the bank.
- [ ] Credit note on the invoice (needs approval by the other person); the customer's balance goes down.
- [ ] Statement of account for the customer and the supplier: lines and balances match what you did.
- [ ] Online orders screen opens (empty is fine; Shopify is in test mode).

## 5. Money and accounting (owner A)

- [ ] Expenses: record an expense paid in cash.
- [ ] Cash and banks → Transfers: move money from bank to cash.
- [ ] **Bank statements:** import your made-up CSV for the bank account; map the columns; preview; import. Confirm a suggested match;
      ignore a line with a reason; "Record what it was…" for one line (an expense); add a rule ("contains FEES" → Bank charges) and use
      "Record as the rule says"; close the month when the difference is zero; reopen with a reason.
- [ ] **As B:** Bank statements: B can look but not match or close (unless made head accountant).
- [ ] Profit and loss, Trial balance: debits = credits; the numbers follow from §3–§5.
- [ ] Journal: every document above has its entry; open one.
- [ ] Manual journals: draft, change, post one.
- [ ] Chart of accounts: open an account; its lines match.
- [ ] Stock value: equals the inventory account in the trial balance.

## 6. Messages, tasks, alerts, settings

- [ ] Notifications (the bell): approvals and tasks from above appear for the right person.
- [ ] Tasks: open one, finish it.
- [ ] Alert rules: create one with recipients.
- [ ] Connect WhatsApp and Telegram: opens; says test mode / not set up (expected, no accounts yet).
- [ ] Message outbox: shows the simulated messages.
- [ ] Settings → Integrations: every provider shows test mode; Exchange rates show the SIMULATED badge.
- [ ] Audit log: everything done above is there, including approvals and who did them.
- [ ] Guide and Tutorial open; the guided tour starts for B on first sign-in.

## 7. Safety checks

- [ ] **Second company:** sign in as C (own company). C sees **none** of A's items, customers, invoices, statements or users.
- [ ] **Staff limits:** as B, try Settings → Users, Apps, Accounting setup, Approval policies: B cannot change them.
- [ ] Sign out of B's browser; open a page link of A's company: it asks to sign in.

## 8. Arabic and phone

- [ ] Switch to Arabic: every screen above reads right to left; no English left on the main screens; numbers and dates look right.
- [ ] On a phone: sign in, Overview, Stock on hand, a stock request, approve from the bell, record a payment.

## When done

Send the ❌ and ⚠️ lines to Claude. Each broken item gets fixed and re-checked; the result goes in the worklog.
