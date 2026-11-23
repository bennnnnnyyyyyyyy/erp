# Low stock pop-up: build plan (phase 1a)

**Status:** Draft. Ben must approve it before we build.
**Owner:** Ben
**Plan it builds:** [Low stock, expiry and stock value plan](LOW_STOCK_AND_EXPIRY_PLAN.md), part A only.
**Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md), step 1a
**Who builds it:** Track A, on branch `fix/track-a-audit-bugs` or a new branch after Ben merges it.

> **In short**
> - After sign-in, a pop-up lists the low items. It shows only to people who can reorder.
> - Each row has 3 actions: **Create purchase order** (opens a filled draft; nothing is saved until the person saves),
>   **Remind me** (1 hour, tomorrow, next week) and **Don't show again**.
> - The pop-up also opens when the bell gets a new low stock alert, within 5 minutes.
> - One migration (**106**, test **103**): a table for each person's snooze and mute, and an optional maximum level per item.
> - Parts B and C (expiry days, stock value) are **not** in this build.

---

## 1. Your answers (23 Nov) and what they mean for the build

| Question | Your answer | In the build |
|---|---|---|
| Must "Remind me" and "Don't show again" write to the audit log? | No | They are personal settings, like the language. The functions write no audit row. |
| An item with no supplier: what does "Create purchase order" do? | Open the order and ask for a supplier | The draft opens with the item and quantity. The supplier box is empty and has focus. A line says "Choose a supplier." |
| Who sees the pop-up? | Only people who can reorder | People with `purchasing.orders.create` or `inventory.request.create`. The API checks this, and the screen too. |

## 2. What already exists (we reuse it)

- **Reorder level** for each item, and the Reorder levels screen (`/inventory/reorder-levels`).
- **Forecast** `inv__forecast_for` (sql/030, 064). For each item, it gives the available quantity, the use per day, the lead days,
  the quantity on order and a suggested order.
- **The supplier's last cost** for each item: `pur_supplier_prices` (sql/097). It tells us the last supplier of each item.
- **Low stock alert rule** (`stock_below`, sql/028). The job runs every 5 minutes. Since sql/104 (live 23 Nov), the bell notification
  has the target `alert:stock_below`.
- **New purchase order form** (`NewOrderForm`, `modules/trade/common.tsx`). Today it cannot be filled from a link.

## 3. Database: migration 106, test 103

**New table `inv_stock_alert_states`** (one row for each person and item)

| Column | Meaning |
|---|---|
| `org_id`, `user_id`, `item_id` | Company, person, item. Primary key `(org_id, user_id, item_id)`. |
| `snoozed_until` | Set by "Remind me". |
| `muted_at` | Set by "Don't show again". |

- It has row level security. A person reads only their own rows (`user_id = auth.uid()` and member of the company).
- It has `revoke all` for `anon` and `authenticated`, then `grant select` only. Writes go through functions.
- **Mute comes back at zero:** the pop-up list ignores a mute when the available quantity is 0 or less. We need no trigger.

**New column `inv_items.max_level`** (numeric, optional, 0 or more). It needs its **column grant in the same migration**, because
`inv_items` uses column grants (the lesson from sql/095).

**New functions** (each checks the company and the person, and is rerun-safe)

| Function | What it does |
|---|---|
| `inv_low_stock_popup()` | Lists the low items for the caller: available ≤ reorder level, not snoozed, not muted (unless available ≤ 0). It also gives the suggested quantity, the last supplier and that supplier's last cost. It refuses people who cannot reorder. |
| `inv_snooze_low_stock(item, until)` | "Remind me". `until` must be in the future and at most 8 days ahead. |
| `inv_mute_low_stock(item, on)` | "Don't show again", or undo it. |
| `inv_set_max_level(item, level)` | Owners and admins. Audited, like the reorder level. |

**Suggested quantity:** fill up to the maximum level when there is one. Otherwise use the forecast's suggested order. Otherwise
use reorder level × 2 − available. Then take away what is already on order. Never less than 0.
Example (plan section 7): max 300, stock 100, nothing on order → **200**.

**Test 103:** another company cannot see or change the states or the new column. A person cannot see another person's snooze or
mute. A muted item shows again at zero. A snooze ends at its time. A person who cannot reorder gets nothing. The `max_level` grant
is there (test 092 lists it). No anonymous use.

## 4. API

| Method | Path | Permission | What it does |
|---|---|---|---|
| GET | `/v1/inventory/low-stock/popup` | `inventory.items.read`, plus a reorder permission (checked in the route and in the function) | The pop-up list. |
| POST | `/v1/inventory/low-stock/:itemId/snooze` | the same | Body `{ for: 'hour' \| 'tomorrow' \| 'week' }`. The server works out the time in the company's time zone ("tomorrow" = 08:00 tomorrow). |
| POST / DELETE | `/v1/inventory/low-stock/:itemId/mute` | the same | Mute or undo. |
| PUT | `/v1/inventory/items/:id/max-level` | `inventory.items.manage` | Maximum level. |

Before migration 106 is applied, these routes return 503 `not_set_up`, and the screen shows no pop-up. This is for when you merge
before the migration.

## 5. Screens

1. **Pop-up** (`components/LowStockPopup.tsx`, in the app shell)
   - It opens once after each sign-in if the list is not empty. It does not open again on each page (sessionStorage).
   - It opens again when the bell gets a new `alert:stock_below` notification.
   - Title: "5 items are low". One row for each item: name (Arabic name in Arabic), available and level with the unit, the
     suggested quantity, and the 3 actions. "Show all" opens Reorder levels.
   - Works with the keyboard (the same Modal as the other pop-ups) and right-to-left.
2. **"Create purchase order"** opens `/purchasing/orders/new?item=<id>&qty=<n>&supplier=<id>`. The form fills itself from the link:
   the supplier (when known), one line with the item, the quantity and the suggested price (it already looks up the supplier's last
   cost). **Nothing is saved until the person clicks "Place order".** The normal approval rules apply (sql/069).
   - With no supplier: the supplier box is empty and has focus, with "Choose a supplier."
   - A person who can only make stock requests (no purchase order permission): the row shows "Ask for it" instead. It opens a new
     stock request for that item.
3. **Reorder levels:** add a "Maximum" column next to the level. It is saved with the same "Save changes" button (added 23 Nov).

The suggested reorder point column ("Suggested" with an Accept button, plan part A) is a **second step**. It needs no new data
(the forecast has it). I suggest we build it after the pop-up works, in the same branch.

## 6. Tests

- **SQL:** test 103 (above).
- **API:** the routes check permissions (the existing guard test). The pop-up is refused for a person who cannot reorder. Each route
  gives 503 before the migration.
- **Web:** the suggested quantity (the plan's example → 200). Reading the order form's link (item, quantity, supplier; bad values are
  ignored). The pop-up opens once for each sign-in.
- **End to end** (you asked for many tests of "Create purchase order"): pop-up → filled draft → save → it waits for approval when the
  company has an approval limit. This test runs in the demo build in CI, with the sample data.

## 7. Rollout

1. You approve this plan. I add it to `checklist.md`.
2. I build it, with a commit for each part: migration and test, API, pop-up, order form link, maximum level.
3. Before live: your yes, then a dry run with rollback, then I apply 106, then test 103 and 092 on live, then a WORKLOG entry.
4. You merge and deploy. I check in the browser on the live test site (you allowed this on 20 Nov). You sign in first. I check a
   buyer (the pop-up shows) and a worker who cannot reorder (no pop-up), in English and Arabic.

## 8. Open questions (choices with a recommended answer)

1. **"Tomorrow" in "Remind me":** 08:00 tomorrow in the company's time zone, or 24 hours from now?
   Recommendation: 08:00 tomorrow.
2. **The pop-up for an owner who signs in many times a day:** once each sign-in (the plan), or at most once each day?
   Recommendation: once each sign-in, as the plan says.
3. **"Ask for it" (a stock request) for people who cannot make purchase orders:** build it now, or show these people no button?
   Recommendation: build it now. It is small, and it keeps the plan's rule "people who can make a purchase order or a stock request".
