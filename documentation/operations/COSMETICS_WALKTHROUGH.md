# Walkthrough: a day at "Demo Cosmetics Factory" (sample data)

**For:** presenting or learning the ERP through one invented Egyptian cosmetics manufacturer. **Length:** about 15 minutes. **Written:** 2 Nov 2026, from the live sample organization's data that day (read-only queries). Figures below are marked *as of 2 Nov*; the screen is always the truth, so **read numbers off the screen, not off this page**, and treat the facts in the story (which customer is late, which lot is expiring) as the guide to where to look.
**Not for:** a customer-facing claim of savings. Everything here is invented sample data.

## The cast (sign in as each; passwords are in your private `.temp` folder, never in this repo)
| Person | Role in the app | Plays |
|---|---|---|
| **Chris** | Owner | the factory owner: wants numbers and decisions, not menus |
| **Joseph** | Admin | purchasing manager: approves stock leaving, watches suppliers |
| **Grant** | Member | warehouse: asks for stock, hands it out |
Use two browsers (or one normal and one private window): **Chris or Joseph in one, Grant in the other.**

## The company in one paragraph
A factory in Egypt making shampoo, conditioner, lotions, hand cream, face wash, vitamin C serum, sunscreen, lip balm, shower gel, hair oil, night cream and clay masks. It buys 21 raw materials and 12 packaging items from 12 suppliers, keeps stock in five places (Raw materials, Packaging, Cold room, Finished goods, Quarantine), and sells to 10 customers: a pharmacy chain, supermarkets, beauty stores, an export buyer, an online shop, care centres. The data covers the 12 months up to now.

## Chapter 1: Chris opens the app (3 min)
**Click:** sign in as Chris, pick the cosmetics organization. You land on the home page.
**Say:** "The owner doesn't want 30 menus. He wants six answers."
**Walk the six cards, left to right** (each shows what it is and the period it covers):
1. **Profit and loss** Month by month. *As of 2 Nov: July to September were profitable; **October was a small loss** (sales about 1.13M EGP against about 592K cost of goods and 586K running costs). Use it:* "October is lower because the factory sold less sunscreen and winter items are not yet in season; the owner sees it the day it happens, not at year end." (The seasonal pattern is built into the sample; say "in this sample".)
2. **Receivables and payables.** What customers owe and what is late. *As of 2 Nov, the largest overdue balances: Maadi Care Centers (about 592K EGP overdue of 653K owed), Gulf Export Buyer (about 413K), Cairo Pharmacy Chain (about 291K), Nasr City Cosmetics (about 262K).*
3. **Pending approvals.** Stock requests that need a manager. *As of 2 Nov: 2 waiting, 2 approved and not yet handed out.*
4. **Inventory value and expiry.** Value on the shelf and what is about to expire.
5. **Top products.** *As of 2 Nov, last 90 days: sunscreen (about 1.05M EGP), vitamin C serum (about 738K), night cream (about 463K), shampoo (about 393K), hair oil (about 378K).*
6. **Supplier concentration.** *As of 2 Nov: one packaging supplier, Delta Plastics, is by far the largest spend (about 2.4M EGP in 12 months, then about 0.75M and 0.70M).* "If that supplier fails, bottles stop and so does the factory."
**Click:** open **Profit overview** (first card) for 20 seconds: sales vs costs by month.
**Notice:** every card has a title, a one-line meaning and a period. Say "overdue means unpaid after 30 days".

## Chapter 2: The warehouse asks, the manager approves (4 min)
**The point:** stock cannot leave without an approval, and nobody approves their own request.
1. **Grant** (warehouse): Inventory > Stock requests > **New request**. Choose *Finished goods*, one item (for example Lip balm), quantity **10**, reason "Sample for the pharmacy chain". Submit. *The 10 units are set aside (reserved) immediately; nothing has left.*
2. **Joseph or Chris:** open the same request. Click **Approve**.
3. **Self-approval test (the strongest moment):** as **Chris**, create a small request, then try to **approve your own**. It is refused ("You cannot approve your own request"). **Say:** "This is not a hidden button. The database itself refuses it."
4. **Grant:** open the approved request and click **Issue**. *Stock moves.* 
5. **Existing queue to use instead of making new ones:** *as of 2 Nov there are four open requests from the seed:* OUT-0340 (120 shampoo) and OUT-0342 (48 hair oil) **waiting for approval**; OUT-0341 (60 sunscreen) and OUT-0343 (72 conditioner) **approved and waiting to be issued**. Approve OUT-0340 as Joseph; issue OUT-0341 as Grant.
**Notice:** when sunscreen is issued, the system ships the batch that expires **first** (the near-expiry lot goes before newer stock). Show it in Chapter 3.

## Chapter 3: Expiry, forecast, alerts (3 min)
**Click:** Inventory > **Batches and expiry**.
**Say:** "In cosmetics, expired stock is money in the bin."
*As of 2 Nov the sample deliberately contains:* **lip balm** (300 units) expiring in about 15 days, **hand cream** (180) in about 39, **sunscreen** (120) in about 77, **vitamin C serum** (40) that **already expired** on 20 Oct, and **clay face mask** (60) in **quarantine**. Point out: the system never issues an expired or quarantined batch, and the owner home counts them in "Inventory value and expiry".
**Click:** Inventory > **Stock forecast**: "from the factory's own history it says how many days each item will last, and says 'thin data' when it isn't sure."
**Click:** **Alerts** > Rules and teams: "tell Purchasing when stock is low, tell Management when a batch is about to expire or a customer is more than 30 days late."

## Chapter 4: Moving stock between warehouses (2 min, optional)
**Click:** Inventory > **Stock transfers** > New transfer: move a small quantity of a finished product from Finished goods to another warehouse. Show it waits for approval, then **Dispatch** (it appears under "In transit now": stock that belongs to no warehouse, so nobody can sell it), then **Receive**. "Batches and expiry dates travel with the goods."

## Chapter 5: Proof, and the close (2 min)
**Click:** Settings > **Audit log**. Show the rows your demo just created. **Say:** "Every approval and every stock movement is written here in the same step as the change. Nobody can edit or delete it."
**Close:** "The owner sees profit and risks in ten seconds; the warehouse can't move stock without the right approval; and everything leaves a record. Next: approvals over WhatsApp and voice, and a pilot with one real company."
**Be clear what is planned, not built:** WhatsApp and voice approvals (not tested on a real phone), full Arabic screens, accounting and e-invoicing.

## Before you start (10 minutes)
- [ ] Sign in as Chris, Joseph and Grant once each; check the home page shows numbers (not zeros).
- [ ] Note the top card's actual October figure; if it reads a loss, decide how you will talk about it (Chapter 1 has wording).
- [ ] Use small quantities. Demo actions add real rows to the sample organization (they are not undone by reloading, unlike the standalone demo site).
- [ ] Keep https://erp-demo-bas.pages.dev open in a spare tab as a no-sign-in fallback; it has stock requests, approvals, transfers and the audit log, not the owner home.
- [ ] If something errors, don't debug live: say "let me show that on the sample build" and switch tabs.

## What to adapt next (if this becomes an in-app guided tour)
The Guide page already lists the five-step path. A guided tour could highlight each of these chapters on the real screens with the sample data. Not built yet.
