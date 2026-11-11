# Architecture

**Parent index:** [`documentation/README.md`](../README.md)

The system as it is built today. Update this file in the same change that alters the system; a
plan describes intent, this file describes what runs. Decisions that are expensive to reverse
live in [`decisions/`](decisions/).

Last checked against the code: 11 Nov 2026 (audit finding 9). Requests run with the signed-in person's own JWT (ADR-0003); the
secret-key client is limited to the "Master-key exceptions" in [`agents.md`](../../agents.md) and guarded by
`apps/api/test/boundaries.test.ts`. Note: the comment in `sql/001` saying the API uses the service-role key is out of date (old
migrations are not edited). This page is a map, not a feature list: what is built is in
[`../plans/checklist.md`](../plans/checklist.md), what reached live is in [`../operations/WORKLOG.md`](../operations/WORKLOG.md).

## Parts

| Part | Where | Runs on |
|---|---|---|
| Web app | `apps/web/` (React, Vite) | Cloudflare Pages (`erp-live`). Screens are lazy-loaded per module from `src/modules/registry.tsx`. A demo build runs on sample data in the browser, with no database. |
| API | `apps/api/` (Hono) | One Cloudflare Worker (`erp-api`), plus a cron trigger every 5 minutes. |
| Shared | `packages/shared/` | Types, permission keys, module manifests (`modules.ts`), provider definitions, money helpers. Used by both apps. |
| Database | `sql/` | Supabase Postgres. Business rules live here: row level security, and writes only through database functions ([ADR-0003](decisions/ADR-0003-mutations-via-rpc.md)). |

## A signed-in request (`/v1/...`)

1. `requireAuth` verifies the Supabase JWT. `rateLimit('api')` counts per user (Workers rate-limit binding).
2. `requireTenant` reads `X-Org-Id` and checks the caller is an active member of that organization.
3. `requireModule(key)` refuses a module the organization has not switched on (`org_modules`).
4. The route calls `requirePermission('module.action')`: early rejection only.
5. The route calls the database **as the caller** (`lib/db.user.ts`: publishable key plus the caller's JWT). Row level security limits
   reads to the organization; every change is a `security definer` function that re-checks role, organization and business rules and
   writes its `audit_log` row in the same transaction ([ADR-0002](decisions/ADR-0002-multi-tenancy.md)). Application roles cannot
   insert into business tables directly.

## Without a user

- **Webhooks** (`/webhooks/*` in `src/index.ts`): WhatsApp, Telegram, Paymob, Fawry, Bosta, Shopify. Each is rate limited per IP,
  size-capped before its body is read (`middleware/bodyLimit.ts`), and verified (signature or shared secret, constant-time compare)
  before anything happens. They use the service-role client (`lib/db.admin.ts`) and call only service-role database functions,
  which re-check amounts, states and duplicates.
- **Cron** (`scheduled` in `src/index.ts`, every 5 minutes): `jobs/outbox.ts` queues reminders, escalations and alerts, checks the
  audit chain hourly, then delivers due messages through the channel adapters (`lib/channels/`); delivery is at-least-once.
  `jobs/fx.ts` fetches exchange rates at most every 6 hours.
- **AI** (`lib/aiService.ts`): the assistant reads data with the caller's own client, then calls the provider the company switched on
  (OpenAI, ElevenLabs or the company's Ollama server), only while the owner has accepted the current AI notice. Spend on our keys has
  a soft monthly cap.

The service-role client is never imported by request routes for business data (`apps/api/test/boundaries.test.ts`).

## How changes reach live

- **Code:** a push to `main` runs `.github/workflows/ci-deploy.yml`: lint, typecheck, tests, doc link check, a browser smoke test of
  every screen, the web build, then deploys the Worker and Pages.
- **Database:** migrations are **not** applied by the deploy. Ben applies each one to the live project (`ggoerp`) with the Supabase
  CLI, after its SQL tests pass (`.github/workflows/sql-tests.yml` on the pull request) and a rolled-back dry run on live, and
  records it in the worklog. [`sql/README.md`](../../sql/README.md) lists every migration and whether it is applied.
- **Secrets:** Worker secrets in Cloudflare; provider keys per company in Supabase Vault (write-only from the app).
