# Plans Execution Status & Checklist

**Last updated:** 2026-11-09: status overview reconciled with the worklog, including migration 061 and AI notice v2. The 28 Oct "Task list by area" moved to [`../archive/checklist-2026-10-task-list.md`](../archive/checklist-2026-10-task-list.md); the "Detail" blocks below are dated and kept as history. **Where anything disagrees, the worklog wins.**
**Source of truth for what actually happened:** [`../operations/WORKLOG.md`](../operations/WORKLOG.md). Migration status per file: [`sql/README.md`](../../sql/README.md).

## Status overview

| Status | Plans |
|---|---|
| ✅ Built and on live (https://erp-live.pages.dev; `main` deploys on push; see the worklog for what each run verified) | Inventory ([INVENTORY_PLAN.md](INVENTORY_PLAN.md), [INVENTORY_TRANSFERS_PLAN.md](INVENTORY_TRANSFERS_PLAN.md)), purchasing ([PURCHASING_PLAN.md](PURCHASING_PLAN.md), [SUPPLIER_INVOICES_PLAN.md](SUPPLIER_INVOICES_PLAN.md)), sales ([SALES_PLAN.md](SALES_PLAN.md), [CUSTOMER_INVOICES_PLAN.md](CUSTOMER_INVOICES_PLAN.md)), finance, owner home and alerts ([OWNER_INSIGHTS_PLAN.md](OWNER_INSIGHTS_PLAN.md)), messaging and tasks ([TASKS_AND_OUTBOX_PLAN.md](TASKS_AND_OUTBOX_PLAN.md)), workflow gaps S1–S5a ([SUPERFIX_WORKFLOW_PLAN.md](SUPERFIX_WORKFLOW_PLAN.md), `sql/040`–`044`), accounting phase 1 ([ACCOUNTING_PLAN.md](ACCOUNTING_PLAN.md), `sql/045`–`049`, `055`; browser-checked on live 6 Nov), treasury, branches and statements ([TREASURY_PLAN.md](TREASURY_PLAN.md), `sql/050`–`052`), integrations stages A–E in simulated mode ([INTEGRATIONS_PLAN.md](INTEGRATIONS_PLAN.md), `sql/053`–`061`; no provider keys yet; AI needs the owner to accept notice v2), sign-up and getting-started, per-person language choice, the Guide |
| 🟡 Built but not proven | WhatsApp and voice approvals (**never tested on a real phone**); Arabic on every screen (machine drafts, **not yet reviewed by a native speaker**); every integration against a real provider (needs keys) |
| 🛠 Written, not applied | none (`sql/061` applied 9 Nov) |
| 📝 Draft / RFC | [ETA_EINVOICING_PLAN.md](ETA_EINVOICING_PLAN.md) (slice A applied 3 Nov, screens and real signing not built); [ONBOARDING_WIZARD_PLAN.md](ONBOARDING_WIZARD_PLAN.md) (branch, not merged); [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md) phases 2–9; [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md), [MANAGEMENT_PLAN.md](../planning/MANAGEMENT_PLAN.md); ADR-0001 to 0003 still Proposed; ADR-0004 draft in [`architecture/decisions/`](../architecture/decisions/) |
| 💡 Backlog | Integrations stage F (bank statement import, CBE rates) and G (setup guide); CSV import with a preview, barcode scanning, PDF printing; cheques (waiting for the accountant) |

## Detail

- [ ] **[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) Phase 0: Foundation**
  - **Done (2026-10-28):** docs system and `agents.md`; generic code foundation copied, typecheck and tests green; ADR-0003 rework in code (user-scoped client, RPC functions, boundary test); `sql/003` written.
  - **Waiting on:** a Supabase project (new or cleared) to run `sql/001`-`003`; product name; ADR deciders.
  - **Remaining:** run and verify the SQL; SQL isolation and audit tests; root `README.md` and `PRODUCT_BRIEF.md`; move the two plans into `documentation/`; accept or revise the ADRs.
- [ ] **Step 0: demand proof** (see [MANAGEMENT_PLAN.md](../planning/MANAGEMENT_PLAN.md) section 5)
  - **Done:** nothing yet.
  - **Remaining:** hands-on trials of the six competitors; 8-10 customer interviews.
- [x] **Inventory module plan** (`documentation/plans/INVENTORY_PLAN.md`)
  - **Done (reconciled 2026-11-02):** plan approved for slice 1; slice 1 and the later slices (adjustments, approval policies, batches and expiry, forecast, reorder levels, transfers) are built, applied to Supabase and deployed; see the worklog. (This block said "nothing" on 28 Oct.)
  - **Remaining:** partial transfer receipts, filters and pagination on lists, CSV import, returns.

- [ ] **[ACCOUNTING_PLAN.md](ACCOUNTING_PLAN.md): Accounting, phase 1 (general ledger)**
  - **Done (2026-11-05):** plan and [ADR-0004 draft](../architecture/decisions/DRAFT_ADR-0004-general-ledger.md) written on branch `accounting-phase1`; Egyptian chart research in [UNIFIED_CHART_OF_ACCOUNTS.md](../reference/egypt-accounting/UNIFIED_CHART_OF_ACCOUNTS.md).
  - **Done (2026-11-06):** `sql/045`-`049` applied to live (tests 040-044 pass on live); permission keys, API routes (`apps/api/src/modules/accounting/routes.ts`, test `apps/api/test/accounting.test.ts`) and screens (`apps/web/src/modules/accounting/`, Arabic included) built on branch `accounting-phase1`, not deployed.
  - **Waiting on:** Ben's browser check after deploy; the pilot accountant for the unconfirmed codes in groups 3 and 4 (plan O1); moving the ADR draft into `architecture/decisions/`.
  - **Remaining:** deploy the API and web; switch accounting on for the demo company (owner, from Accounting setup) and check the trial balance; an issue-reason picker on stock requests.

- [ ] **[TREASURY_PLAN.md](TREASURY_PLAN.md): phase 2, treasury, branches, party codes and statements**
  - **Done (2026-11-06):** plan written and approved to build (Ben: branches inside one company; cheques wait for the accountant).
  - **Done (2026-11-06):** `sql/050`–`052` applied to live (tests 045–047 pass on live); API (`modules/treasury`, `core/branchRoutes`, finance statements, payment treasury account, party codes; test `apps/api/test/treasury.test.ts`) and screens (Treasury, Transfers, Settings → Branches, Finance → Statement of account, payment picker, codes on customers and suppliers; Arabic) on branch `treasury-phase2`, not deployed.
  - **Remaining:** deploy; browser check (needs accounting switched on in a company, then treasury switched on in Settings → Apps); cheques (waiting for the accountant); per-branch permissions and reports (later).

Template for further blocks; update them in the same change as the work:

- [ ] **[<PLAN>.md](<PLAN>.md): <name>**
  - **Done:** what is built, with dates.
  - **Waiting on:** who or what.
  - **Remaining:** what is left.

- [x] **[SUPPLIER_INVOICES_PLAN.md](SUPPLIER_INVOICES_PLAN.md): Supplier invoices**
  - **Done (2026-10-30):** partial supplier bills against received POs, received/billed/remaining value summary, duplicate invoice protection, and billed quantity guard; migration 018 and SQL isolation test 014 passed.
  - **Waiting on:** Ben's commit/push and manual UI check after deployment.
  - **Remaining:** tax, payments, credit notes and accounting export are later scope.

- [ ] **[ETA_EINVOICING_PLAN.md](ETA_EINVOICING_PLAN.md): E-invoicing (Egypt), in progress, not deployed**
  - **Done (2026-11-03, committed, migrations applied, app code not deployed):** slice A applied to the live project 3 Nov (`sql/036` tax data and per-company ETA mode, `sql/037` credit and debit notes with approval); document builder and serializer (byte-for-byte equal to the SDK sample); one `EtaTransport` with a Simulated and a Real implementation (simulated by default, production refused without credentials and a real signer; PreProd contract tests skipped without credentials); API routes. **Not started:** screens and the SIMULATED badge UI, credential storage, callback route, submission queue, real signing, finance integration for notes. **Needs Ben:** credential-storage and signing decisions, ETA PreProd access. See [ETA_WORKSTREAM_LOG](../operations/ETA_WORKSTREAM_LOG.md).
- [x] **[INVENTORY_TRANSFERS_PLAN.md](INVENTORY_TRANSFERS_PLAN.md): Inventory transfers between warehouses, with approval**
  - **Done (2026-11-02):** plan approved by Ben with the recommended answers. Built: `sql/033_inventory_transfers.sql`, `sql/tests/029_inventory_transfers.sql`, API routes (`/v1/inventory/transfers`, `/in-transit`), permission keys, web screens (list, new, detail, in transit) and demo data. Root typecheck clean; tests 5 shared + 39 API pass.
  - **Done (2026-11-02):** `sql/033` applied and `sql/tests/029` passed in Supabase (project ggoerp). **Deployed and browser-checked 2026-11-02** (live app: the list and new-transfer pages load against the real API; the full request, approve, dispatch, receive flow and the self-approval refusal were checked in the demo build; the self-approval refusal was also checked on the live database for stock requests). **Not yet done on the live app: a full multi-role transfer** (needs a second person). **Hardening applied 2026-11-02:** `sql/034` (a cold item can no longer go to a warehouse with no condition; revokes an anonymous execute grant) and `sql/035` (batch receipts follow the same rule), each dry-run tested then applied, with tests 029 and 022 passing on the live project.
  - **Remaining:** a live multi-role transfer test; org settings for storage mismatch and receive confirmation (later); partial receipt (later).

- [ ] **[ONBOARDING_WIZARD_PLAN.md](ONBOARDING_WIZARD_PLAN.md): first-run setup wizard**
  - **Done (2026-11-04, on branch `worktree-onboarding-wizard`, not merged):** 8-step wizard (welcome, language, company, warehouse, items, team, approvals, done → tour) using existing routes only; automatic start in brand-new companies only; English and Arabic; tests; typecheck, lint, tests and build pass.
  - **Waiting on:** Ben's review and merge after the demo; a browser check in a new company.
  - **Remaining:** item import, progress saved on the account, VAT/ETA question.
- [ ] **[SUPERFIX_WORKFLOW_PLAN.md](SUPERFIX_WORKFLOW_PLAN.md): workflow gaps from the ERPNext and Dolibarr teardowns**
  - **Done (2026-11-03, written, not run, not deployed):** S1 lock date (`sql/040`), S2 payment terms and due dates (`sql/041`), S3 stock count sessions (`sql/042`), S4 customer returns through credit notes (`sql/043`), S5a units with conversion (`sql/044`); SQL tests 035-039; API routes; root typecheck, lint and tests pass.
  - **Waiting on:** Ben's go-ahead to dry-run and apply 040-044 on ggoerp and run tests 035-039 there (or let CI's SQL workflow run them on push); the S6 storage decision.
  - **Remaining:** S5b (units on order and request lines), S6 (audit chain anchored outside the database, needs ADR-0007), screens for all slices, WhatsApp/voice approval of counts.

- [ ] **[ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md): accounting suite roadmap, phases 0–9**
  - **Done (2026-11-05):** draft written from the Miracle meeting notes and the demo notes. Phase 0 under way: PR #1 (S1–S5a, migrations 040–044) passed CI SQL tests (39/39).
  - **Waiting on:** Ben's approval and answers Q1–Q8; Ben's yes to apply 040–044 on live.
  - **Remaining:** one module plan per phase before building; ADR for the general ledger.

- [ ] **Language choice in Settings** (small change, no plan needed)
  - **Done (2026-11-02):** "My language" in Settings > General (company default, English or Arabic); the company language is now only a default and never overrides a person's own choice. Typecheck and tests to be re-run by Ben's handoff; not browser-tested.
  - **Remaining:** translate the rest of the screens (UI audit finding 1) once the Arabic review owner is decided.

## Migrations

See [`sql/README.md`](../../sql/README.md) for per-file status.
- [ ] **[OWNER_INSIGHTS_PLAN.md](OWNER_INSIGHTS_PLAN.md): Owner home, finance, triggers, forecast, batches and expiry, cosmetics demo data** (draft, waiting for Ben's approval and answers to section 16)

