# System-wide audit, 2026-11-03

Ben asked for "a system wide audit of everything" after the UI polish rounds ([plan](2026-11-03-ui-polish-plan.md)). This audit
checks the repository's own non-negotiable rules ([`agents.md`](../../agents.md)) against the code, then quality, operations and
documentation. Earlier focused audits are not repeated: [`../reviews/2026-10-30-security-audit.md`](../reviews/2026-10-30-security-audit.md),
[`../reviews/2026-11-02-ui-audit.md`](../reviews/2026-11-02-ui-audit.md), [`2026-11-04-ui-audit.md`](2026-11-04-ui-audit.md).
(Written in `plans/` because writes to `documentation/reviews/` are blocked by a permission rule in this environment; move it there if wanted.)

## Method and limits

- **Read-only.** Scripts over `apps/api/src`, `apps/web/src`, `packages/shared`, all 39 files in `sql/` and the 33 SQL tests; git, CI
  (`gh run list`), `npm audit`, the live API `/health`; the live web app in Chrome (owner, read-only) earlier the same day.
- **Not done:** penetration testing, load testing, a live RLS probe with two real accounts (the SQL isolation tests cover this in CI),
  a review of every database function body, a native-speaker Arabic review, a real phone.
- Findings are marked **seen** (observed on screen or in output), **measured** (counted by a script) or **read** (from the code).

## Scorecard

| Area | Verdict | Evidence |
|---|---|---|
| Tenant isolation in the database | **Strong** | 54 tables: RLS on all 54; privileges revoked from `anon`/`authenticated` on all 54; `org_id` on every business table (the 5 without are reference, per-user or system tables) — measured |
| Isolation **tests** | **Gap** | 47 of 54 tables named in `sql/tests`; 7 business tables are not (finding 2) — measured |
| Mutations and audit | **Strong** | No direct table writes from API routes (all through database functions); `audit_log` blocked from update/delete by trigger, hash-chained on insert (`sql/001`, `sql/003`) — read |
| API authorisation | **Strong** | 128 routes; all but 6 call `requirePermission`; the 6 are `/health`, the WhatsApp webhook (token-checked), and 3 self-scoped core routes (`/session`, `/me/language`, `/people`) — measured |
| Secret-key client | **Strong** | Imported only by the allowed files; enforced by `apps/api/test/boundaries.test.ts` (ADR-0003) — read |
| Secrets in git | **Clean** | No `.env`/secret files tracked, no key-shaped strings — measured |
| Dependencies | **Clean** | `npm audit --omit=dev`: 0 vulnerabilities — measured |
| CI / deploy | **Healthy** | Last 5 "CI and Cloudflare deploy" runs green; "SQL tests (local Supabase)" green; live `/health` = ok, production — seen |
| Error handling | **Good** | Unexpected errors logged server-side, client gets "Something went wrong on our side" (no stack, no SQL) — read |
| Correctness of money screens | **Defect** | Lists capped at 200/300 rows; balances computed from the capped list (finding 1) — read + seen |
| Abuse protection | **Gap** | No rate limiting in the Worker (finding 4) — measured |
| Code quality tooling | **Gap** | No linter or formatter in any package; route files with lines up to 799 characters (finding 5) — measured |
| UI and language | **Improved today** | Rounds 1 to 5 of the polish plan; 0 untranslated strings, 0 browser pop-ups left (fixed in this audit) — measured |
| Repository hygiene | **Gap** | About 17 scratch files tracked at the repo root (finding 9) — measured |

## Findings

Severity: **P0** breaks a customer or the demo, **P1** wrong data shown or a non-negotiable rule broken, **P2** should fix soon, **P3** polish.

| # | Sev | Area | Finding | Why it matters | Suggested fix | Effort |
|---|---|---|---|---|---|---|
| 1 | **P1** | Finance, Sales, Purchasing | The list endpoints stop at 200 (`sales/invoices`, `sales/orders`), 250 (`supplier-invoices`) and 300 (`finance/payments`, `finance/expenses`) rows. The Payments form and the payment, invoice and expense pages compute **paid** and **outstanding** from these lists, and the Payments form only offers the newest 200 invoices. Demo Cosmetics Factory already has PAY-0443 and INV-0312 (seen). | Older invoices show wrong outstanding amounts and cannot be selected for a payment. The database still refuses an overpayment, so no wrong money is recorded, but the screens are wrong. The Home cards are not affected (computed in the database). | Server-side outstanding per invoice and expense (a `..._balances` view or RPC) and a by-id endpoint for each record; server-side search for the payment target; pagination on the lists. | medium |
| 2 | **P1** | Tests (rule) | 7 business tables are not named in any isolation test: `inv_warehouses`, `inv_counters`, `inv_request_lines`, `pur_suppliers`, `inv_storage_conditions`, `alr_team_members`, `alr_rule_recipients`. `agents.md`: every business table "has isolation tests ... No exceptions". | RLS is on for all of them (low risk today), but a later policy change would not be caught. | One SQL test file that, for each of the 7, signs in as a member of org B and asserts zero rows from org A and a refused write. | small |
| 3 | **P1** | Data / demo | Conflicting records about e-invoicing: the WORKLOG entry for 036/037 says the `einvoicing` module is on for **0** organizations, but on 3 Nov the audit log showed it switched on in Demo Cosmetics Factory by chris at 16:30 (seen in the UI audit). | If a manager opens it during the demo it may be unfinished; and the WORKLOG is the source of truth for what is live. | Ben: decide on or off for the demo company; read-only `select org_id from org_modules where module_key = 'einvoicing' and enabled`; correct the WORKLOG. | small, a decision |
| 4 | **P2** | API | No rate limiting in the Worker (only Supabase Auth limits sign-in). | A leaked or scripted session can hammer list endpoints; cost and noisy-neighbour risk once there are several customers. | Cloudflare rate-limiting rule on `/v1/*` per IP and per user, or a Durable Object counter for writes. | small |
| 5 | **P2** | Code quality | No ESLint/Biome and no formatter in any package. `modules/sales/routes.ts` has 799-character lines, `purchasing/routes.ts` 518, `inventory` 371, `finance` 360 (several statements per line). | Reviews miss things in one-line code; agents working in parallel produce inconsistent style. | Add Biome (lint and format) at the root, run it once, add it to CI. | small |
| 6 | **P2** | Testing | Web has 42 unit tests and no browser smoke test. Today's UI defects (every Button drawn as a primary button; a white-on-white ghost button) were only found by eye. | UI regressions reach production unnoticed. | A Playwright smoke run in CI against the sample build (`vite --mode demo`): open each page, fail on console errors and low contrast. (agents.md bans automated browser testing by agents; a CI job is Ben's call.) | medium |
| 7 | **P2** | Language | All Arabic, including today's accounting terms (ذمم مدينة، تكلفة البضاعة المباعة …), is a machine draft. | Wrong financial terms in front of an Egyptian customer. | Native review of `lib/i18nScreens.ts`, `lib/i18nNav.ts`, `help/*Content.ts`; refresh `../reviews/arabic-review-sheet.md`, which predates today's renames. | medium (a person) |
| 8 | **P2** | People | Users have no full names, so people show as email handles (`grant.holden.wiz`) in requests, ledger and history. | Looks like test data; hard to read on a projector. | Set `full_name` for the demo users (data); make the name required on invite. | small |
| 9 | **P2** | Repository | Tracked at the repo root besides the allowed files: `22.md`, `sss.md`, `reply.md`, `orders.md`, `neworder.md`, `migration.md`, `colluege audit.md`, `QUESTIONS_FOR_BEN.md`, `REPLY_TO_CLAUDE_CHAT.md`, `UI_AUDIT_BRIEF.md`, `Trial_capture_workbook_v13.xlsx`, a saved `Home (…).html` page and others. They are pushed to GitHub. | Notes and a saved web page may contain personal data; the root is the first thing a reviewer sees. | Ben: move what matters into `documentation/`, `git rm` the rest, keep scratch files out with `.gitignore`. | small |
| 10 | **P2** | Operations | "Failed to fetch", seen by some users, is still undiagnosed (from the UI audit brief). | Unknown cause of failed screens. | When it happens: page, time, user, console and network tab; Worker logs (`wrangler tail`) for the same minute. | unknown |
| 11 | **P3** | Performance | The web app ships as one 627 kB JavaScript file. | Slow first load on a phone over mobile data. | Lazy-load each app's routes (`React.lazy` per module in `registry.tsx`). | small |
| 12 | **P3** | Demo data | The cancelled test request OUT-0372 ("Browser check by Claude"), "(sample)" in customer and supplier names, no transfers in the demo company. | Reads as test data. | Ben's call (data). | small |
| 13 | **P3** | i18n hygiene | A few texts replaced during the polish rounds remain as unused dictionary lines. | Dead strings in the translation sheet. | An "unused key" check in `i18nScreens.test.ts`. | small |

## Fixed during this audit

- Settings > Apps used a browser `window.confirm` to switch an app off; it now confirms in place (`ConfirmButton`) and uses the shared
  `Button`. App names, suites and descriptions there were shown untranslated; now through `tr()`.
- Arabic for the last untranslated strings ("Sign out", "{n} items") and the new confirm.
- After this: 0 untranslated strings in the screens, 0 browser pop-ups (measured).

## What is in good shape (keep it that way)

- Database-enforced approvals and append-only, hash-chained audit: the core promise of the product holds in the schema.
- Every write goes through a database function called with the user's own token; the Worker's permission checks are an early
  rejection only.
- Boundaries enforced by tests (`boundaries.test.ts`), green CI on every push, SQL tests against a local Supabase in CI.

## Recommended order

1. Before the demo: **3** (decide e-invoicing), **12** and **8** (data), and do not take payments on very old invoices on stage (**1**).
2. Next: **1** (server-side balances and by-id endpoints), **2** (isolation tests), **5** (Biome), **4** (rate limit).
3. Then: **7** (native Arabic), **9** (repo root), **6** (smoke tests), **11** (lazy loading).

## Status after the fix pass (2026-11-03, same day)

| # | Status | What was done |
|---|---|---|
| 1 | **Fixed (in code, not deployed)** | New read endpoints compute everything on the server over all rows (paged by 1000): `GET /v1/finance/open-items?direction=in|out` (outstanding per invoice and expense), `GET /v1/finance/payments?for=c:|s:|e:<id>` (all payments for one record), `GET /v1/finance/payments/:id`, `/expenses/:id`, `/v1/sales/invoices/:id`, `/v1/purchasing/supplier-invoices/:id` (with item and order number); payment rows carry their target's number. The Payments form, the payment, expense and both invoice pages use them; nothing adds up money from a capped list any more. Tests: `apps/api/test/finance_balances.test.ts`. |
| 2 | **Fixed (test written, runs in CI)** | `sql/tests/034_isolation_gaps.sql` covers the 7 tables: org A sees its rows, org B sees none and cannot insert, update or delete. Not run locally (needs the local Supabase of the SQL-tests workflow); it runs on the next push. |
| 3 | **Open, Ben** | The Supabase connection available to Claude here is a different account (project `saleooperations`, not `ggoerp`), so the live state was not read. Run the query in the finding. |
| 4 | **Fixed (not deployed)** | Workers rate limiting binding `API_LIMITER` (600 requests a minute per user, per IP for webhooks) in `apps/api/wrangler.toml`; `middleware/rateLimit.ts` answers 429 `rate_limited`. `wrangler deploy --dry-run` accepts the binding. Tests: `apps/api/test/rate_limit.test.ts`. |
| 5 | **Open, needs Ben** | Adding Biome (a new dev dependency) was refused by the permission system in this session. Allow `npm install -D @biomejs/biome` (or add it yourself), then format `apps/api/src/modules/*/routes.ts` and add `biome ci` to CI. |
| 6 | Not done | agents.md forbids automated browser testing by agents; a CI smoke job is Ben's call. |
| 7 | Open, a person | Native Arabic review. |
| 8 | **Half fixed** | Invites now require a full name, stored on the new account (`authAdmin.createInvitedAccount`); existing demo users still need their names set (live data, Ben). |
| 9 | Open, Ben | Repo-root files are Ben's; not moved or deleted. |
| 10 | Open | Needs a live occurrence. |
| 11 | **Partly fixed** | Every screen is a lazy chunk (`modules/registry.tsx`, Suspense in `Shell.tsx`): 29 files, 174 kB of screens no longer loaded at start. Start-up is still 620 kB, mostly React and the Supabase client that sign-in needs. |
| 12 | Open, Ben | Demo data. |
| 13 | Not done | Low value; left. |

## Second fix pass (2026-11-03, after Ben's go-ahead)

Ben: use the Supabase CLI (the MCP connector is another account), allow the formatter, do the smoke test (the agents.md browser rule
is for Antigravity and Codex only), he reviews the Arabic himself, drop "Failed to fetch".

| # | Status now | What was done |
|---|---|---|
| 3 | **Answered; decision open** | Read-only on project ggoerp via `supabase db query --linked`: `einvoicing` is ON for **Demo Cosmetics Factory** (since 3 Nov 16:30 Cairo) and **Demo Trading Co.** (since 18:43). The WORKLOG line "on for 0 organizations" was true when written and is out of date (corrected in the WORKLOG). Switching it off is a live change: Ben's call. |
| 5 | **Fixed** | Biome 2.6.4 (`biome.json`): formatter and recommended lint rules for `apps/api` and `packages/shared` (`noNonNullAssertion` off: the code uses `!` on purpose). 70 files formatted; longest API line 799 → 195 characters (long text literals). Two real lint errors fixed (untyped `let` in `eta_transport.contract.ts`). `npm run lint` = `biome ci`; a CI step runs it before the typecheck. `lineEnding: auto` so it passes on Windows checkouts and on Linux CI. The web app is not formatted yet (left out to avoid a 100-file diff colliding with parallel work). |
| 6 | **Fixed** | Playwright 1.64 smoke test (`apps/web/e2e/smoke.e2e.ts`, `playwright.config.ts`): starts the sample build, discovers every page (Home tiles → sidebars → first record of each list), on desktop and a phone; fails on a missing heading, "Page not found", any console error or exception, and sideways scrolling on the phone; plus a right-to-left pass. CI runs it before the deploy. It found two real bugs on its first run, both fixed: the sample build's Purchase invoices page stayed on "Loading…" forever (the sample has no such data; the page now shows load errors and the sample build no longer lists it), and Settings > Apps listed Purchasing and Sales twice (duplicate module entries in `lib/demo.ts`). |
| 7 | **Handed to Ben** | `2026-11-03-arabic-review-sheet.md`: the 216 Arabic strings new or changed today, with a column for corrections. |
| 10 | **Dropped** | At Ben's request. |
| 8 | **Fixed** | Ben gave the names; set on the four accounts on ggoerp (`full_name`, see WORKLOG). Live: "Requested by" shows Grant Holden. |
| 9, 12 | Open, Ben | The repo-root files and the demo data are Ben's files and live data: not touched. |