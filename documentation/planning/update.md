# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Last updated: 2026-10-29. Standing brief: `neworder.md` (its Status block mirrors this).

## Last done
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
