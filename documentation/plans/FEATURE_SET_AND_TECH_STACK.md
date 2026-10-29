# Feature set and tech stack

**Status:** `[📝 Draft / RFC]` for Ben's review, 2026-10-29. Replaces the ad-hoc feature lists in `neworder.md` section 4 and `PRODUCT_BRIEF.md` for planning; those stay as the short versions.
**Rule for this document:** nothing is described as working unless it was run and tested. Every claim about an outside service is labelled with how sure we are. No dates, no costs: costing comes after the trials and interviews.

## 0. How to read the labels

| Label | Meaning |
|---|---|
| **Built, tested** | Runs on the real database and API; a test or a live run is recorded in `documentation/operations/WORKLOG.md` |
| **Built, not tested** | Code exists, no test or run recorded |
| **Not built** | Nothing exists |
| **Decision** | A human must choose before we build (owner in section 7) |
| **Unverified** | A claim about an outside service from a web page we did not confirm in the vendor's own contract or account. Check before relying on it |

## 1. What is real today (facts)

| Area | Status | Evidence |
|---|---|---|
| Organizations, members, roles (owner, admin, member, viewer), module switches, organization settings | Built, tested | `sql/tests/001`, real-login runs for 3 users |
| Append-only, hash-chained audit log; no edit, delete or TRUNCATE; delivery outcomes audited | Built, tested | `sql/tests/001`, `002`, `003` |
| Inventory slice 1: items, warehouses, stock ledger, reservation, request, single-level approval (not by the requester), issue, cancel | Built, tested | `sql/tests/002`, live API runs |
| Approval enforced in the database, even against a direct insert by a privileged role | Built, tested | `sql/tests/002` S6c, S7 |
| Tasks, transactional outbox, in-app notifications, retry with backoff, expiry, reminders and escalation, 5-minute cron | Built, tested | `sql/tests/003`, live API run |
| Web app (Arabic/English-ready layout, right-to-left switch for the demo bar only), notification bell, Tasks, Messages | Built, not tested in a browser by the assistant | typecheck, bundle checks |
| Real sign-in, deployed Worker and web app | Built, tested at API level | real-login script 15/15, 15/15, 17/17 |
| Real WhatsApp, voice, email delivery | **Not built** | the delivery job fails visibly on any channel that is not connected |

**About "fake":** the `fake` channel in the code is a test seam so retry and failure handling can be tested without a provider. It is never shown to a customer as a channel. The older sample-data link (`erp-demo-bas.pages.dev`) runs on invented in-browser data and is a fallback only; whether to retire it once management is happy with the real app is a decision (section 7).

## 2. Feature set

Phases follow `neworder.md`: **P1** = the star feature and what it needs to be real, **P2** = the fuller ERP, **P3** = later. Effort is rough: **S** days, **M** a couple of weeks, **L** a month or more of focused work, with no promise.

### 2.1 Star feature: outbound approvals and tasks over WhatsApp and voice

| ID | Feature | Why | Status | Phase | How | Needs |
|---|---|---|---|---|---|---|
| S1 | Real WhatsApp delivery of approval requests, reminders and task messages | Management's preferred direction; no ERP reviewed does it for staff | Not built | P1 | Meta WhatsApp Business Platform (Cloud API) adapter behind the existing channel interface; status webhooks update the outbox | WhatsApp provider **Decision**; Meta business account, a phone number, approved message templates (section 4) |
| S2 | Phone-number identity binding | A delivered message is not proof of identity (`neworder.md` rule) | Not built | P1 | User enters number, receives a one-time code over WhatsApp (authentication template), number stored as verified; change revokes pending tokens; all audited | S1; new table, functions and SQL tests |
| S3 | Decision tokens: approve or reject from a WhatsApp reply | The point of the feature | Not built | P1 | Message carries a single-use, expiring token tied to (request, approver, channel); the reply goes through a webhook to the same `inv_decide_request` as the app; replay, wrong number, expired, self-approval all refused | S1, S2; webhook signature check; SQL tests |
| S4 | Inbound task replies ("done") | Flow 2 in `neworder.md` | Not built | P1 | Inbound message matched to the person and their open task; changes status only through `tsk_set_status` | S1, S2 |
| S5 | Voice notes in, intent out | Hands-free approvals and task creation | Not built | P1 | Inbound WhatsApp voice note, speech-to-text, closed set of actions chosen by a language model through tool calling, read back and confirmed before anything changes | S1, S2, speech and language-model **Decision**s; Egyptian Arabic test set |
| S6 | Outbound voice calls | Reach people who will not read a message | Not built | P3 | Either WhatsApp Business Calling or a telephony provider **Unverified** whether available and permitted for Egypt and GCC | provider **Decision**, legal check |
| S7 | Value threshold and second confirmation | Safety rule: voice cannot approve above a set value alone | Not built | P1 | Organization setting; function requires a second confirmation on another channel above it | S5 |
| S8 | Configurable chasing (who, when, how many steps), quiet hours, per-user channel preference | Reminders currently use two fixed steps and one channel | Partly built (two settings in organization settings) | P2 | Settings screen plus policy table | S1 |
| S9 | Delivery receipts and failures visible to managers | Trust in the channel | Built, tested for in-app and fake; real receipts need S1 | P1 | Outbox screen already exists | S1 |
| S10 | Email notifications | Fallback channel; invites | Not built (Supabase invite emails also not working for outside addresses) | P2 | Custom SMTP sender (section 4) | email provider **Decision** |

### 2.2 Inventory

| ID | Feature | Status | Phase | Notes |
|---|---|---|---|---|
| I1 | Items, warehouses, ledger, reservation, request, approve, issue, cancel | Built, tested | done | slice 1 |
| I2 | Receiving stock against a purchase order | Not built (demo only on sample data) | P2 | pairs with purchasing |
| I3 | Stock adjustments and cycle counts, approved, with reason | Not built | P1 | approval and audit pattern already exists; counts become tasks |
| I4 | Transfers between warehouses with approval and in-transit state | Not built | P2 | competitors: Edara has transfer approvals |
| I5 | Approval policies: value thresholds, multiple levels, by warehouse or category | Not built | P1 | needed for S7 |
| I6 | Reorder levels and low-stock notifications | Not built | P1 | feeds the outbox |
| I7 | Barcode scanning with the phone camera | Not built | P2 | browser API; fits web first |
| I8 | Lots, serial numbers, expiry | Not built | P2 | columns planned in the ledger from the start |
| I9 | Costing and stock valuation (average first) | Not built | P2 | money as integer minor units |
| I10 | Units of measure and conversions, item categories, images | Not built | P2 | |
| I11 | Negative stock allowed as an organization setting | Not built | P3 | default refuses |

### 2.3 Purchasing and sales (wave 2)

| ID | Feature | Status | Phase |
|---|---|---|---|
| P1 | Suppliers, purchase orders, goods receipt on the ledger | Not built (sample-data demo only) | P2 |
| P2 | Customers, sales orders, delivery notes, linked to the stock request | Not built (sample-data demo only) | P2 |
| P3 | Returns, credit notes | Not built | P3 |

### 2.4 Platform, reporting, compliance

| ID | Feature | Status | Phase | Notes |
|---|---|---|---|---|
| X1 | Arabic and English text (not only layout), Egyptian wording reviewed by a native speaker | Not built (layout is right-to-left safe) | P1 | blocks any Egyptian customer demo in Arabic |
| X2 | Dashboard: waiting approvals, low stock, overdue tasks, time to approve, approvals by channel | Not built | P2 | answers the "do people use WhatsApp approvals" question |
| X3 | Reports: stock on hand, valuation, movements, audit export | Not built | P2 | |
| X4 | CSV import with a dry-run report; CSV and PDF export | Not built | P2 | onboarding in one afternoon is a stated goal |
| X5 | Custom fields per organization | Not built | P2 | no per-customer code |
| X6 | Print templates: request slip, delivery note | Not built | P2 | browser print first |
| X7 | Names without the admin key (`B10`) | Not built | P2 | database function for organization people |
| X8 | Egypt e-invoicing (ETA), later Saudi (ZATCA) | Not built | **Decision** | section 4 |
| X9 | Invoicing and accounting export | Not built | P3 | export, not a ledger |
| X10 | Billing in EGP and metering of messages and voice | Not built | before the first paying customer | payment gateway **Decision** |
| X11 | Installable web app, then native phone app | Not built | P2 then P3 | web first |

### 2.5 Security and operations (must exist before real customers)

| ID | Item | Status |
|---|---|---|
| O1 | Staging and production separated (today one Supabase project serves development, tests and the demo) | **Decision**, not built |
| O2 | Backups and a tested restore; point-in-time recovery | Not built **Unverified** which Supabase plan provides what |
| O3 | Scheduled audit-chain verification with an alert on a break | Function exists (`audit_verify`); job and alert not built |
| O4 | Rate limiting on webhooks and token checks | Not built (needed with S1 and S3) |
| O5 | Error tracking and log retention | Not built |
| O6 | CI: typecheck, unit tests, SQL tests against a database on every change | Not built (run by hand through the CLI) |
| O7 | Leaked-password protection, MFA for owners and admins, session policies | Not built; Supabase advisor warning open |
| O8 | Data protection: consent text for phone numbers and voice recordings, retention, deletion on request (Egypt and Saudi laws) | Not built; legal review needed |
| O9 | Outbox cleanup and retention | Not built |
| O10 | Concurrency test: two job runs at once; two approvals at once | Not built |

## 3. Tech stack, current

All confirmed in the repository.

| Layer | Choice | Notes |
|---|---|---|
| Language and tooling | TypeScript, npm workspaces, Node 22+ | typecheck and tests at the repo root |
| API | Cloudflare Workers, Hono | request routes call the database as the signed-in user; the admin key is limited to the delivery job, member invites and audit helper (a test enforces the allow-list) |
| Web | React 19, Vite, plain CSS with logical properties, IBM Plex Sans Arabic and Mono | web first |
| Database | Supabase Postgres | row level security, security-definer functions, triggers; migrations in `sql/`, applied with the Supabase CLI |
| Auth | Supabase Auth, password sign-in | tokens verified at the Worker; organization chosen by `X-Org-Id`, checked in the database |
| Background work | Cloudflare Cron Trigger every 5 minutes plus a transactional outbox | no separate queue yet |
| Hosting | Cloudflare Pages (web), Workers (API) | account `meetings.dmedeskai@gmail.com` |
| Tests | Vitest, SQL tests (`sql/tests/`), real-login script | no automated browser tests (project rule): manual click-through |

## 4. Tech stack, needed (and what we know)

### 4.1 WhatsApp (S1 to S4)

- **Route:** Meta WhatsApp Business Platform Cloud API, called directly from the Worker, behind the existing channel interface. A business solution provider (BSP) is an alternative; **Decision** (quotes needed).
- **What Meta's own documentation says** (pricing page, shown as updated 30 September 2026, changes effective 1 October 2026): billing is per delivered template message, by category (marketing, utility, authentication, plus the newer service and Meta Business Agent categories) and by the recipient's country calling code. Non-template messages sent inside an open customer service window are free, and utility templates sent inside that window are free. The exact Egyptian and Saudi rates must be read from the live rate card; we have not read them.
- **Test number:** every app gets a free test number; at most 5 recipients, each of whom must verify their number first; you cannot message real customers from it and they cannot message it; templates made on it cannot be reused on your own number. This lets us build and prove S1 to S4 for real with a handful of staff phones before any business verification.
- **Needed before real customers:** a Meta business account and verification, a WhatsApp Business Account, a phone number dedicated to it, message templates approved by Meta, a public webhook URL on the Worker with request signature verification, opt-in from every recipient (a third-party guide says opt-in is required even in testing; confirm against Meta's policy).
- **Secrets (names only, set by Ben with `wrangler secret put`):** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` (webhook signature), `WHATSAPP_VERIFY_TOKEN`; non-secret: `WHATSAPP_PHONE_NUMBER_ID`.
- **Design consequence:** approval requests sent outside a 24-hour window must be templates, so the wording of each template is a product decision and needs review.

### 4.2 Voice (S5, S6)

- **Path we recommend first:** staff send a **WhatsApp voice note**; we transcribe it and turn it into an action. No telephone line needed. Outbound calls are a later step (S6).
- **Speech-to-text:** Google Cloud Speech-to-Text lists Arabic (Egypt, `ar-EG`) with several models; Azure Speech lists `ar-EG` and supports custom speech trained on audio with human transcripts. **Unverified:** neither listing gives accuracy for Egyptian speech. **We must test both on real recordings from Egyptian warehouse staff** (a test set of about 100 short phrases covering approve, reject, quantities, item names and numbers) before promising anything. Browser speech APIs can be used for a no-key microphone button but are not a production path.
- **Text-to-speech:** only needed for outbound calls (S6); **Decision** later.
- **Language model:** needed only to map a transcript to one action from a closed list (look up stock, create request, approve or reject, create task, update task) by tool calling. Any provider with reliable tool calling can do it; evaluate Arabic quality on the same test set. The key is a Worker secret (name proposed: `LLM_API_KEY`); every action still runs through the database functions with the person's permissions; a model never gets a database key. **Decision**: provider.
- **Hard rules (already in `neworder.md`):** free text never executes; every action is read back and confirmed; above the organization's value threshold a second confirmation on another channel is required; transcripts are referenced from the audit entry.

### 4.3 Email (S10, invites)

- Supabase's built-in sender is for testing only: third-party guides give about 2 to 3 auth emails per hour and delivery only to team addresses; custom SMTP lifts it (about 30 per hour by default, adjustable). **Unverified** numbers: confirm in Authentication, Rate Limits.
- **Needed:** a transactional email provider (Resend, Postmark and Amazon SES are common) with a sending domain (SPF, DKIM), connected under Authentication, SMTP. **Decision**: provider and domain.
- Until then, invites work by copying the link the app shows.

### 4.4 E-invoicing (X8): decision pending

- Egypt: submission to the Egyptian Tax Authority's API, signed documents. **Unverified, from vendor pages only:** OAuth2 client credentials, separate pre-production and production endpoints, canonical JSON before signing, signature (CAdES) by a USB token, an HSM or an accredited provider, e-receipts expanding for B2C through 2026. We did not find the official specification in the search; the ETA developer documentation and the list of accredited signing providers must be read before any estimate.
- **Recommendation (unchanged):** a licensed provider first, direct integration later if cost or reliability demands it. Data model fields were planned from slice 1.

### 4.5 Everything else

| Need | Recommended | Alternative | Status |
|---|---|---|---|
| File storage (voice notes, attachments, print output) | Supabase Storage with row level security by organization | Cloudflare R2 | **Decision**; retention rules first (O8) |
| PDF output | Browser print styles first | server-side rendering later | not built |
| Queue at higher volume | Cloudflare Queues replacing the cron scan | keep cron + outbox | not needed yet |
| Search | Postgres full text, Arabic normalization of letters | external search | not built |
| Observability | Workers logs, an error tracker, the audit-chain job (O3) | | not built |
| CI | GitHub Actions with the Supabase CLI against a database branch or staging project | manual | not built |
| Payments | A gateway behind a port: Paymob is the working assumption; Gulf gateway later | manual invoices for the pilot | **Decision**; quotes needed |
| Native phone app | Only after the installable web app is validated | | not built |

## 5. What "real" means for the star feature, step by step

1. **Day 1 (needs Ben):** create a Meta developer app and a business account; add up to 5 staff phone numbers as test recipients; give the Worker the three secrets above. Nothing here costs a message fee.
2. Build S1 (send), the status webhook and the webhook signature check; prove with a real phone that an approval request arrives and a failed send retries.
3. Build S2 and S3 with SQL tests and a real-phone run: approve from WhatsApp, replay refused, wrong number refused, self-approval refused, expired token refused. Every approval from WhatsApp must produce the same records as one from the app.
4. Build S4. Then S5 on the 100-phrase test set; report the real accuracy, whatever it is.
5. Only then business verification, templates in Arabic and English reviewed by a native speaker, and a pilot customer.

## 6. Order of work

1. Now: your click-through of slices 1 and 2; fix findings; X1 (Arabic text); I3, I5, I6; O3, O10.
2. Then S1 to S4 for real on the Meta test number (blocked only by the account steps in section 5).
3. Then S5 and the Egyptian Arabic evaluation; S7; dashboard X2 to measure whether people use the channels.
4. Then wave 2 (purchasing, sales, receiving, transfers), X4 to X6, the decision on X8, and production readiness (O1 to O9).

## 7. Decisions needed

| # | Decision | Who | Blocks |
|---|---|---|---|
| 1 | WhatsApp route: Meta Cloud API directly or a provider; who owns the Meta business account | Ben, management | S1 to S4 |
| 2 | Speech-to-text and language-model provider, after the Egyptian audio test | Ben | S5 |
| 3 | Email provider and sending domain | Ben | S10, invites |
| 4 | Retire the sample-data demo link once the real app is accepted? | Ben | confusion about what is real |
| 5 | Separate staging and production Supabase projects now or at the pilot | Ben | O1 |
| 6 | E-invoicing: day one, later, or provider | management | X8 |
| 7 | Payment gateway and billing entity | management | X10 |
| 8 | Product name | management | public pages, message templates |
| 9 | Data protection review before storing phone numbers and voice | management, legal | S2, S5 |

## 8. Sources (outside claims above)

- [Pricing on the WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Cloud API get started and test number (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/), [test number limits (third-party summary)](https://help.wanotifier.com/en/article/test-phone-number-limitations-kt0ly2/)
- [Cloud API Calling (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling.md)
- [Google Cloud Speech-to-Text supported languages](https://cloud.google.com/speech-to-text/docs/languages), [Azure Speech language and voice support](https://learn.microsoft.com/en-nz/azure/cognitive-services/speech-service/supported-languages)
- [Egypt ETA e-invoicing, vendor guide (secondary source)](https://ecosire.com/hi/blog/odoo-egypt-localization-guide-2026)
- [Supabase custom SMTP guide (third party)](https://sendlayer.com/blog/supabase-custom-smtp-and-email-configuration-guide/), [Brevo and Supabase SMTP (third party)](https://developers.brevo.com/docs/supabase-smtp-integration)
