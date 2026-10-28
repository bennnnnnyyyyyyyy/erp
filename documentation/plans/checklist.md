# Plans Execution Status & Checklist

**Last updated:** 2026-10-28
**Source of truth for what actually happened:** [`../operations/WORKLOG.md`](../operations/WORKLOG.md)

## Status overview

| Status | Plans |
|---|---|
| ✅ Live | none |
| 🟡 In progress | Phase 0 foundation ([TECHNICAL_PLAN.md](../../TECHNICAL_PLAN.md) section 9) |
| 📋 Approved / ready | none |
| 📝 Draft / RFC | [TECHNICAL_PLAN.md](../../TECHNICAL_PLAN.md), [MANAGEMENT_PLAN.md](../../MANAGEMENT_PLAN.md), [ADR-0001](../architecture/decisions/ADR-0001-stack.md), [ADR-0002](../architecture/decisions/ADR-0002-multi-tenancy.md), [ADR-0003](../architecture/decisions/ADR-0003-mutations-via-rpc.md) |
| 💡 Backlog | none |

## Detail

- [ ] **[TECHNICAL_PLAN.md](../../TECHNICAL_PLAN.md) Phase 0: Foundation**
  - **Done (2026-10-28):** docs system and `agents.md`; generic code foundation copied, typecheck and tests green; ADR-0003 rework in code (user-scoped client, RPC functions, boundary test); `sql/003` written.
  - **Waiting on:** a Supabase project (new or cleared) to run `sql/001`-`003`; product name; ADR deciders.
  - **Remaining:** run and verify the SQL; SQL isolation and audit tests; root `README.md` and `PRODUCT_BRIEF.md`; move the two plans into `documentation/`; accept or revise the ADRs.
- [ ] **Step 0: demand proof** (see [MANAGEMENT_PLAN.md](../../MANAGEMENT_PLAN.md) section 5)
  - **Done:** nothing yet.
  - **Remaining:** hands-on trials of the six competitors; 8-10 customer interviews.
- [ ] **Inventory module plan** (`documentation/plans/INVENTORY_PLAN.md`)
  - **Done:** nothing; empty placeholder module only.
  - **Remaining:** write from [`MODULE_PLAN_TEMPLATE.md`](MODULE_PLAN_TEMPLATE.md) after step 0.

Template for further blocks; update them in the same change as the work:

- [ ] **[<PLAN>.md](<PLAN>.md): <name>**
  - **Done:** what is built, with dates.
  - **Waiting on:** who or what.
  - **Remaining:** what is left.

## Task list by area

`[x]` done and verified as stated, `[ ]` not done. Sources: [TECHNICAL_PLAN.md](../../TECHNICAL_PLAN.md) (phases in section 9) and [MANAGEMENT_PLAN.md](../../MANAGEMENT_PLAN.md).

### A. Repository and documentation
- [x] Docs structure, `agents.md`, worklog, checklist, plan and research templates, ADR format
- [x] ADR-0001, 0002, 0003 written (all still Proposed)
- [x] Worklog entries for the migration and the ADR-0003 rework
- [ ] Accept or revise ADR-0001, 0002, 0003 and fill `{{DECIDERS}}`
- [ ] Choose the product name and replace `{{PRODUCT_NAME}}`
- [ ] Root `README.md` (what it is, hypotheses, how to run)
- [ ] `PRODUCT_BRIEF.md` (scope, modules, out of scope, first slice)
- [ ] Move `TECHNICAL_PLAN.md` and `MANAGEMENT_PLAN.md` into `documentation/`
- [ ] `documentation/architecture/ARCHITECTURE.md` written once something runs
- [ ] ADR-0004 channel ports and adapters, ADR-0005 e-invoicing route, ADR-0006 payment gateway
- [ ] Decide GitHub organization (remote is a personal account)

### B. Database (Supabase)
- [x] `sql/001` tenancy core, `sql/002` user lookup (carried over)
- [x] `sql/003` audit hash chain and core functions (written)
- [ ] Choose project: reuse the existing one (it already has the four 001 tables) or a new staging project
- [ ] Run `sql/001`, `002`, `003` in order and the verification queries; log in the worklog
- [ ] Set `default_currency` default to EGP on an already-created `organizations` table
- [ ] SQL tests in `sql/tests/`: cross-organization isolation, audit chain verify, direct-write refusal
- [ ] Scheduled `audit_verify` job and alert on a broken chain

### C. API (Cloudflare Worker)
- [x] Auth, tenant resolution, permission and module guards, standard responses
- [x] Core routes: org, members, modules, audit, session
- [x] User-scoped client, admin client, RPC wrapper, boundary test (ADR-0003)
- [x] Org settings and module switching through database functions
- [ ] Member invite/role/disable routes moved to database functions (still admin client plus separate audit call)
- [ ] `.env` for the new repo (Supabase URL and keys); confirm `wrangler dev` runs against it
- [ ] API tests that hit a real database (second-organization isolation)
- [ ] Rate limiting on inbound webhooks and token checks (with messaging)

### D. Web app: UI
- [x] Shell, sign-in, org picker, password set/reset, Home, list view, modal
- [x] Settings: General, Users, Apps, Audit log screens (carried over)
- [x] Demo mode on sample data: `npm run dev:demo -w apps/web`, role switcher, working Users/Apps/General/Audit screens
- [x] Demo of the first slice on sample data: stock, requests, approve/reject, issue (blocked without approval), ledger, history
- [ ] Manual review of Home, Settings and the inventory demo in a browser; list fixes
- [ ] Split demo code out of normal builds before any deploy
- [x] Remove leftover CRM-era CSS from `styles.css`; restyle (palette, fonts, motion, logical properties)
- [ ] Browser check of the restyle: contrast, spacing, dark mode, RTL flip, phone width
- [ ] Home page: the "switch on" notice only checks for a business app tile, so it can stay up when a module is on but has no app yet
- [ ] Arabic and English strings (no hard-coded text) and RTL layout for the shell and settings
- [ ] Responsive check in a phone browser (web first, phone app later)
- [ ] Inventory screens (see E)
- [ ] Audit log screen: entity history view, filters, chain status

### E. Inventory module, wave 1 (needs an approved plan first)
- [ ] `INVENTORY_PLAN.md` from the template, after step 0
- [ ] Tables `inv_*`: items, warehouses, stock moves (append-only), balances, requests, request lines, approvals, approval policies
- [ ] Functions: submit request (reserve), decide request, post issue; request state machine trigger
- [ ] Revoke direct writes on ledger, balances and approvals
- [ ] Permissions and module manifest entries
- [ ] Screens: items, warehouses, new request, approvals inbox, request detail, stock on hand
- [ ] Tests: state machine, self-approval refusal, reservation, negative stock, concurrency, audit coverage

### F. Messaging layer (wave 1 interface, wave 2 WhatsApp)
- [ ] Channel adapter interface and in-app adapter
- [ ] `msg_*` tables: identities, outbox, events, decision tokens, templates
- [ ] Transactional outbox and queue worker
- [ ] WhatsApp adapter, identity verification, webhook signature check (only if interviews say yes)
- [ ] Contract tests: in-app and fake WhatsApp give identical decisions and audit rows
- [ ] Voice channel and Egyptian Arabic evaluation set (phase 3)

### G. Demand validation (step 0)
- [ ] Hands-on trials: Edara, Daftra, Odoo, Wafeq, Zoho, ERPNext, Business Central (six-point checklist each)
- [ ] EGP quotes from Edara, Daftra, Zoho, NetSuite; confirm Odoo pricing from Egypt
- [ ] 8-10 interviews with Egyptian SMEs that hold stock
- [ ] Teardown notes in `documentation/research/<slug>/` (behaviour only, no copied code or text)
- [ ] Re-rank vendors; update the plans if findings contradict them

### H. Compliance, billing and business decisions
- [ ] E-invoicing: day one, later, or via a provider (management)
- [ ] WhatsApp provider quotes (Meta direct vs local provider)
- [ ] Payment gateway quotes (Paymob assumed) and billing entity
- [ ] Data protection review (Egypt, Saudi) and retention settings
- [ ] Support model and hours for the pilot
- [ ] Hosting region for first customers

### I. Deployment and operations
- [ ] Hosting for the web app; first deploy of the API
- [ ] Staging and production separation
- [ ] CI running typecheck, tests and SQL tests
- [ ] Backups and restore check
- [ ] Status page and runbook

### J. Later waves (not committed; gated by pilot evidence)
- [ ] Parties (customers and suppliers), purchasing and receiving, sales orders and delivery notes
- [ ] Invoicing, e-invoicing adapter, export to the customer's accounting tool
- [ ] Billing in EGP with metering, price page from one source
- [ ] Phone app, offline queue, tasks over messaging, AI intent extraction (flagged)
- [ ] Lots, serials, expiry, costing methods, CSV import and onboarding

## Migrations

See [`sql/README.md`](../../sql/README.md) for per-file status.
