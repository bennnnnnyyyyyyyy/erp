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
