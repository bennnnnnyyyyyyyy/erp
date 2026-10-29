# {{PRODUCT_NAME}} Worklog

Newest first. Every significant fix, schema change, migration run, deployment or data operation
gets an entry with these four headings:

- **Objective.** Why the work was done.
- **Actions Completed.** What changed, with file paths.
- **Database / System Result.** What happened in Supabase / Cloudflare / hosting, or "None".
- **Safety Status.** Tests run, what was not verified, and manual steps still needed.

Entry heading format: `## YYYY-MM-DD — Short title`. If it is not in this file, it has not been
run or deployed.

---

## 2026-10-29 — Workstream C started: sql/005 and sql/006 applied via the Supabase CLI, inventory tests pass

**Objective.** Start the live demo on a real database (orders.md, workstream C): database layer for the inventory slice.

**Actions Completed.**
- Ben ran `supabase init` and `supabase link --project-ref plhuuhcpvlytozyedamt` in the repo; from now on Supabase work uses the CLI (`supabase db query --linked -f <file>`, `supabase db advisors --linked`). Read-only state check first: 4 core tables with RLS, 14 functions, 3 audit triggers, 1 organization, 5 audit rows, 0 chain problems.
- `supabase db advisors --linked`: warnings only. Fixed by new `sql/005_advisor_fixes.sql` (pinned `search_path` on `set_updated_at`, `audit_log_is_append_only`, `audit_log_no_truncate`; `auth.uid()` wrapped in the `memberships_own_read` policy). Applied via CLI; verified (all three functions show `search_path=public`, the policy shows the wrapped call, the advisors no longer list those items). `001` and `004` edited to carry the same changes for fresh installs. Remaining advisor warnings are intentional (four `SECURITY DEFINER` functions callable by signed-in users by design) plus **leaked password protection is off** (Auth setting in the dashboard; Ben to decide).
- `documentation/plans/INVENTORY_PLAN.md` written (slice 1 only, approved by Ben through `orders.md`).
- `sql/006_inventory_core.sql` applied via CLI: eight `inv_` tables (warehouses, items, counters, requests, request lines, approvals, stock moves, stock balances), RLS select-only, seven public functions (`inv_create_warehouse`, `inv_create_item`, `inv_receive_stock`, `inv_submit_request`, `inv_decide_request`, `inv_post_issue`, `inv_cancel_request`), triggers: request status transitions, issue only for an approved request, ledger and approvals append-only. Table check: nobody decides their own request. Verification: 8 tables RLS on; no non-SELECT privilege for anon/authenticated; exactly the 7 public functions executable by signed-in users.
- `sql/tests/002_inventory_approval.sql` run via CLI: **ALL TESTS PASSED (everything rolled back)** on first run. Covers viewer read-only, reservation and over-reservation refusal, member cannot approve, owner cannot approve own request, issue without approval refused (function, signed-in direct insert, and even a privileged direct insert), table refuses self-approval and a skipped state, manager approves, issue once only, reject and cancel release reservations, organization isolation, module switch enforced in the database, ledger and approvals append-only, audit row per step, audit chains clean. `sql/tests/001` re-run via CLI: still passes.
- API: `lib/rpc.ts` maps `INVALID_STATE`, `NOT_FOUND`, `MODULE_DISABLED` and includes the database's detail text (for example "30 available, 80 requested").

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds `sql/001`-`006`. After the rolled-back tests: 1 organization, 0 items, 0 requests, 2 auth users, 5 audit rows (nothing left behind).

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Not done yet: API routes for inventory, wiring the web screens to the API, test users and demo organization, Worker deploy with secrets, web deploy against the real API, the real-login script for inventory calls. Known limit (in INVENTORY_PLAN): a refused action raises an error, so the refusal is not itself audit-logged.

## 2026-10-29 — Real-login check script written (not run)

**Objective.** Prove over the real path (sign-in, then Supabase REST calls with `X-Org-Id`) what the SQL tests could only simulate.

**Actions Completed.** `scripts/real-login-check.mjs`: signs in with `TEST_EMAIL`/`TEST_PASSWORD`, then checks that the user sees only their organizations and audit rows, that `current_org_id` accepts their own organization header and refuses a random organization (`NOT_A_MEMBER`) and a missing header (`ORG_REQUIRED`), that direct update of `organizations`, delete from and insert into `audit_log` are refused, that `audit_append_admin` and `audit_verify` are not callable, and, for a plain member, that `core_update_org` is `FORBIDDEN` (skipped for owners and admins because it would change data). Never prints the password or token. Reads settings from environment variables or the repo-root `.env`. Supabase Auth currently has two users (from a screenshot): `ben@prime-ad.com` (signed in) and `ben.arthur.wiz@gmail.com` (invited 28 Oct, not yet accepted).

**Database / System Result.** None yet; the script has not been run against Supabase.

**Safety Status.** Syntax checked with `node --check`, and confirmed to stop with a clear message when settings are missing. The only write it attempts is the member-role call, which must be refused; the other write attempts must also be refused. The password is entered by the user in their own terminal, never in chat or a file.

## 2026-10-29 — SQL test script run: all passed

**Objective.** Record the run of `sql/tests/001_core_isolation_and_audit.sql`.

**Actions Completed.** Ben ran the script in the Supabase SQL Editor (postgres role). Result: `ERROR: P0001: ALL TESTS PASSED (everything rolled back)`, raised at line 144 of the block, i.e. the final deliberate `raise exception` after every check (T1 to T11) had passed. No setup problem with `auth.users` occurred.

**Database / System Result.** Proven on the real database: organizations cannot see each other (RLS), the `X-Org-Id` header is refused when missing or for a non-member, owners can change settings and plain members get `FORBIDDEN`, signed-in users have no direct writes (no inserts, updates, deletes, forged audit rows or TRUNCATE), `audit_append_admin` and `audit_verify` are closed to signed-in users, anon is blocked, each organization has its own gapless audit chain that verifies clean, and even the owner cannot update, delete or truncate `audit_log`. Everything was rolled back; no test data remains.

**Safety Status.** Still unproven: the browser path (`X-Org-Id` through PostgREST with a real token from the API) and a real second sign-in. The script simulates sign-in with `set_config`, which matches what PostgREST does but is not the same path. Re-run this script after every change to `sql/`.

## 2026-10-29 — Plans moved into documentation; SQL test script written

**Objective.** Finish the documentation layout from the migration brief and add runnable proof for the database rules.

**Actions Completed.** `TECHNICAL_PLAN.md` moved to `documentation/plans/`, `MANAGEMENT_PLAN.md` to `documentation/planning/`; links in the checklist, `PRODUCT_BRIEF.md`, plans README and planning README fixed (the dead `INPUT_NEEDED.md` pointer replaced by `update.md`). A relative-link check over all repo markdown found only the two intentional template placeholders. New `sql/tests/001_core_isolation_and_audit.sql` plus `sql/tests/README.md`: creates three throwaway users and two organizations, then checks organization isolation (RLS), the `X-Org-Id` header (missing and non-member refused), owner versus member roles, no direct writes by signed-in users (including forged audit rows and TRUNCATE), admin-only functions closed, anon blocked, separate gapless audit chains verified clean, and append-only refusal even for the owner. It always rolls back by ending with a deliberate error: "ALL TESTS PASSED (everything rolled back)" means pass.

**Database / System Result.** None. The test script has **not been run**; it was written without access to the database and may need small fixes (for example if inserting into `auth.users` needs more columns).

**Safety Status.** Link check passed. Not covered by this script and still open: the browser path through PostgREST with a real token. Typecheck and tests unchanged.

## 2026-10-29 — Root README and PRODUCT_BRIEF written

**Objective.** Complete the migration documents from `migration.md` step 3 (README and product brief; `agents.md`, research README and first worklog entry were done earlier).

**Actions Completed.** `README.md` (what it is, four hypotheses with the demand caveat, architecture table, how to run the demo and the real app, the PowerShell `&&` caveat) and `PRODUCT_BRIEF.md` (what it is, why it might win, first vertical slice and its rules, module table by wave, out of scope, open decisions, non-negotiable rules). Product name stays `{{PRODUCT_NAME}}`.

**Database / System Result.** None.

**Safety Status.** Documents only. Commands in the README were written from the existing scripts (`npm run dev:demo -w apps/web`, `build:demo`, `dev:api`, `dev:web`); only the demo commands have been run. The "run the real app" steps have not been tried against the new Supabase project.

## 2026-10-29 — sql/004 run in Supabase and verified

**Objective.** Record the run of `sql/004_revoke_extra_privileges.sql`.

**Actions Completed.** Ben ran `sql/004` and both verification queries (screenshots): query 2, triggers on `audit_log` are `audit_log_append_only`, `audit_log_chain`, `audit_log_no_truncate` (PASS); query 1, no non-SELECT privileges for `anon`/`authenticated` on the four core tables (PASS, zero rows). The TRUNCATE refusal itself was not exercised (deliberately not tested on real data).

**Database / System Result.** `audit_log` has the `audit_log_no_truncate` trigger (query 2: three triggers). Query 1 then returned "Success. No rows returned" (screenshot): `anon` and `authenticated` hold no privilege other than SELECT on `organizations`, `memberships`, `org_modules` and `audit_log`. **`sql/004` is verified; the privilege gap is closed** for those four tables and, by default privileges, for future tables created by the same role.

**Safety Status.** The TRUNCATE refusal was not exercised on real data (deliberately). Still unproven, as before: the browser path (`X-Org-Id` through PostgREST with a real token) and cross-organization refusal.

## 2026-10-29 — sql/003 verified on a database; privilege gap found, sql/004 written

**Objective.** Record the verification results Ben pasted and the gap they exposed.

**Actions Completed.** Results reported by Ben from the Supabase SQL Editor (postgres role): check 5, hash chain: after two `core_update_org` calls as a simulated authenticated owner, `audit_log` shows `seq` 1 (`prev_hash` null, `hash` 4fc1aa5dae) and `seq` 2 (`prev_hash` 4fc1aa5dae, `hash` 8ccaa9eeec), channel `api`, action `organization.updated`; `bad_rows` 0 from `audit_verify` on every row; the three older rows from before `003` have null seq and hash and are ignored by the chain, as designed. Check 6: update on `audit_log` refused (see entry below). Query 3b: `anon` holds nothing; `authenticated` holds **REFERENCES, TRIGGER and TRUNCATE** on all four core tables and no INSERT, UPDATE or DELETE (so query 3 would return zero rows; query 3 and query 4 were not run as separate statements, their conditions are covered by 3b and by `bad_rows` 0). New `sql/004_revoke_extra_privileges.sql` (written, **not run**): revokes TRUNCATE, REFERENCES, TRIGGER from `anon` and `authenticated`, adds a trigger that refuses TRUNCATE on `audit_log`, and revokes those rights by default on future tables. `agents.md` gains the rule for new tables.

**Database / System Result.** `sql/003` is verified for: chain numbering and linking, `audit_verify`, `core_update_org` writing its audit row in the same transaction, append-only update refusal, admin-function privileges. Two real audit rows (`organization.updated`, no setting changed) were added by the test. Not yet verified: the browser path (`X-Org-Id` header through PostgREST, needs an API test with a real token) and cross-organization refusal (needs a second organization and user). The TRUNCATE gap exists in the database until `sql/004` is run.

**Safety Status.** TRUNCATE is not exposed through the Supabase API, so the gap was not remotely reachable, but it let a signed-in role empty the audit log over a direct database connection; treat `sql/004` as required before real data. Typecheck and tests unchanged.

## 2026-10-29 — sql/003 run in Supabase, partly checked (superseded by the entry above)

**Objective.** Record what is known about `sql/003` after Ben ran it.

**Actions Completed.** Ben ran `sql/001`-`003` in the Supabase SQL Editor (as reported; not seen by Claude). Verification results reported by Ben: query 1 PASS (triggers `audit_log_append_only` and `audit_log_chain`); query 2 PASS (anon and authenticated false for `append_admin`, `verify`, `require_role`; service_role true). Check 6 (`update public.audit_log set summary = 'x' where id = 1;`) PASS: refused with `ERROR: P0001: audit_log is append-only (UPDATE refused)` from `audit_log_is_append_only()` (run as the SQL Editor's postgres role, so the rule holds even for the owner). Queries 3, 3b and 4 not confirmed. Chain check (two `core_update_org` calls as an authenticated user, then `audit_verify`) not run.

**Database / System Result.** The Supabase project holds `001`-`003`. Existing audit rows from before `003` have no sequence or hash and are ignored by `audit_verify`.

**Safety Status.** `003` is **not verified** until queries 3 and 4 and the chain check are confirmed. The signed-in path through PostgREST (the `X-Org-Id` header reaching `current_org_id()`) cannot be proven from the SQL Editor; it waits for an API test with a real user token. Cross-organization refusal needs a second organization and user. Open point to check with the extended privileges query: whether `authenticated` still holds TRUNCATE, REFERENCES or TRIGGER on the four core tables (`sql/001` only revoked INSERT, UPDATE, DELETE).

## 2026-10-29 — Demo: purchasing and sales (wave 2 sample) and redeploy

**Objective.** Show on the demo how the product grows past the first slice: buying goods, selling goods, and how both connect to stock and approvals.

**Actions Completed.** `apps/web/src/lib/demoTrade.ts` (sample suppliers, customers, purchase orders, sales orders; money in integer minor units, EGP). `demoInventory.ts`: stock requests can carry a sales-order source, ledger moves carry a reference (purchase order number), exported `createRequest`/`receiveGoods`. `demo.ts`: `/v1/purchasing` and `/v1/sales` routes; Purchasing and Sales appear as demo-only modules in Settings → Apps. Screens: `modules/trade/common.tsx`, `modules/purchasing/PurchasingDemo.tsx` (suppliers, purchase orders, receive goods adds stock), `modules/sales/SalesDemo.tsx` (customers, sales orders, "request stock" raises a stock request that still needs manager approval; the order shows delivered once that request is issued). Request page links back to its sales order; ledger links receipts to their purchase order. Registered in `modules/registry.tsx` in demo mode only. No SQL, API or real module manifest changes.

**Database / System Result.** None. Redeployed the demo to the same Cloudflare Pages project `erp-demo` (deployment `c7e52f6a`); https://erp-demo-bas.pages.dev serves the new bundle.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Live URL answers 200 on `/` and `/sales/orders`. Screens not clicked through in a browser by me. Demo-only: these two apps are a sample of wave 2 and are not committed scope; the real modules wait for the trials and interviews and approved plans.

## 2026-10-28 — Demo published on Cloudflare Pages

**Objective.** Give management a link to the same clickable demo that runs locally.

**Actions Completed.** Added `npm run build:demo` (Vite `demo` mode; ignores any `.env`, so no Supabase values can reach the bundle) and `apps/web/public/_headers` (`X-Robots-Tag: noindex, nofollow`, `nosniff`, no referrer). Built `apps/web/dist`, checked the bundle contains no project address or key. Logged in with `wrangler login`, created the Pages project `erp-demo` (needed `--force`: wrangler 4.154 otherwise delegates Pages to Workers and fails in a workspace root), and deployed with `wrangler pages deploy apps/web/dist --project-name erp-demo --branch main`.

**Database / System Result.** Cloudflare account "Meetings.dmedeskai@gmail.com's Account": Pages project `erp-demo`, production URL **https://erp-demo-bas.pages.dev**, first deployment `d7820af9` (47 files). No Supabase project, API or database involved; sample data only, no sign-in. Public: anyone with the link can open it.

**Safety Status.** Root URL and the deep link `/inventory/requests` answer 200 and the `noindex` header is present. Not opened in a browser by me. Updates are manual: rebuild with `npm run build:demo`, then run the deploy command again (no `--force`). The per-deployment URL `d7820af9.erp-demo-bas.pages.dev` did not resolve from here at the time of checking. Not done: access restriction (Cloudflare Access), GitHub-connected automatic deploys, a custom domain.

## 2026-10-28 — UI restyle: "loading dock" look, logical CSS, Home and stock screens

**Objective.** Make the web UI look designed and ready for right-to-left use, and remove CRM-era leftovers.

**Actions Completed.** `apps/web/src/styles.css` rewritten (warm paper and ink palette with cargo-green accent and signal amber for items that need a person, light and dark, logical properties for RTL, motion that respects reduced-motion; CRM-only styles removed). Self-hosted IBM Plex Sans Arabic and IBM Plex Mono via `@fontsource` (new dependencies in `apps/web`). Home page: line icons, date, staggered tiles. Stock screen: summary cards, stock-level bars. Request page: progress steps. Topbar brand mark. Demo bar: RTL layout toggle.

**Database / System Result.** None.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17; dev server compiles the changed files. **Not looked at in a browser by me**, so spacing, contrast and the RTL flip are unchecked. Screen text is still English only; the toggle flips layout, not language.

## 2026-10-28 — Demo mode: clickable sample of the app and the first inventory slice

**Objective.** Let the screens and the first vertical slice (item, stock request, manager approval, issue, audit entry) be tried in a browser before the real inventory module and a running API exist.

**Actions Completed.** `npm run dev:demo -w apps/web` (Vite `demo` mode, flag `VITE_DEMO_MODE`, off in every other mode). `apps/web/src/lib/demo.ts` (in-memory org, members, modules, audit and a switchable acting person), `lib/demoInventory.ts` (pretend inventory rules: approval gate, no self-approval, reservation, append-only ledger), `DemoApp.tsx` (yellow banner to act as owner, admin, member or viewer), `modules/inventory/InventoryDemo.tsx` (stock on hand, requests, new request, request page with approve/reject/issue, ledger), registered in `modules/registry.tsx` only in demo mode. `lib/api.ts` routes to the demo handlers in demo mode. No API, SQL or `inventory` manifest changes.

**Database / System Result.** None. The demo never talks to Supabase.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Dev server answers on http://localhost:5173 and compiles the new files; the screens have **not** been clicked through by me and are not browser-tested. The demo imitates the rules in the browser; it proves nothing about the database. Demo code is still bundled in normal builds (registered only when the flag is on); to be split out before any deploy.

## 2026-10-28 — ADR-0003: user-scoped database access, audit hash chain, first RPC functions

**Objective.** Make the audit log and tenant checks hold in the database instead of depending on every API route, as required before any stock or approval feature (ADR-0003, `TECHNICAL_PLAN.md` section 3.4).

**Actions Completed.**
- `documentation/architecture/decisions/ADR-0003-mutations-via-rpc.md` (Proposed); active organization is the `X-Org-Id` header checked against membership in the database, not a JWT claim.
- `sql/003_audit_chain_and_core_rpc.sql` (new, **not run**): `audit_log` gains `seq`, `prev_hash`, `hash`, `channel`, `request_id`; per-organization hash-chain trigger with an advisory lock; `audit_verify`; service-role-only `audit_append_admin`; `current_org_id()`, `require_org_role()`; `core_set_module()` and `core_update_org()` which change data and write the audit row in one transaction.
- API: `lib/db.ts` replaced by `lib/db.user.ts` (publishable key plus the caller's JWT) and `lib/db.admin.ts` (secret key); new `lib/rpc.ts` mapping reason codes to HTTP errors; `lib/audit.ts` reduced to an admin-path helper that calls `audit_append_admin`. `tenant.ts`, org settings, module enable/disable and the audit read now run as the user; `memberRoutes.ts` stays on the admin client for Supabase Auth admin calls. New `SUPABASE_PUBLISHABLE_KEY` binding.
- `apps/api/test/boundaries.test.ts`: fails if a file outside an allow-list imports the admin client, or inserts into `audit_log` directly. Added `@types/node` for it.

**Database / System Result.** At the time of writing `sql/003` had not been run (see the later entry: run by Ben, partly checked), so the `X-Org-Id` header check, the hash chain and the two RPC functions are untested against a real database.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17 (shared 4, api 13). Not browser-tested. Not done: SQL tests (state machine, isolation, audit verification); a second-organization isolation test; ADR-0003 is still Proposed. Manual: run `sql/001`, `002`, `003` in order on a staging Supabase project, run the verification queries, then record the run here.

## 2026-10-28 — Migration: generic foundation copied from the previous internal ERP

**Objective.** Start the new product ({{PRODUCT_NAME}}, warehouse-first ERP for Egypt and the GCC) by reusing the generic parts of the previous internal ERP, without carrying over CRM, time tracking or customer-specific content. The old repository was only read, never modified.

**Actions Completed.**
- Documentation system: `agents.md` (rewritten for this product, logging rules kept, stock/approval/audit and competitor-licensing rules added), `CLAUDE.md`, `PLANS.md`, `documentation/` structure with reset worklog, checklist, plan template, ADR format and research/teardown template, competitor index (Edara, Daftra, Odoo, Wafeq, Zoho, ERPNext, Business Central).
- Code foundation: monorepo tooling; `apps/api` (auth, tenant resolution, permission/module guards, response helpers, core org/members/modules/audit routes); `apps/web` (module-driven shell, sign-in, org picker, core settings screens, list view); `packages/shared` (API types, permissions, module manifest, money); `sql/001`, `sql/002`.
- Changed on the way: package scope `@ggo/*` to `@erp/*`; default currency `USD` to `EGP` in `sql/001`; CRM manifest replaced by an empty `inventory` placeholder module (API routes file, empty web and shared folders); CRM wiring removed from the API and web registries, Home and Shell.
- Left behind: CRM and activities/timeline/my-tasks code and SQL, the generic record-page/field components built for CRM, GGO plans, discovery notes, old worklog and checklist content.
- `apps/api/src/lib/db.ts` and `audit.ts` copied as-is and marked `TODO(ADR-0003)`: they use the secret key and a separate-call audit insert, which must be reworked before the stock and approval features (see `TECHNICAL_PLAN.md`).

**Database / System Result.** None. `sql/001` and `sql/002` have not been run against any Supabase project.

**Safety Status.** `npm install` ok (0 vulnerabilities); `npm run typecheck` clean in shared, api and web; `npm test` passing (shared 4, api 11). Not browser-tested. No `.env` files, secrets, node_modules or git history copied. Open: product name and deciders placeholders, README, PRODUCT_BRIEF, ADR-0003, the db/audit rework.
