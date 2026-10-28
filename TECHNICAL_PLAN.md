# Technical Plan: Warehouse-first ERP for Egypt and GCC SMEs

**Status:** Draft v0.1, 28 October 2026
**Inputs:** `migration.md` (repo/stack decisions), `temp/MANAGEMENT_SUMMARY_market_gaps.md`, `temp/MEETING_PREP_QA.md`
**Product name:** TBD (placeholder: "the ERP")

This plan is organised around the **cons**: every weakness the research found in competitors, plus the risks the research says we carry ourselves. Each con gets a concrete technical answer, a way to prove it, and a phase. The architecture in section 3 exists to serve those answers, not the other way round.

Evidence labels follow the research: *(research)* = public-source finding, *(unconfirmed)* = still needs a trial or interview. Nothing marked unconfirmed should drive a build decision until checked.

---

## 1. Principles

1. **A control that lives only in the UI is not a control.** Approval, audit and tenancy are enforced in Postgres. The API and the messaging layer are clients of the rules, never the holders of them.
2. **Stock is a ledger.** Quantities are derived from append-only movements. Nothing edits a balance directly.
3. **Channels are plug-ins.** In-app, WhatsApp and voice all submit the same signed "decision" to the same function. The first slice ships with in-app only; the interface is final from day one.
4. **No plan gating of core warehouse function.** Modules are switched on per org; features inside a module are not held back by tier.
5. **Egypt first, GCC ready.** EGP is the default currency, not a hardcoded one. Arabic and RTL are built in from the first screen, not added later.
6. **Smallest slice that tests the hypothesis.** Item, outgoing request, manager approval, issue, audit entry. Everything else waits for interview evidence.

---

## 2. Cons register: attack plan

### 2A. Cons found in competitors (our openings)


| #   | Con (source)                                                                                                                                                                    | Technical answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Proof it works                                                                                                                                                                            | Phase                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C1  | **Approval may not really hold stock.** Edara "transfer approvals: check it truly holds stock"; Odoo has no native manager gate on internal transfers *(research, unconfirmed)* | The gate is a **database state machine**. A stock issue can only be posted by `inv_post_issue(request_id)`, which refuses unless the request is `approved` and the approver is not the requester. Direct inserts into `inv_stock_moves` are revoked from every role except the function owner. Pending requests **reserve** quantity so it cannot be issued, sold or transferred elsewhere in the meantime. See 4.3.                                                                                    | Automated test: with the API bypassed entirely (raw SQL as `authenticated` and as the Worker's role), no path creates an outgoing movement without an approved request.                   | Slice 1                                                                 |
| C2  | **No edit-history log.** Edara has only a deleted-documents view; Daftra and Wafeq show no log *(research)*                                                                     | **Trigger-based audit inside the same transaction** as the change, so a change cannot exist without its audit row. Field-level before/after diff, actor, channel, request id. `audit_log` is append-only (update/delete raise) and **hash-chained per org** so tampering or gaps are detectable. Audit is also a first-class screen with entity history ("who changed this item's reorder level"). See 4.4.                                                                                             | Test: every mutating RPC produces exactly the expected audit rows; chain verification function returns clean; attempted `update`/`delete` on `audit_log` fails even for the service role. | Slice 1                                                                 |
| C3  | **WhatsApp is outbound-only.** Edara shares sales orders; Odoo Enterprise likely; Daftra via Zapier. Nothing for staff approvals or tasks *(research)*                          | A **messaging layer** (`msg_` tables, section 5): inbound webhook, outbound outbox, conversation state, template registry. Approvals arrive as an **approval decision** with a one-time token bound to (request, approver, channel), expiry, and replay protection. Same function as in-app approval (`inv_decide_request`).                                                                                                                                                                            | Contract test: a fake WhatsApp adapter and the in-app adapter produce byte-identical decision records and audit rows.                                                                     | Layer in slice 1 (interface + in-app adapter); WhatsApp adapter slice 2 |
| C4  | **Voice and Egyptian Arabic are unserved.** Voice vendors are standalone; no Egyptian-dialect voice found *(research)*                                                          | Voice is just another channel adapter behind the same interface. Pipeline: telephony/WhatsApp voice note, speech-to-text, **intent extraction constrained to a closed schema** (approve / reject / ask, request id), **read-back confirmation** ("Approve issue of 40 cartons of item X to Y? Say yes"), then the same decision function. STT/TTS providers are swappable. Voice can never approve alone above an org-set value threshold; it falls back to a WhatsApp or in-app confirmation. See 5.4. | An Egyptian Arabic **evaluation set** (recorded phrases for approve/reject/quantities/item names) with a pass rate we must hit before voice ships.                                        | Phase 3 (after WhatsApp validated by interviews)                        |
| C5  | **USD or hidden pricing; EGP almost absent.** Only Wafeq shows EGP *(research)*                                                                                                 | Billing in EGP: price list table per currency, invoices in EGP, **FX never silently applied**. Public price page generated from the same `plans` table the billing code reads, so what is shown is what is charged. Payment via an Egyptian-capable provider (decision needed, see section 9). Costs that are USD-linked (SMS, WhatsApp conversations, STT) are **metered and passed through or bundled with an explicit cap**, never a surprise charge.                                                | Price page and billing share one source; a test fails if they diverge.                                                                                                                    | Before first paying customer                                            |
| C6  | **Warehouse features gated by plan or add-on.** Wafeq (top plan), Zoho (Elite), Odoo (approval add-ons ~USD 16-40) *(research)*                                                 | `org_modules` switches on whole modules; **inside `inventory`, nothing is tiered.** Multi-warehouse, lots, expiry, approvals and audit are all in. Plan differences are users, volume and optional modules (messaging volume, voice minutes), declared in code in `packages/shared` so they are visible and testable.                                                                                                                                                                                   | A plan-matrix test asserts no inventory permission key is plan-restricted.                                                                                                                | Always                                                                  |
| C7  | **Warehouse depth for small firms.** Serial/lot/expiry, multi-warehouse, costing (Edara FIFO/LIFO/average; Daftra serial/lot/expiry) *(research)*                               | Ledger design supports these without schema change: movement rows carry optional `lot_id`, `serial_no`, `expiry_date`; costing method is an org setting (average first, FIFO second). Slice 1 ships single-UoM, single-warehouse paths but **the columns exist from the first migration** so later depth is additive.                                                                                                                                                                                   | Migration review: no later slice requires altering `inv_stock_moves` shape.                                                                                                               | Columns slice 1; features phase 2                                       |
| C8  | **Weak mobile.** Reviewers want better mobile at Edara *(research)*                                                                                                             | Warehouse screens are **mobile-first PWA** (installable, large touch targets, barcode via camera). Offline queue for counts and receipts with idempotent replay (client-generated UUIDs). Approvals specifically are designed to work from a phone notification or a WhatsApp message with no login.                                                                                                                                                                                                    | Manual test on a mid-range Android over throttled network; replay test for duplicate submits.                                                                                             | Responsive from slice 1; offline phase 2                                |
| C9  | **Arabic quality.** Zoho default not optimised; NetSuite Arabic licensing extra *(research)*                                                                                    | i18n keys from the first component (`ar-EG` and `en`), logical CSS properties (no left/right), RTL layout tests, Arabic-Indic digit display option per user, number/date formatting through `Intl`. UI copy written by a native Egyptian Arabic speaker, not machine-translated. Arabic item names and search (normalisation of alef/ya/ta marbuta, diacritics) in the item search function.                                                                                                            | RTL visual review on every screen; search test with variant spellings.                                                                                                                    | Slice 1                                                                 |
| C10 | **API only on a high plan; costly customisation.** Odoo API on Custom plan; Edara extra cost for customisation *(research)*                                                     | Public REST API and **outbound webhooks for every org**, same permission model as the UI. Per-org **custom fields** (typed, validated, stored in `jsonb` with a definition table) instead of code customisation. Approval **policies as data** (thresholds, levels, roles), not code.                                                                                                                                                                                                                   | Every UI action is reachable by an API key scoped to a role.                                                                                                                              | API slice 1; webhooks and custom fields phase 2                         |
| C11 | **Upgrade fragility.** Odoo 20 removes record rules, custom modules need review *(research)*                                                                                    | No per-customer code. Variation lives in settings, custom fields and policies. Migrations are numbered, rerun-safe, with verification queries (already our standard). RLS and isolation tests run in CI on every migration.                                                                                                                                                                                                                                                                             | CI gate.                                                                                                                                                                                  | Always                                                                  |
| C12 | **AI features need paid credits; approval add-ons ~USD 299.** *(research)*                                                                                                      | AI is **optional and never on the critical path**. The deterministic flow (item, request, approve, issue) works with AI disabled. Where AI is used (intent extraction, summaries), usage is metered per org and visible.                                                                                                                                                                                                                                                                                | Feature flag off by default; suite passes with AI provider unreachable.                                                                                                                   | Phase 3                                                                 |
| C13 | **Heavy, expensive implementation.** ERPNext USD 15,000-100,000; Odoo USD 5,000-200,000 *(research)*                                                                            | Self-serve onboarding: org creation, CSV import for items/opening stock with a dry-run report, starter templates (roles, approval policy, units), sample data toggle. Target: a 5-person warehouse live in one afternoon without a partner.                                                                                                                                                                                                                                                             | Timed onboarding test with a non-technical user.                                                                                                                                          | Phase 2                                                                 |
| C14 | **Limited support hours (Edara); thin local support.** *(research)*                                                                                                             | Not solvable by code alone, but reduce load: in-product audit and "why was this blocked" explanations (a blocked action states the exact rule and the person who can resolve it), status page, and an ops runbook. Decision on support staffing is a business item.                                                                                                                                                                                                                                     | Every rejected action returns a machine and human-readable reason code.                                                                                                                   | Slice 1 (reason codes)                                                  |
| C15 | **Egypt e-invoicing (ETA) and Saudi (ZATCA) are table stakes** at Edara and Daftra *(research)*                                                                                 | **Decision needed from management** (day one or phase 2). Technical stance: do **not** build in slice 1, but make it cheap later: documents carry tax lines, tax registration numbers, and a stable document UUID from the start; an `einvoicing` module is a separate adapter (ETA first) behind the same port/adapter pattern as messaging. Option to integrate via a licensed provider instead of direct ETA to cut time.                                                                            | Slice-1 invoice/delivery docs pass a schema review against ETA required fields.                                                                                                           | Decision gate before phase 2                                            |
| C16 | **Data residency.** Wafeq stores Saudi data in KSA *(research)*                                                                                                                 | Org has a `region` setting from day one; Supabase project region is a deployment property, so a KSA/UAE-resident project can be added later without code change. State clearly that the first deployment is single-region.                                                                                                                                                                                                                                                                              | Config test: region comes from settings, never hardcoded.                                                                                                                                 | Setting in slice 1; deployment later                                    |

### 2B. Cons we carry ourselves


| #  | Risk (source)                                                                                                                                                                                                                                            | Technical answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| R1 | **Demand is untested.** No customer asked yet; 8-10 interviews pending *(research)*                                                                                                                                                                      | Build only the vertical slice. Instrument it (section 8) so a pilot answers: how many approvals happen in-app vs messaging, time-to-approve, rejection rate. **Do not build WhatsApp/voice adapters before interviews say yes.** Interface exists so the build is cheap if they do.                                                                                                                                                                                                                                                                                                           | Gate              |
| R2 | **The window may close.** Odoo and Business Central have MCP and agents; WideBot does Arabic voice *(research)*                                                                                                                                          | Speed to slice 1 and a working pilot. Expose our own MCP/webhook surface later so we are a *target* of those agents, not only a competitor.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Ongoing           |
| R3 | **Price floor already ~USD 35-70.** Hard to undercut *(research)*                                                                                                                                                                                        | Compete on clarity and the messaging workflow, not price. Keep unit cost low: Cloudflare Workers + Supabase are inexpensive at SME scale; meter the variable costs (messaging, voice).                                                                                                                                                                                                                                                                                                                                                                                                        | Business          |
| R4 | **Facts unconfirmed** (Edara audit, Odoo ETA, Daftra approval, prices) *(research)*                                                                                                                                                                      | Run the six-point trial checklist before locking scope. Feature decisions reference a trial finding or an interview, recorded under `research/`.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Before scope lock |
| R5 | **Reused foundation bypasses RLS.** The old repo's Worker uses the Supabase secret key, so tenant scoping depends on every query remembering `org_id`; audit is written in a **separate call** after the mutation (`apps/api/src/lib/db.ts`, `audit.ts`) | This directly contradicts C1/C2. For the new product, **mutations go through Postgres functions** that take the org from the verified JWT claim, run in one transaction, and write the audit row themselves. The Worker keeps the secret key only for admin tasks (provisioning, webhooks). See 3.2. **DECIDED 28 Oct 2026: rework.** This is the largest change to the migrated foundation. `db.ts` and `audit.ts` move from "keep as is" to "keep but rewrite" in the migration table, and the old repo is not touched (the rework happens in the new repo). Recorded as ADR-0003, see 3.4. | Phase 0           |
| R6 | **Concurrency on stock** (two approvals / two issues racing)                                                                                                                                                                                             | Row-level locks on the balance row inside the issue function; reservation check and decrement in one statement; negative stock forbidden unless org setting allows, with the setting audited.                                                                                                                                                                                                                                                                                                                                                                                                 | Slice 1           |
| R7 | **Messaging identity risk** (wrong person approves via a forwarded message or reused phone number)                                                                                                                                                       | Phone numbers are **verified and bound** to a user (one-time code in-app) before they can decide anything; decisions require the bound number, a one-time token and an unexpired request; number changes are audited and revoke pending tokens.                                                                                                                                                                                                                                                                                                                                               | Slice 2           |
| R8 | **Third-party messaging limits and policy** (WhatsApp templates, 24-hour window, opt-in, number approval)                                                                                                                                                | Outbound goes through an **outbox** with templates registered per org; in-app and email fallbacks; delivery status stored; rate limits and retry with backoff. Treat WhatsApp as unreliable by design: an approval request never depends on a single delivered message.                                                                                                                                                                                                                                                                                                                       | Slice 2           |

---

## 3. Architecture

### 3.1 Stack (carried from the migration brief)

- **API:** Cloudflare Worker (Hono), `apps/api/`.
- **Web:** React PWA, `apps/web/`, module-driven shell.
- **Shared:** `packages/shared/` types, permission keys, module manifest, Zod schemas.
- **DB:** Supabase Postgres, migrations in `sql/`, numbered and rerun-safe, ending with read-only verification queries.
- **Async:** Cloudflare Queues for the message outbox and webhook delivery; Cron triggers for expiry sweeps (approval expiry, token cleanup).

### 3.2 Request path: where each rule is enforced

```
Client (web / WhatsApp / voice)
   |  JWT or signed channel decision
   v
Worker: authenticate, resolve org, requirePermission('inventory.request.approve')   <- fast fail, UX
   |  user-scoped client (anon key + user JWT), NOT the secret key
   v
Postgres RPC  inv_decide_request(...)      <- THE enforcement point
   - org from auth.jwt() claim, never from the request body
   - RLS on every table (org_id)
   - state machine check, self-approval check, reservation check
   - writes stock_moves + audit_log in the same transaction
```

Rules:

- The Worker's permission check is for early rejection and clean errors. **Passing it grants nothing**; the function re-checks permission from the DB.
- Business tables grant `select` to `authenticated` (via RLS) and **no direct insert/update/delete**; writes happen only through `security definer` functions with a pinned `search_path`.
- The secret-key client is limited to provisioning, webhook ingestion (before a user exists) and scheduled jobs, in clearly named files, with tests that no request-handling route imports it.

### 3.4 Rework of `db.ts` and `audit.ts` (decided)

Old files, from the GGO repo: `db.ts` returns one secret-key client (bypasses RLS); `audit.ts` inserts the audit row in a second call after the mutation.


| New file (new repo) | Replaces   | Behaviour                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/db.user.ts`    | `db.ts`    | `userDb(env, jwt)`: Supabase client with the **anon key plus the caller's JWT**, so RLS and `auth.jwt()` claims apply. Used by all request-handling routes.                                                                                                                                                                                                                        |
| `lib/db.admin.ts`   | `db.ts`    | `adminDb(env)`: secret-key client. Only imported by provisioning, webhook ingestion and cron jobs. A lint/test rule fails the build if a route file imports it.                                                                                                                                                                                                                    |
| `lib/rpc.ts`        | new        | Typed wrapper `callRpc<T>(client, name, args)` that maps Postgres errors carrying our reason codes (`APPROVAL_REQUIRED`, `SELF_APPROVAL`, `INSUFFICIENT_AVAILABLE`, ...) to API errors.                                                                                                                                                                                            |
| `lib/audit.ts`      | `audit.ts` | **No `writeAudit()` for stock or approvals.** Audit is written by DB triggers and RPCs in the same transaction. The file keeps only `auditContext(c)`, which sets `app.actor`/`app.channel`/`app.request_id` for the transaction, and a read helper for the audit screen. A `writeAudit` for non-database events (login, export) calls an `audit_append` RPC, never a bare insert. |

Also needed (new repo, `sql/`): a custom access-token hook (or equivalent) that puts `org_id` and membership role into the JWT; `audit_append`, `audit_row_change`, `audit_verify`; revokes on direct writes. Migration order: tenancy core, JWT claims, audit v2 (hash chain), then inventory.

Existing migrated tests must be re-run against the user-scoped client: the isolation suite is what tells us the rework did not open a hole.

### 3.3 Module layout

Follows the existing module convention exactly:


| Module key   | Purpose                                                                  | Slice                        |
| -------------- | -------------------------------------------------------------------------- | ------------------------------ |
| `core`       | orgs, memberships, roles/permissions, org settings, audit read           | 1                            |
| `inventory`  | items, warehouses, stock ledger, requests, approvals                     | 1                            |
| `messaging`  | channel adapters, outbox, conversations, templates, identity binding     | 1 (interface) / 2 (WhatsApp) |
| `tasks`      | assignable warehouse tasks (pick, count, receive) over the same channels | 2                            |
| `billing`    | plans, EGP price list, metering (our own subscriptions)                  | before first paying customer |
| `einvoicing` | ETA/ZATCA adapters                                                       | gated, section 2A C15        |
| *(waves 2-3)* | `parties`, `purchasing`, `sales`, `invoicing`, `accounting_export`      | see 3.5                      |

Tables are prefixed by module (`inv_`, `msg_`, `tsk_`, `bil_`, `pur_`, `sal_`, `prt_`, `ivc_`, `acc_`).

### 3.5 Module roadmap beyond the first slice

The slice is the wedge, not the product. The modules below close the stock loop and then add money. Each wave is gated by pilot evidence; none is built before the one above it is validated.

| Wave | Module key | Purpose | Depends on | Notes |
|---|---|---|---|---|
| 1 | `core`, `inventory`, `messaging` | as 3.3 | | Slice 1 |
| 2 | `parties` (`prt_`) | customers and suppliers, tax registration numbers, contacts | core | Needed by purchasing, sales and e-invoicing; tax fields already planned in 12.1 |
| 2 | `purchasing` (`pur_`) | purchase orders, goods receipt, supplier returns | inventory, parties | Receipts post `receipt` moves through the same ledger functions |
| 2 | `sales` (`sal_`) | sales orders, delivery notes, customer returns | inventory, parties | **Outgoing stock requests link to a sales order or delivery note**; the approval policy can key on order value |
| 3 | `invoicing` (`ivc_`) | customer invoices, credit/debit notes, payments received | sales, parties | Issued documents locked, see 12.1 |
| 3 | `einvoicing` | ETA/ZATCA adapter | invoicing | Gated by C15 decision |
| 3 | `accounting_export` (`acc_`) | scheduled/manual export of invoices, payments and stock valuation to the customer's accounting tool | invoicing, inventory | **Deliberately not a general ledger**: valuation is posted as journal summaries per period |
| Later | `pos`, `manufacturing`, `ledger` | | | Not planned; revisit on customer demand |

Design consequences now (cheap to do in slice 1, expensive to retrofit):

- Every ledger movement and request has nullable `source_type`/`source_id` so a later order or delivery note can link to it without altering `inv_stock_moves`.
- Approval policies match on a generic "document value and type", not on stock requests only, so sales and purchasing documents reuse the same engine and audit trail.
- The messaging layer's decision schema is document-agnostic (`entity_type`, `entity_id`, `decision`), so WhatsApp/voice approvals work for purchase orders and discounts without a new channel.
- Costing method and currency are org settings from slice 1, because Wave 3 valuation exports depend on them.
- Table prefixes are fixed now, since this is a new codebase and nothing legacy constrains them: `inv_` inventory, `msg_` messaging, `tsk_` tasks, `prt_` parties, `pur_` purchasing, `sal_` sales, `ivc_` invoicing, `acc_` accounting export, `bil_` our own subscription billing, `einv_` e-invoicing submissions. The prefix table lives in `agents.md` once the plan is approved.

---

## 4. Data layer design (inventory, slice 1)

All tables: `id`, `org_id not null references organizations(id)`, `created_at`, `updated_at`, `deleted_at`, RLS, index leading with `org_id`. Money is `bigint` minor units plus ISO 4217 code; timestamps `timestamptz`.

### 4.1 Tables


| Table                   | Notes                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inv_items`             | sku, name, name_ar, uom, tracking (`none`/`lot`/`serial`), reorder_level, custom (jsonb)                                                                                                                                                             |
| `inv_warehouses`        | code, name, name_ar, active                                                                                                                                                                                                                          |
| `inv_stock_moves`       | **append-only ledger**: item_id, warehouse_id, qty (signed, numeric(18,3)), kind (`receipt`/`issue`/`transfer_in`/`transfer_out`/`adjust`), request_id, lot_id?, serial_no?, expiry_date?, unit_cost_minor?, currency, posted_by, channel, posted_at |
| `inv_stock_balances`    | on_hand, reserved per (item, warehouse[, lot]); maintained **only** by the posting functions                                                                                                                                                         |
| `inv_requests`          | outgoing stock request: number, requested_by, warehouse_id, status, reason, needed_by, total_value_minor                                                                                                                                             |
| `inv_request_lines`     | request_id, item_id, qty                                                                                                                                                                                                                             |
| `inv_approvals`         | request_id, level, approver_user_id, decision (`approved`/`rejected`), comment, channel, decided_at, evidence (jsonb: token id, message id, call id)                                                                                                 |
| `inv_approval_policies` | per org: matching rule (warehouse, value threshold, item category), levels, required role per level, expiry hours                                                                                                                                    |

### 4.2 Request state machine

```
draft -> submitted -> approved -> issued
              |          |
              |          +-> cancelled (before issue; releases reservation)
              +-> rejected
              +-> expired   (cron; releases reservation)
```

Transitions are allowed only through named functions. A trigger rejects any status change not in the allowed table, so even a direct `update` by the function owner cannot skip a state.

### 4.3 Making the approval real (C1)

- `inv_submit_request`: validates lines, **reserves** qty (`reserved += qty` under lock; fails with `INSUFFICIENT_AVAILABLE` if `on_hand - reserved < qty`), picks the matching policy, writes audit.
- `inv_decide_request(request_id, decision, channel, evidence)`: caller must hold the approver role for the next required level, **must differ from `requested_by`** (policy can allow override, audited), request must be `submitted` and unexpired. Multi-level: status becomes `approved` only when all levels are satisfied.
- `inv_post_issue(request_id)`: requires `approved`; inserts `issue` moves, decrements `on_hand` and `reserved`, sets `issued`, writes audit. Idempotent on `request_id`.
- Revoke `insert`/`update`/`delete` on `inv_stock_moves`, `inv_stock_balances`, `inv_approvals` from all application roles. Add a trigger on `inv_stock_moves` that rejects an `issue` row whose `request_id` is not `approved` (belt and braces behind the function).

### 4.4 Audit (C2)

- Generic trigger `audit_row_change()` attached to every business table: records `table`, `row id`, `action`, changed-field diff (`before`/`after` only for changed columns), `actor` (from `auth.uid()` or a `set_config('app.actor', ...)` set by functions), `channel`, `request_id`.
- `audit_log`: `seq` (per-org monotonic), `prev_hash`, `hash = sha256(prev_hash || canonical row)`. A scheduled `audit_verify(org)` recomputes the chain and records the result; a break raises an alert.
- Append-only enforced by trigger (as in the current `sql/001`) **plus** revoking update/delete; the verification query set includes an attempted update that must fail.
- Soft delete only; `deleted_at` changes are audited like any other field.

---

## 5. Messaging layer (the differentiator)

### 5.1 Ports and adapters

```
interface ChannelAdapter {
  kind: 'in_app' | 'whatsapp' | 'voice' | 'email'
  send(msg: OutboundMessage): Promise<DeliveryReceipt>
  parseInbound(raw: Request): Promise<InboundEvent>   // verifies provider signature
}
```

Inbound events become one of: `decision` (approve/reject a pending request), `task_update`, or `free_text` (routed to a human). Business logic never sees provider payloads.

### 5.2 Tables


| Table                 | Notes                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `msg_identities`      | user_id, channel, address (E.164 phone), verified_at, revoked_at                                                       |
| `msg_outbox`          | message to send: template, params, target identity, related entity, status, attempts, next_attempt_at, idempotency_key |
| `msg_events`          | every inbound/outbound event, provider message id, raw payload hash, delivery status                                   |
| `msg_decision_tokens` | token hash, request_id, approver_user_id, channel, expires_at, used_at                                                 |
| `msg_templates`       | per org, per language (`ar-EG`, `en`), provider approval status                                                        |

### 5.3 Approval over messaging: flow

1. `inv_submit_request` commits, then enqueues one outbox row per approver per channel preference (**transactional outbox**, so a crash cannot lose a notification or send one for a rolled-back request).
2. Message carries a summary (requester, items, quantities, value) and reply options. Token is single-use, bound to (request, approver, channel).
3. Reply arrives at the webhook; signature verified; sender number matched to a **verified** `msg_identities` row; token validated and consumed; `inv_decide_request` called with `evidence` (message id, token id).
4. Confirmation sent back. If anything fails (unknown number, expired, already decided) the reply states why and offers the in-app link.
5. Webhook handling is idempotent on provider message id.

### 5.4 Voice (phase 3)

Voice note or call, transcribed by a swappable STT provider; extraction maps to the same closed `decision` schema, never free-form actions; **read-back and explicit confirmation** before any state change; value threshold forces a second channel confirmation; transcripts and audio references are stored in `msg_events` and linked in the audit row. Providers are chosen by the Egyptian Arabic evaluation set, not by brand.

### 5.5 What messaging must never do

- Create or change stock directly. It can only submit a decision to `inv_decide_request`.
- Treat a delivered message as proof of identity. Proof is verified number + valid unused token.
- Be the only path. Every pending approval is also visible and decidable in-app.

---

## 6. Multi-tenancy, security, compliance

- Every table `org_id` + RLS. Isolation tests per table (section 7). No "internal-only" exceptions.
- Org comes from the JWT claim set at login/membership change, never from a request parameter.
- Permissions are keys in `packages/shared` (`inventory.request.create`, `.approve`, `.issue`, `inventory.audit.read`, ...) mapped to roles per org; DB functions check the same keys.
- Secrets only in Cloudflare/Supabase secrets; none in source, logs, plans or worklogs. Provider webhook secrets rotate without downtime (two active keys).
- PII (phone numbers, voice recordings): collected only for verified channel binding, retention period as an org setting, deletable on request except audit references (store hashes in audit, content elsewhere).
- Rate limiting on inbound webhooks and token validation (brute force on tokens).

---

## 7. Testing strategy


| Layer                         | What                                                                                                                                 | Proves     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| SQL tests (pgTAP or scripted) | state machine, self-approval refusal, reservation, negative stock, direct-insert refusal, audit trigger coverage, chain verification | C1, C2, R6 |
| Isolation suite               | for **every** table: user in org B cannot select/insert/update/delete org A rows, through RLS **and** through each RPC               | tenancy    |
| API tests                     | permission fast-fail, error reason codes, idempotency                                                                                | C14        |
| Channel contract tests        | in-app and fake-WhatsApp adapters yield identical decisions/audits; replayed token rejected; unverified number rejected              | C3, R7     |
| Concurrency test              | N parallel issues against limited stock never oversell                                                                               | R6         |
| Plan-matrix test              | no inventory permission is plan-restricted                                                                                           | C6         |
| i18n/RTL                      | key coverage `ar-EG` vs `en`; RTL snapshot; Arabic search variants                                                                   | C9         |
| Voice eval (phase 3)          | Egyptian Arabic phrase set pass rate                                                                                                 | C4         |

`npm run typecheck` and `npm test` stay the root gates; SQL and isolation tests are added to CI.

---

## 8. Instrumentation (to test the hypotheses, not for vanity)

Recorded per approval: channel, time from submit to decision, decision, level, whether the approver had to open the app. Per org: requests/week, rejection rate, expired rate. These answer R1 (do people use messaging approvals, and do they get faster?) and feed the pricing conversation. Stored in `audit_log` plus a small `inv_request_metrics` view; no third-party analytics SDK in the web app.

---

## 9. Phasing


| Phase               | Deliverable                                                                                                                                                                | Exit test                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Foundation**    | Migrate generic foundation per `migration.md`; **resolve R5 first**: write ADR-0003 "mutations via RPC, user-scoped client" and rework `db.ts`/`audit.ts` accordingly      | Isolation suite green on core tables; audit written atomically                                                                                                 |
| **1 Slice**         | Item, outgoing request, manager approves (in-app), issue, audit entry; reason codes; AR/EN + RTL; message interface with in-app adapter                                    | The SQL tests in section 7 (state machine, self-approval, reservation, direct-insert refusal, audit coverage) pass; a manager can complete the flow on a phone |
| **2 Pilot-ready**   | WhatsApp adapter (if interviews say yes), identity binding, outbox, CSV import, onboarding, receipts/transfers/counts, lots/expiry, offline queue, webhooks, custom fields | A pilot customer onboarded in one afternoon; approval-over-WhatsApp contract tests green                                                                       |
| **3 Differentiate** | Tasks over messaging, voice channel, AI intent extraction (flagged), EGP billing and metering                                                                              | Egyptian Arabic eval threshold met; EGP price page and billing share one source                                                                                |
| **Gate**            | e-invoicing decision (C15), regional data residency deployment (C16)                                                                                                       | Management decision recorded as an ADR                                                                                                                         |

**Hard gates before phase 2:** the six-point trial checklist (R4) and at least 8 interviews (R1) are done, and their results change the plan if they contradict it.

---

## 10. Open decisions (need a human)

1. ~~R5 / foundation~~ **Decided: rework `db.ts` and `audit.ts` (3.4).**
2. **C15 compliance:** e-invoicing timing and route. Options and recommendation in section 12; pending.
3. **WhatsApp provider:** Meta Cloud API directly or a local BSP (cost in EGP, template approval speed, local support)? Needs quotes.
4. **Payments (C5):** gateway shortlist in section 13 (Paymob is the working assumption, not decided). Which company entity bills?
5. **Voice vendor shortlist** (WideBot, Sai, Ziwo, or STT API direct): decided after phase 1, by evaluation set.
6. **Product name and branding** (affects the migration "rewrite" group).
7. **Hosting region** for the first customers (Supabase region; Egypt/KSA residency expectations from interviews).
8. **Support model** for the first 10 customers (C14).

## 11. Documentation to produce in the new repo

- `documentation/architecture/decisions/ADR-0003-mutations-via-rpc.md` (R5)
- `documentation/architecture/decisions/ADR-0004-channel-ports-and-adapters.md`
- `documentation/plans/INVENTORY_PLAN.md` and `MESSAGING_PLAN.md` from `MODULE_PLAN_TEMPLATE.md`, with the sections above as their source
- `documentation/research/<competitor>/` teardowns from the trial checklist (behaviour only, no code, no copied text or assets)
- WORKLOG entry for each migration and SQL change, as per project rules

---

## 12. Compliance (C15): e-invoicing options, pending decision

**Status:** pending management decision. Everything below is from general knowledge of the Egyptian and Saudi regimes and **must be verified** against the Egyptian Tax Authority (ETA) developer documentation, ZATCA documentation and a current provider quote before anyone commits. Nothing here has been checked in this session.

### 12.1 What we must be ready for regardless of option


| Item                                                                               | Why                                                           | Done in                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------- |
| Tax registration number per org and per customer/supplier                          | Required fields on e-invoices                                 | Slice 1 org settings, party records |
| Tax lines on every sales/delivery document (rate, code, amount in minor units)     | Documents must map to the authority schema                    | Slice 1 doc model                   |
| Stable document UUID, immutable once issued, numbering gaps explained              | Authorities reject or flag gaps and edits                     | Slice 1                             |
| Item codes (GS1/EGS in Egypt) on items                                             | Egypt requires coded items                                    | `inv_items.tax_item_code`, nullable |
| Issued documents are **locked**; corrections are credit/debit notes, never edits   | Authority rule, and matches our audit principle               | Phase 2                             |
| Submission status, authority response and error stored per document                | Support and reconciliation                                    | `einv_submissions` table, phase 2   |
| Digital signing key held outside the app database (HSM, token or provider custody) | Egypt requires signed documents; key custody is the hard part | Option dependent                    |

### 12.2 Routes


| Option                                                | What it is                                                                                       | For                                                                           | Against                                                                                                                   | Rough effort           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **A. Direct ETA integration**                         | We build the signing, submission and status polling against ETA's API as an `einvoicing` adapter | Full control, no per-document fee, strongest long-term moat                   | Key custody and signing are fiddly, certification effort, ETA changes land on us, delays slice 2                          | High (weeks to months) |
| **B. Licensed e-invoicing provider / aggregator**     | We send documents to a provider's API; they sign and submit                                      | Fastest, provider carries regulatory change, may cover ETA and ZATCA together | Per-document or monthly fee, vendor dependency, availability of an Egyptian provider with a stable API is **unconfirmed** | Low to medium          |
| **C. Partner integration (customer's existing tool)** | Export documents/CSV to a tool the customer's accountant already uses                            | Zero build, honest for phase 1 pilots                                         | Weak product story; fails customers who need it native                                                                    | Minimal                |
| **D. Defer**                                          | Not in scope until demand is proven                                                              | Keeps focus on the approval/messaging hypothesis                              | Loses buyers who must submit to ETA (research: native at Edara and Daftra)                                                | None now               |

**Recommendation (to be confirmed):** D for the pilot, B as the first real implementation, A only if provider cost or reliability hurts. The slice-1 data-model items in 12.1 are cheap and make B or A possible later without a migration of issued documents. Saudi (ZATCA Phase 2) and UAE (accredited provider model, mandatory from 1 January 2027 per the research) follow the same adapter, so choose a provider that can also cover them if one exists.

### 12.3 Other compliance items to track (each needs an owner and a check)

- **Data protection:** Egypt Personal Data Protection Law (PDPL) and Saudi PDPL apply to staff phone numbers and voice recordings. Needs consent text, retention setting (6), deletion process, and a legal review of cross-border storage. Unverified specifics.
- **Messaging policy:** WhatsApp Business policy (opt-in, templates, number verification). Treated as technical constraint in R8.
- **Audit retention:** how long tax and stock records must be kept in Egypt/KSA; sets audit and soft-delete retention defaults. Unconfirmed.
- **Accounting standards:** this product holds stock and costs it, it is not a statutory ledger. Decide explicitly whether it ever posts to accounts or only exports to the customer's accounting tool.

### 12.4 Compliance decision record

When decided: ADR-0005 "E-invoicing route", with the date, who decided, the provider quote or ETA documents relied on, and the trigger that would reopen it.

---

## 13. Payments and billing (C5): gateway options

**Status:** shortlist only. Paymob is the working assumption; nothing is decided. **Features, fees and Egypt availability below are unverified**; get written quotes and check subscription support before choosing.

### 13.1 What billing has to do

- Charge in **EGP** subscriptions (monthly/annual) plus metered add-ons (messaging, voice), with a public price table that is also the billing source.
- Pay methods Egyptian SMEs actually use: cards, mobile wallets, Fawry-style cash/reference, bank transfer/InstaPay. B2B customers often want an invoice and bank transfer, not a card.
- Recurring charges with tokenised cards, or a reliable "pay this invoice" link flow if recurring is not supported.
- Webhooks for payment status, signed and idempotent.
- Egyptian tax invoice for our own subscription revenue (our own ETA obligation; tie to section 12).

### 13.2 Candidates


| Gateway                              | Fit                                                                                                           | Open questions                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Paymob**                           | Egyptian, broad local methods (cards, wallets, reference/cash, installments), common choice for Egyptian SaaS | Does it support card-on-file recurring for SaaS? Settlement time, fees, KSA/UAE coverage for later                                  |
| **Kashier**                          | Egyptian, cards and wallets                                                                                   | Recurring support, API quality, fees                                                                                                |
| **Fawry**                            | Largest cash/reference network                                                                                | Better as an add-on method than the primary subscription rail                                                                       |
| **PayTabs / HyperPay / Tap**         | Gulf coverage, some Egypt support                                                                             | Egypt EGP settlement and fees; useful when we sell in KSA/UAE                                                                       |
| **Stripe**                           | Best developer experience                                                                                     | **Understood not to onboard Egyptian merchants directly**; verify. Possible only via a foreign entity, which is a business decision |
| **Manual (bank transfer + invoice)** | Zero integration, matches how many SMEs pay                                                                   | No automation; fine for the first 5-10 customers                                                                                    |

### 13.3 Recommended approach

1. **Pilot:** manual invoice and bank transfer. No gateway code. This keeps phase 2 on the product hypothesis.
2. **First paying cohort:** one gateway behind our own `PaymentProvider` port (same pattern as channels): `createCheckout`, `charge(token)`, `parseWebhook`, `refund`. Start with the shortlisted local gateway, most likely Paymob.
3. **Gulf expansion:** add a second adapter (a Gulf-capable gateway) only when a GCC customer is signed.
4. Billing tables (`bil_` prefix): `bil_plans`, `bil_prices` (per currency), `bil_subscriptions`, `bil_usage_events`, `bil_invoices`, `bil_payments`, `bil_gateway_events` (raw webhook, idempotent on provider id). Money is `bigint` minor units with currency code. Entitlements (`org_modules`) change only from confirmed payment events via an RPC, audited.
5. FX: no silent conversion. If a Gulf customer pays in SAR/AED, the price is a row in `bil_prices`, not a computed rate.

### 13.4 Decisions needed and how to settle them


| Decision                                      | Settled by                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Which gateway first                           | Written quotes from Paymob and one other; test sandbox for card-on-file recurring and webhook signing |
| Billing entity (Egyptian company, or another) | Management / accountant; affects gateway eligibility and our own e-invoicing                          |
| Metered add-on pricing (WhatsApp, voice)      | Provider cost sheets once WhatsApp provider is chosen (section 10, item 3)                            |
| Invoice-first vs card-first for B2B           | Interview question 6 and 8 from the meeting prep                                                      |

Record the choice as ADR-0006 "Payment gateway".
