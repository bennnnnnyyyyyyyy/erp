# Tasks and Notification Outbox Plan (slice 2)

**Module keys:** `tasks` (tables `tsk_`), `messaging` (tables `msg_`)
**Status:** `[📋 Approved / ready]` for slice 2 only, approved by Ben in `neworder.md` (section 4, slice 2, and "Next tasks" item 8).
**Owner:** Ben Arthur
**Depends on modules:** core, inventory (for the approval notifications)
**Background:** [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) section 5, [INVENTORY_PLAN.md](INVENTORY_PLAN.md), `neworder.md` section 3 (the star feature)

---

## 1. Goal

Reach people instead of waiting for them to open the app. When a stock request needs approval, the managers get a notification; when a manager assigns work, the assignee gets a task and a notification; if nobody answers, the system reminds, then escalates. Delivery goes through a channel adapter, so WhatsApp and voice plug in later without changing any business rule. In this slice the only real channel is in-app; a fake channel exists to prove retry and failure handling.

## 2. Scope

**In:** tasks (create, assign, due time, status, link to a document), a transactional outbox, an in-app notification inbox, a fake channel for tests, retries with backoff, message expiry, reminders and escalation for requests waiting for approval and for overdue tasks, a scheduled job that delivers and chases, screens for tasks, notifications and the outbox, audit entries for task and chasing events.
**Out (later, slice 3 and 4):** WhatsApp and voice adapters, phone-number identity binding, decision tokens, voice assistant, deciding a request from a message, email delivery, request expiry (a waiting request is chased but not auto-closed), per-user channel preferences.
**Won't:** a message ever changes stock or approves anything. Approval stays in `inv_decide_request`.

## 3. Data model

All tables: `org_id`, `created_at`, `updated_at`, RLS select-only for signed-in users, changes only through functions (ADR-0003).

| Table | Purpose | Rules |
|---|---|---|
| `tsk_tasks` | title, description, assignee, creator, due time, status (`open`, `in_progress`, `done`, `cancelled`), optional link (type, id), completion | assignee must belong to the organization; allowed moves: open to in_progress, open or in_progress to done, open or in_progress to cancelled |
| `msg_outbox` | one message for one person on one channel: kind, subject, body, entity link, `idempotency_key` (unique per organization), status (`pending`, `sending`, `sent`, `failed`, `expired`, `cancelled`), attempts, max attempts, next attempt time, expiry time, last error | enqueued in the same transaction as the event that causes it, so no event without its message and no message for a rolled-back event |
| `msg_notifications` | the in-app inbox: title, body, link, read time | one per outbox message (unique on the outbox id), so delivery is idempotent |

Organization setting (in `organizations.settings`): `chasing.reminder_after_minutes` (default 30) and `chasing.escalate_after_minutes` (default 120).

## 4. Behaviour

- **Enqueue:** a trigger on `inv_requests` (managers on submit; requester on approve, reject, issue) and on `tsk_tasks` (assignee on create; creator when done). Nothing is enqueued unless the `messaging` module is on for the organization. A duplicate key is ignored.
- **Delivery (service role, scheduled job):** `msg_claim_due` marks due rows `sending` (skipping rows another worker holds, expiring old ones, recovering rows stuck in `sending`), the adapter sends, `msg_complete` records success, or failure with exponential backoff (1, 2, 4 minutes) until `max_attempts`, then `failed`. In-app delivery is `msg_deliver_in_app`, idempotent.
- **Chasing (service role):** `msg_run_chasing` queues one reminder per waiting request per manager after the reminder time, one escalation per owner after the escalation time, and the same two steps for overdue tasks (assignee, then creator). Idempotency keys make reruns safe. Each newly queued reminder or escalation writes an audit entry.
- **Who sees what:** everyone reads only their own notifications; owners and admins read the outbox (delivery status); everyone in the organization reads tasks.

## 5. Permissions

| Key | Granted to | Allows |
|---|---|---|
| `tasks.tasks.read` | everyone | read tasks |
| `tasks.tasks.create` | owner, admin | create and assign tasks |
| `tasks.tasks.update` | owner, admin, member | change status (database restricts to the assignee, the creator, owner or admin) |
| `messaging.notifications.read` | everyone | read and mark own notifications |
| `messaging.outbox.manage` | owner, admin | read the outbox and run the delivery job on demand (a `.read` key would have reached members, so it is `.manage`) |

## 6. API and job

`GET/POST /v1/tasks`, `POST /v1/tasks/:id/status`; `GET /v1/messaging/notifications`, `POST /v1/messaging/notifications/read`; `GET /v1/messaging/outbox`; `POST /v1/messaging/process` (owner or admin, runs one delivery and chasing pass now, for the demo). A Cloudflare Cron Trigger calls the same job every five minutes. The job is the only code besides invites that uses the admin client, in one allow-listed file.

## 7. Screens

Notification bell with unread count and list in the top bar; Tasks (my tasks, all tasks for managers, new task, mark done); Settings area "Message outbox" for owners and admins.

## 8. Tests

`sql/tests/003_tasks_and_outbox.sql` (rolls back): outbox rows appear with the request and are not duplicated; nothing is enqueued when the module is off; delivery makes exactly one notification even if repeated; failure retries with backoff then ends `failed`; expired messages are never sent; reminders and escalations fire once and only after the time; task rules (who can create, assignee must belong, transitions, who can change); notifications and the outbox are visible only to the right people; service functions are closed to signed-in users; no direct writes; audit chain clean. Then API tests and the real-login script for the new routes.

## 9. Rollout

1. `sql/007_tasks_and_outbox.sql` via CLI, verification queries, `sql/tests/003`.
2. Seed: enable `tasks` and `messaging` for the demo organization, set short chasing times for the demo.
3. API routes and job, Worker deploy (cron trigger).
4. Web screens, deploy; Ben clicks through.

## 10. Open questions

- Should a manager be able to reassign or edit a task? (Slice 2: no, cancel and create again.)
- Real delivery time for reminders in production (defaults 30 and 120 minutes) and whether they should respect working hours (later).
