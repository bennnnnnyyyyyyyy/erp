# Low stock, expiry and stock value plan

**Module:** `inventory` (we add to it; no new module)
**Status:** Draft. Ben must approve it.
**Owner:** Ben
**Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md), steps 1a and 2c
**Uses:** core, inventory, purchasing, alerts
**Build plan for part A:** [Low stock pop-up build plan](LOW_STOCK_POPUP_BUILD_PLAN.md) (draft, 23 Nov)

> **In short**
> - **Part A (first):** a pop-up tells buyers which items are low. One click opens a filled-in purchase order.
> - **Part B (later):** each company sets its own expiry warning days.
> - **Part C (later):** the ERP shows what old stock is really worth now. This is **on screen only**. It never changes the accounts.

---

## 1. Goal

The ERP tells the right people what needs attention. It does not annoy them.

## 2. What we build

### Part A: low stock (step 1a)

**When the pop-up shows**
1. **At sign-in.** One pop-up lists all low items, for example "5 items are low".
2. **While the person works.** A new pop-up shows when an item becomes low.

**Who sees it**
- Only people who can reorder. That is, people who can make a purchase order or a stock request.

**What each row has**
- **Create purchase order.** This is the main button. It opens a draft order with the item, the supplier and a suggested quantity.
  Nothing is saved until the person clicks Save.
- **Remind me.** Choices: in 1 hour, tomorrow, next week.
- **Don't show again.** This stops the pop-up for that item.

**Rules for "Remind me" and "Don't show again"**
- They work **for one item and one person**. Other people still see the item.
- If a muted item goes to **zero**, the mute stops. The item shows again.

**Suggested reorder point** (the common method in the industry)
- Reorder point = average daily use × supplier lead time + safety stock.
- The ERP already has this data. The forecast (`sql/029`) calculates lead time and use.
  - Lead time is the average days from order to receipt in the last 12 months. It is 7 days if we never bought the item.
  - Safety stock is 7 days of use.
- A person accepts the suggestion or types a different number.
- New: a **maximum level** for each item (optional). The order fills stock up to this level.

**Bell fix**
- Low stock and overdue invoice notifications get a link. Today a click on them does nothing.

### Part B: expiry (step 2c)

What already works (`sql/026` and `sql/035`). We keep it:
- Stock goes out in this order: the batch that expires first goes out first.
- The ERP skips expired batches and batches in quarantine.
- The ERP does not accept goods that are already expired.

What we add:
1. **Warning days for each item group.** An item can have its own days. The default is 30, 60 and 90 days.
   Today these numbers are fixed in the code.
2. **A setup wizard step:** "How many days' warning before expiry?"
3. **A discount suggestion** (off by default). Example: "This batch expires in 7 days. Suggest 30% off."
   It is only a suggestion. It never changes a price.

### Part C: stock value (step 2c)

1. The company has a **table of brackets**. Each bracket gives a % of value loss.
2. A bracket is based on one of these:
   - age since the goods came in
   - time since the item last sold
   - days until expiry
3. We ship a default table. An item group can have its own table.
4. Screens show **"Estimated worth"** next to cost.
5. This **never changes the accounts.** The balance sheet still uses cost.

**Example default table** (an accountant must check it before we ship it)

| Age since goods came in | Value loss |
|---|---|
| 0 to 180 days | 0% |
| 181 to 365 days | 25% |
| 366 to 730 days | 50% |
| more than 730 days | 100% |

### Not now
- Writing the value loss into the accounts. This needs an approved journal entry.
- Fixed-asset depreciation. This is a separate module.

### Never
- Automatic purchase orders. The pop-up only fills in a draft. A person saves it. The normal approval rules apply.

## 3. Database changes

- **Migration number:** the next free number when we build. Check the migration register first.
  (The HR app work uses 102 and test 099.)

**New table: `inv_stock_alert_states`** (one row for each person and item)

| Column | Meaning |
|---|---|
| `org_id`, `user_id`, `item_id` | Which company, person and item. Only one row for each person and item. |
| `snoozed_until` | Set by "Remind me". |
| `muted_at` | Set by "Don't show again". The ERP clears it when the item goes to zero. |

A person can see only their own rows.

**New columns**

| Table | Column | Meaning |
|---|---|---|
| `inv_items` | `max_level` | The level that an order fills stock up to. |
| `inv_items` | `expiry_warn_days` | Warning days for this item. Empty means use the group's days. |
| `inv_item_groups` | `expiry_warn_days` | Warning days for the group. |

**Important:** `inv_items` has column grants. Add the grant for each new column **in the same migration**.

**New table: `inv_value_brackets`**

| Column | Meaning |
|---|---|
| `org_id` | The company. |
| `item_group_id` | The group. Empty means the company default. |
| `basis` | `age`, `since_last_sale` or `to_expiry`. |
| `from_days`, `to_days` | The range of the bracket. Ranges must not overlap. |
| `writedown_pct` | The value loss, from 0 to 100%. |

**Company settings:** default warning days (30, 60, 90). Discount suggestion: on or off, with days and %.

**Standard rules for each new table:**
- It has `org_id` and row level security.
- It has a test that shows another company cannot see or change it.
- Remove all access first, then give read access only.
- Writes go through database functions.

## 4. Permissions

| Permission | Who has it | What it allows |
|---|---|---|
| Existing "create purchase order" or "create stock request" | as today | See the low stock pop-up. |
| Existing inventory settings permission | owner, admin | Set reorder points, maximum levels, expiry days and value brackets. |

"Remind me" and "Don't show again" need no extra permission. A person changes only their own rows.

## 5. API

| Method | Path | What it does |
|---|---|---|
| GET | `/v1/inventory/low-stock/popup` | Lists low items. It removes items the person snoozed or muted. Muted items come back at zero. |
| POST | `/v1/inventory/low-stock/:itemId/snooze` | "Remind me": 1 hour, tomorrow or next week. |
| POST / DELETE | `/v1/inventory/low-stock/:itemId/mute` | "Don't show again", or undo it. |
| GET | `/v1/inventory/reorder-suggestions` | The suggested reorder point and maximum for each item. |
| PUT | `/v1/inventory/value-brackets` | Saves the bracket table. It refuses overlaps. |
| GET | `/v1/inventory/stock-value` | Cost and estimated worth, by item, group and warehouse. |

## 6. Screens

| Screen | Where | Notes |
|---|---|---|
| Low stock pop-up | after sign-in, and while the person works | Arabic and English. Works with the keyboard and screen readers. "Show all" opens Reorder levels. |
| Reorder levels | `/inventory/reorder` (exists) | Add a "Suggested" column with an Accept button. Add Maximum level. |
| Expiry warning days | item group page, item page, settings | Three numbers. The defaults show. |
| Value brackets | inventory settings | A table you can edit. A preview shows what your stock is worth today. |
| Stock value tile and report | home and inventory | Cost and estimated worth side by side. |

**How the pop-up gets new alerts**
- A job runs every 5 minutes. It already checks low stock.
- It puts a notification in the bell.
- When the bell gets a new low stock notification, the pop-up opens.
- So "live" means "within 5 minutes". We need no new real-time server.

## 7. Examples with numbers

**Reorder point**
- The item sells 12 a day. Lead time is 5 days. Safety stock is 7 days.
- Reorder point = 12 × (5 + 7) = **144**.
- Maximum level is 300. Stock is 100. Nothing is on order.
- Suggested order = 300 − 100 = **200**.

**Mute comes back**
- Item X is muted at 40. Its reorder level is 50.
- Item X goes to 0. The mute stops. The pop-up shows item X again.

**Value loss**
- A batch came in 200 days ago. It cost 10,000 EGP.
- The bracket for 181 to 365 days is 25%.
- Estimated worth = **7,500 EGP**. The screen says "Estimated worth, not in the accounts".

## 8. Company settings

- Expiry warning days.
- Discount suggestion: on or off, with days and %.
- Value brackets for the company and for each group.
- Who sees the pop-up. This follows permissions.

## 9. Tests

**Database tests**
- Another company cannot see or change states, brackets or the new columns.
- A person cannot see another person's snooze or mute.
- A mute clears at zero.
- The ERP refuses brackets that overlap.
- The new `inv_items` columns have their grants.

**API tests**
- The pop-up list follows permissions, snooze and mute.
- The reorder suggestion matches the example in section 7.

**Web tests**
- The sign-in pop-up shows one time for each sign-in, not on each page.
- "Create purchase order" fills in the draft correctly.
- The layout works right-to-left (Arabic).

**Ben asked for many tests of "Create purchase order".** Add a full test: pop-up → filled draft → save → approval.

## 10. Rollout

1. Test the migration first in a transaction that rolls back. Then apply it. Run its SQL test on live. Write a worklog entry.
2. Deploy the API and the web app.
3. Check in the browser on the live test site (Ben allowed this on 20 Nov):
   - sign in as a buyer: the pop-up shows
   - sign in as a worker who cannot reorder: no pop-up
   - check in Arabic and in English

## 11. Open questions

1. Must "Remind me" and "Don't show again" write to the audit log?
   Recommendation: no. They are personal settings, like the language choice.
2. An accountant must check the default value brackets.
3. What happens if an item has no supplier yet? Two choices:
   - open the purchase order with no supplier, or
   - offer a stock request.
