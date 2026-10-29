# Inventory Plan (slice 1: outgoing stock with approval)

**Module key:** `inventory` (matches `packages/shared/src/modules.ts`)
**Status:** `[📋 Approved / ready]` for slice 1 only, approved by Ben in `orders.md` (2026-10-29). Everything marked "later" below needs its own approval.
**Owner:** Ben Arthur · **Reviewers:** management (Grant)
**Research:** [market gap research](../planning/MANAGEMENT_PLAN.md) (competitor behaviour: Edara transfer approvals, Odoo no native gate, ERPNext workflow engine). Teardowns not yet written; trials pending.
**Depends on modules:** core
**Technical background:** [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) sections 4 and 5, [ADR-0003](../architecture/decisions/ADR-0003-mutations-via-rpc.md)

---

## 1. Goal

A warehouse team can record items and stock, a staff member can request stock to leave, a manager approves or rejects, and the warehouse issues it. The approval really blocks the stock: the database refuses an issue without an approved request, and every step is written to the audit log in the same transaction. Users: requester (member), manager (admin), owner.

## 2. Scope

**In (slice 1):** items, warehouses, opening stock and receipts, outgoing stock request with reservation, single-level manager approval or rejection, issue, cancel, stock on hand, stock ledger, request history, audit entries for every step.
**Out (later):** multi-level and value-based approval policies, lots, serials, expiry, units of measure conversion, costing and valuation, transfers between warehouses, counts and adjustments, purchasing and sales documents, WhatsApp and voice approval, CSV import, offline use, custom fields.
**Won't (this phase):** e-invoicing, billing, Arabic UI text (the right-to-left layout stays).

## 3. Data model

All tables: `id`, `org_id not null references organizations(id)`, `created_at`, `updated_at`, RLS (select for members only), no direct write grants for signed-in users. Parents have `unique (org_id, id)` and children reference `(org_id, parent_id)` so a row can never point at another organization's row.

| Table | Columns that matter | Rules |
|---|---|---|
| `inv_warehouses` | code, name, name_ar, deleted_at | unique (org_id, code) |
| `inv_items` | sku, name, name_ar, uom, deleted_at | unique (org_id, sku) |
| `inv_counters` | org_id, key, value | per-organization request numbering, locked per call |
| `inv_requests` | number, requester_id, warehouse_id, reason, status, decided_by, decided_at, decision_comment, issued_by, issued_at | check: `approved`/`issued` need `decided_by` different from `requester_id`; status moves only along the allowed transitions (trigger) |
| `inv_request_lines` | request_id, item_id, qty > 0 | |
| `inv_approvals` | request_id, decision, approver_id, comment, channel, decided_at | append-only evidence of each decision |
| `inv_stock_moves` | item_id, warehouse_id, qty (signed), kind (`receipt`, `issue`), request_id, ref, posted_by, posted_at | **append-only ledger**; an `issue` row is accepted only for a request that is `approved` (trigger) |
| `inv_stock_balances` | item_id, warehouse_id, on_hand, reserved | check `0 <= reserved <= on_hand`; changed only by the functions |

Statuses: `submitted` → `approved` → `issued`; `submitted` → `rejected`; `submitted`/`approved` → `cancelled`. Nothing moves out of `issued`, `rejected` or `cancelled`.
**Migration file:** `sql/006_inventory_core.sql`. **Tests:** `sql/tests/002_inventory_approval.sql`.

## 4. Permissions

Enforced in the database by role (owner, admin, member, viewer), repeated as API permission keys for fast failure.

| Key | Granted to by default | Allows |
|---|---|---|
| `inventory.items.read` | everyone | read items, warehouses, stock, requests, ledger |
| `inventory.items.manage` | owner, admin, member | create items, receive stock |
| `inventory.warehouses.manage` | owner, admin | create warehouses |
| `inventory.request.create` | owner, admin, member | submit and cancel own requests |
| `inventory.request.approve` | owner, admin | approve or reject, never one's own request |
| `inventory.stock.issue` | owner, admin, member | issue an approved request |

## 5. API

Reads go through the signed-in user's client (RLS). Every change is one database function (ADR-0003). Response shapes match the demo screens so they switch to the real API without redesign.

| Method | Path | Database function / read |
|---|---|---|
| GET | `/v1/inventory/items`, `/warehouses`, `/stock`, `/ledger`, `/requests`, `/requests/:id` | table reads |
| POST | `/v1/inventory/warehouses` | `inv_create_warehouse` |
| POST | `/v1/inventory/items` | `inv_create_item` |
| POST | `/v1/inventory/requests` | `inv_submit_request` |
| POST | `/v1/inventory/requests/:id/approve`, `/reject` | `inv_decide_request` |
| POST | `/v1/inventory/requests/:id/issue` | `inv_post_issue` |
| POST | `/v1/inventory/requests/:id/cancel` | `inv_cancel_request` |

Reason codes: `ORG_REQUIRED`, `NOT_A_MEMBER`, `FORBIDDEN`, `INVALID_INPUT`, `INVALID_STATE`, `INSUFFICIENT_AVAILABLE`, `APPROVAL_REQUIRED`, `SELF_APPROVAL`.
**Audit:** every function writes its audit row inside the same transaction (`inventory.item.created`, `inventory.stock.received`, `inventory.request.submitted`, `.approved`, `.rejected`, `.cancelled`, `inventory.stock.issued`). Known limit: a refused action raises an error, which rolls back the transaction, so the refusal itself is not in the audit log. Logging refusals is a later item (from the API layer through the admin function).

## 6. Screens

Stock on hand, Stock requests (list, new, detail with approve/reject/issue/cancel and history), Stock ledger, Items and warehouses management. These are the existing demo screens, wired to the API.

## 7. Business rules

- Submitting reserves quantity: available = on_hand − reserved; a request needing more than available is refused.
- Approving or rejecting needs owner/admin and a different person from the requester. Rejecting or cancelling releases the reservation.
- Issuing needs an approved request; it reduces on_hand and reserved together and writes one `issue` move per line.
- Quantities are `numeric(18,3)`. Nothing here stores money; costing is later.
- Example: 120 gloves on hand, 30 reserved by request OUT-0002. Available 90. A request for 100 is refused; for 90 succeeds, available becomes 0.

## 8. Org settings this module adds

None in slice 1. Later: approval policies (thresholds, levels), negative stock allowed, request expiry.

## 9. Tests

`sql/tests/002_inventory_approval.sql` (always rolls back): direct insert into the ledger refused; issue without approval refused; self-approval refused; viewer and member cannot approve; reservation and over-reservation; reject releases; cancel releases; issue moves stock exactly once; audit entry per step; each organization's chain verifies; a user in another organization sees and changes nothing. Plus API tests and the real-login script extended to the inventory calls.

## 10. Rollout

1. Run `sql/006_inventory_core.sql` and its checks; log in the worklog.
2. Run `sql/tests/002_inventory_approval.sql`.
3. Deploy the API (Cloudflare Worker) with the Supabase settings as secrets.
4. Deploy the web app against it.
5. Create the demo organization and test users; enable the module for it.
6. Manual click-through by Ben.

## 11. Open questions

- Is `admin` the right database role for "manager", or do we need a separate manager role? (Slice 1 uses admin.)
- Should a requester be allowed to issue their own approved request, or must a different person issue? (Slice 1 allows it; approval is the control.)
- Logging refused actions in the audit log: when, and how.
