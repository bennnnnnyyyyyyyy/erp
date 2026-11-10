# Click-through checklist: the whole app as owner and as staff (with your ticks)

Your original list, same order, **your ticks and notes kept**. Unticked lines are rewritten with the exact words on screen, checked
against the live app's code.

**How sure we are that each step is right:**
- 🟢 Confirmed in the code.
- 🟡 Confirmed, one detail to watch (written under the step).
- 🔴 Can't be done as written; the line says what to check instead.

**A** = you (owner), **B** = staff (member).
- B never sees Finance, Accounting, Treasury or Alerts.
- In Settings, B sees only My settings.

**Not live yet (don't look for it):** purchase order approval, Excel imports, Google Sheets links, delivery note numbers, "Late"
orders, Google Chat, tonight's walkthrough fixes.

## Before you start

- [x] 🟢 **Three test accounts:** owner A, staff B (member), owner C of a second company.
- [x] 🟢 Two browsers or one normal and one private window.
- [ ] 🟢 A phone, or Chrome F12 → phone icon, for the phone checks.
- [x] 🟢 A made-up bank statement: ready at `Desktop\ERP\test-bank-statement.csv` (Claude made it).
- [ ] 🟢 **Get ready for the steps below:**
  - a bank account and a cash box: **Treasury** → **Cash and banks** → **Add the default treasury accounts**;
  - a second warehouse (you have one).

Mark each line ✅ works, ❌ broken, or ⚠️ works but confusing.

## 1. Sign-up and set-up (owner A)

- [x] 🟢 Sign up with A's email; the sign-in link arrives and works.
- [x] 🟢 Set up your company: name, currency EGP, time zone Cairo, "What do you sell?"; the right apps are on.
- [x] 🟢 Settings → General: company details save; the language switch changes everything to Arabic and back.
- [x] 🟢 Settings → Branches: add one branch.
- [x] 🟢 Settings → Users: invite B as member; B signs in and lands in A's company.
- [x] 🟢 Settings → Apps: Accounting and Treasury on; Accounting → Accounting setup finished.
- [x] 🟢 My settings (A and B): change own name; change password.

## 2. Inventory (owner A unless stated)

- [x] 🟢 Inventory opens on the Overview; the four numbers and "Needs you today" make sense.
- [ ] 🟢 **Add an item with batches** (your note: "what do you mean"):
  1. Inventory → Stock on hand → **Add item**: SKU **FC-1**, Unit **piece**, Name **Face cream**, Opening stock **0**, Warehouse → **Add item**.
  2. Inventory → **Batches and expiry** → section **Batch tracking per item** → row FC-1 · Face cream → **Turn on**.
  3. Click the Face cream row in Stock on hand: the item page opens (tabs Stock by warehouse, Movements, Batches, Units, Cost, History).
  4. Edit its name with **Edit** in Stock on hand.
- [x] 🟢 Add a second warehouse.
- [ ] 🟢 **Reorder levels:**
  1. Inventory → **Reorder levels** → type **10** in an item's row → **Save**.
  2. The Overview tile **Low on stock** counts it when its available stock is 10 or less.
  3. **Stock forecast** lists every item.
- [x] 🟢 Approval policies: open it; the default rule makes sense.
- [x] 🟢 **As staff B:** New stock request for an item with no stock: refused with a clear message. (ui is shit why text give me a popup)
- [ ] 🟢 **Staff asks to take goods OUT, owner approves** (your note: "what?").
  - A stock request takes goods **out** of a warehouse; it never adds stock. On an empty item it's refused with "Not enough stock".
  - To **add** stock use **Receive goods** on a purchase order, **Receive a batch** (Batches and expiry), or **Opening stock** when adding an item.
  - So do this step on an item that already has stock (for example after "Receive part of an order" below).
  1. As B: Inventory → Stock requests → **New request**: warehouse, **Reason**, item, quantity **2** → **Submit for approval**.
  2. B's page says "Waiting for a manager to approve." with **no** Approve button.
  3. As A: open it → **Approve** → **Issue stock** → **Yes, issue**. Stock goes down by 2.
- [ ] 🟢 **Stock transfers** (your note: owner should be able to approve his own; that's built, not live yet):
  1. As B: Stock transfers → **New transfer**: From, To, item, quantity 1 → **Submit transfer**.
  2. As A: **Approve**.
  3. Then **Dispatch** → **Receive at destination**. One less in the first warehouse, one more in the second.
- [ ] 🟢 **Stock adjustments** (it's a one-item count, not a "loss" form):
  1. As B: **Stock adjustments** → **New cycle count**: item, warehouse, **Counted quantity** = the "System quantity" shown minus 1, **Reason** "broken" → **Submit count**.
  2. As A: **Approve** in that row. Stock goes down by 1.
- [ ] 🟢 **Stock counts:**
  1. As B: **Stock counts** → **Start a count** → warehouse → **Start the count**.
  2. Type a counted quantity for **every** item, one different from the books → **Submit for approval** → **Yes, submit**.
  3. As A: open it → **Approve** → **Yes, change the stock**.
  4. The Stock ledger shows a **Count adjustment** row.
- [x] 🟢 Settings → General: **blind counts** on; as B the expected quantity is hidden; as A it is shown. (why does it have its own setting, this should be an option amongst stuff)
- [ ] 🟢 **Batches and expiry:**
  1. Inventory → **Batches and expiry** → **Receive a batch**: item Face cream, warehouse, **Batch number** B-001, **Quantity** 20, **Expires on** about three months ahead, unit cost → **Receive batch**.
  2. B-001 shows under **All batches** and **Expiring in the next 90 days**.
  - Receiving a purchase order doesn't ask for a batch.
- [ ] 🟢 **Stock ledger** (under Records and rules): every movement above, with **Posted by** (who) and When.
- [ ] 🟢 **Phone:** Stock on hand shows one row per item and warehouse; the big buttons **Request**, **Receive**, **Count** work.

## 3. Buying (owner A; B can't create purchase orders)

- [x] 🟢 Suppliers: add one; edit its phone.
- [x] 🟢 New purchase order: 2 items from the supplier.
- [ ] 🟢 **Receive part of an order:**
  1. New purchase order for 10 → open it → **Receive goods** → change "Arrived now" to **4**.
  2. Choose **Yes, keep the order open for the rest** → **Receive into stock**.
  3. The list's Status says **Partly received**.
- [x] 🟢 Receive the rest: the order closes as received.
- [x] 🟢 Purchase invoice from the order: cannot bill more than arrived.
- [ ] 🟢 **Pay the supplier** (your note: show the unpaid bills; that's built, not live yet):
  1. Finance → **Payments** → **Record a payment**: Payment type **Payment to supplier or expense**, **For** = the purchase invoice, amount, Method **bank**, **Paid from** = the bank account → **Record payment**.
  2. Open the purchase invoice: its Payments section says **Paid in full**.

## 4. Selling

- [x] 🟢 Customers: add one; edit it.
- [x] 🟢 New sales order as B; approval by A; issue the goods; stock goes down.
- [x] 🟢 Sales invoice from the order; open it; the totals are right.
- [x] 🟢 Payments: record the customer's payment into the bank.
- [ ] 🔴 **Credit note:** there's **no credit-note screen** on the live app (only **Void invoice** and payments on the invoice). Just confirm you can't find one; it's a finding and the screen will be built. (your note: isn't this stupid, if I can get an online reference id this step would be unneeded)
- [ ] 🟢 **Statement of account:** Finance → **Statement of account** → For **Customer**, then **Supplier** → pick the party, **From** and **To** → **Show**. Lines and balance match.
- [x] 🟢 Online orders screen opens (empty is fine; Shopify is in test mode).

## 5. Money and accounting (owner A)

- [ ] 🟢 **Expense paid in cash:**
  1. Finance → **Expenses** → **Record an expense**: Date; Category (if none: **New category** → **Add category**); Amount **50**; **Note** "Office tea".
  2. Tick **Paid now** → **Paid from** = the cash box → **Record expense and payment**.
- [ ] 🟢 **Bank to cash:** Treasury → **Transfers** → **New transfer**: From bank, To cash box, **100** → **Record transfer**. Both balances change.
- [ ] 🟢 **Bank statements:**
  1. Treasury → **Bank statements** → bank account → **Import a statement** → `test-bank-statement.csv`.
  2. Debit shows as **Money out**, Credit as **Money in** → **Import**.
  3. **Confirm** a suggestion if one appears; on one line **Ignore…** → reason → **Ignore**.
  4. On BANK CHARGES: **Record what it was…** → **An expense paid from the bank** → **Bank charges (created if missing)** → **Record and match**.
  5. Rules (bottom of the Bank statements page): add "contains COMMISSION" → Bank charges; the COMMISSION line then offers **Record as the rule says**.
  6. Close the month when the difference is zero; reopen with a reason.
- [ ] 🔴 **As B: bank statements:** B can't see Treasury at all (there's no "look only" role). Check instead: B's app menu has no Treasury, Finance, Accounting or Alerts.
- [ ] 🟡 **Profit and loss** (Finance → **Profit and loss**) and **Trial balance** (Accounting → **Trial balance** → From, To, Currency → **Show** → "The books balance: debits equal credits.").
  - Watch: Profit and loss says "Nothing to show yet" until something is invoiced or an expense recorded.
- [ ] 🟢 **Journal:** Accounting → **Journal** → click a row; its **Total** row's debit equals credit.
- [ ] 🟢 **Manual journals:**
  1. **New manual journal**: Date, **Description**, two lines until **Balanced.** → **Save for approval**.
  2. Open it → **Change** → edit → **Post now** → **Yes, post**.
  - You can't "Approve and post" your own.
- [ ] 🟢 **Chart of accounts:** Accounting → **Chart of accounts** → open an account; its lines match the journal.
- [ ] 🟡 **Stock value:** Accounting → **Stock value** shows "In the books / At average cost / Difference".
  - Watch: compare "In the books" with the inventory line (likely 161, Goods for resale) in the Trial balance by eye.

## 6. Messages, tasks, alerts, settings

- [ ] 🟡 **Bell:** A gets a notice when B submits a stock request; **See all** → Messages → Notifications.
  - Watch: transfers, counts and adjustments may not send one. Note what you see.
- [ ] 🟡 **Tasks** (Tasks app): none exist until someone makes one.
  1. As A: **New task** (For = B) → **Assign task**.
  2. As B: **Done** on the row.
- [ ] 🟢 **Alert rules:** **Alerts** app → **Alert rules** → **Add a rule**: Trigger **Stock below reorder level**, **Every item**, Recipients **All owners** → **Add rule**; **Send test** works.
- [ ] 🟢 **Connect WhatsApp and Telegram** (Messages app): heading "Connect your WhatsApp", buttons **Send me a code** and **Connect Telegram**. Not set up yet; that's expected.
- [ ] 🟢 **Message outbox** (Messages app, A): opens; button **Send waiting messages now**.
- [ ] 🟡 **Settings → Integrations:** switched-on providers say "Test mode: nothing is really sent."; **Exchange rates** → the Central Bank of Egypt panel shows **SIMULATED**.
- [ ] 🟢 **Audit log** (Settings → Audit log): the approvals above, with who did them.
- [ ] 🟡 **Guide and tour:** Guide app → **Guide** opens; **Take the tour** (top right) starts it.
  - Watch: the tour does **not** start by itself on first sign-in. That's a bug we found, being fixed.

## 7. Safety checks

- [ ] 🟢 **Second company:** sign in as C. C sees none of A's items, customers, invoices or users.
- [ ] 🟢 **Staff limits:** as B, Settings shows only **My settings**; Inventory → **Approval policies** says "Only owners and admins can change approval policies."; Reorder levels is read-only.
- [ ] 🟡 **Signed out:** sign B out, paste a link from A's company. It shows the sign-in screen (exact wording unconfirmed).

## 8. Arabic and phone

- [ ] 🟢 **Arabic:** Settings → **My settings** → **My language** → Arabic.
  - Screens read right to left, no English left on the main screens, numbers and dates look right.
- [ ] 🟡 **Phone:** sign in, Overview, Stock on hand, a stock request, approve from the bell, record a payment.
  - Watch: layout can only be judged by eye; note anything cut off or hard to tap.

## When done

Save this file and tell Claude. Each ❌ and ⚠️ gets fixed and checked again.
