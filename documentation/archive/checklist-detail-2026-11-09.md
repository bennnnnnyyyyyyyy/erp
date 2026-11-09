# Archived checklist details — 9 November 2026

These plan-by-plan notes were moved out of the active checklist because several dated blocks still described work as waiting, not deployed, or not started after the current status had changed. They are retained as historical snapshots, not as a live task list. Use the [current status](../plans/checklist.md), [worklog](../operations/WORKLOG.md), and [SQL migration register](../../sql/README.md) for current state.

## Foundation and demand proof

- [TECHNICAL_PLAN.md](../plans/TECHNICAL_PLAN.md), Phase 0: foundation.
  - **Done (2026-10-28):** documentation system and `agents.md`; generic code foundation copied; typecheck and tests green; ADR-0003 rework in code (user-scoped client, RPC functions, boundary test); `sql/003` written.
  - **Waiting on (snapshot):** a Supabase project to run `sql/001`–`003`; product name; ADR deciders.
  - **Remaining (snapshot):** run and verify SQL; SQL isolation and audit tests; write README and PRODUCT_BRIEF; move two plans into documentation; accept or revise the ADRs.
- Step 0 demand proof (see [MANAGEMENT_PLAN.md](../planning/MANAGEMENT_PLAN.md), section 5).
  - **Done (snapshot):** nothing yet.
  - **Remaining (snapshot):** hands-on trials of six competitors; 8–10 customer interviews.

## Inventory and operations

- [INVENTORY_PLAN.md](../plans/INVENTORY_PLAN.md).
  - **Done (reconciled 2026-11-02):** plan approved for slice 1; slice 1 and later slices (adjustments, approval policies, batches and expiry, forecast, reorder levels, transfers) built, applied to Supabase and deployed; see the worklog. This block said “nothing” on 28 Oct.
  - **Remaining (snapshot):** partial transfer receipts, filters and pagination on lists, CSV import, returns.
- [INVENTORY_TRANSFERS_PLAN.md](../plans/INVENTORY_TRANSFERS_PLAN.md): inventory transfers between warehouses, with approval.
  - **Done (2026-11-02):** plan approved; `sql/033_inventory_transfers.sql`, test 029, API routes, permission keys, screens and demo data built. Root typecheck clean; 5 shared and 39 API tests passed.
  - **Done (2026-11-02):** `sql/033` applied and test 029 passed in Supabase; deployed and browser-checked. The full request/approve/dispatch/receive flow and self-approval refusal were checked in demo; the self-approval refusal was checked on live DB for stock requests. `sql/034` and `sql/035` applied and verified.
  - **Remaining (snapshot):** live multi-role transfer test; storage mismatch and receive confirmation settings; partial receipt.
- [SUPPLIER_INVOICES_PLAN.md](../plans/SUPPLIER_INVOICES_PLAN.md): supplier invoices.
  - **Done (2026-10-30):** partial supplier bills against received POs, received/billed/remaining value summary, duplicate invoice protection, and billed quantity guard; migration 018 and SQL isolation test 014 passed.
  - **Waiting on (snapshot):** Ben's commit/push and manual UI check after deployment.
  - **Remaining (snapshot):** tax, payments, credit notes and accounting export.
- [OWNER_INSIGHTS_PLAN.md](../plans/OWNER_INSIGHTS_PLAN.md): owner home, finance, triggers, forecast, batches and expiry.
  - **Status in original checklist:** draft, waiting for approval and answers to section 16.

## Accounting and finance

- [ACCOUNTING_PLAN.md](../plans/ACCOUNTING_PLAN.md): accounting, phase 1 (general ledger).
  - **Done (2026-11-05):** plan and [ADR-0004 draft](../architecture/decisions/DRAFT_ADR-0004-general-ledger.md) written on branch `accounting-phase1`; Egyptian chart research in [UNIFIED_CHART_OF_ACCOUNTS.md](../reference/egypt-accounting/UNIFIED_CHART_OF_ACCOUNTS.md).
  - **Done (2026-11-06):** `sql/045`–`049` applied to live (tests 040–044 passed); permissions, API routes/tests and screens built on `accounting-phase1`, not deployed at that snapshot.
  - **Waiting on (snapshot):** Ben's browser check after deploy; pilot accountant input for unconfirmed codes; moving the ADR draft into `architecture/decisions/`.
  - **Remaining (snapshot):** deploy API and web; switch accounting on for demo company and check trial balance; issue-reason picker on stock requests.
- [TREASURY_PLAN.md](../plans/TREASURY_PLAN.md): phase 2, treasury, branches, party codes and statements.
  - **Done (2026-11-06):** plan written and approved; `sql/050`–`052` applied to live; API and screens built on `treasury-phase2`, not deployed at that snapshot.
  - **Remaining (snapshot):** deploy; browser check with accounting and treasury enabled; cheques pending accountant input; per-branch permissions and reports later.

## Integrations and older roadmap notes

- [ETA_EINVOICING_PLAN.md](../plans/ETA_EINVOICING_PLAN.md): e-invoicing in progress, not deployed at the 3 Nov snapshot.
  - **Done (2026-11-03):** slice A applied; document builder, serializer and API routes implemented. **Not started at that snapshot:** screens, credential storage, callback route, submission queue, real signing, finance integration. See [ETA workstream log](../operations/ETA_WORKSTREAM_LOG.md).
- [ONBOARDING_WIZARD_PLAN.md](../plans/ONBOARDING_WIZARD_PLAN.md): first-run setup wizard.
  - **Done (2026-11-04, branch `worktree-onboarding-wizard`, not merged at that snapshot):** eight-step wizard using existing routes, English and Arabic, tests, typecheck, lint and build.
  - **Waiting on (snapshot):** Ben's review/merge and browser check in a new company.
  - **Remaining (snapshot):** item import, saved progress, VAT/ETA question.
- [SUPERFIX_WORKFLOW_PLAN.md](../plans/SUPERFIX_WORKFLOW_PLAN.md): workflow gaps from ERPNext and Dolibarr teardowns.
  - **Done (2026-11-03 snapshot):** S1 lock date (`sql/040`), S2 payment terms and due dates (`sql/041`), S3 stock count sessions (`sql/042`), S4 customer returns through credit notes (`sql/043`), S5a units with conversion (`sql/044`); tests 035–039 and API routes written.
  - **Waiting on (snapshot):** approval to dry-run/apply 040–044 on live and the S6 storage decision.
  - **Remaining (snapshot):** S5b, S6 external audit-chain anchor, screens, WhatsApp/voice approval of counts.
- [ROADMAP_ACCOUNTING_SUITE.md](../plans/ROADMAP_ACCOUNTING_SUITE.md): accounting suite phases 0–9.
  - **Done (2026-11-05 snapshot):** draft written from the meeting and demo notes.
  - **Waiting on (snapshot):** Ben's approval and answers Q1–Q8; approval to apply 040–044 live.
  - **Remaining (snapshot):** module plan per phase; ADR for general ledger.
- Language choice in Settings.
  - **Done (2026-11-02):** “My language” in Settings → General; company language is a default and does not override a person's choice.
  - **Remaining (snapshot):** translate remaining screens once the Arabic review owner is decided.

For the current status of any item above, use the active checklist and worklog. These historical blocks are not open work by default.
