# Demo script: how the ERP helps a company make money (written 2 Nov 2026, updated 3 Nov 2026, for a first-time demo)

Read sections 1 to 3 first (10 minutes). Section 4 is your cheat sheet during the call. Section 6 is the ETA.

---

## 1. The one-sentence story

> "This ERP helps a company that holds stock **see whether it is making money, stop losing stock, and make sure nothing leaves the warehouse without a manager's approval.** Every approval and every stock movement is written to a log nobody can edit."

Three ideas to repeat all demo long: **1. know your numbers, 2. stop stock being lost or wasted, 3. every important action needs the right person's approval, and leaves a record.**

## 2. The company in the demo (fictional)

"Demo Cosmetics Factory", an invented Egyptian cosmetics manufacturer. In the database: 45 items (21 raw materials, 12 packaging, 12 finished products like shampoo, serum, sunscreen), 12 suppliers, 10 customers (pharmacy chain, supermarkets, an export buyer, an online shop), and **12 months of history**, so the numbers on screen are not empty. All names are made up and marked "(sample)". Currency is EGP. **The company is now named "Demo Cosmetics Factory" on screen: the "(sample data)" label was removed on 3 Nov. Say out loud that the data is invented sample data, or restore the label before the call.**

**How it makes money for a company like this** (say it in this order):

| Money lever | What the app does | Where you show it |
|---|---|---|
| **Know if you are profitable** | Owner home page answers "Am I making or losing money?" with revenue minus cost of goods minus expenses, by month | Home, first card |
| **Never run out of a best-seller** | Forecast says how many days of stock are left per item, from the company's own sales history | Inventory > Stock forecast |
| **Stop throwing away expired stock** | Batches with expiry dates; oldest-expiry goes out first; expiring stock is flagged; bad batches can be quarantined | Inventory > Batches and expiry |
| **Stop stock walking out the door** | Stock can only leave through a request a *different* manager approves. The database itself refuses otherwise | Inventory > Stock requests |
| **Get paid faster** | Customer invoices, payments, and "who owes me" with overdue alerts | Sales > Customer invoices, Finance |
| **Pay only for what you received** | Supplier invoices are matched against goods received | Purchasing > Supplier invoices |
| **Know who to blame, and who to trust** | Audit log: who did what, when, can't be edited or deleted | Settings > Audit log |

**Careful with money claims.** You have no customer results yet. Say "this helps find and prevent..." not "this saves X%". If asked for a number, say: "I'll measure it in the pilot; here is how we'd measure it" (section 5).

## 3. The 12-minute walk-through (click order)

Use the **cosmetics demo organization**, signed in as the **owner** (Chris). Have a second window signed in as a **member** (Grant) for step 5. Keep the browser zoomed to 110 percent so the room can read it.

1. **Home (1 min).** "This is what the owner sees in ten seconds." Point at the cards in order: *Am I making or losing money?*, *Money coming in and going out*, *Waiting for your decision*, *Stock and expiry*, *Best sellers, last 90 days*, *Who you depend on*. Read one real number off the screen, e.g. this month's profit. Say: "A factory owner doesn't want 30 menus; he wants these six answers."
2. **Stock forecast (1 min).** Inventory > Stock forecast. "It predicts which item runs out and when, from the factory's own history. It says 'thin data' when it isn't sure, rather than guessing."
3. **Batches and expiry (1 min).** Inventory > Batches and expiry. "In cosmetics, stock that expires is money in the bin. The oldest batch always goes first, and a suspicious batch can be quarantined so it can never be shipped."
4. **Stock on hand and reorder levels (1 min).** Inventory > Stock on hand. "Live stock per warehouse."
5. **The main event: approval (3 min).** In the member's window (Grant): Inventory > Stock requests > New request, ask for a small quantity (for example 5 of one item), submit. **In New request, choose the "Finished goods" warehouse** (the list defaults to the Cold room). Then in the owner's window: open that request.
   - Show **Approve**. Say: "The warehouse can't issue this stock until a manager approves. And the person who asked can't approve their own request."
   - Then try approving **your own** request (as Chris, request something, then approve it): it is refused. "This isn't just a hidden button. The database refuses it, so nobody can bypass it, even by hacking around the screen."
   - Approve the member's request as the owner, then issue it.
6. **Transfers (2 min).** Inventory > Stock transfers > New transfer: move a few units between two warehouses. Show it needs approval, then dispatch (it shows under "In transit now": stock that belongs to no warehouse), then receive. "Batches and expiry dates travel with the goods."
7. **Audit log (1 min).** Settings > Audit log. Show the rows your demo just created. "Every approval and every stock movement is recorded in the same step. Nobody can edit or delete these."
8. **Money side (1 min).** Sales > Customer invoices, then Finance > Profit overview. "Invoices, payments, expenses. This is where the profit number on the home page comes from."
9. **Alerts (1 min, optional).** Alerts > Rules and teams. "The right person is told when stock is low, a batch is about to expire, or a customer is late paying."
10. **Getting started tutorial and tour (optional, only if checked live).** These are **not** in the cosmetics company: the tutorial and the guided tour are switched on only in the empty company "Test Organization" (the tour is a per-company switch in Settings > General). Show them only if you have signed in there and checked, after the latest push, that the language prompt, the tutorial and "Take the tour" work. Say: "A new customer starts with an empty company and is walked through it, in English or Arabic."

**Close (30 seconds):** "In one place the owner sees profit, risks and decisions, and the warehouse can't move stock without the right approval. The next step is a pilot with one real company to measure the savings."

## 4. Cheat sheet during the call

**Do not claim, do not click:**
- **WhatsApp approvals.** Built but never tested on a real phone. Don't open "Connect WhatsApp". If asked: "WhatsApp approval is designed in and next on the list once we have the company's WhatsApp Business account."
- **Voice AI.** Not built; it is a plan.
- **Arabic.** The menus, the Getting started tutorial and the Guide are Arabic (machine draft, awaiting a native reviewer); the app screens are English. (The Arabic home page and the one-time language prompt exist only once the latest build is pushed: check before you promise them.) Say "Arabic and right-to-left layout are in progress, screen by screen".
- **Accounting and tax.** It is a management view of profit, not a full accounting ledger or VAT return.
- **Egypt e-invoicing (ETA).** Not live. The document builder and credit/debit notes with approval are built and tested locally; **nothing has been sent to the tax authority**, and the module is off in every company. Say "in progress, not live".
- **Manufacturing.** No bill of materials or production orders yet, so profit for a factory is approximate.
- **Not a live product yet.** It's a demo environment with sample data; say "pilot-ready", not "finished".

**Likely questions and honest answers:**
- *"Why not just use Odoo or Daftra?"* "They are broader, and we looked hands-on at Odoo. In our trial, an admin could validate a delivery and apply a count in one click, with no approval by default. (Those tests were done as an admin, and on Odoo Enterprise an admin can add an approval with Studio.) We are built around control and approvals, enforced in the database, for companies that hold stock."
- *"How is the data kept separate between companies?"* "Every company's data is isolated in the database, and we test that another company cannot see it."
- *"What does it cost / how do we charge?"* "Not decided. Odoo's own price is roughly US$9 to 16 per user per month by one source and higher by others, and we haven't confirmed Egypt's price. We'd decide pricing after the pilot."
- *"Can it connect to our systems / import our items?"* "CSV import with a preview is the next feature we plan."
- *"When can a real company use it?"* See section 6.
- *"What if you don't know the answer?"* "Good question. I'll confirm and send you the answer today." Then write it down.

**If something breaks:** don't debug on the call. Say "let me show that on the sample version" and open **https://erp-demo-bas.pages.dev** (no sign-in, sample data, resets when you reload). Keep that tab open beforehand as your safety net.

## 5. How to talk about "making money" without inventing numbers

Use this illustration, clearly labelled as an example, not a result:

> "Example, not a measured result: if a factory holds 10 million EGP of stock and loses 1 percent a year to expiry, mistakes or theft, that is 100,000 EGP a year. Approvals, expiry flags and a forecast target exactly those losses. In a pilot we'd count what is lost today and what is lost after, and show the difference."

Pilot measures: stock lost to expiry (EGP), number of stock-outs, days to collect customer payments, number of stock movements without approval (should be zero).

## 6. The ETA (they asked for one within the hour)

I don't know exactly what the ETA is *for*, so ask Joseph one question first: **"Do you mean an ETA for a pilot with a real company, or for the full product?"** If you can't ask, answer for a pilot.

**What is done today:** inventory with approvals, adjustments, transfers between warehouses (database-tested, deployed), batches and expiry, forecast, purchasing and supplier invoices, sales and customer invoices, payments and expenses, owner home page, alerts, audit log, sign-up, people and roles. The Odoo comparison is finished.

**What a customer would still need, and what it depends on:**

| Item | My rough estimate (add 30 to 50 percent buffer) | Depends on |
|---|---|---|
| CSV import with preview (to load a customer's items) | days to a week | nothing external |
| Returns and credit notes; categories and units | 1 to 2 weeks | nothing external |
| Arabic on every screen | 1 to 3 weeks | someone chosen to review the Arabic text |
| WhatsApp approvals on a real phone | 1 to 3 weeks | the company's Meta/WhatsApp Business account approval, which is outside our control |
| Egypt e-invoicing | document builder and credit/debit notes are built and tested locally, nothing sent to ETA, module off; the rest is its own project, longer | Tax Authority PreProd access, a signing option (USB token or similar), a decision on credential storage, screens |
| Manufacturing (bill of materials) | later project | a management decision |

**A safe way to say it:** "The core is working and demonstrable today. A pilot-ready version for one company is about [X] weeks from when we agree the scope, mainly import, returns and Arabic. WhatsApp approvals and e-invoicing depend on outside approvals, so I'll give dates for those once the accounts are in place." Fill in X yourself after you decide how much you want to commit. **Don't give one single date for everything.** Give a pilot date plus clearly named dependencies. These are estimates written by an AI assistant from how fast this project has moved; you know the team's real capacity better, so adjust.

## 7. Before the call (30 minutes)

- [ ] Check the latest push really deployed (GitHub Actions "CI and Cloudflare deploy" is green for the newest commit). Then sign in once as each demo user and **choose a language yourself**, so the one-time language prompt does not appear in front of the audience.
- [ ] Sign in to the cosmetics organization as owner in one window and as a member in another. Check the home page shows numbers.
- [ ] Open the demo site https://erp-demo-bas.pages.dev in a third tab as the safety net.
- [ ] Do the whole walk-through once, quietly, with small quantities. Demo actions create real rows in the demo company; that's fine, but practise so nothing surprises you.
- [ ] Close notification pop-ups and personal tabs; share only the one browser window.
- [ ] Write the three ideas from section 1 on a sticky note.
- [ ] Have the Odoo review open (documentation/research/odoo/ODOO_REVIEW.md) in case they ask about competitors.
