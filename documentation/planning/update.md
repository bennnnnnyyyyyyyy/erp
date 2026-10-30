# Update (paste this into the chat)

## Latest (2026-10-30, night): security audit branch synced
- **Last done:** branch `worktree-security-audit-fixes` (`.claude/worktrees/security-audit-fixes`) brought up to main (`68c6c31`), audit fixes reapplied, two README conflicts resolved. Typecheck clean, 30/30 unit tests pass.
- **Fixes on the branch (not merged, not run, not deployed):** member changes and their audit now done in the database with the user's own login (M-1); existing accounts get an invitation they must accept (M-2); WhatsApp channel can't be faked in the audit log (L-2); one WhatsApp number in several orgs (L-3); "process now" only touches your own org (L-4); sign-in links only for accounts in no other org (L-5); timing-safe webhook token, production-only CORS, browser security headers.
- **Not done:** `sql/025` and test 021 not run; the audit report file the migration cites was never written.
- **Needs your input:** review and commit the branch; say "run 025" (staging first) and whether to write the audit report.

## Latest (2026-10-30, evening)
- Sales gap closed in the database (`sql/020`, test 016 passes). API display tweak not deployed. Customer Invoices plan written (`documentation/plans/CUSTOMER_INVOICES_PLAN.md`), two questions inside; no code yet.
- Supplier Invoices already exist (sql/018, test 014, API and screen, deployed); not rebuilt.
- Click: enable Sales in Settings > Apps for Test Organization, create a customer and order, request stock, reject it as a manager, then "Request stock" again.

Last updated: 2026-10-30 (morning). Standing brief: `neworder.md`.

## MORNING SUMMARY (overnight queue)
- Built and tested on the live database: S2 identity binding (test 004), S3 decision tokens (005), S4 task replies (006), I5 approval policies (007), I3 stock adjustments (008), I6 reorder levels (009), O3 audit check job (010), O9 retention, dry run only and not scheduled (011), X7 names for every member (012), O10 concurrency (`scripts/concurrency-check.mjs`, 12 checks).
- S1 adapter: built and unit tested (`apps/api/test/whatsapp.test.ts`, 26 API tests); NOT tested against real WhatsApp (needs the Meta app and three secrets).
- X1 language: framework built, typechecks and builds; 9 Arabic strings, machine draft, right-to-left not looked at in a browser.
- Nothing deployed overnight. The API, web and Messaging screen changes (X7 route, X1, low-stock text) are not live until you ask for a deploy. DB-only functions for policies, adjustments, reorder and identity have no API or screen yet.
- Right now: typecheck clean, npm test passes, SQL tests 001-012 pass, real-login checks pass (owner 15, manager 15, requester 17).

## Needs your input
- Say "deploy" to publish the API and web changes (I will record version ids; rollback versions are in the worklog).
- Answer the "Activating Stock Requests" question: (a) switch the module on, (b) a draft step, (c) re-open a cancelled/rejected request.
- Browser click-through, Supabase Site URL, rotate demo passwords, Meta developer app for real WhatsApp, approval before `msg_cleanup` is ever scheduled.
## Earlier notes

## Newest (this turn)
- **Feature set and tech stack written, no fake channels:** `documentation/plans/FEATURE_SET_AND_TECH_STACK.md`. Real today vs not built, every feature with status/phase/how, the stack we have, the stack we need per capability (WhatsApp, voice, speech, language model, email, e-invoicing, storage, CI, payments), outside facts labelled **Unverified** where I could not confirm them, and decisions with owners. Costs and dates deliberately left out.
- **The real path for the star feature:** use Meta's WhatsApp Cloud API directly on its free test number (up to 5 verified staff phones, no real customers, no business verification yet) to build and prove sending, status webhooks, phone binding, approve-by-reply with single-use tokens, all on a real phone. Then voice notes with Egyptian Arabic speech tested on real recordings. **You need to:** create a Meta developer app, add up to 5 staff phone numbers as recipients, and later set three Worker secrets (names `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`). I will give the exact steps when you say go.
- **Your note about notifications is built:** clicking a task notification opens a **Task details** page where the assignee can **Acknowledge** or **Complete** (and see the task's history). Deployed; checked over the API as grant (task found, notification links to the right task); not opened in a browser by me. Opening the page changes nothing; each button runs the database rule with the person's rights.
- **"Activating Stock Requests":** I did not build anything for this one. **One question:** do you mean (a) switching the Inventory module on for an organization (exists: Settings, Apps), (b) a draft step so a request is only "active" once the requester submits it, or (c) re-opening a cancelled or rejected request? Tell me a, b or c.

## Last done (earlier)
- **Slice 2 is built, deployed and verified over the live API.** Reviewed `sql/007` against ADR-0003 first. Gaps found and fixed: delivery outcomes (sent, failed, expired) were not in the audit log, now they are; a task could be "changed" to the status it already had, now refused.
- **`sql/007` applied** through the CLI. **`sql/tests/003` passes** and covers your list: outbox row in the same transaction as its event, duplicates prevented, retry with backoff, expiry, reminder and escalation fire once, no direct writes, other-organization isolation, and **a channel cannot change stock or approve** (requests stay submitted, no approvals created, ledger and balances unchanged, messaging functions contain no inventory writes). Tests 001, 002, 003 all pass.
- **Built:** delivery job with a 5-minute cron on the Worker, tasks and messaging routes, a notification bell in the top bar, a Tasks page, a Messages app (inbox and manager outbox with "Run delivery and reminders now"). Real app only; the sample-data link is unchanged.
- **Live API run with real logins:** joseph (manager) got "OUT-0003 needs your approval" and a reminder for the old waiting request OUT-0002; chris (owner) also got an escalation; grant (staff) got "New task: Count aisle 4"; a second run right away sent nothing new; grant is refused (403) on running the job, reading the outbox and creating tasks.
- Worklog has an entry for the plan, the migration and each test run. Not committed (you commit). Not opened in a browser by me.

## Doing now
- Nothing running. I will not start Slice 3 before your click-through unless you say so.

## Slice 2 click path on https://erp-live.pages.dev (passwords: `.temp\demo-credentials.txt`)
(The first delivery pass already ran during my test; later reminders fire once their times pass and a pass runs, either the 5-minute cron or the button below.)
1. Sign in as **joseph.brown.wiz@gmail.com** (manager). Open Inventory, Stock requests: **OUT-0003 "Gloves for the day shift"** and OUT-0002 are waiting.
2. Sign in as **chris.johnson.wiz@gmail.com** (owner): Messages, "Message outbox": sent messages (approval requests, reminders, an escalation, a task). Click **"Run delivery and reminders now"**. About 1 minute after the seed a pass queues reminders for OUT-0003; after 3 minutes it adds an escalation and the overdue-task reminder. The notice shows the counts; the bell shows new unread messages.
3. Sign in as **grant.holden.wiz@gmail.com** (staff): the bell shows "New task: Count aisle 4". Open Tasks: the task is "To do", due about 3 minutes after the seed. Click **Start**, then **Done**.
4. As **joseph** after a pass (chris's button): the bell shows "Task done: Count aisle 4".
5. As **joseph**, open OUT-0003 and **Approve**; as **grant**, **Issue stock**. After a pass grant gets the decision and issued notices. Settings, Audit log (chris): messaging entries sit next to inventory and task entries.
6. As **joseph**, Tasks, **New task**, to create more.

## Needs your input
- Your click-through (slice 1 path from earlier, then the path above) and what looks wrong.
- Supabase Site URL (Authentication, URL Configuration) = https://erp-live.pages.dev; rotate the three demo passwords after the demo.
- Management items in `orders.md` (trials, interviews, e-invoicing, WhatsApp provider, payment gateway). Slice 3 needs no real provider: a fake WhatsApp adapter first.

## Commit groups (nothing committed by me; everything since your last commit)
1. `docs(plan): tasks and outbox plan` : `documentation/plans/TASKS_AND_OUTBOX_PLAN.md`
2. `feat(db): slice 2 tasks and outbox` : `sql/007_tasks_and_outbox.sql`, `sql/tests/003_tasks_and_outbox.sql`, `sql/tests/README.md`, `sql/README.md`, `sql/seed/002_demo_slice2.sql`
3. `feat(api): tasks, notifications, delivery job and cron` : `apps/api/src/lib/channels/index.ts`, `apps/api/src/jobs/outbox.ts`, `apps/api/src/modules/tasks/routes.ts`, `apps/api/src/modules/messaging/routes.ts`, `apps/api/src/modules/registry.ts`, `apps/api/src/index.ts`, `apps/api/wrangler.toml`, `apps/api/test/boundaries.test.ts`, `apps/api/src/modules/core/routes.ts` (audit order), `packages/shared/src/modules.ts`
4. `feat(web): notification bell, tasks, messages` : `apps/web/src/components/NotificationBell.tsx`, `apps/web/src/components/Shell.tsx`, `apps/web/src/modules/tasks/Tasks.tsx`, `apps/web/src/modules/messaging/Messaging.tsx`, `apps/web/src/modules/registry.tsx`, `apps/web/src/modules/core/Home.tsx`, `apps/web/src/styles.css`
5. `chore: banner, ignore build folders` : `apps/web/src/components/EnvBanner.tsx`, `apps/web/src/main.tsx`, `apps/web/src/DemoApp.tsx`, `apps/web/vite.config.ts`, `.gitignore`
6. `docs: worklog, status, brief` : `documentation/operations/WORKLOG.md`, `documentation/planning/update.md`, `documentation/plans/TECHNICAL_PLAN.md`, `neworder.md`

## Where to look
`neworder.md`, `documentation/plans/TASKS_AND_OUTBOX_PLAN.md`, `documentation/operations/WORKLOG.md`, `sql/tests/003_tasks_and_outbox.sql`, `sql/007_tasks_and_outbox.sql`.
