# Walkthrough, part 2: what is left

You did part 1 (sign-up, settings, warehouses, suppliers, buying, selling). This list is only what is left, in plain steps.

**Before you start**

- You test the app **as it is live now**. Tonight's work (purchase order approval, imports from Excel, Google Sheets links, delivery
  note numbers, "Late" orders, Google Chat, the walkthrough fixes) is **not live yet**, so don't look for it.
- **Already known, no need to report again:**
  - pop-up boxes cut off (fixed);
  - Payment terms box inside the supplier list;
  - empty Arabic name column on Stock on hand;
  - "0.000" quantities and the stock message;
  - time zone and currency typed by hand;
  - setup asking twice;
  - warehouse can't be edited;
  - Settings menu order;
  - errors shown as text;
  - few columns on items and suppliers;
  - accounting setup wording;
  - inventory menu confusing (being rebuilt).
- Use **A** = you (owner) and **B** = your staff account, in two browser windows.
- For each line write ✅ works, ❌ broken, or ⚠️ works but confusing, plus a few words. That's all I need.
- The made-up bank statement is ready: `Desktop\ERP\test-bank-statement.csv`.

---

## 1. Stock (Inventory app)

1. [ ] **Add an item that has an expiry date.**
   1. As A: Inventory → Stock on hand → Add item. Name "Face cream", SKU "FC-1", unit piece, no opening stock. Save.
   2. Open the item (click its row) → switch on "Track batches" (it may be called batch tracking). (where i can find that, i didnt even add an expiry date)
   3. Check: the item page opens and shows the batch setting on.

2. [ ] **Give that item stock with a batch and expiry.**
   1. Purchasing → New purchase order for Face cream, 20 pieces.
   2. Open the order → Receive goods → enter a batch number "B-001" and an expiry date three months ahead, if asked.
   3. Check: Inventory → Batches and expiry shows B-001 with its date.

3. [ ] **Receive part of an order.**
   1. Make a new purchase order for 10 of any item → Receive goods → type 4 → choose "Yes, the rest is still coming".
   2. Check: the order says "Partly received" and Stock on hand went up by 4.

4. [ ] **Staff asks for goods; the owner approves.**
   1. As B: Inventory → Stock requests → New request, 2 pieces of an item that has stock.
   2. As B: open it. There should be **no** Approve button for B.
   3. As A: open the bell or Stock requests → open B's request → Approve → Issue.
   4. Check: stock went down by 2.

5. [ ] **Move stock between warehouses.**
   1. As B: Stock transfers → New transfer, 1 piece from warehouse 1 to warehouse 2.
   2. As A: approve it; then dispatch and receive it as the screens ask.
   3. Check: one less in warehouse 1, one more in warehouse 2.
   - (Owners approving their own transfers is built, not live yet.)

6. [ ] **Correct a quantity.**
   1. As B: Stock adjustments → record a loss of 1 piece with a reason ("broken").
   2. As A: approve it.
   3. Check: stock went down by 1.

7. [ ] **Count a warehouse.**
   1. As B: Stock counts → Start a count for warehouse 1 → type a counted number for each item, **one of them different** from the books → Submit.
   2. As A: open it → Approve.
   3. Check: the difference became a stock change.

8. [ ] **Reorder level and forecast.**
   1. Reorder levels → set 10 for one item.
   2. Check: Overview "Low on stock" counts it if it has fewer than 10. Stock forecast lists the item.

9. [ ] **Stock ledger:** Inventory → Stock ledger. Check: every movement above is listed, with who did it and when.

## 2. Money

10. [ ] **Pay a supplier.**
    1. Cash and banks must have a bank account; add one if not.
    2. Payments → pay a supplier you billed, from the bank account.
    3. Check: Purchases → that bill shows paid. (Picking from a list of unpaid bills is coming; type it for now.)
11. [ ] **Credit note.**
    1. As B: open a sales invoice → Credit note for 1 item.
    2. As A: approve it.
    3. Check: the customer owes less.
12. [ ] **Statement of account:** Finance → Statement of account → pick the customer, then the supplier. Check: lines and balances match what you did.
13. [ ] **Expense:** Expenses → record "Office tea", 50, paid in cash. Check: it shows in the list.
14. [ ] **Cash and bank transfer:** Cash and banks → Transfers → move 100 from bank to cash. Check: both balances change.
15. [ ] **Bank statement** (Treasury → Bank statements):
    1. Choose the bank account → Import → pick `test-bank-statement.csv` → check the columns are matched → Import.
    2. On the statement:
       - Confirm a suggested match if one appears.
       - Ignore one line with a reason.
       - For the "BANK CHARGES" line press "Record what it was…" (if you see it) → expense.
    3. Check: the line counts change (open, matched, ignored).
16. [ ] **As B:** Bank statements. Check: B can look but cannot confirm, ignore or close.

## 3. Accounting reports (Accounting app)

17. [ ] **Trial balance:** the two total columns are equal.
18. [ ] **Profit and loss** (Finance → Profit and loss): sales, costs and the expense above appear.
19. [ ] **Journal:** open any entry, for example the expense; it shows two sides that are equal.
20. [ ] **Manual journal:** New manual journal → two lines that balance → save as draft → change it → post.
21. [ ] **Stock value:** the total equals the "Goods for resale" (inventory) line in the trial balance.

## 4. Messages, tasks, alerts, settings

22. [ ] **Bell:** as A, the approvals you were asked for appear; as B, B's own notices appear.
23. [ ] **Tasks:** open one (if any) and mark it done.
24. [ ] **Alert rules:** Alerts → Add a rule: "Stock below reorder level", every item, recipients "All owners". Check: it appears in the list.
25. [ ] **Connect WhatsApp and Telegram:** it opens and says it's not set up (expected).
26. [ ] **Message outbox:** opens (it may be empty or show test messages).
27. [ ] **Settings → Integrations:** every provider says test mode; Exchange rates show "SIMULATED".
28. [ ] **Audit log:** your approvals above are there, with who did them.
29. [ ] **Guide and tour:** Guide opens. Sign in as B in a fresh private window: the tour starts.

## 5. Safety checks

30. [ ] **Another company sees nothing.**
    1. Sign up a third email as a new company (C).
    2. Check: C sees none of A's items, customers, invoices or users.
31. [ ] **Staff limits:** as B, open Settings → Users, Apps, and Inventory → Approval policies. Check: B cannot change them.
32. [ ] **Signed out:** sign B out, then paste a link from A's company. Check: it asks to sign in.

## 6. Arabic and phone

33. [ ] **Arabic:** switch to Arabic. Check:
    - screens read right to left;
    - no English left on the main screens;
    - numbers and dates look right.
34. [ ] **Phone** (or Chrome F12 → phone icon): sign in, Overview, Stock on hand, make a stock request, approve from the bell, record a payment.

---

When done, put this file back in `Desktop\ERP` and tell Claude. Each ❌ and ⚠️ gets fixed and checked again.
