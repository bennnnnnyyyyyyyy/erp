# Walkthrough, part 2 (checked against the live app's code)

Every step below was checked against the code that is live now. The labels in **bold** are the exact words on screen.
Steps are grouped by how sure we are that the step is right:

- **Group 1:** confirmed in the code. Do these first.
- **Group 2:** confirmed, but one detail is worth watching (written under the step).
- **Group 3:** the app can't do what the old checklist asked. Each says what to check instead.

**A** = you (owner). **B** = your staff account (member). Use two browser windows.
Mark each step ✅ works, ❌ broken, or ⚠️ works but confusing, plus a few words.

**Who sees what (confirmed):**
- B never sees the **Finance**, **Accounting**, **Treasury** or **Alerts** apps.
- In **Settings**, B sees only **My settings**.
- B can't create purchase orders.

**Not live yet, don't look for it:** purchase order approval, imports from Excel, Google Sheets links, delivery note numbers, "Late"
orders, Google Chat, and tonight's walkthrough fixes.

---

## 0. Get ready (A, about 5 minutes)

1. [ ] **Two warehouses:** Inventory → Stock on hand → **Add warehouse** (Short code, Name). You need two.
2. [ ] **A supplier:** Purchasing → Suppliers → **Add supplier**.
3. [ ] **A bank account and a cash box:**
   1. **Treasury** → **Cash and banks** → **Add the default treasury accounts**.
   2. Or use **Add a cash box or bank account** with Kind "Bank account", then again for a cash box.
   3. Treasury needs Accounting switched on.

---

## Group 1: confirmed in the code

**Stock**

1. [ ] **Add an item, then switch on batches.**
   1. As A: Inventory → Stock on hand → **Add item**. Fields: SKU **FC-1**, Unit **piece**, Name **Face cream**, Opening stock **0**, Warehouse. Click **Add item**.
   2. Inventory → **Batches and expiry** (under Planning) → section **Batch tracking per item** → row **FC-1 · Face cream** → **Turn on**.
   3. Check: the message "FC-1: batch tracking on." appears and the Tracking column says On.
   4. Click the Face cream row in Stock on hand. The item page opens with the tabs **Stock by warehouse, Movements, Batches, Units, Cost, History**.

2. [ ] **Receive a batch with an expiry date.**
   1. Inventory → **Batches and expiry** → **Receive a batch**. Fields: Item Face cream, Warehouse, **Batch number** B-001, **Quantity** 20, **Expires on** about three months ahead, Unit cost (needed when accounting is on).
   2. Click **Receive batch**.
   3. Check: B-001 appears under **All batches** and **Expiring in the next 90 days**.

3. [ ] **Receive part of a purchase order** (A only).
   1. Purchasing → Purchase orders → **New purchase order**: Supplier, Warehouse, item Face cream, Quantity **10**, Unit cost (type 0 if free) → **Place order**.
   2. Open the order → **Receive goods**. "Arrived now" is filled with 10: change it to **4**.
   3. Choose **Yes, keep the order open for the rest** → **Receive into stock**.
   4. Check: the message "Received what arrived. The order stays open for the rest." In the Purchase orders list, Status says **Partly received**.
   - These 4 go into a lot called "UNBATCHED" (no expiry), because receiving an order doesn't ask for a batch.

4. [ ] **Staff asks for goods; the owner approves.**
   1. As B: Inventory → Stock requests → **New request**: Issue from warehouse, **Reason**, Item, Quantity **2** → **Submit for approval**.
   2. As B: open it. Check it says "Waiting for a manager to approve." and there is **no** Approve button.
   3. As A: open the request → **Approve** → **Issue stock** → **Yes, issue**.
   4. Check: stock went down by 2.
   - After approval B can also press Issue stock.

5. [ ] **Move stock between warehouses.**
   1. As B: Inventory → Stock transfers → **New transfer**: From warehouse, To warehouse, Item, Quantity 1 → **Submit transfer**.
   2. As A: open it → **Approve**.
   3. Then (A or B) **Dispatch**, then **Receive at destination**.
   4. Check: one less in the first warehouse, one more in the second.

6. [ ] **Correct a quantity (a loss of 1).** This screen is a one-item count, not a "loss" form.
   1. As B: Inventory → **Stock adjustments** (under Counting) → **New cycle count**: Item, Warehouse, **Counted quantity** = the "System quantity" shown minus 1, **Reason** "broken" → **Submit count**.
   2. As A: in that row press **Approve**.
   3. Check: stock went down by 1.

7. [ ] **Count a warehouse.**
   1. As B: Inventory → **Stock counts** → **Start a count** → pick a warehouse → **Start the count**.
   2. Type a counted quantity for **every** item; make one different from the books. **Submit for approval** only works once every item is counted → **Yes, submit**.
   3. As A: open it → **Approve** → **Yes, change the stock**.
   4. Check: the Stock ledger shows a **Count adjustment** row.

8. [ ] **Reorder level and forecast.**
   1. As A: Inventory → **Reorder levels** → type **10** in Face cream's row → **Save**. B sees this page read-only.
   2. Check: the Overview tile **Low on stock** counts Face cream when its available stock is 10 or less.
   3. Inventory → **Stock forecast** lists every item; Face cream shows "no usage in 90 days".

9. [ ] **Stock ledger:** Inventory → **Stock ledger** (under Records and rules). Check: every movement above, with When, Item,
   Warehouse, Type, Quantity, Reference and **Posted by**.

**Money (A only)**

10. [ ] **Record the supplier's bill, then pay it.**
    1. Purchasing → **Purchase invoices** → **Record an invoice**: pick the received order from step 3, Supplier's invoice number, Invoice date, quantity (up to the 4 received).
    2. Finance → **Payments** → **Record a payment** (or open the invoice → **Record a payment →**). Fields: Payment type **Payment to supplier or expense**; **For** = that purchase invoice; Amount; Date; Method **bank**; **Paid from** = the bank account → **Record payment**.
    3. Check: open the purchase invoice; the Payments section says **Paid in full** (or "paid · outstanding" if you paid part).

11. [ ] **Statement of account:** Finance → **Statement of account** → For **Customer** (then **Supplier**) → pick the party, **From** and
    **To** dates → **Show**. Check: lines and balance match what you did.

12. [ ] **Expense paid in cash.**
    1. Finance → **Expenses** → **Record an expense**: Date; Category (if none, type a **New category** → **Add category**); Amount **50**; **Note** "Office tea" (there's no name field).
    2. Tick **Paid now** → **Paid from** = the cash box → **Record expense and payment**.
    3. Check: it shows in the list.

13. [ ] **Bank to cash:** Treasury → **Transfers** → **New transfer**: From the bank account, To the cash box, Amount **100** → **Record
    transfer**. Check: both balances change in Cash and banks.

14. [ ] **Bank statement.**
    1. Treasury → **Bank statements** → pick the Bank account → **Import a statement** → choose `Desktop\ERP\test-bank-statement.csv`.
    2. Check the columns are matched: Debit shows as **Money out**, Credit as **Money in**, plus Balance. Check the date format → **Import**.
    3. On the statement page:
       - **Confirm** a suggestion if one appears;
       - on one line, **Ignore…** → "Why ignore it?" → **Ignore**;
       - on the BANK CHARGES line, **Record what it was…** → **An expense paid from the bank** → Expense category **Bank charges (created if missing)** → **Record and match**.
    4. Check: the open, matched and ignored counts change.

**Accounting (A only)**

15. [ ] **Trial balance:** Accounting → **Trial balance** → From, To, Currency → **Show**. Check: "The books balance: debits equal credits."
16. [ ] **Journal:** Accounting → **Journal** → click a row. Check: the **Total** row's debit and credit are equal.
17. [ ] **Manual journal.**
    1. Accounting → **Manual journals** → **New manual journal**: Date, **Description**, two lines (Account, Debit or Credit) until it says **Balanced.** → **Save for approval**.
    2. Open it → **Change** → edit → then **Post now** → **Yes, post**.
    - You can't approve your own draft with "Approve and post"; **Post now** is the owner's way.

**Messages, alerts, settings**

18. [ ] **Alert rule** (A): **Alerts** app → **Alert rules** → **Add a rule**: Name, Trigger **Stock below reorder level**, For **Every item**,
    Recipients **All owners** → **Add rule**. Check: it's in the list; **Send test** works.
19. [ ] **Phone link page** (A and B): **Messages** app → **Connect WhatsApp and Telegram**. Check: heading "Connect your WhatsApp",
    buttons **Send me a code** and **Connect Telegram**. Not set up yet; that's expected.
20. [ ] **Outbox** (A): Messages → **Message outbox** opens (button **Send waiting messages now**).
21. [ ] **Audit log** (A): Settings → **Audit log**. Check: the approvals above are there with who did them.
22. [ ] **Staff limits** (B): Settings shows only **My settings**. Inventory → **Approval policies** opens but says "Only owners and admins
    can change approval policies." Reorder levels is read-only too.
23. [ ] **Arabic:** Settings → **My settings** → **My language** → Arabic.
    - Check: screens read right to left, no English left on the main screens, numbers and dates look right.
    - Then switch back.

---

## Group 2: confirmed, one detail to watch

24. [ ] **Profit and loss:** Finance → **Profit and loss**. It says "Nothing to show yet" until something is invoiced or an expense recorded.
25. [ ] **Stock value:** Accounting → **Stock value** shows "In the books / At average cost / Difference".
    - Watch: compare "In the books" with the inventory line of the Trial balance by eye.
    - We couldn't confirm which account code that line has (likely 161, "Goods for resale").
26. [ ] **Bell:** the bell (top bar) shows A a notice when B submits a stock request; **See all** opens Messages → Notifications. Inventory →
    Overview **Needs you today** also lists pending approvals.
    - Watch: whether transfers, counts and adjustments also send a notice is unconfirmed. Note what you see.
27. [ ] **Tasks** (Tasks app): there are none until someone makes one.
    1. As A: **New task** (Task, For = B, Due, Details) → **Assign task**.
    2. As B: **Done** on the row (or open it → **Complete**).
28. [ ] **Integrations:** Settings → **Integrations**. Each switched-on provider says "Test mode: nothing is really sent." Click **Exchange
    rates**: the Central Bank of Egypt panel shows **SIMULATED**.
29. [ ] **Tour:** Guide app → **Guide** opens. **Take the tour** (top right of Guide or Home) starts it.
    - Watch: the tour does **not** start by itself on first sign-in. That's a bug we found; it's being fixed.
    - B may see a language picker first.
30. [ ] **Signed out:** sign B out, paste a link from A's company. It should show the sign-in screen (exact wording unconfirmed).

---

## Group 3: the old step was wrong; check this instead

31. [ ] **Credit notes have no screen on the live app.** The sales invoice page only offers **Void invoice** and payments.
    - Just confirm you can't find a credit-note button.
    - This is a finding: the screen will be added.
32. [ ] **B and bank statements:** B can't see Treasury at all (there's no "look but not change" role). Check: B's app menu has no
    Treasury, Finance, Accounting or Alerts.
33. [ ] **Another company:** sign up a new email as company C. Check: C has no items, orders, invoices or users from A. (The database
    separation is tested automatically; this is the on-screen check.)
34. [ ] **Phone layout:** open the app on a phone (or Chrome F12 → phone icon): Overview, Stock on hand, a stock request, approve from
    the bell, record a payment. Note anything cut off or hard to tap.

---

When done, save this file and tell Claude. Each ❌ and ⚠️ gets fixed and checked again.
