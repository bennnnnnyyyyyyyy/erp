# {{PRODUCT_NAME}}

A general-purpose ERP for small and mid-size businesses, Egypt first. It is built to cover every business track, one module at a time: the first warehouse, stock and accounting capabilities are built; next comes broader inventory workflows and the connected business tracks. Modules are switched on per company, prices are in Egyptian pounds by default, and the web app works in Arabic and English.

Status (18 November 2026; migrations 001–096 are recorded as applied to live, 079 and 080 are unused, and 097 is built but not applied): a working early build, not production-ready. The current status summary is in [documentation/plans/checklist.md](documentation/plans/checklist.md); dated deployment and database evidence is in [documentation/operations/WORKLOG.md](documentation/operations/WORKLOG.md) and [sql/README.md](sql/README.md). Customer demand, a real pilot, real-provider transactions, and WhatsApp or voice approvals on a real phone remain unproven. Arabic text remains a machine draft awaiting native-speaker review. See [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) for scope.

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

**Run the real app** (needs a Supabase project with every migration in `sql/` applied in number order; [`sql/README.md`](sql/README.md) lists each file and whether it is applied to live):

1. Copy `.env.example` to `.env` at the repo root and fill in the Supabase URL and keys. Never commit `.env`.
2. `npm run dev:api` and `npm run dev:web`, then open http://localhost:5173.

Note: on this Windows setup npm runs scripts in old PowerShell, where `&&` fails. Scripts chain steps with
`scripts/run-steps.mjs` instead (for example the web `build`), so `npm run build -w apps/web` works in PowerShell, cmd and CI.

## Working on this repo

Humans and AI agents (Claude, Codex, Antigravity, Cursor) share it. Read [`agents.md`](agents.md) first. A module is not built until it has an approved plan in `documentation/plans/`, and significant work gets a dated entry in [`documentation/operations/WORKLOG.md`](documentation/operations/WORKLOG.md).
