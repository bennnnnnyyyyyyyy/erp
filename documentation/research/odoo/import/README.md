# Odoo import files (same data as our cosmetics sample company)

Generated from `sql/seed/004_cosmetics_factory_demo.sql`. **Not yet imported or tried in the trial**: contents and row counts were checked, not an actual import.

Column headings follow the exported samples in [`../templates/`](../templates/) (list-view exports from the trial, because the template download fails with "couldn't load plugin"). Those exports include read-only columns that cannot be imported (Avatar, Activities, Stats, Image, Favorite, # Product Variants, Quantity On Hand, Last Updated, Currency); they are left out.

| File | Columns | Rows | Import into |
|---|---|---|---|
| `odoo_product_categories.csv` | Name | 3 | Inventory > Configuration > Product Categories (**import this before products**) |
| `odoo_products.csv` | Product Category, Track Inventory, Name, Sales Price, Cost, Internal Reference | 45 (21 raw, 12 packaging, 12 finished goods) | Inventory > Products > Products |
| `odoo_vendors.csv` | Name, Email, Phone, Country | 12 | Purchase > Orders > Vendors |
| `odoo_customers.csv` | Name, Email, Phone, Country | 10 | Sales > Orders > Customers |
| `odoo_opening_stock.csv` | Product, Location, Counted | 45 | Inventory > Operations > Physical Inventory |

## Import order
1. Vendors and customers.
2. Product categories first (Odoo does not create them during a product import: error 'No matching records found ... Product Category'), then products. This Odoo has no "All" parent category (existing ones are Expenses, Goods, Services), so the new ones are top-level; do not add a Parent Category column.
3. Opening stock. Then click **Apply All** on the Physical Inventory screen so the counted quantities become on-hand stock.

## Notes
- The samples show "Complete Name" for contacts. That field is computed and read-only, so the files use **Name**.
- Emails use the reserved `.example.com` domain and phone numbers are invented (+20 2 5555 01xx / 02xx). Prices and costs are EGP in whole pounds (our database stores piasters).
- Stock quantities use a seeded random pattern, not our app's actual opening balances.
- Left out on purpose: units of measure (everything imports as Units although our items use kg, l and piece), lots and expiry, Arabic names, sales/purchase history.
- If a column does not match during import, map it by hand on the import screen.


