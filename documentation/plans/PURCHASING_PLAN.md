# Purchasing & Receiving Plan

**Module key:** `purchasing`  
**Status:** `[✅ Approved / In implementation]`  
**Owner:** Ben · **Depends on modules:** core, inventory

## 1. Goal

Record suppliers and purchase orders, then receive delivered goods into a selected warehouse. The receipt is a real inventory-ledger posting, never a browser-only adjustment.

## 2. Scope

**In:** suppliers; ordered, received and cancelled purchase orders; one full receipt per order; costs in minor units; audit history.  
**Out:** partial receipts, supplier invoices, tax, payment, returns, approvals and costing valuation.

## 3. Data model

`pur_suppliers`, `pur_orders` and `pur_order_lines` all have organization isolation, RLS and select-only access for signed-in roles. Orders progress only `ordered → received|cancelled`; order identity and lines are locked after creation. `sql/017_purchasing_core.sql` owns the schema.

## 4. Permissions

| Key | Default | Allows |
|---|---|---|
| `purchasing.suppliers.read` | viewer+ | Read suppliers |
| `purchasing.suppliers.manage` | admin+ | Create suppliers |
| `purchasing.orders.read` | viewer+ | Read orders |
| `purchasing.orders.create` | admin+ | Place orders |
| `purchasing.orders.receive` | member+ | Receive delivered goods |
| `purchasing.orders.manage` | admin+ | Cancel an ordered purchase order |

## 5. API and screens

`/v1/purchasing/suppliers` and `/v1/purchasing/orders` provide lists, detail and mutation routes. Web routes are `/purchasing/suppliers`, `/purchasing/orders`, `/purchasing/orders/new` and `/purchasing/orders/:id`.

## 6. Rules and tests

Costs are `bigint` minor units and currency comes from the organization setting. Receiving calls the inventory receipt helper for each line, updates the order and writes `purchasing.order.received` in one transaction. Migration verification and the purchasing SQL test must prove direct writes are refused, receiving happens once, stock changes correctly, audit chains verify, and another organization cannot read or mutate the data.

## 7. Rollout

Run migration 017 and `sql/tests/013_purchasing_receiving.sql`, deploy API/web, enable `purchasing` for the pilot organization, then manually create an order and receive it from the Purchasing screen.
