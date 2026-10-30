# {{PRODUCT_NAME}} Worklog

Newest first. Every significant fix, schema change, migration run, deployment or data operation
gets an entry with these four headings:

- **Objective.** Why the work was done.
- **Actions Completed.** What changed, with file paths.
- **Database / System Result.** What happened in Supabase / Cloudflare / hosting, or "None".
- **Safety Status.** Tests run, what was not verified, and manual steps still needed.

Entry heading format: `## YYYY-MM-DD — Short title`. If it is not in this file, it has not been
run or deployed.

## 2026-10-30 — Purchasing & Receiving module: migration 017

**Objective.** Turn the sample purchasing screen into the first real purchasing workflow: suppliers, purchase orders and controlled receipt of goods into warehouse stock.

**Actions Completed.** Added the approved [Purchasing plan](../plans/PURCHASING_PLAN.md), shared module permissions, user-scoped API routes, and registered Purchasing in the real web application. `sql/017_purchasing_core.sql` adds organization-isolated suppliers, orders and lines; all signed-in writes remain closed except audited database functions. `pur_receive_order` locks an ordered purchase order, posts each line with the inventory receipt helper, marks the order received, and appends the purchasing audit event in the same transaction. Added `sql/tests/013_purchasing_receiving.sql` and enabled Purchasing for Test Organization with the audited `core_set_module` function.

**Database / System Result.** Migration 017 was applied to the linked Supabase project. Its verification returned all three purchasing tables with RLS; the direct-write privilege query returned no rows. Test 013 reached its deliberate `ALL TESTS PASSED (everything rolled back)` result, so its setup rows were not retained. Test Organization now has the `purchasing` module enabled; enabling it adds the normal audited module-change event only.

**Safety Status.** The schema change is additive: no existing table or business record was deleted or modified. The proof checks direct writes are refused, receipts happen once, stock changes once, the audit chain verifies, and another organization cannot read or cancel the order. Root typecheck and tests passed; the web production build also passed. No commit, push, Worker deployment or Pages deployment was made.

## 2026-10-30 — Added all Auth users to Test Organization

**Objective.** During testing, make every existing Supabase Auth account available in the single Test Organization.

**Actions Completed.** Read the live Auth users and memberships, preserved the existing `ben@prime-ad.com` owner and `ben.arthur.wiz@gmail.com` member, and added the other six Auth accounts to Test Organization as regular members. Added matching `member.added` audit entries in the same transaction. No roles in the other organizations were changed.

**Database / System Result.** Test Organization now has 8 active memberships: 1 owner and 7 members. The added accounts are the three demo users and three concurrency-test users.

**Safety Status.** This was an explicitly authorized additive data operation against the named Test Organization. No users were deleted, disabled or moved from another organization. The app should be refreshed before checking Settings → Users.

## 2026-10-30 — Deploy stock adjustments app via GitHub Actions

**Objective.** Publish the Inventory stock-adjustment app after the automatic deployment workflow was enabled.

**Actions Completed.** GitHub Actions run `41084167662` passed the typecheck, shared/API tests and web build, then deployed both the `erp-api` Worker and `erp-live` Pages site from `main`.

**Database / System Result.** None; the existing stock-adjustment migration was reused and no database mutation was run by the deployment.

**Safety Status.** CI and both Cloudflare deployment jobs completed successfully. The Node.js 20 messages are third-party action deprecation warnings, not deployment errors. Manual browser refresh and click-through remain needed.

## 2026-10-30 — Inventory stock adjustments and cycle counts app

**Objective.** Add the next warehouse workflow after approval policies: physical counts that become ledger adjustments only after manager approval.

**Actions Completed.** Added `Inventory → Stock adjustments`. Staff can select an item and warehouse, enter a counted quantity and reason, submit a count, and cancel their pending count. Owners/admins can approve or reject it. The API uses `inv_submit_adjustment`, `inv_decide_adjustment` and `inv_cancel_adjustment`; the database remains responsible for reserved-stock checks, stale-count refusal, approval enforcement, ledger posting and audit. Added adjustment permissions and demo-mode behavior.

**Database / System Result.** None; `sql/012_stock_adjustments.sql` was already applied and tested, so no migration or production data change was run.

**Safety Status.** Root typecheck passed; shared tests (4) and API tests (26) passed; web Vite production build passed; diff check passed. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — Inventory approval policies app

**Objective.** Add the next small Inventory app after reorder levels, while keeping the existing database-enforced approval path.

**Actions Completed.** Added `Inventory → Approval policies`. Owners and admins can add or update quantity thresholds, choose all warehouses or one warehouse, choose 1–3 required approvals, and remove policies. Inventory users can view the rules. Added API routes backed by `inv_set_approval_policy` and `inv_remove_approval_policy`, the `inventory.approval_policies.manage` permission, and equivalent demo-mode behavior. The highest matching policy continues to be enforced by `inv_decide_request`.

**Database / System Result.** None; `sql/011_approval_policies.sql` was already applied and tested, so no migration or production data change was run.

**Safety Status.** Root typecheck passed; shared tests (4) and API tests (26) passed; web typecheck and production Vite build passed; diff check passed. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — Inventory reorder levels app

**Objective.** Build a smaller useful Inventory feature while deferring real WhatsApp integration.

**Actions Completed.** Added the Reorder levels page to the real Inventory app. It shows available stock across warehouses, configured reorder levels, and low-stock status. Owners and admins can save or clear a non-negative reorder level. Added the API route `POST /v1/inventory/items/:id/reorder-level`, exposed the existing `reorder_level` field on item reads, added the `inventory.reorder.manage` permission, and added equivalent demo-mode behavior. The database function `inv_set_reorder_level` remains the mutation and audit boundary; no new migration was needed because `sql/013_reorder_levels.sql` is already live and tested.

**Database / System Result.** None; no database migration or production data change was run in this turn.

**Safety Status.** Typecheck passed; API tests passed (26); shared tests passed (4); web production build passed when run as separate TypeScript and Vite steps. The normal Windows `npm run build -w apps/web` wrapper still fails on PowerShell's unsupported `&&`, while the GitHub Ubuntu workflow is unaffected. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — GitHub Actions deployment automation prepared

**Objective.** Make the API Worker and real web app deploy automatically after a successful push to `main`.

**Actions Completed.** Added `.github/workflows/ci-deploy.yml`. Pull requests and pushes run dependency installation, typecheck, tests and the production web build. A successful push to `main` deploys `erp-api` with Wrangler and publishes `apps/web/dist` to the `erp-live` Cloudflare Pages project. Database migrations remain manual and are not part of the push deployment.

**Database / System Result.** None. No Supabase or Cloudflare production state was changed.

**Safety Status.** The workflow is not active yet because the GitHub repository currently has no secrets. Before the first push deployment, configure the `production` environment with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. The existing Worker secret `SUPABASE_SECRET_KEY` remains stored remotely in Cloudflare and is not copied to GitHub. The workflow file needs to be committed and pushed by Ben; no commit was created by Codex.

## 2026-10-30 — Live database verification resumed

**Objective.** Complete the three read-only Supabase checks left open after the SQL test suite.

**Actions Completed.** Using the linked Supabase project, ran `audit_verify` for every active organization, ran `msg_cleanup(90, true)` as a dry run, and ran `supabase db advisors --linked`.

**Database / System Result.** There are 3 active organizations; all 3 audit chains returned `first_bad_seq = null` and `reason = null`. The 90-day cleanup dry run reported 0 outbox, 0 notifications, and 0 tokens. Advisors returned the existing intentional warnings for authenticated callers of SECURITY DEFINER application functions, plus the existing Auth warning that leaked-password protection is disabled; no new database mutation was made.

**Safety Status.** All checks were read-only. No cleanup was executed, no rows changed, no deployment occurred, and no secrets were printed. The advisor warnings should remain until the application-function exposure policy and Auth setting are deliberately reviewed.

---

## 2026-10-30 (overnight 1/n) — S2 identity binding, S3 decision tokens, S4 task replies: sql/008, 009, 010 and tests 004, 005, 006

**Objective.** Overnight queue from Ben, in order. S2, S3 and S4 are the database side of the real WhatsApp approvals and task replies in `documentation/plans/FEATURE_SET_AND_TECH_STACK.md`. No message provider is involved yet: the webhook functions take a number and a text, so they are testable on a real database and will be called by the WhatsApp webhook (S1 adapter, next).

**Actions Completed.**
- `sql/008_identity_binding.sql`: `msg_identities`; `msg_identity_start/confirm/revoke`; codes are a 6-digit random value stored only as a hash, expire in 10 minutes, 5 tries, 5 starts per hour; outbox gets `secret_body` (no SELECT for signed-in users, wiped on sent, failed or expired) so a code or token is never readable in the outbox; audit rows mask numbers (last 3 digits). New message kinds `verification` and `alert`.
- `sql/009_decision_tokens.sql`: `msg_tokens` (hash only, one per request, approver and channel, expiring, single use, no access for signed-in users); a manager with a verified WhatsApp number gets a WhatsApp message with a token; `msg_decide_by_token` (service role) turns "APPROVE/YES/REJECT/NO <token>" into a call to `inv_decide_request` as the approver with channel `whatsapp`, so role check, self-approval refusal, state check and audit are the app's own. Tokens issued before a number was (re-)verified stop working. Refusals return a code and are audited (a refusal never raises, so its audit row is kept).
- `sql/010_task_replies.sql`: `msg_task_reply` (service role): "ACK/START/DONE [ref]" from the assignee's verified number calls `tsk_set_status` as that person; ambiguity (several open tasks) returns the list instead of guessing; assignees with a verified number get a WhatsApp message with their task reference.
- Tests (each rolls back): `004_identity_binding.sql` (code only through the outbox and hashed, unreadable to signed-in users and owners, wrong and expired codes, 5-try lockout, duplicate number refused, rebind replaces old, viewer and module-off refused, rate limit, direct writes refused, secret wiped after sending, masked audit); `005_decision_tokens.sql` (tokens only for verified managers, hashed, unreadable; wrong number, unknown number, free text, replay, expired, already decided in the app, rebound number, forged token for own request all refused and audited; valid reply approves through the same function and leaves the same records as the app except the channel; reject by reply releases the reservation); `006_task_replies.sql` (ack and complete by reply, same audit as the app, unknown number, wrong person, no open task, ambiguity, reference, closed to signed-in users).

**Database / System Result.** Project now holds `sql/001`-`010`. Test runs through the CLI: 004, 005 and 006 each failed once on a mistake in the test itself (a column my own privilege rules hide; a wrong expected reservation; a regex that matched hex digits) and then **ALL TESTS PASSED**; regression run of tests 001 to 006 after the migrations: all pass (see the line printed by that run in the final summary).

**Safety Status.** Nothing here sends a real message: a channel adapter is still needed (next item). Webhook functions are callable only by the service role. Rollback: re-running the earlier version of a function's file (`sql/007_tasks_and_outbox.sql` for `inv_requests_notify`-era behaviour is superseded by `009`; the 007 definitions of `msg_complete`, `msg_claim_due` and `tsk_tasks_notify` are restored by re-running `sql/007` then `sql/008` without the new parts); no table was dropped, so data is not at risk.

## 2026-10-30 (overnight 2/n): O10 concurrency check

**Objective:** prove the rules hold when several people act at the same time, through the real login path (SQL tests run in one transaction and cannot do this).

**Actions Completed:**
- `sql/seed/003_concurrency_org.sql`: throwaway organization "Concurrency Check (test)" (owner, admin, member; inventory, messaging, tasks). Three test users created with the CLI; passwords only in `.temp/concurrency-credentials.txt` (git-ignored). Not the demo organization.
- `scripts/concurrency-check.mjs`: signs in as the three users and races: six reservations of 4 against 10 units; owner and manager approving the same request; three people issuing the same approved request; two delivery job runs. Creates its own `CONC-` warehouse and item each run.

**Database / System Result:** run against the live project, ALL 12 CHECKS PASSED: exactly 2 of 6 reservations succeeded and 4 were refused INSUFFICIENT_AVAILABLE (reserved 8 of 10); exactly one of two approvals accepted and one approval record; exactly one of three issues accepted, one -4 ledger movement, on hand 6 and reserved 4; both job runs answered 200 and 6 claimed = 6 sent, no message tried twice. The check leaves `CONC-` test rows in the throwaway organization only; nothing was deleted.

**Safety Status:** no existing data changed, no destructive SQL, no secrets in the repo, nothing deployed, nothing committed.
## 2026-10-30 (overnight 3/n): X7 names for every member: sql/016, test 012

**Objective:** a requester saw "Someone" instead of names because the members list is admin-only.

**Actions Completed:** `sql/016_org_people.sql` adds `core_org_people()` (id and display name only, active members of the caller's own organization; no email, role or sign-in data). `GET /v1/core/people` in `apps/api/src/modules/core/routes.ts`; `usePeople` in `apps/web/src/lib/people.ts` now uses it (demo mode unchanged). `sql/tests/012_org_people.sql` added.

**Database / System Result:** applied to the live project with the CLI (authenticated can run it, anonymous cannot). Test 012 ALL TESTS PASSED (everything rolled back): member sees 2 active people by name, full name and email-prefix fallback, disabled member and other organization not listed, wrong organization refused (NOT_A_MEMBER), missing header refused (ORG_REQUIRED), anonymous refused. `npm run typecheck` clean; `npm test` 26 API tests + 4 shared tests passed. The new API route is NOT deployed yet, so the live app still shows the old behaviour until the Worker and Pages are deployed.

**Safety Status:** read-only function, no table changed, nothing deleted, nothing deployed, nothing committed.
## 2026-10-30 (overnight 4/n): X1 language framework; I5, I3, I6, O3, O9 records; full regression

**Objective:** finish the overnight queue and record what was done after "overnight 1/n".

**Actions Completed:**
- I5 `sql/011_approval_policies.sql` (N approvals above a quantity), I3 `sql/012_stock_adjustments.sql` (counted vs system, approval, stale count refused), I6 `sql/013_reorder_levels.sql` (reorder level, low-stock message in `msg_run_chasing`), O3 `sql/014_audit_check.sql` (`audit_check_all`, hourly, alerts owners; also called by the 5-minute job in `apps/api/src/jobs/outbox.ts`), O9 `sql/015_outbox_retention.sql` (`msg_cleanup`, dry run by default, NOT scheduled). Each applied with the CLI and tested with `sql/tests/007` to `011` (all passed when run). Test 004 and 005 had flawed hash assertions (a 6-digit run can occur inside a 64-hex hash); fixed to exact checks and repeated 5 times.
- X1: `apps/web/src/lib/i18n.tsx` (English/Arabic, English text is the key so a missing translation shows English, sets `lang` and `dir=rtl`, choice kept in the browser), language switch in the user menu, applied to the top bar, user menu and page-not-found. Coverage is 9 strings only. The Arabic is a machine draft and needs review by a native speaker. The rest of the app is English only. Right-to-left layout is not checked in a browser (styles.css has no hard-coded left/right rules, which is all I verified).
- `Messaging.tsx` shows low-stock and audit-check results of a delivery pass.

**Database / System Result (regression, 2026-10-30, live project via CLI):** SQL tests 001 to 012 all ALL TESTS PASSED. `scripts/real-login-check.mjs`: owner 15, manager 15, requester 17 checks passed. `scripts/concurrency-check.mjs`: 12 of 12 passed. `npm run typecheck` clean, `npm test` 26 API + 4 shared passed, `vite build` succeeded.

**Safety Status:** nothing deployed overnight (Worker and Pages are unchanged: Worker `9d7095fc-f77d-4c6e-b2cb-32b3a9f854b2`, previous `3d6ff8ce-fb30-412e-8970-0e1dd74b837b`; Pages erp-live `232a6013-eeed-4dac-bef9-9f7efc47d399`, previous `91bdab5d-54c9-4b61-a48e-579d829e5ccd`). Database changes are additive; no table, row or audit entry was dropped or deleted; `msg_cleanup` is not scheduled. No secrets in files; nothing committed.
## 2026-10-29 — Feature set and tech stack written; task detail screen with acknowledge and complete

**Objective.** Ben asked for "no fake shit": a real feature set and the tech stack needed, written down. Two pasted notes arrived at the same time: "Activating Stock Requests" and "the employee receives an in-app notification; clicking it takes them to the Task Details screen where they can acknowledge or complete the task."

**Actions Completed.**
- `documentation/plans/FEATURE_SET_AND_TECH_STACK.md`: what is real today with evidence; every feature with status, phase, how and dependencies (star feature S1-S10, inventory I1-I11, purchasing and sales, platform, reporting, compliance, security and operations O1-O10); current stack; needed stack per capability with labelled outside claims; the real path for the star feature step by step (Meta Cloud API free test number, up to 5 verified recipients, no customer messages, then business verification); decisions table with owners. Outside facts were checked by web search and are labelled; unconfirmed items say **Unverified** (Egyptian-Arabic speech accuracy, ETA signing details, Supabase email limits, Egypt WhatsApp rates, availability of WhatsApp calling for Egypt and the GCC). The `fake` channel is documented as a test seam only. No costs or dates.
- Intake loop (`neworder.md` section 6) for the pasted notes: **"Activating Stock Requests"** is ambiguous (module switch, a draft step, or re-opening); recorded as B12 with one question for Ben, nothing built. **Task details** (B11): `GET /v1/tasks/:id`; web route `/tasks/:id` with the task, status, who and when, **Acknowledge** (sets `in_progress`; labelled "Acknowledged" in lists), **Complete**, **Cancel task**, and its audit history; task notifications now open it (the bell and the Notifications page); the task list links to it and the "Start" button is now "Acknowledge". No database change: acknowledge reuses the existing `in_progress` transition and every button calls `tsk_set_status` with the person's rights (opening the page changes nothing). Rule check: a notification only navigates; it never changes a task by itself.
- Deployed: Worker version `9d7095fc`, web deployment `232a6013`; bundle scanned clean.

**Database / System Result.** None.

**Safety Status.** Typecheck clean; 17 tests pass. Live API check as grant: `GET /v1/tasks/:id` 200 for "Count aisle 4" (still open, untouched), the task notification's entity id equals the task id, a malformed id gives 404. The page itself has not been opened in a browser by me. "Acknowledge" is not a separate stored fact (no timestamp of when it was acknowledged beyond the audit entry); if the reminder logic should stop on acknowledgement, that is a design change to ask Ben about.

## 2026-10-29 — Slice 2 built end to end: job, routes, screens, demo seed, deploy; demo path verified over the live API

**Objective.** Finish slice 2 for the demo path in `neworder.md` task 8: manager gets a notification for the pending request, staff gets a task, a reminder fires if nobody answers.

**Actions Completed.**
- API: channel adapter interface with in-app and fake adapters (`lib/channels/index.ts`; WhatsApp, voice and email fail visibly as "not configured"); the delivery and chasing job (`jobs/outbox.ts`, admin client, only calls the service-role functions); routes `tasks` (`GET/POST /v1/tasks`, `POST /v1/tasks/:id/status`) and `messaging` (`GET /notifications`, `POST /notifications/read`, `GET /outbox`, `POST /process`); Cloudflare cron trigger `*/5 * * * *` plus the Worker `scheduled` handler; boundary test allow-list extended by exactly the job and the adapter file. New modules `tasks` and `messaging` with permission keys in `packages/shared/src/modules.ts` (`messaging.outbox.manage`, not `.read`, so members do not receive it).
- Web: notification bell in the top bar (unread count, latest messages, mark read, opens the request or task), Tasks page (my/all, new task, start/done/cancel), Messages app (notifications; message outbox with "Run delivery and reminders now"). Real API only; the sample-data demo is unchanged.
- Demo data: `sql/seed/002_demo_slice2.sql` (run via CLI): messaging and tasks on for the demo organization, chasing times 1 minute (reminder) and 3 minutes (escalation), joseph assigns grant the task "Count aisle 4" due in 3 minutes, grant submits a request for 20 gloves (OUT-0003). 3 messages queued.
- Deploys: Worker `erp-api` version `3d6ff8ce` (cron schedule confirmed in the deploy output; secret still set); web `erp-live` deployment `91bdab5d`, bundle scanned clean (no passwords, no secret keys) and confirmed to contain the new screens.

**Database / System Result.** Seed 002 only (rows in `tsk_tasks`, `msg_outbox`, `org_modules`, organization settings, plus the new request and audit rows). Live API run with real logins for chris, joseph and grant: grant gets 403 on running the job, reading the outbox and creating a task; chris runs delivery: 2 reminders and 1 escalation queued (for the older waiting request OUT-0002), 6 messages claimed, 6 sent, 0 failed; joseph has 2 unread ("OUT-0003 needs your approval", "Reminder: OUT-0002 is still waiting for approval"); chris has 3 (adds "Escalation: OUT-0002 has had no decision"); grant has 1 ("New task: Count aisle 4"); the outbox shows all 6 as sent; an immediate second run queued and sent nothing; mark-all-read changed 2 rows.

**Safety Status.** Typecheck clean; 17 tests pass; SQL tests 001, 002, 003 pass (CLI). The screens have **not** been opened in a browser by me. The cron trigger is deployed but its first scheduled run has not been observed. Not done: slice 3 (WhatsApp adapter, identity binding, decision tokens), slice 4 (voice), a concurrency test for two job runs at once, outbox retention. The demo's first delivery pass already happened during my test, so Ben will see reminders for OUT-0003 and the overdue task only after the reminder and due times pass (1 and 3 minutes after the seed) and a pass runs (cron or the "Run now" button).

## 2026-10-29 — Slice 2 database layer: plan, sql/007 applied, sql/tests/003 passes

**Objective.** Start slice 2 of `neworder.md` (tasks and the notification outbox with a fake channel adapter) database-first, and review it against ADR-0003 before building screens.

**Actions Completed.**
- Plan: `documentation/plans/TASKS_AND_OUTBOX_PLAN.md` (modules `tasks` and `messaging`, tables `tsk_`/`msg_`, behaviour, permissions, tests, rollout).
- Migration `sql/007_tasks_and_outbox.sql` applied via CLI (twice more after edits; rerun-safe). Tables `tsk_tasks`, `msg_outbox`, `msg_notifications` (RLS on, select-only for signed-in users). Functions: `tsk_create_task`, `tsk_set_status`, `msg_mark_read` (signed-in users, role and module checked, audit in the same transaction); `msg_claim_due`, `msg_complete`, `msg_deliver_in_app`, `msg_run_chasing` (service role only, for the scheduled job); internal `mod__guard`, `msg__managers`, `msg__enqueue`; triggers that write outbox rows in the same transaction as the event (`inv_requests_notify`, `tsk_tasks_notify`) and transition guards. Verification: 3 tables RLS on; no non-SELECT privilege for anon/authenticated; signed-in users can execute exactly `tsk_create_task`, `tsk_set_status`, `msg_mark_read` of these.
- **Review of 007 against ADR-0003.** Conforms: changes only through security-definer functions with pinned `search_path`, called with the user's identity; organization from the validated header; direct writes revoked; audit written in the same transaction as the change; the admin client is needed only by the scheduled job (service-role functions), not by request routes. Gaps found and fixed: (1) delivery outcomes were not audited, so sent, failed and expired messages are now written to the append-only, hash-chained audit log (`messaging.message.sent/failed/expired`, metadata: channel, kind, recipient, attempts); (2) a task could be "changed" to the status it already had, which rewrote the completion time: now `INVALID_STATE`. Accepted: outbox rows are operational state and mutable by the service role (retries need that); the audit entries are the permanent record of outcomes. Not covered by this slice: retention and cleanup of old outbox rows.
- `sql/tests/003_tasks_and_outbox.sql`: covers outbox row in the same transaction as its event (S1, S2), idempotent enqueue and idempotent delivery (S1c-d, S3), retry with backoff and giving up (S4), expiry (S5), stuck-message recovery (S6), reminders and escalation fire once and only when due, and stop after a decision or completion (S7-S9), task rules (S9), notifications and outbox visibility (S10-S11), service functions and direct writes closed to signed-in users (S12), channel cannot change stock or approve (S14: requests stay submitted, no approvals, ledger and balances unchanged, messaging functions contain no inventory writes), organization isolation (S11, S2), audit chain clean (S13).

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds `sql/001`-`007`. Test runs through the CLI, all rolled back: `003` first run **ALL TESTS PASSED** (before the audit additions); after the audit-of-outcomes edit and re-applying 007: `003`, `002` and `001` **all ALL TESTS PASSED**.

**Safety Status.** Not yet built: API routes, the scheduled job (cron), screens, demo seed for this slice, deploy. The demo organization does not have the `tasks` and `messaging` modules enabled yet, so nothing is queued there.

## 2026-10-29 — Worker secret set; audit log ordering fix; Worker redeployed

**Objective.** Close the open item from task 1 (Settings → Users error, "Someone" names) and check it works.

**Actions Completed.** Ben ran `npx wrangler secret put SUPABASE_SECRET_KEY --name erp-api` himself (pasted at the prompt; I did not see the value). `wrangler secret list --name erp-api` now shows the name `SUPABASE_SECRET_KEY` (type `secret_text`), the only secret. Through the deployed Worker as chris (owner): `GET /v1/core/members` returns 200 with all three users and their roles (so Settings → Users and names on request pages work); `GET /v1/core/audit` returns 200. The check also showed the audit log shuffling entries that share one timestamp (one database function writes several rows in one transaction): `apps/api/src/modules/core/routes.ts` now orders by `id` (insertion order) instead of `occurred_at`. Worker redeployed (version `0ec3eb58`), secret confirmed still set after the redeploy.

**Database / System Result.** None.

**Safety Status.** Typecheck clean; 17 tests pass. The Settings → Users page and the audit screen were checked at API level only, not in a browser. B1 remains open until Ben's browser click-through.

## 2026-10-29 — neworder.md tasks 1-7: branding, demo banner, hygiene, tests re-run, redeploy

**Objective.** Work through `neworder.md` ("Next tasks"), tasks 1 to 7. Task 8 (slice 2) not started.

**Actions Completed.**
- Task 1 (verify deploy): the Worker holds the Supabase URL, publishable key and allowed origins (checked through behaviour: sign-in token accepted, CORS correct). **`SUPABASE_SECRET_KEY` is not set**: `wrangler secret list --name erp-api` returns `[]`. Ben's first attempt failed because he ran `wrangler secret put` from the repo root (no Worker name there); the command needs `cd apps\api` or `--name erp-api`. So the "Supabase isn't configured on this server" error on Settings → Users is **still present**, and user names fall back to "Someone" on request pages because the members list also needs the admin client. Sign-in in a real browser as the three users has **not** been done by me (no browser testing); the same sign-in was proven over the API.
- Task 2 (GGO branding): no "GGO" in any code, UI string, style, seed or script. The header showed "GGO" because the old organization was literally named GGO in the database: renamed it to "Test Organization" (slug `test-organization`) through SQL with an `organization.updated` audit row (written with `audit_append_admin`), chain still clean. Doc mentions neutralised in `TECHNICAL_PLAN.md` and `WORKLOG.md`. `migration.md` and `neworder.md` are Ben's own files and still mention GGO as history. The Supabase project's dashboard name is "ggoerp" (not user-facing; rename in the dashboard if wanted).
- Task 3 (banner): new `components/EnvBanner.tsx`, "Demo environment: sample data only. Changes are saved to a test database; do not enter real customer data." on the live build (flag `DEMO_ENVIRONMENT=true` at build time via `vite.config.ts`); the sample-data build's own bar now starts with "Demo environment: sample data only. Nothing is saved; reload resets it." Both redeployed (erp-live deployment `2cf38fa4`, erp-demo deployment `55f75635`); both bundles confirmed to contain the text.
- Task 4 (hygiene): `.temp/demo-credentials.txt`, `.env`, `.env.local`, `apps/api/.dev.vars`, `test.ps1`, `supabase/.temp/linked-project.json` are git-ignored; added `dist-*/` to `.gitignore`. Scanned all 124 non-ignored files, both web bundles, the worklog and update.md for the three demo passwords, `sb_secret_` keys and JWTs: none found. Worker secrets by name: none set yet (plain variables: `APP_ENV`, `ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). Recommendations: rotate the three demo passwords after the demo; set Supabase Authentication → URL Configuration → Site URL to `https://erp-live.pages.dev` and add it to the redirect URLs so invite and reset links return to the app; the Supabase secret key will become visible in your shell history if typed instead of pasted at the prompt (paste at the prompt).
- Task 5 (tests): `sql/tests/` already covers every listed item. `002_inventory_approval.sql`: direct ledger insert refused (S6b signed-in user, S6c privileged role), issue without approval refused (S6a, S10c), self-approval refused (S5b function, S7a table constraint), reservation (S3, S4, S10, S11), audit entry per step (S1c, S15a-e), hash chain verifies (S15f, S15g), other-organization isolation (S12a-f). `001_core_isolation_and_audit.sql` covers core isolation and the chain. Both re-run via CLI after the rename: **ALL TESTS PASSED**, nothing left behind (2 organizations, 5 users, 2 requests, audit rows unchanged apart from the rename entry).
- Task 6 (commit grouping) and task 7 (status block and backlog in `neworder.md`; the brief names it `CLAUDE_CODE_LIVING_BRIEF.md`, the actual file is `neworder.md`) done; see `update.md`.

**Database / System Result.** One organization renamed (name and slug) with an audit row. No migration run. Cloudflare: both Pages projects redeployed; Worker unchanged.

**Safety Status.** Typecheck clean; 17 tests pass; SQL tests pass. Not browser-tested by me. Open: Worker secret key, browser sign-in check by Ben, Supabase Site URL, names without the admin client (idea: a user-scoped database function that returns the organization's people; not built), slice 2.

## 2026-10-29 — Deploy: API Worker `erp-api` and real web app `erp-live` on Cloudflare

**Objective.** Put the real inventory slice (real sign-in, real database) behind a URL Ben and management can click through.

**Actions Completed.**
- Cloudflare account `meetings.dmedeskai@gmail.com` (login still active). Created Pages project `erp-live` (`wrangler pages project create ... --force`) and deployed the real web build: `https://erp-live.pages.dev` (deployment `3f93bfc5`). Built with `npx vite build` in `apps/web` (the `build` script's `&&` fails in this shell) with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (public by design) and `VITE_API_BASE_URL` set for the build only. Demo mode is off in this build; the demo code is still bundled (checklist item open).
- Deployed Worker `erp-api` from `apps/api`: `https://erp-api.meetings-dmedeskai.workers.dev` (version `31028900`). `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` passed at deploy time with `--var` (not stored in the repo); `ALLOWED_ORIGINS` set in `apps/api/wrangler.toml` to `https://erp-live.pages.dev,http://localhost:5173` after a first deploy with the value passed via `--var` produced no CORS header at all (cause not investigated; the toml value works).
- **`SUPABASE_SECRET_KEY` is not set on the Worker yet** (Ben sets it with `wrangler secret put`; I must not see it). Without it, only the routes that use the admin client fail with 503: Settings → Users (invite, role changes) and member audit events. The inventory flow does not need it.

**Database / System Result.** None.

**Safety Status.** Smoke test through the deployed Worker with a real login as grant (member): `/health` ok, no token gives 401, session 200 (Demo Trading Co., role member, modules core and inventory), items 5, stock 9 rows, requests OUT-0001 issued and OUT-0002 submitted, ledger 11 rows, a foreign `X-Org-Id` gives 403 `not_a_member`. CORS: `erp-live.pages.dev` and `localhost:5173` allowed, an unknown origin gets no allow header. The web app pages return 200; the sign-in screen and the click-through are **not yet tested by anyone in a browser**. Supabase Auth "Site URL" and redirect URLs still point to defaults, so password-reset and invite links will not return to `erp-live`.

## 2026-10-29 — Demo users created, demo organization seeded, real-login checks pass (all via the CLI)

**Objective.** Put real data and real sign-in behind the inventory slice, per `neworder.md` (slice 1) and "run the Supabase stuff using the CLI".

**Actions Completed.**
- Created three Supabase Auth users by SQL through the CLI (`auth.users` plus `auth.identities`, bcrypt via `extensions.crypt`, email pre-confirmed; no email sent): `chris.johnson.wiz@gmail.com`, `joseph.brown.wiz@gmail.com`, `grant.holden.wiz@gmail.com`. Passwords were generated randomly and saved only to `.temp/demo-credentials.txt` (git-ignored); they were not printed or committed. The temporary SQL file that held them was blanked.
- Ran `sql/seed/001_demo_organization.sql` via CLI. Result: organization "Demo Trading Co." (EGP, Africa/Cairo), 3 members (chris owner, joseph admin, grant member), module `inventory` on, 2 warehouses, 5 items, 2 requests (one issued, one waiting for approval), 21 audit rows, `audit_verify` 0 problems. Stock read back: cartons 460 (500 − 40 issued), tape 54 (60 − 6), gloves 120 on hand with 30 reserved for the waiting request.
- `scripts/real-login-check.mjs` extended with inventory checks (items readable, direct ledger insert refused, direct balance change refused with a permission error, issue of an unapproved request refused, member cannot approve) and a clearer sign-in error message.

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds the demo organization and 3 more auth users (5 in total). Real sign-in worked for all three through Supabase's password sign-in, which also shows the SQL-created users are accepted by Supabase Auth.

**Safety Status.** Real-login check (real password sign-in, then Supabase REST calls with `X-Org-Id`): **chris 15/15, joseph 15/15, grant 17/17 passed**. This proves the browser path the SQL tests could only simulate: header accepted for own organization and refused for another or missing, isolation, no direct writes, admin functions closed, approval enforced for real users. Skipped on purpose (would change data): approving as owner/admin. Not yet tested: the Worker routes and the screens against this data. Credentials created by direct SQL is non-standard; if Supabase Auth ever misbehaves for these users, recreate them from the dashboard.

## 2026-10-29 — Workstream C: inventory API routes, screens on the real API, demo seed script (not run)

**Objective.** Connect the inventory database layer (`sql/006`) to the API and the web screens, and prepare the demo organization.

**Actions Completed.**
- Roles for the demo users (from Ben): `chris.johnson.wiz@gmail.com` owner, `joseph.brown.wiz@gmail.com` manager (admin), `grant.holden.wiz@gmail.com` requester (member). **These three users do not exist in Supabase Auth yet** (checked via CLI: only `ben@prime-ad.com` and `ben.arthur.wiz@gmail.com`).
- `packages/shared/src/modules.ts`: inventory permissions (`inventory.items.read`, `.items.manage`, `.warehouses.manage`, `.request.create`, `.request.approve`, `.stock.issue`) and member grants.
- `apps/api/src/modules/inventory/routes.ts`: reads (warehouses, items, stock, ledger, requests) filtered by the caller's organization, and changes through the seven `sql/006` functions; response shapes match the existing screens. No admin client used.
- Web: `modules/inventory/InventoryDemo.tsx` renamed `Inventory.tsx` and now registered in every build (sales and purchasing stay demo-only); new `lib/people.ts` resolves user ids to names from the members list (fixed names in demo mode); the warehouse default no longer assumes a demo id.
- `sql/seed/001_demo_organization.sql` (written, **not run**): creates "Demo Trading Co." with the three users above, two warehouses, five items with opening stock, one issued request and one waiting for approval, all through the real functions. Stops with a clear message if a user is missing; does nothing if the organization already exists.

**Database / System Result.** None from this entry.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. API routes and screens not run against the real database yet (needs the users, the seed, a running API). Known gaps: no API test for the new routes; Worker not deployed; web not built against the real API.

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
- Changed on the way: the old package scope to `@erp/*`; default currency `USD` to `EGP` in `sql/001`; CRM manifest replaced by an empty `inventory` placeholder module (API routes file, empty web and shared folders); CRM wiring removed from the API and web registries, Home and Shell.
- Left behind: CRM and activities/timeline/my-tasks code and SQL, the generic record-page/field components built for CRM, the old internal plans, discovery notes, old worklog and checklist content.
- `apps/api/src/lib/db.ts` and `audit.ts` copied as-is and marked `TODO(ADR-0003)`: they use the secret key and a separate-call audit insert, which must be reworked before the stock and approval features (see `TECHNICAL_PLAN.md`).

**Database / System Result.** None. `sql/001` and `sql/002` have not been run against any Supabase project.

**Safety Status.** `npm install` ok (0 vulnerabilities); `npm run typecheck` clean in shared, api and web; `npm test` passing (shared 4, api 11). Not browser-tested. No `.env` files, secrets, node_modules or git history copied. Open: product name and deciders placeholders, README, PRODUCT_BRIEF, ADR-0003, the db/audit rework.

