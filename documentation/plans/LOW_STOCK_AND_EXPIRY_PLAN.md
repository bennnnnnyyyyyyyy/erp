# Low stock, expiry and stock value plan

**Module key:** `inventory` (extends it; no new module)
**Status:** `[📝 Draft, awaiting Ben's approval]`
**Owner:** Ben · **Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md) phases 1a and 2c
**Depends on modules:** core, inventory, purchasing, alerts

---

## 1. Goal

The ERP tells the right people what needs attention, without nagging: low stock pops up with a one-click purchase order; batches
nearing expiry warn early, on windows each company chooses; and owners see what their stock is **really worth now**, not only what it
cost.

## 2. Scope

**Part A, low stock (phase 1a, first):**
- A1. Pop-up **at sign-in** summarising every item at or below its reorder level ("5 items are low").
- A2. **Live** pop-up when an item drops to or below its reorder level while the person is signed in.
- A3. Shown **only to people who can reorder** (purchasing order create, or inventory request create).
- A4. Per row: **Create purchase order** (main button), **Remind me** (1 hour / tomorrow / next week), **Don't show again** for this
  item. Snooze and mute are **per item, per person**. A muted item comes back if it **reaches zero**.
- A5. **Suggested reorder point** (industry standard): average daily use × supplier lead time + safety stock, from the existing
  forecast (`sql/029`: lead time = average days from order to receipt over 12 months, 7 if never bought; 7 safety days). A person
  accepts the suggestion or types their own. Reorder quantity tops up to a **maximum level** (new, optional per item).
- A6. The bell's low-stock and overdue-invoice notifications get a link to the item or invoice (today they open nothing).

**Part B, expiry (phase 2c):**
- B1. **Warning days per item group, overridable per item** (default 30/60/90). Replaces the fixed windows in Batches, Inventory
  Overview and the owner home card.
- B2. A **setup-wizard step**: "How many days' warning before expiry?"
- B3. Optional **near-expiry discount suggestion** (off by default): suggests a % off for batches inside a chosen window. A suggestion
  on screen only; it never changes a price by itself.
- Already built and kept as is: soonest-expiring batch goes out first (FEFO), expired and quarantined batches are skipped on issue,
  expired goods can't be received (`sql/026`, `sql/035`).

**Part C, stock value loss (phase 2c), screen only:**
- C1. A **bracket table** per company: basis = age since receipt, time since last sold, or days until expiry; each bracket gives a
  write-down %. We ship a default; item groups can override it.
- C2. "Current worth" shown beside cost on the stock value tile, item page and stock report. **Never posts to the accounts.**

**Out (later):** posting write-downs to the accounts (would need an approved journal entry), fixed-asset depreciation (own module).
**Won't:** automatic purchase orders. The pop-up only *prefills* a draft order; a person saves it, and approval rules apply as today.

## 3. Data model

Migration: next free number at build time (102 as of 20 Nov). SQL test: next free (099 as of 20 Nov). Check the migration register first.

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| `inv_stock_alert_states` | `org_id`, `user_id`, `item_id` | uuid | no | unique (org, user, item); RLS: a person sees only their own rows |
| | `snoozed_until` | timestamptz | yes | set by "Remind me" |
| | `muted_at` | timestamptz | yes | set by "Don't show again"; cleared automatically when the item reaches zero |
| `inv_items` (new columns) | `max_level` | numeric | yes | reorder quantity tops up to it; **column grant in the same migration** (column-grant table) |
| | `expiry_warn_days` | int[] | yes | overrides the group's windows |
| `inv_item_groups` (new columns) | `expiry_warn_days` | int[] | yes | default for items in the group |
| `inv_value_brackets` | `org_id`, `item_group_id` (null = company default), `basis` (`age`, `since_last_sale`, `to_expiry`), `from_days`, `to_days`, `writedown_pct` | | | ranges may not overlap; 0–100% |

Settings in `organizations` settings: `expiry_warn_days` default `{30,60,90}`; `expiry_discount_suggestion` (off, or window and %).
Every new table: `org_id`, RLS, isolation test, `revoke all` then `grant select`, writes through functions, audit rows.

## 4. Permissions

| Key | Default | Allows |
|---|---|---|
| existing `purchasing.orders.create` or `inventory.requests.create` | as today | seeing low-stock pop-ups |
| existing inventory settings permission | owner, admin | reorder points, max levels, expiry windows, value brackets |

Snooze and mute need no permission beyond seeing the pop-up; a person only changes their own rows.

## 5. API

| Method | Path | Permission | Returns |
|---|---|---|---|
| GET | `/v1/inventory/low-stock/popup` | reorder permission | items at or below level, minus snoozed or muted ones (muted come back at zero), with supplier, suggested quantity |
| POST | `/v1/inventory/low-stock/:itemId/snooze` | reorder permission | `{ until: '1h' \| 'tomorrow' \| 'week' }` |
| POST | `/v1/inventory/low-stock/:itemId/mute` · `DELETE …/mute` | reorder permission | |
| GET | `/v1/inventory/reorder-suggestions` | inventory read | suggested reorder point and max per item, from the forecast |
| PUT | `/v1/inventory/value-brackets` | inventory settings | the whole table, validated (no overlaps) |
| GET | `/v1/inventory/stock-value` | inventory read | cost and current worth by item, group and warehouse |

"Create purchase order" opens the existing purchase order form **prefilled** (item, the item's last supplier, suggested quantity); it
does not create anything until the person saves. Audit: snooze and mute are personal preferences and are not business records; they
write no audit rows (decision to confirm, §11).

## 6. Screens

| Screen | Where | Notes |
|---|---|---|
| Low-stock pop-up | after sign-in; live while signed in | modal, Arabic and English, keyboard and screen-reader friendly; "Show all" opens Reorder levels |
| Reorder levels | `/inventory/reorder` (exists) | adds "Suggested" column with Accept, and Max level |
| Expiry windows | item group and item pages; settings | three numbers, defaults shown |
| Value brackets | inventory settings | editable table; preview "what your stock is worth today" |
| Stock value tile and report | home and inventory | cost vs current worth |

**Live pop-up delivery:** the low-stock check today runs in the 5-minute job and in alert rules. Live means "within the next
5-minute job", delivered into the existing bell inbox and shown as a pop-up when the bell sees a new low-stock notification. No new
real-time server is needed. A true "instant" pop-up would need websockets (later, if asked).

## 7. Business rules and worked examples

- **Reorder point:** item sells 12 units/day, lead time 5 days, safety 7 days → 12 × (5 + 7) = **144**. Max level 300, available
  100, on order 0 → suggested order **200**.
- **Mute comes back:** muted item X at 40 (level 50); it falls to 0 → the mute is cleared and it pops up again.
- **Value brackets:** default by age since receipt: 0–180 days 0%, 181–365 25%, 366–730 50%, 731+ 100% (the default to confirm with an
  accountant). A batch received 200 days ago, cost 10,000 EGP → current worth **7,500 EGP**. Perishable group by days to expiry:
  ≤7 days 50%, expired 100%.
- Value loss is **screen only**: the balance sheet still uses cost. Each screen says so ("Estimated worth, not in the accounts").

## 8. Org settings

Expiry warning windows; discount suggestion on or off with window and %; value brackets (company and per group); who sees the
pop-up (follows permissions).

## 9. Tests

- SQL: isolation (a second company can't read or change states, brackets or new columns); a person can't read another person's
  snooze or mute rows; mute clears at zero; bracket overlap refused; column grants present for new `inv_items` columns.
- API: the pop-up list respects permissions, snooze and mute; the reorder suggestion matches the worked example.
- Web: the pop-up shows once per sign-in, not on every page load; "Create purchase order" prefill; RTL layout.
- **Ben asked for heavy testing of "Create purchase order"**: add an end-to-end smoke test (sample build) for pop-up → prefilled
  order → save → approval.

## 10. Rollout

1. Apply the migration (dry run first), its verification queries and SQL test on live; worklog entry.
2. Deploy API and web.
3. Browser check on live (Ben allowed driving the live test site, 20 Nov): sign in as a purchaser, as a worker without reorder
   permission (no pop-up), Arabic and English.

## 11. Open questions

1. Should snooze and mute write to the audit log? (Recommended: no; they are personal preferences, like language.)
2. Default value brackets: confirm with an accountant before shipping.
3. "Create purchase order" when an item has no supplier yet: open the form with the supplier empty, or offer a stock request instead?
