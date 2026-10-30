# Sales Orders & Delivery Plan

**Module key:** `sales` · **Status:** Implemented · **Depends on:** inventory

## Goal

Record customer orders and connect fulfillment to stock requests. Stock is reserved, approved, and issued only through Inventory; Sales marks an order delivered only when its linked request is issued.

## Scope and rules

- Customer directory and immutable sales orders with item, quantity, and unit price in minor currency units.
- A sales order can raise one stock request. Request lifecycle is the source of fulfillment state; issued means delivered, rejected/cancelled means eligible to retry.
- Database functions enforce roles, module enablement, tenant scope, state transitions, and audit entries.
- No direct stock movement, invoicing, taxes, returns, or payments in this slice.

## Acceptance

- Members can create orders and request stock; owners/admins can manage customers and cancel eligible orders.
- Stock requests use the existing approval and reservation rules; self-approval remains blocked.
- The sales order displays linked request status and becomes delivered only after issue.
- RLS and SQL tests prove cross-organization isolation and atomic audit behavior.
