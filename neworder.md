# Claude Code living brief: build the full app around the star feature

Owner: Ben Arthur. Created 29 October 2026. This file is the standing instruction. Re-read it at the start of every session and update the Status block at the end of every turn. Ben will keep adding features; treat section 6 as the intake loop.

## 1. The product in one paragraph

A warehouse-first ERP for SMEs in Egypt and the GCC. **The star feature (management liked this direction): outbound voice and WhatsApp approvals and task assignment inside the ERP.** The system reaches out to people (manager, warehouse staff) over their channel, asks for an approval or assigns a task, takes the answer, and does it, with every step audited. No competitor we reviewed offers this inside an ERP (research: public sources, unconfirmed by trials). The rest of the ERP (inventory, purchasing, sales, reports) must be full enough that the star feature has something real to act on. Web first; phone app later.

## 2. Non-negotiable rules (from agents.md; do not weaken)

- Approvals, stock posting and audit are enforced in the database by functions, called with the signed-in user's own identity; the secret-key client is for provisioning, webhooks and scheduled jobs only.
- Every stock movement and approval writes an audit entry in the same transaction; audit log is append-only and hash-chained.
- Stock is an append-only ledger.
- **Channels never change stock or approve by themselves.** WhatsApp, voice and in-app all submit the same decision to the same function. A delivered message is not proof of identity: verified, bound phone number plus a one-time, expiring token.
- Voice cannot approve above an organization-set value threshold without a second confirmation on another channel; every voice action is read back and confirmed.
- Study competitors' behaviour only; never copy their code.
- No secrets in source, logs or docs. No real customer data. No destructive SQL without Ben's confirmation. Do not commit; Ben commits. Add a WORKLOG entry for every migration run, deploy and significant change.
- Arabic and English from the first screen; right-to-left safe styling.

## 3. The star feature, designed (build this early and build it properly)

**Concepts**

- **Request**: an outgoing stock request (or a purchase order, discount, etc. later) that needs a decision.
- **Task**: an assignable piece of warehouse work (pick, count, receive, deliver, check) with assignee, due time, status, and linked document.
- **Notification/outbox**: an item to send to a person on a channel (in-app, WhatsApp, voice call, email), with idempotency, retries and delivery status (transactional outbox).
- **Channel adapter** (interface): `send(message)`, `parseInbound(raw)`; kinds: in_app, whatsapp, voice, email. A fake adapter exists for tests and the demo.
- **Decision**: `{entity_type, entity_id, decision, channel, evidence}` submitted to the database function; the same record regardless of channel.
- **Identity binding**: a user's phone number is verified once (code) before it can decide anything; changes are audited and revoke pending tokens.
- **Chasing**: reminders, escalation to another approver, and expiry if nobody answers.

**Flows to demonstrate**

1. Mona submits a request for 20 safety gloves. The system notifies Layla (manager) with a summary and options. Layla approves from the message or voice reply; the system issues stock and tells Mona. If Layla does not answer, it reminds her, then escalates.
2. The manager says (voice or text): "Assign Omar to count aisle 4 by 5 pm." The assistant creates the task, tells Omar, Omar replies "done"; the assistant updates the task and the audit log.
3. The assistant asks for what is missing: "Which warehouse? How many?" It never guesses on a state change; it reads back and gets a clear yes.

**Voice assistant rules**: closed set of actions (look up stock, create request, approve/reject, create task, update task, create order) via tool calling; free text never executes directly; every action goes through the database functions with the user's permissions; transcripts referenced from the audit entry. STT, TTS and the LLM are swappable adapters. Demo uses browser speech APIs (no keys). The LLM key, when needed, is a Worker secret; tell Ben the secret name and where to set it. English first; design for Egyptian Arabic and record limits you hit.

## 4. Build order (revise after Ben's feature input; keep the star feature visible in every slice)

1. **Slice 1: real foundation and inventory.** Staging Supabase with sql/001-005; real sign-in; items, warehouses, ledger, reservations, requests, approval, issue, audit; screens wired to the real API; SQL tests (direct ledger insert refused, issue without approval refused, self-approval refused, reservation, audit entry per step, hash chain, other-org isolation). Old sample-data demo kept as fallback.
2. **Slice 2: tasks and the notification outbox.** Task entity and screens; outbox with fake channel adapter; in-app notifications; reminders and escalation by scheduled job; tests (idempotency, retry, expiry).
3. **Slice 3: approvals and tasks over messaging.** WhatsApp adapter interface with a fake provider (no real provider chosen yet); identity binding; decision tokens; contract test: in-app and fake WhatsApp produce identical decisions and audit rows; replay and wrong-number tests.
4. **Slice 4: voice assistant** per section 3, with read-back and confirmation, thresholds and audit.
5. **Slice 5 onward: fuller ERP**, in parallel as capacity allows: purchasing and receipts, sales orders linked to stock requests, reports and dashboards, CSV import/export, custom fields, print templates, responsive/installable phone experience, notifications centre. Features come from Ben via section 6 and `FEATURE_SET_v0.1_and_study_plan.md`.
   Keep the fuller-ERP work moving, but do not let it push the star feature slices out of the next two weeks.

## 5. Not now

E-invoicing (management decision pending), billing/payments, real WhatsApp provider integration (provider not chosen), native phone app, real customer data, Arabic voice quality claims (record findings only).

## 6. Intake loop (how Ben gives you features)

When Ben gives a feature:

1. Restate it in two lines, and say which module/slice it belongs to.
2. Check it against section 2. If it conflicts, say so and propose a compliant version.
3. Add it to the backlog table below with priority (P1 now, P2 next, P3 later), risk and the test that proves it.
4. Ask at most one clarifying question, only if the answer changes the design. Otherwise state your assumption and proceed.
5. Build it small, in the existing module conventions (`apps/api/src/modules/<key>`, `apps/web/src/modules/<key>`, `packages/shared/src/modules/<key>`, `sql/NNN_*.sql`, tables prefixed by module).
6. Run typecheck and tests; write SQL tests for anything touching approvals, stock, audit or isolation.
7. Add the WORKLOG entry; update the checklist and this Status block.
8. Report: what works (with click path), what was tested, what is not done, anything Ben must test manually.

## 7. Backlog (keep current)

| ID  | Feature                                                                      | From             | Priority | Status                                                         | Proof (test or click path) |
| --- | ---------------------------------------------------------------------------- | ---------------- | -------- | -------------------------------------------------------------- | -------------------------- |
| B1  | Real inventory flow with DB-enforced approval                                | Management       | P1       | Database, seed and real sign-in done and tested; Worker deploy and screen check pending | sql/tests/002, scripts/real-login-check.mjs |
| B2  | Tasks and notification outbox (fake channel)                                 | Star feature     | P1       | Not started                                                    | idempotency/retry tests    |
| B3  | Approvals and tasks over messaging (fake WhatsApp adapter, identity binding) | Star feature     | P1       | Not started                                                    | contract test              |
| B4  | Voice assistant (browser speech demo, tool calling, read-back)               | Star feature     | P1       | Not started                                                    | click path + tests         |
| B5  | Purchasing and goods receipt on the ledger                                   | Feature set v0.1 | P2       | Not started                                                    |                            |
| B6  | Sales orders linked to stock requests                                        | Feature set v0.1 | P2       | Not started                                                    |                            |
| B7  | Reports and dashboard                                                        | Feature set v0.1 | P2       | Not started                                                    |                            |
| B8  | CSV import/export, custom fields, print templates                            | Feature set v0.1 | P2       | Not started                                                    |                            |
| B9  | Responsive/installable phone experience                                      | Feature set v0.1 | P2       | Not started                                                    |                            |

## 8. Status block (update at the end of every turn; paste-ready for Ben)

- **Last done (2026-10-29):** Slice 1 database side is live and tested on the linked Supabase project (`sql/001`-`006`, tests 001 and 002 pass, advisor warnings fixed). Created the three demo users (chris owner, joseph manager/admin, grant requester/member) via CLI, seeded "Demo Trading Co." (2 warehouses, 5 items, 1 issued and 1 waiting request, 21 audit rows, chain clean). Real sign-in plus REST checks pass for all three (15/15, 15/15, 17/17). Inventory API routes and the screens wired to the real API are written (typecheck clean, 17 tests pass) but not yet run against the real database through the Worker.
- **Doing now:** nothing running; waiting on Ben for the Worker secrets step.
- **Next:** (1) deploy the Worker, (2) build and deploy a web build against it, (3) Ben clicks through as grant (request), joseph (approve), grant (issue), (4) then slice 2 (tasks and notification outbox with a fake channel adapter).
- **Needs Ben:** open `.temp\demo-credentials.txt` (git-ignored) for the three passwords; at deploy time run the two `wrangler secret put` commands I will give you (one needs the Supabase secret key from the dashboard); decide leaked-password protection; management items in `orders.md` (trials, interviews, e-invoicing, WhatsApp provider, payment gateway).
- **Where to look:** WORKLOG.md, checklist.md, this file, `sql/seed/001_demo_organization.sql`, `scripts/real-login-check.mjs`.

## 9. Things Ben may ask that you should challenge

- Voice or WhatsApp actions that skip confirmation or the approver role check.
- Putting provider keys or tokens in source.
- Claims in the UI or docs that a feature "works" when it only works on sample data.
- Copying a competitor's code, text or assets.
