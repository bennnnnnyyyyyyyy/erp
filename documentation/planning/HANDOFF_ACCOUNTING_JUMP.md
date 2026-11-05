# Handoff: the big jump to a general-purpose ERP (written 2026-11-05)

> **Update, 5 Nov evening: the plan is now
> [`ROADMAP_ACCOUNTING_SUITE.md`](../plans/ROADMAP_ACCOUNTING_SUITE.md).**
> - It was built from Ben's meeting with a warehouse accountant who uses Miracle, and from his demo
>   notes. It replaces section 3 below.
> - Ben decided that packaging for a company's own servers, and SaaS billing, come **after** the
>   accounting suite.
> - **PR #1** (`pr/next-slices`, migrations 040–044) passed CI SQL tests: 39 passed, 0 failed.
>   **Next:** dry run on live (rolled back), then apply 040–044 with Ben's yes, then Ben merges.
> - The top bar is merged and pushed (`4e36a51`).
> - The bad branch `pr/next-slices-ci-check` is deleted.

Read this first in a fresh session. It records where things stand, what Ben decided on 5 Nov, and
how far the product is from the goal. **The worklog wins** wherever this file and
[`WORKLOG.md`](../operations/WORKLOG.md) disagree.

## 1. The goal (Ben, 5 Nov 2026, lightly cleaned)

> "The app has good features. We showed it to an accountant on a warehouse. The general direction
> isn't only cosmeceutical: broad spectrum, general purpose. We were researching an ERP called
> Miracle Egypt, made for accountants, and we have far less accounting detail than that."
>
> "Miracle isn't really a benchmark. We don't want it to be accounting-only or warehouse-only. The
> end goal is still a general-purpose ERP that we can run in the cloud as SaaS for companies, or set
> up locally for a company."

What this means for the work:
- **General-purpose ERP.** It is not cosmetics-only, accounting-only or warehouse-only. The cosmetics
  data (Demo Cosmetics Factory, the wizard's sample fill, cold-storage rules) stays as one demo.
  It must not shape the core.
- **Two ways to deliver it:**
  - **SaaS:** we host it; many companies share one deployment, kept apart by `org_id` and RLS.
  - **On-premises:** installed on one company's own servers.
  Every design choice must work in both.
- **Miracle is one reference, not the benchmark.** It is useful because it shows where our
  accounting is thin, which an accountant also noticed. Study what it does, never its code or text
  (`agents.md`).
- **Conflict to settle (Q1):** `agents.md` and `PRODUCT_BRIEF.md` say "warehouse-first" and
  exclude CRM, HR and payroll. "General purpose" may change that. Do not build into those areas
  until Ben decides.

## 2. How far we are (assessed 5 Nov from the code)

### 2a. Breadth: what a general-purpose ERP needs

| Area | State |
|---|---|
| Inventory: ledger, approvals, batches and expiry, transfers, reorder, forecast | **Strong** (built, live) |
| Purchasing: purchase orders, receiving, supplier bills | Built |
| Sales: orders, delivery, customer invoices | Built |
| Approvals, append-only audit log, alerts, tasks, onboarding wizard | Built |
| WhatsApp and voice | Built in part; **never tested on a real phone** |
| Finance today: expenses, payments, open items, average cost, owner home | Built, but **light** |
| **Accounting:** chart of accounts, double-entry ledger with automatic posting from documents, trial balance, profit and loss, balance sheet, bank and cash, cheques, cost centres, periods and closing, VAT report, fixed assets | **Missing.** This is the biggest gap, and the accountant noticed it |
| ETA e-invoicing (Egypt) | Database live; screens, signing and submission not built |
| Returns, price lists, PDF printing, CSV import, reports | Missing (in the backlog) |
| Manufacturing: bills of materials, production orders | Missing (needed for factory customers) |
| Arabic on every screen | The switch exists; most translations do not |
| CRM, HR, payroll, point of sale | Out of scope today (Q1) |

### 2b. SaaS readiness

- **Have:**
  - multi-tenancy with RLS and isolation tests;
  - sign-up, limited to 3 companies per person;
  - modules switched on per company;
  - deploy from CI (`ci-deploy.yml`) and SQL tests (`sql-tests.yml`).
- **Missing:**
  - **billing and subscriptions:** there is nothing in the code;
  - separate staging and production;
  - a tested backup and restore;
  - monitoring and a status page;
  - a custom domain for the API (it is on `workers.dev` today);
  - terms of service and data-protection work;
  - a support model.

### 2c. On-premises readiness

The good news is that the coupling to Cloudflare is small:
- The API uses Hono, which also runs on Node.
- The only Cloudflare-specific parts are:
  - the rate limiter, which is already optional;
  - the `scheduled` cron for the outbox (`apps/api/src/index.ts:78`), which needs a Node timer
    instead.
- Supabase (Postgres, Auth, PostgREST) has an official self-hosted Docker setup, so the SQL and RLS
  stay the same.
- The web app is a static build.

Missing:
- **A migration runner that records which migrations have run.** Today they are applied by hand and
  tracked in the worklog. That cannot work for many customer databases, and it matters for SaaS
  staging too. **Do this first.**
- An API entry point for Node, and a `docker compose` package (API, web, self-hosted Supabase).
- Settings for the web app at run time: the `VITE_*` values are fixed at build time today, so each
  install would need its own build.
- Install, upgrade and backup scripts, and a runbook.
- A licence or activation scheme, and a way to deliver updates.
- WhatsApp needs a public webhook address, which an install behind a company firewall may not have.
  Decide whether on-premises installs get WhatsApp, or relay it through our cloud.

### 2d. Summary

The base is sound for both ways of delivering it: tenancy, audit, approvals, inventory and the
small platform coupling. Three big blocks remain:
1. **real accounting**;
2. **deployment packaging** (migration runner, Node entry point, Docker, run-time settings);
3. **SaaS business plumbing** (billing, staging, backups).

Around those sit smaller breadth items: returns, printing, import, manufacturing and Arabic.

## 3. Suggested order for the next session (Ben chooses)

1. **ADR: one codebase, two deployment shapes.** Also the migration runner, because it is small
   and everything after it depends on it.
2. **Accounting module.**
   - Light research first: what Egyptian accountants expect (Miracle, Odoo, others), recorded in
     `documentation/research/<slug>/` from `_TEMPLATE`. Mark every claim as seen, documented or
     claimed. Nothing about Miracle is in the repo; don't state its features from memory.
   - Then `documentation/plans/ACCOUNTING_PLAN.md` from
     [`MODULE_PLAN_TEMPLATE.md`](../plans/MODULE_PLAN_TEMPLATE.md), an ADR for the general ledger,
     and an entry in [`checklist.md`](../plans/checklist.md).
   - Probable first slice:
     - chart of accounts from an editable template;
     - append-only balanced journal entries;
     - automatic posting from receipts, bills, invoices, deliveries (cost of goods sold),
       payments, expenses, adjustments and notes;
     - cash and bank accounts;
     - trial balance, profit and loss, balance sheet;
     - period lock.
3. **On-premises package:** Node entry point, Docker, run-time settings, install and upgrade
   scripts.
4. **SaaS plumbing:** billing, staging, backups.

Build only after Ben approves each plan. Migrations continue from `sql/040`.

## 4. Decisions only Ben can make

- **Q1.** What does "general purpose" include? Are CRM, HR, payroll and point of sale still out?
  Then reword `PRODUCT_BRIEF.md` and `agents.md` to match.
- **Q2.** Which comes first: accounting, or deployment packaging?
- **Q3.** On-premises:
  - Who installs and supports it?
  - How are updates delivered?
  - How is it licensed?
  - Does it get WhatsApp?
- **Q4.** SaaS billing: price per company, per user, or per module? Which payment gateway (Paymob
  was assumed)?
- **Q5.** Accounting:
  - The chart-of-accounts template: the Egyptian Unified Accounting System, a simple small-business
    chart, or the company's choice?
  - Who was the accountant, and can we interview them?

## 5. Yesterday (4 Nov) reviewed

- **Gulf Global Outsourcing:** four test companies with this name, all soft-deleted.
  - The last one, `c9e42af1-…` (Chris), was deleted 20:58 UTC and checked by query.
  - Data and audit logs are kept; the worklog has the undo.
- **Efficiency fixes F1–F4 and "Explore more":** merged into `main`.
  - Still to do: re-measure live speed with the
    [efficiency audit](../plans/2026-11-04-efficiency-audit.md) method.
- **Setup wizard:** merged into `main`.
  - Still to do: a browser check in a brand-new company.
  - Its sample data is cosmetics-only. A general sample set fits the new direction.
- **Laptop:** the laptop itself was misbehaving. There is **no IP filter**, only CORS for
  `https://erp-live.pages.dev`.
- **Loose ends:**
  - The worktrees `worktree-next-slices` and `worktree-onboarding-wizard` still exist. Ask Ben
    before removing them.
  - The worklog edit and this file are not committed. Ben commits.

## 6. Practical notes for the agent

- **Live database `ggoerp`:** use the Supabase CLI.
  - Run `npx supabase db query --linked -f <file.sql>`, with Node on PATH from
    `C:\Users\ben.arthur\node-v24.14.1-win-x64`.
  - Put SQL in a file: inline SQL with quotes breaks in PowerShell.
  - The Supabase MCP connector is a **different** account.
- **Schema names that are easy to get wrong:**
  - Members are in `public.memberships`.
  - The audit time column is `audit_log.occurred_at`.
  - Audit rows are inserted directly; the chain trigger fills `seq` and the hashes.
- The PowerShell profile prints PSReadLine errors on every call. They are harmless.
- **Rules:** live data changes need Ben's explicit yes and a target checked first. Never commit.
  Update the worklog.
