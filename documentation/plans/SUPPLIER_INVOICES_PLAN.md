# Supplier Invoices Plan

**Module key:** `purchasing` (extension)  
**Status:** `[✅ Implemented]`  
**Depends on:** Purchasing & Receiving

## Goal and scope

Record supplier bills against goods received on purchase orders and make billed quantities and amounts visible beside received quantities and order value. This slice supports partial bills, invoice reference/date, and an outstanding balance. Tax, payments, credit notes, OCR, and accounting export are out of scope.

## Rules

- Bills can only reference a received PO; each billed line must match a PO item.
- Cumulative billed quantity cannot exceed received quantity. The database locks the PO while validating and recording a bill.
- Unit prices use the PO cost, stored in integer minor units; the organization currency is inherited from the PO.
- A bill is immutable after recording; the database writes an audit event in the same transaction.
- All tables include `org_id`, RLS, and select-only direct access.

## Acceptance

- A user can list received purchase orders with received, billed, and remaining amounts.
- An owner/admin can record a partial or full supplier bill by invoice reference/date and quantities.
- Attempts to bill unreceived quantities, duplicate references for a supplier, or another organization's PO are refused.
- The billing summary updates and audit verification remains clean.

## Rollout

Migration 018 and SQL test 014 were run against the linked test database. Deploy API and web, then try a partial bill against a received purchase order.
