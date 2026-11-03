# {{PRODUCT_NAME}}

A warehouse-first ERP for small and mid-size businesses in Egypt and the GCC that hold stock. Modules are switched on per company, prices are in Egyptian pounds, and the web app works in Arabic and English.

Status (2 Nov 2026): a working early build, deployed at https://erp-live.pages.dev with invented sample data, **not production-ready**. Built and deployed: inventory (stock requests with approval, adjustments, batches and expiry, forecast, reorder levels, transfers between warehouses), purchasing and supplier invoices, sales orders and customer invoices, expenses and payments, the owner home, alerts and messaging, sign-up, a guide, an English/Arabic choice per person. Not built or not yet proven: approvals by WhatsApp and voice on a real phone, Arabic on every screen, CSV import, returns and credit notes, Egyptian e-invoicing, a real customer pilot. The clickable no-database demo still exists (below). See [`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) for scope, [`documentation/plans/checklist.md`](documentation/plans/checklist.md) for plan status and [`documentation/operations/WORKLOG.md`](documentation/operations/WORKLOG.md) for what was actually run and deployed.

## What we are testing (hypotheses)

1. **Approvals that really hold the stock.** Outgoing stock cannot leave the warehouse without a manager's approval, and the database enforces it, not just the screen.
2. **A change history nobody can edit.** Every stock movement and approval writes to an append-only audit log, in the same step as the change.
3. **Approvals and tasks over WhatsApp, and later voice.** No competitor reviewed offers this for warehouse staff. Demand is **not yet confirmed**: customer interviews come first.
4. **Clear EGP pricing with warehouse features included**, no plan gating or add-ons.

The research behind these is public-source only; hands-on trials and customer interviews are still to do.

## How it is built

| Part | Where | Notes |
|---|---|---|
| API | `apps/api/` | Cloudflare Worker (Hono). Checks the caller and permission, then calls database functions as the signed-in user. |
| Web app | `apps/web/` | React + Vite, web first (a phone app comes later), Arabic/English with right-to-left support. |
| Shared code | `packages/shared/` | Types, permission keys, module manifest, money helpers. |
| Database | `sql/` | Supabase Postgres migrations, numbered and rerun-safe, each ending with read-only verification queries. |
| Docs | `documentation/` | Plans, ADRs, research, worklog, checklist. Start at [`documentation/README.md`](documentation/README.md). |

Key decisions: [`ADR-0001`](documentation/architecture/decisions/ADR-0001-stack.md) stack, [`ADR-0002`](documentation/architecture/decisions/ADR-0002-multi-tenancy.md) multi-tenancy, [`ADR-0003`](documentation/architecture/decisions/ADR-0003-mutations-via-rpc.md) changes go through database functions with the user's own login.

## Run it

Node 22 or newer. From the repo root:

```powershell
npm install
npm run typecheck
npm test
```

**See the clickable demo (no database, no sign-in, sample data):**

```powershell
npm run dev:demo -w apps/web
```

Open http://localhost:5173. The yellow bar lets you act as different people and flip the layout to right-to-left. A public copy runs at https://erp-demo-bas.pages.dev. Rebuild with `npm run build:demo`, deploy with `npx wrangler pages deploy apps/web/dist --project-name erp-demo --branch main`.

**Run the real app** (needs a Supabase project with `sql/001` to `sql/035` applied in order, see [`sql/README.md`](sql/README.md)):

1. Copy `.env.example` to `.env` at the repo root and fill in the Supabase URL and keys. Never commit `.env`.
2. `npm run dev:api` and `npm run dev:web`, then open http://localhost:5173.

Note: on this Windows setup npm runs scripts in old PowerShell, so scripts that chain commands with `&&` (for example the `build` script) fail; use the demo build script or run the commands separately.

## Working on this repo

Humans and AI agents (Claude, Codex, Antigravity, Cursor) share it. Read [`agents.md`](agents.md) first. A module is not built until it has an approved plan in `documentation/plans/`, and significant work gets a dated entry in [`documentation/operations/WORKLOG.md`](documentation/operations/WORKLOG.md).
