# Inventory Transfers Plan (stock moves between warehouses, with approval)

**Module key:** `inventory` (a feature of the existing module; no new module key)
**Status:** `[📋 Approved / ready]` by Ben on 2026-11-02, with the recommended answers to section 11. **Built, not yet run or deployed:** `sql/033_inventory_transfers.sql`, `sql/tests/029_inventory_transfers.sql`, API routes, shared permission keys, web screens, demo data (see "Differences from the draft" at the end). The migration and test have not been run against a database.
**Owner:** Ben Arthur · **Reviewers:** management (Grant)
**Research:** [Odoo review](../research/odoo/ODOO_REVIEW.md), seen in the Odoo 20 trial on 2026-11-02: internal transfers exist only after the Storage Locations setting is switched on, and a transfer or a barcode count completes with no approval. [Odoo P1 gap](../research/odoo/P1_GAP.md) lists transfers as the top missing P1 item. Teardown not yet written.
**Depends on modules:** core, inventory (slice 1 approval engine, adjustments, batches)
**Technical background:** [INVENTORY_PLAN.md](INVENTORY_PLAN.md), [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md), [ADR-0003](../architecture/decisions/ADR-0003-mutations-via-rpc.md)

---

## 1. Goal

A warehouse team can move stock from one warehouse to another. A manager approves the move, the source warehouse dispatches it, and the destination warehouse confirms it arrived. The approval blocks the stock movement in the database, exactly as it does for outgoing stock today, and goods in transit are visible rather than "lost". Odoo lets the same person create and complete a transfer with no approval (seen); this is where we are different.

## 2. Scope

**In (this version):**
- Transfer request: source warehouse, destination warehouse, lines (item and quantity), reason. Reserves stock at the source on submit.
- Approval using the existing approval policy (same rules and thresholds as outgoing requests), requester can never approve their own, any channel (app now, WhatsApp and voice later) calling the same function.
- Dispatch (stock leaves the source, goes **in transit**) and receive (stock enters the destination), as two separate ledger postings by two steps.
- Batch and expiry carried across: the destination receives the same batches with the same expiry dates that left the source.
- Storage-condition check: an item that needs a cold room cannot be sent to an ambient warehouse unless the company allows it.
- Audit log entry for every step, in the same transaction.
- Screens: transfer list, new transfer, transfer detail with approve, dispatch, receive and cancel; an "in transit" figure on the inventory home.

**Out (later, each needs its own approval):** partial receipt with shortage handling (see open questions), multi-leg routes, picking lists and barcodes for transfers, transport cost, serial numbers, transfers between organizations (never).
**Won't:** a transfer that skips approval. There is no "approval off" switch for transfers.

## 3. Data model

Every table gets `id`, `org_id not null references organizations(id)`, `created_at`, `updated_at`, RLS (select for members only), `revoke all` from `anon` and `authenticated` then `grant select`, and an index leading with `org_id`. Parents have `unique (org_id, id)` so children can use composite foreign keys, as in `sql/006`.

| Table | Columns that matter | Rules |
|---|---|---|
| `inv_transfers` | number (`TR-000001`, per organization), requester_id, from_warehouse_id, to_warehouse_id, reason, status, decided_by, decided_at, decision_comment, dispatched_by, dispatched_at, received_by, received_at | check `from_warehouse_id <> to_warehouse_id`; check decider is not the requester; `approved` and later need a decider; `unique (org_id, number)` |
| `inv_transfer_lines` | transfer_id, item_id, qty > 0 | `unique (transfer_id, item_id)` |
| `inv_transfer_approvals` | transfer_id, decision, approver_id, comment, channel (`app`, `whatsapp`, `voice`, `api`), decided_at | append-only evidence, same shape as `inv_approvals`; one row per approver so multi-approval policies work |
| `inv_transfer_batches` | transfer_id, item_id, batch_id, qty | filled at dispatch with the batches actually taken (first expiry first out), read at receipt so the destination gets the same batches; append-only |
| `inv_stock_moves` (existing) | new kinds `transfer_out` (qty < 0) and `transfer_in` (qty > 0); new nullable column `transfer_id` | a `transfer_out` row is accepted only for a transfer in status `approved`, a `transfer_in` row only for `dispatched`; otherwise the guard raises `APPROVAL_REQUIRED` |

**In-transit stock** is derived, never stored twice: for each item, the quantity on `dispatched` transfers (out posted, in not yet posted). It is not part of any warehouse's `on_hand`, so a warehouse can never sell it.

**Statuses:** `submitted` → `approved` → `dispatched` → `received`; `submitted` → `rejected`; `submitted` or `approved` → `cancelled`. Nothing moves out of `received`, `rejected` or `cancelled`. Once `dispatched`, a transfer cannot be cancelled; a wrong dispatch is corrected by a new transfer back (keeps the ledger honest).
**Migration file:** `sql/033_inventory_transfers.sql` (rerun-safe, ends with read-only verification queries). **Tests:** `sql/tests/029_inventory_transfers.sql`.

## 4. Permissions

| Key | Granted to by default | Allows |
|---|---|---|
| `inventory.transfers.read` | every member | see transfers and in-transit stock |
| `inventory.transfers.create` | member+ | request a transfer, cancel your own |
| `inventory.transfers.approve` | manager roles, as `inventory.request.approve` today | approve or reject (never your own) |
| `inventory.transfers.dispatch` | member+ | dispatch an approved transfer from the source warehouse |
| `inventory.transfers.receive` | member+ | confirm arrival at the destination warehouse |

Keys are added to `packages/shared/src/modules.ts` with the module manifest. The route check is for early rejection; the database functions re-check role and state.

## 5. API

All routes resolve the caller's organization and call a database function with the caller's own JWT (ADR-0003). The secret-key client is not used.

| Method | Path | Permission | Body / query | Database function |
|---|---|---|---|---|
| GET | `/v1/inventory/transfers` | `inventory.transfers.read` | `page`, `pageSize`, `status` | select (RLS) |
| GET | `/v1/inventory/transfers/:id` | `inventory.transfers.read` | | select (RLS) |
| GET | `/v1/inventory/in-transit` | `inventory.transfers.read` | | `inv_in_transit()` |
| POST | `/v1/inventory/transfers` | `inventory.transfers.create` | `fromWarehouseId`, `toWarehouseId`, `reason`, `lines[]` | `inv_submit_transfer` |
| POST | `/v1/inventory/transfers/:id/decision` | `inventory.transfers.approve` | `decision`, `comment`, `channel` | `inv_decide_transfer` |
| POST | `/v1/inventory/transfers/:id/dispatch` | `inventory.transfers.dispatch` | | `inv_dispatch_transfer` |
| POST | `/v1/inventory/transfers/:id/receive` | `inventory.transfers.receive` | | `inv_receive_transfer` |
| POST | `/v1/inventory/transfers/:id/cancel` | `inventory.transfers.create` | | `inv_cancel_transfer` |

Validation (zod schemas in `packages/shared`): warehouses differ and both exist in the organization, at least one line, quantity greater than zero with up to 3 decimals, no duplicate items, available stock covers each line.
**Audit actions written in the same transaction:** `inventory.transfer.submitted`, `.approved`, `.rejected`, `.dispatched`, `.received`, `.cancelled`, each with the transfer number and a summary of lines.

## 6. Screens

| Screen | Route | Permission | Notes |
|---|---|---|---|
| Transfers list | `/inventory/transfers` | `inventory.transfers.read` | status filter, search by number, CSV export like other lists |
| New transfer | `/inventory/transfers/new` | `inventory.transfers.create` | pick source, destination, add items with available quantity shown; warns on storage-condition mismatch |
| Transfer detail | `/inventory/transfers/:id` | `inventory.transfers.read` | timeline of steps, lines, batches moved, buttons shown only if the person may do them and the status allows |
| In-transit card | inventory home | `inventory.transfers.read` | count and quantity of dispatched, unreceived transfers |

Arabic and English from the first screen: new strings go through `t()`, logical CSS properties only, buttons at least 44 px high (see the UI audit).

## 7. Business rules and calculations

- **Reserve on submit.** `reserved` at the source rises by the line quantity; submit fails with `INSUFFICIENT_STOCK` if `on_hand - reserved` is short. Cancel or reject releases it.
- **Approval.** `inv__required_approvals(org, from_warehouse, total_qty)` decides how many approvals are needed (reuse of `sql/011`); the transfer becomes `approved` only when enough different people have approved, none of them the requester.
- **Dispatch.** For each line, post a `transfer_out` row (negative). The existing batch trigger takes first-expiry-first-out and skips quarantined and expired batches; the batches taken are copied into `inv_transfer_batches`. `on_hand` and `reserved` at the source fall by the quantity. Status becomes `dispatched`.
- **Receive.** For each `inv_transfer_batches` row, post a `transfer_in` row (positive) with the batch set through the same `erp.batch_id` mechanism the receipt functions use, so expiry follows the goods. `on_hand` at the destination rises. Status becomes `received`.
- **Cost.** Average cost is per item for the organization, so a transfer changes no cost and no valuation; only warehouse quantities move.
- **Storage condition.** If the item's storage condition is outside the destination warehouse's range (cold item to ambient), submit is refused unless the organization setting allows it (default: refused).

**Worked example** (sample company): 120 x Shampoo 400 ml, Finished goods (on hand 1,911) to a new warehouse "Alexandria branch". After submit: FG on hand 1,911, reserved 120. After approval by a manager and dispatch: FG on hand 1,791, reserved 0, in transit 120. After receive: Alexandria on hand 120, in transit 0. Org total stays 1,911; the ledger has one `transfer_out` of -120 and one `transfer_in` of +120, and four audit rows exist (submitted, approved, dispatched, received).

## 8. Org settings this module adds

Nothing customer-specific is hardcoded; all in org settings with defaults:
- `inventory.transfers.allow_storage_mismatch` (default off).
- `inventory.transfers.require_receive_confirmation` (default on; off posts the receive automatically at dispatch, for small companies that do not want a second step). The approval is never optional.

## 9. Tests

- **SQL (`sql/tests/029_inventory_transfers.sql`):** a user in another organization cannot read or change transfers, lines, approvals or batches; a direct insert of a `transfer_out` or `transfer_in` move is refused for an application role and with no approved transfer (`APPROVAL_REQUIRED`); the requester cannot approve; two-approver policy needs two different people; dispatch below available stock fails; batch and expiry arrive intact at the destination; quarantined batches are skipped; cancel after dispatch is refused; in-transit equals dispatched-minus-received; every step writes exactly one audit row in the same transaction.
- **API tests:** each route refuses without its permission and without an organization; a second organization gets 404; zod validation errors.
- **Shared:** schemas and permission keys listed in `permissions.test.ts`.
- **Manual (browser):** Ben follows the steps in section 10.

## 10. Rollout

1. Run `sql/033_inventory_transfers.sql` and its verification queries; run `sql/tests/029_inventory_transfers.sql`; log both in the worklog.
2. Deploy the API.
3. Deploy the web app.
4. The `inventory` module is already on; nothing to enable. Permission keys are available to existing roles by default.
5. Manual check: create a second warehouse, request a transfer as a member, approve it as a manager (the same user must be refused), dispatch, check "in transit", receive, check both warehouses and the audit log.

## 11. Open questions

1. **Partial receipt.** If 118 of 120 arrive, do we (a) force a full receive and fix with a destination adjustment, (b) allow receive of fewer with the rest staying "in transit" until a manager resolves it, or (c) write off the difference at the source? Recommended for this version: (a), with (b) as the next step.
2. **Approval wording.** Should the approver also confirm dispatch, or is a separate storekeeper step enough? Recommended: separate steps, different permissions.
3. **Quarantine warehouse.** Should transfers *into* the quarantine warehouse need no approval (urgent isolation) or always need one? Recommended: always, same as everything else; revisit if it slows down real recalls.
4. **Numbering.** One counter (`TR-`) per organization, like requests and adjustments. Agreed?
5. **Odoo behaviour to confirm.** Odoo's transfer between warehouses was seen only as "needs Storage Locations on"; a full Odoo transfer with two steps was not run. Marked claimed until it is.


## 12. Decisions taken (2026-11-02) and differences from the draft

Ben approved the plan and the recommended answers: a transfer is received in full (a difference is fixed with an adjustment at the destination), dispatch and receive are separate steps with separate permissions, numbering is `TR-000001` per organization, and a transfer into quarantine needs approval like any other.

What was built differs from the draft in these places (all simplifications, none weakens the approval rule):
- **Org settings (section 8) are not built yet.** Version 1 always refuses a storage-condition mismatch (same rule as batch receipts in `sql/026`) and always requires the receive confirmation. The two settings can be added later without changing the tables.
- **Routes:** approve and reject are two routes (`/transfers/:id/approve`, `/reject`), like requests and adjustments, instead of one `/decision` route.
- **Validation** is written by hand in the route (same as the other inventory routes); there are no zod schemas in `packages/shared` for inventory today. The database re-checks everything.
- **Cancel by managers:** a requester, or an owner or admin, can cancel before dispatch (the screen shows the button to them only).
- **Screens** use plain English strings like the other inventory screens; moving all inventory screens to translated strings stays with the Arabic work.
- **Not run:** `sql/033` and `sql/tests/029` need to be run in Supabase (migration first, then the test, which always rolls back); log both in the worklog.
