# Teardown: Microsoft Dynamics 365 Supply Chain (purchasing and stock), plus MRP basics

**Slug:** `dynamics-365-scm`
**Sources:** two videos Ben transcribed (10 Nov 2026). The transcripts are kept locally next to this folder
(`documentation/research/VIDEO B.MD`, `video transcribe A .md`) and are not committed.
- **Video B:** a third-party functional training session on Dynamics 365 Finance and Operations, supply chain (trade and logistics):
  the purchase process shown live in Microsoft's sample company.
- **Video A:** a university lecture on MRP (material requirements planning) and ERP: bills of materials, gross and net requirements,
  lot sizing. Not about one product; included because it describes what a manufacturing customer will expect.
**Studied by:** Claude · **Date:** 2026-11-10
**Access used:** the transcripts only (no trial account).
**Status:** Parked: only the purchase process is covered; enough for the gap list below.

> Behaviour only, in our own words. Claims are marked **seen in video** (demonstrated on screen in the training) or **said in video**
> (stated by the trainer or lecturer, not shown). Nothing is copied.

## 1. Summary

Dynamics 365 Supply Chain is Microsoft's ERP for mid-size and large companies, sold through partner companies who configure it per
client (said in video). For purchasing, it walks an order through creation, an optional approval workflow, supplier confirmation,
product receipt and supplier invoice, each a separate step. MRP (video A) is the planning layer on top: from what must be sold or made,
it works out what to buy or make, when and how many.

## 2. The purchase process (video B)

| Step | What happens | Our ERP today |
|---|---|---|
| Create the order | Supplier, warehouse, items, quantities (seen in video) | ✅ Same |
| Approval workflow | Draft → in review → approved before it is sent (said in video; "covered in a later session") | ❌ Purchase orders need no approval |
| Confirmation | The order is confirmed, with the delivery date the supplier promised; the step is required (seen in video) | ❌ No confirmation step, no promised date |
| Product receipt | Goods received; the person types the supplier's delivery note number (said to be important, not required); on hand goes up at once (seen in video: 335 → 345) | ✅ Receipt, including part deliveries (9 Nov); ❌ no field for the supplier's delivery note number |
| Supplier invoice | Done by accounts payable from the order; updates what is owed to the supplier (said in video) | ✅ Supplier bills, capped by what arrived |
| Landed cost | Freight, customs and other charges added into the item cost (said in video, a separate certification topic) | ❌ Not built |
| Product master / released product | The same product defined once and "released" to each company (said in video) | Not needed: one company per tenant |
| Colour-coded messages | Blue = done, yellow = warning, red = error (said in video) | Similar (notice / error) |

## 3. MRP basics (video A), against what we have

| MRP idea | What it means | Our ERP today |
|---|---|---|
| Independent vs dependent demand | Finished goods are forecast; their parts follow from a bill of materials | Only finished goods (trading); no bills of materials |
| Bill of materials | The parts and quantities to make one unit | ❌ Not built (no manufacturing) |
| Net requirements | Needed − on hand − already ordered | ✅ The stock forecast's suggested order does this for traded goods (usage × lead time − available − on order) |
| Lead time | Time from ordering to receiving | ✅ Learned from past purchase orders (sql/029) |
| Lot sizing | Order exactly what is needed, a fixed quantity, or an economic order quantity | ❌ Suggested orders are exact; no minimum order or pack size per supplier |
| Work in process | Materials being turned into goods | ❌ No production |

## 4. What this suggests for us (for Ben to decide; recommendation first)

1. **Supplier's delivery note number on receipts.** One optional field on the receive form, shown on the receipt and searchable.
   It is what an accountant matches a bill against. Small. *Recommended next.*
2. **Landed cost.** Freight, customs and clearing added to the cost of what was received. Important in Egypt, where much stock is
   imported and customs is a large share of cost. Medium; touches average cost and accounting posting.
3. **Purchase order approval.** The same approval rules as stock requests (sql/011 policies) applied to purchase orders above an
   amount. Fits the product's approval rule. Medium.
4. **Supplier confirmation and promised date.** An optional "confirmed for <date>" on the order; feeds the forecast and an alert for
   late deliveries. Small to medium.
5. **Minimum order quantity and pack size per supplier and item.** Makes the forecast's suggested order realistic. Small.
6. **Manufacturing (bills of materials, production orders).** A new module, only with its own approved plan. The demo company is a
   cosmetics *factory*, so a real customer like it would need this. Large.
