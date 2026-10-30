# Customer Invoices Plan

**Module key:** `sales` (second app inside Sales) · **Status:** Proposed, not built · **Depends on:** sales, inventory

## Purpose
Record the bill to a customer for a delivered sales order and show ordered versus delivered versus invoiced per order line, flagging mismatches. Mirrors Supplier Invoices (`SUPPLIER_INVOICES_PLAN.md`).

## Scope and rules
- An invoice can only be raised for an order whose linked stock request is **issued** (delivered). Partial invoicing allowed; invoiced quantity per line may not exceed delivered quantity.
- Money as integer minor units plus the organization's currency; no tax calculation, payments, credit notes or e-invoicing in this slice (e-invoicing route is still an open decision, ADR-0005).
- Invoice numbers per organization from a counter; invoices are immutable once issued; a wrong invoice is voided (status change, audited), never edited or deleted.
- DB functions (`sal_create_invoice`, `sal_void_invoice`) with RLS select-only tables, org-scoped, role-checked, module-checked, one audit entry per change.
- Nothing is sent to the customer by a channel in this slice; WhatsApp/voice stays out of scope.

## Acceptance
- Order lines show ordered / delivered / invoiced and a mismatch flag (over-billed, under-billed, undelivered).
- Over-invoicing and invoicing an undelivered order are refused in the database.
- SQL test proves isolation, refusals, partial then final invoicing, void, and audit chain intact.
- Unit test covers the mismatch calculation.

## Open questions for Ben
1. Is the invoice price taken from the order line (assumed) or editable?
2. Does the customer need a printable/PDF invoice in this slice (assumed no)?
