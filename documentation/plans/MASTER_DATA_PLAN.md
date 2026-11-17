# Master data and coding Plan (accounting roadmap phase 4)

**Module key:** `inventory` (items, groups, units), `purchasing` and `sales` (party item codes, prices); no new module
**Status:** `[📝 Draft / RFC]`: written 17 Nov 2026, waiting for Ben's approval. Not built.
**Owner:** Ben · **Reviewers:** Ben, the accountant
**Roadmap:** [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md) phase 4. Ben's notes there: "item, sub-item and sub-sub-item,
each with coding", "auto SKU or our own (best for the Egyptian Tax Authority)", "SKU as the supplier knows it differs from the SKU the
customer knows", "price gets added or updated automatically".
**Depends on modules:** core, inventory; purchasing and sales for the party codes and prices.

---

## 1. Goal

A company can organise its items in **groups of any depth, each with a code**, have item codes **built automatically from the groups**
(or typed), find an item by **the code a supplier or customer uses for it**, and stop retyping prices: the **last purchase price per
supplier** is remembered, each item has a **sales price** (optionally per **price list** for a customer group), and a new purchase price
updates or suggests the item's price as the company chooses. Lines can be bought and sold in **other units** (a box of 12) without losing
money to rounding.

## 2. What exists (code survey, 17 Nov)

- Items with a SKU (typed, or automatic from a prefix and digits, `sql/075`), a base unit, average cost, ETA codes and a VAT rate
  (`sql/036`, `sql/092`).
- Extra units per item with a factor (`inv_item_units`, `sql/044`), used nowhere on documents yet (S5b was left for its own design).
- No item groups, no party item codes, no prices beyond what each order line types.

## 3. Scope

**In (this version), in four slices, each usable alone:**
- **A. Item groups and codes.** Groups in a tree (any depth; the screens show three levels comfortably), each with a code and a name in
  English and Arabic. An item belongs to one group. Item code rule per company: *typed* (as today), *prefix and sequence* (as today), or
  *group codes and a sequence* (`10-03-007` = group 10, sub-group 03, item 7; separator and digits are settings). Codes never change once
  documents use the item (a renamed group keeps old codes). The ETA code stays a separate field, shown next to the item code.
- **B. Supplier and customer item codes.** A table of the item's code (and optional name) as each supplier or customer knows it. Order,
  bill and invoice lines find items by those codes too, and print the party's code beside ours.
- **C. Prices.** Last purchase price per supplier and item, recorded automatically from bills (and purchase orders when no bill yet). A
  sales price per item (before or with VAT, following the company's VAT setting), and price lists (per customer group, with a validity
  period) that override it. A company setting: a new purchase price **updates** the item's last cost and suggested sales price, or only
  **suggests** it (roadmap Q6). Order lines take the price list's price, editable.
- **D. Units on document lines (S5b).** Order, request, bill and invoice lines keep their own unit and factor; quantity and price are
  stored as typed (per box), stock moves in base units (box × 12). Money is computed on the typed quantity and price, so no rounding is
  lost; the per-base-unit cost is derived for stock.

**Out (later):** barcodes and label printing; item variants (size/colour matrices); price rules by quantity break; promotions.
**Won't:** importing a competitor's item master as-is (an import from a file exists for that).

## 4. Data model (proposed)

| Table | Key columns | Rules |
|---|---|---|
| `inv_item_groups` | `org_id`, `parent_id`, `code`, `name`, `name_ar`, `active`, `deleted_at` | code unique among siblings; full code = parents' codes joined; no cycles; cannot delete while items use it |
| `inv_items` (+) | `group_id` | optional; required when the company's code rule is "group codes" |
| `inv_party_item_codes` | `org_id`, `item_id`, `party_type` (supplier/customer), `party_id`, `code`, `name` | one code per item and party; a code is unique per party |
| `pur_supplier_prices` | `org_id`, `supplier_id`, `item_id`, `unit`, `last_cost_minor`, `currency`, `source_doc`, `updated_at` | one row per supplier, item, unit; written only by bill/order functions |
| `sal_price_lists` + `sal_price_list_items` | name, customer group, valid from/to, currency; item, unit, price, includes VAT | one active list per customer group per date |
| `sal_customers` (+) | `price_list_id` or `customer_group` | |
| order / request / bill / invoice / note lines (+) | `unit`, `unit_factor`, `qty_in_unit` | base quantity = typed quantity × factor, kept as today in `qty` |

All company data: RLS, member read, writes through audited functions, isolation tests. Migrations `sql/095…` (one per slice).

## 5. Permissions

No new modules. New keys: `inventory.groups.manage` (owner, admin), `purchasing.prices.read` / `sales.prices.read` (members),
`sales.prices.manage` (owner, admin). Party item codes use the existing items/parties manage keys.

## 6. Screens

- Inventory → **Item groups** (tree, add / rename / move, codes); item form: group, code preview.
- Item page: **Codes** (ours, ETA, each supplier's and customer's), **Prices** (last cost per supplier, sales price, price lists).
- Sales → **Price lists**; customer page: price list.
- Order / bill / invoice lines: search by any code; unit picker (S5b).
- Settings → Inventory: code rule (typed / prefix / group codes), separator, digits; purchase price updates or suggests.

## 7. Business rules and calculations

- Group code `10`, sub-group `03`, digits 3, separator `-`: the 7th item in it gets `10-03-007`.
- Box of 12 at EGP 120.00 per box, 3 boxes: line = 3 × 120.00 = 360.00; stock moves 36 pieces at 10.00 each (cost per base unit =
  360.00 ÷ 36). When the division is not exact, the remainder stays in the line amount (money), and the stock cost carries the rounded
  unit cost (average cost already tolerates this).
- A new bill price 105.00 where the last was 100.00: "update" sets the supplier's last cost to 105.00 and the item's suggested sales price
  by the company's markup rule (if set); "suggest" shows it on the item and the next order without changing anything.

## 8. Org settings this module adds

`item_code_rule` (typed / prefix / group), `item_code_separator`, `item_code_digits`, `purchase_price_policy` (update / suggest),
`default_markup_percent` (optional), customer groups and their price lists.

## 9. Tests

SQL tests per slice (codes and their uniqueness, group tree rules, party codes, prices recorded by bills, price list choice by customer and
date, unit maths with known answers), isolation for every new table, API auth tests, and a workflow test: buy in boxes, sell in pieces.

## 10. Rollout

Four PRs (A, B, C, D), each: dry run on live, apply, tests on live, CI green, merge. D touches every document line, so it gets an ADR and
a migration note for existing lines (they become unit = base, factor 1).

## 11. Open questions

1. **Ben:** approve this plan and the order A → B → C → D? (Alternative: C first, if retyping prices hurts most.)
2. **Ben (roadmap Q6):** a new purchase price **updates** the item price or only **suggests** it? (Recommended: suggest, with a
   company setting.)
3. **Ben:** do items need a group always (required) or optionally? (Recommended: optional, required only under the "group codes" rule.)
4. **Ben:** price lists by **customer group** (recommended) or per customer?
5. **Accountant:** does the ETA item code (EGS/GS1) need to follow our coding, or is it independent? (We assume independent.)
