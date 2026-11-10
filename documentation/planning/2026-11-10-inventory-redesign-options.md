# Inventory screens: redesign options

**Status:** for Ben to choose (10 November 2026). Nothing is built. Earlier choices this builds on (9 Nov): lists are tables that open a
full page; the big apps get an overview page; Inventory first.

Tick one option per question, or write your own on the `Your answer:` line. Each question has a recommendation (first option).

## What is wrong today

1. **There is no page for an item.** What the app knows about one item is spread over six screens: Stock on hand (quantities), Reorder
   levels, Stock forecast, Batches and expiry, item units (inside a dialog), and the Stock ledger (its movements, mixed with every
   other item). Clicking an item goes nowhere.
2. **The menu has 11 entries in one flat list**: Stock on hand, Reorder levels, Stock forecast, Batches and expiry, Approval policies,
   Stock adjustments, Stock counts, Stock transfers, Stock requests, Stock ledger, plus the hidden pages. A warehouse clerk needs three
   of them; the rest are for the manager.
3. **No overview.** Inventory opens straight on the stock table. The four numbers above it (items, low on stock, reserved, waiting for
   approval) are the start of an overview, but nothing says what to do next.

## Q1. The item page

**A. One page per item, with tabs (recommended).** Clicking an item anywhere (stock list, request, order, ledger) opens it.

```
← Stock on hand
BOX-50  Boxes 50 cm  ·  صناديق ٥٠ سم                    [Edit] [Request stock] [Count]
──────────────────────────────────────────────────────────────────────────────────
 On hand 69   Reserved 10   Available 59   Reorder at 20   Runs out ~ 12 Dec   Avg cost 20.00
──────────────────────────────────────────────────────────────────────────────────
[Stock by warehouse] [Movements] [Batches] [Units] [Cost] [History]
 Warehouse        On hand   Reserved   Available
 MAIN               60         10          50
 Branch Giza         9          0           9
```

**B. A side panel from the stock list.** The list stays on screen; the item opens in a panel on the side with the same facts in
sections. Faster to look at several items; cramped on a laptop and on phones.

**C. Keep the separate screens**, and only make each item name a link to that item's lines in the stock ledger.

Your answer: **A**, a full item page with tabs (Ben, 10 Nov).

## Q2. The Inventory home (overview)

**A. "What needs you today" first (recommended).** Four numbers, then a short list of things to act on, each with its button.

```
Inventory
 Low on stock 4    Waiting for approval 2    Expiring in 30 days 3    In transit 1
──────────────────────────────────────────────────────────────────────────────────
Needs you today
 • REQ-0041  30 Boxes for SO-0012 — waiting for your approval          [Open]
 • Tape 48 mm is below its reorder level (12 left, reorder at 20)     [Order]
 • Batch B-2207 of Hand cream expires on 28 Nov (40 pieces)           [Open]
 • Transfer TR-0007 Main → Giza has been in transit for 3 days        [Open]
──────────────────────────────────────────────────────────────────────────────────
[Stock on hand]  [New request]  [New transfer]  [Start a count]
```

**B. One card per warehouse**, each with its value, low items and open movements. Good with several warehouses; empty with one.

**C. No overview page**: keep opening on Stock on hand, with the four numbers on top (today).

Your answer: **A**, "What needs you today" (Ben, 10 Nov).

## Q3. The menu

**A. Grouped, and the clerk's three on top (recommended).**

```
Inventory
  Overview
  Stock on hand
  Requests
  Transfers
 ─ Counting
  Stock counts
  Adjustments
 ─ Planning
  Reorder levels
  Forecast
  Batches and expiry
 ─ Records and rules
  Stock ledger
  Approval policies
```

**B. Fewer pages**: merge Reorder levels and Forecast into one "Planning" page, and Adjustments into Stock counts ("Counts and
corrections"). Seven entries instead of eleven, but two pages become longer.

**C. Keep the flat list** (today).

Your answer: **A**, grouped, the clerk's three on top (Ben, 10 Nov).

## Q4. The stock list

**A. One row per item, warehouses inside (recommended)**: the total per item, a warehouse filter on top, a status column (Low / OK /
Out), and the row opens the item page. Columns you can hide: Arabic name, unit, reserved.

**B. One row per item and warehouse** (what accountants often expect): longer, but every number is visible without opening anything.

**C. Keep today's table**, adding only the link to the item page.

Your answer: **B**, one row per item and warehouse (Ben, 10 Nov). The item page shows the totals.

## Q5. On a phone (warehouse staff)

**A. Cards instead of tables below tablet width (recommended)**, with the three clerk actions (request, receive, count) as big buttons.

**B. The same tables, scrolling sideways** (today).

Your answer: **A**, cards and big buttons below tablet width (Ben, 10 Nov).

## How it would be built

In slices, each its own pull request, no database changes expected. Everything shown already exists in the API except one small
addition: the stock ledger today returns the latest 500 movements of all items together, so the item page's Movements tab needs it
filtered by item (an API change only).
1. The item page (Q1) and links to it from every list.
2. The overview (Q2) and the menu (Q3).
3. The stock list (Q4) and phone layout (Q5).

After each slice: checked in the browser in English and Arabic before it is merged.

## Progress

- **Slice 1, the item page (Q1): built** on branch `ux/inventory-redesign`. Inventory → Stock on hand → click a row (or an item in
  the Stock ledger). Tabs: stock by warehouse, movements, batches, units, cost (owners and admins), history. Totals on top, with
  "runs out" from the forecast and the average cost for managers. API: the stock ledger takes `?itemId=`; `GET /item-costs` reads the
  owner-and-admin function `inv_item_costs`. No database change.
- **Next:** slice 2, the overview (Q2) and grouped menu (Q3); then slice 3, the stock list one row per item and warehouse (Q4) and
  phone cards (Q5). The blind-count setting (MVP M3, answer C) needs a small database change and comes with the stock list slice.
- **Slice 2, overview (Q2) and grouped menu (Q3): built** on the same branch. Inventory now opens on the overview: four numbers, then
  "Needs you today" (approvals, approved requests to issue, transfers to receive, low items, batches expiring within 30 days), each
  with its button, then shortcuts; each person sees only what their role can act on. Stock on hand moved to `/inventory/stock` (every
  link updated). Menu: Overview, Stock on hand, Requests, Transfers; then Counting, Planning, Records and rules.
- **Slice 3: built** on branch `feat/mt940-and-inventory-slice3`. Stock on hand shows one row per item and warehouse (Q4 B), with a
  Warehouse column, and an item with no stock anywhere still shows once ("No stock yet"); the status (Out / Low / OK) is the item's,
  across all warehouses, because reorder levels are per item. Phones (Q5 A): every table was already shown as cards below 720 px (UX
  audit, 9 Nov); added a bar of big buttons at the bottom for the clerk (Request, Receive, Count) on the overview and Stock on hand.
  Blind counts (M3 C): a switch in Settings → General (`sql/066`); with it on, staff count without seeing the expected quantity.
