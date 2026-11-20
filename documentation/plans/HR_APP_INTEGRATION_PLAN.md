# HR app integration Plan

**Module key:** `hr` (new; lowercase, to be added to `packages/shared/src/modules.ts`)
**Status:** `[📝 Draft / RFC]`: waiting for Ben's approval. Nothing here is built.
**Owner:** Claude · **Reviewers:** Ben; the HR app team (for the contract only)
**Contract for the HR app team:** [hr-app-integration-contract.md](../reference/hr-app-integration-contract.md) (v1)
**Depends on modules:** core (organizations, memberships, `core_branches`, `core_integrations`, Vault, outbox / 5-minute job)

---

## 1. Goal

A colleague's team is building an HR app as a **separate product in its own repository**. Ben's decision (19 Nov 2026): treat it
exactly like Shopify, Bosta or Paymob: an outside provider on **Settings > Integrations**. Because that app has no documentation
yet, we write the contract ([reference](../reference/hr-app-integration-contract.md)) and the HR app team implements their side
from it.

Phase 1 gives an owner one place to see **who works where**: the HR app's branches, departments and employees, copied into the ERP
read-only, and each employee linked (when they have one) to a member of the company in the ERP. Phase 2 (plan only, section 12)
posts payroll and employee advances into accounting.

The HR app stays the **source of truth** for people data. The ERP never writes back to it in phase 1.

## 2. Scope

**In (phase 1):**

- H1. "HR app" card in Settings > Integrations with a **Connect HR app** button (Ben, 20 Nov: OAuth so setup is one click; the HR
  app is not built yet, so it builds OAuth from the start). Connect = OAuth 2.0 authorization code + PKCE (contract section 3):
  the owner or admin signs in to the HR app and approves; we receive tokens and register our webhook through the HR app's
  subscription API, which returns the signing secret. Nothing to copy or paste. The card then shows the HR tenant name, who
  connected and when, **Check connection**, **Sync now**, last sync and last webhook, and **Disconnect** (revokes the tokens).
- H2. Pull sync from the HR app's API (contract section 3): branches, departments, employees; incremental by `updated_since`, full
  re-read once a day; run by the existing 5-minute scheduled job.
- H3. Signed webhooks from the HR app (contract section 4): HMAC-SHA256 over timestamp + raw body, five-minute window, event id
  de-duplication. A webhook only **asks for a sync**; its body is never trusted as data (we re-read the record from the API).
- H4. Read-only "People" screen (owners and admins): employees by branch and department, with status, and the link to an ERP
  member.
- H5. Linking employees to members: automatic suggestion when the HR app's work email equals a member's sign-in email; an owner or
  admin confirms or changes the link. Mapping an HR branch to an ERP branch (`core_branches`) the same way (suggested by code).

**Out (later):** phase 2 (payroll journals, advances and expense claims, section 12); employee self-service; writing to the HR app;
using the link for approvals ("the approver's manager"), which needs its own plan.

**Won't:** salaries, national ID numbers, phone numbers, home addresses, birth dates or any other sensitive personal field in phase
1. The contract asks the HR app not to send them, and we drop unknown fields. We store the minimum needed to say who works where.

## 3. Data model

Migration `sql/102_hr_app_link.sql` (next free number at time of writing; SQL test `sql/tests/099_hr_app_link.sql`). All tables:
`org_id uuid not null references organizations(id)`, RLS on, `revoke all` from `anon` and `authenticated`, then `grant select` to
`authenticated` only; writes only through audited functions; index leading with `org_id`; soft delete (`deleted_at`) where they
are business records.

**Provider registration**: kind `hr_app` added to the `core_integrations` kind check and to `core_save_integration` (switching on
only through `hr_save_connection`, below), each recreated from its latest version with only these additions.

No fields are typed by a person (OAuth). Per company, after Connect:

| Where | What |
|---|---|
| Vault bundle (`core_integrations.secret_id`) | `access_token`, `access_expires_at`, `refresh_token`, `signing_secret` (never shown, never returned) |
| `settings.config` (owners and admins read) | `tenant_id`, `tenant_name`, `scopes`, `subscription_id`, `connected_by`, `connected_at` |

ERP-wide, set once (Worker configuration, not per company): `HR_APP_ISSUER` (the HR app's address), `HR_APP_CLIENT_ID` (plain), and
**`HR_APP_CLIENT_SECRET` (new Worker secret, decision D3)**. The redirect address registered with the HR app is
`https://<erp-web-host>/settings/integrations/hr-app/callback` (production and staging).

**`hr_oauth_states`** (one row per Connect attempt): `org_id`, `user_id`, `state_hash` (sha-256 of the state), `code_verifier`
(PKCE), `expires_at` (10 minutes), `used_at`. RLS on, no grants to users at all (read and written only by the two connect
functions); rows older than a day removed by the retention job.

`core_integrations.settings.config.connection_id`: a random id **we** generate when the card is first saved (`hrc_` + 24 random
characters), unique across companies (unique index like sql/083's Shopify one). The HR app sends it in every webhook; it is how we
find the company. It is not a secret (the signature is), but it is never a company's database id.

**`hr_units`** (branches and departments, one tree)

| Column | Type | Null | Rules |
|---|---|---|---|
| id | uuid | no | pk |
| org_id | uuid | no | |
| external_id | text | no | the HR app's id; unique per `(org_id, kind, external_id)` |
| kind | text | no | `branch` or `department` |
| parent_id | uuid | yes | department → its branch or parent department, same org |
| code | text | yes | ≤ 30 |
| name, name_ar | text | no / yes | ≤ 120 |
| core_branch_id | uuid | yes | branches only: the ERP branch it maps to (suggested by equal code, confirmed by a person) |
| active | boolean | no | |
| source_updated_at | timestamptz | no | the HR app's `updated_at`; an older copy never overwrites a newer one |
| created_at, updated_at, deleted_at | timestamptz | | `deleted_at` set when the HR app reports the record deleted |

**`hr_employees`**

| Column | Type | Null | Rules |
|---|---|---|---|
| id | uuid | no | pk |
| org_id | uuid | no | |
| external_id | text | no | unique per org |
| employee_number | text | yes | ≤ 40 |
| display_name, display_name_ar | text | no / yes | ≤ 160 |
| work_email | text | yes | lower-cased; used only to suggest a member link; column-granted to owners/admins only (see 4) |
| job_title, job_title_ar | text | yes | ≤ 120 |
| branch_unit_id, department_unit_id | uuid | yes | → `hr_units`, same org |
| manager_employee_id | uuid | yes | → `hr_employees`, same org |
| status | text | no | `active`, `on_leave`, `terminated` |
| hired_on, left_on | date | yes | |
| user_id | uuid | yes | the linked ERP member (`memberships` of the same org); unique per org while set |
| link_source | text | yes | `email_suggested`, `confirmed`, `manual` |
| source_updated_at, created_at, updated_at, deleted_at | timestamptz | | as above |

**`hr_sync_state`** (one row per org): `requested_at` (Sync now or a webhook), `last_started_at`, `last_finished_at`,
`last_result` (`ok`, `partial`, `failed`), `last_error` (≤ 300, never a key), `cursor_updated_since` (per resource, jsonb),
`last_full_at`, `counts` (jsonb: added, changed, removed). Shown on the card.

**`hr_webhook_events`** (append-only, kept 7 days, removed by the existing retention job): `org_id`, `event_id` (unique per org),
`event_type`, `received_at`, `result`. Used to drop replays and to show "last webhook received" on the card. Never the body.

**Functions** (all `security definer`, `search_path` pinned, audited in the same transaction):

| Function | Caller | Does |
|---|---|---|
| `hr_begin_connect()` → `{state, code_challenge}` | owner, admin (own JWT) | makes the state and PKCE pair, stores `hr_oauth_states`; audited `hr.connect.started` |
| `hr_take_connect_state(state)` → `code_verifier` | owner, admin (own JWT) | the same person, same company, unexpired, unused; marks used |
| `hr_save_connection(tokens jsonb, tenant jsonb, subscription jsonb)` | owner, admin (own JWT) | writes the Vault bundle and `settings.config`, switches the integration on; refused if the HR tenant is already connected to another company (unique index on `tenant_id`); audited `hr.connected` (tenant name, never a token) |
| `hr_clear_connection()` | owner, admin (own JWT) | deletes the Vault bundle, switches off, keeps the copied data marked stale; audited `hr.disconnected` |
| `hr__save_tokens(org, tokens)` | service role | the sync job's refresh (rotated refresh token) |
| `hr_request_sync()` | owner, admin (own JWT) | sets `requested_at`; at most once a minute; audited `hr.sync.requested` |
| `hr_link_employee(employee, user)` / `hr_unlink_employee(employee)` | owner, admin | sets or clears the member link; the user must be an active member of the same org; audited |
| `hr_map_branch(unit, core_branch)` | owner, admin | maps an HR branch to an ERP branch; audited |
| `hr__sync_due()` | service role | the companies whose sync is requested, or older than the interval (default 15 min, Ben 20 Nov), or whose daily full read is due |
| `hr__begin_sync(org)` / `hr__finish_sync(org, result, error, cursors, counts)` | service role | lock (one sync per org at a time, stale after 10 min), record the result; one audit row per run `hr.sync.finished` with counts |
| `hr__apply_units(org, jsonb)` / `hr__apply_employees(org, jsonb)` | service role | upsert a page; ignore unknown fields; refuse a page over 200 rows; older `source_updated_at` ignored; deleted → `deleted_at`; audit one row per changed record (`hr.employee.changed`, before/after of the stored fields) |
| `hr__accept_webhook(connection_id)` → `{org, secret}` | service role | the callback-credentials pattern of `sal__shopify_callback_credentials`: only for an enabled `hr_app` integration |
| `hr__record_webhook(org, event_id, type)` | service role | inserts the event (conflict = replay → `duplicate`), sets `requested_at` |

## 4. Permissions

| Key | Granted to by default | Allows |
|---|---|---|
| `core.integrations.view` / `core.integrations.manage` | existing | the HR app card, Check connection, Sync now (no new key) |
| `hr.people.read` | owner, admin, member | the People screen as a company directory (Ben, 20 Nov: "industry standard") |
| `hr.people.manage` | owner, admin | linking employees to members, mapping branches |

RLS (Ben, 20 Nov: "industry standard", i.e. a company directory open to staff, HR details restricted): every active member of the org
reads `hr_units` and the directory columns of `hr_employees` (name, number, job title, branch, department, manager, status) through
column grants; `work_email`, `user_id`, `link_source`, hire/leave dates, `hr_sync_state` and `hr_webhook_events` are owners and admins
only (read through an owner/admin function, no column grant to members). Isolation tests cover
every table (section 9).

## 5. API

| Method | Path | Permission | Body / query | Returns |
|---|---|---|---|---|
| POST | `/v1/hr/connect/start` | `core.integrations.manage` | — | `{ authorizeUrl }` (the web app sends the browser there) |
| POST | `/v1/hr/connect/finish` | `core.integrations.manage` | `{ code, state }` from the callback page | `{ tenantName }`. The API takes the verifier with the person's own sign-in, exchanges the code with `HR_APP_CLIENT_SECRET`, registers the webhook subscription, and saves with `hr_save_connection` (own sign-in). **No master key**: nothing is read from another company and the tokens arrive in this request |
| POST | `/v1/hr/disconnect` | `core.integrations.manage` | — | revokes at the HR app (best effort), deletes the subscription, `hr_clear_connection` |
| POST | `/v1/core/integrations/hr_app/check` | `core.integrations.manage` | existing check route; new `hr_app` branch in `integrationChecks.ts`: `GET /erp/v1/ping` with the company's token | `IntegrationCheck` |
| POST | `/v1/hr/sync` | `core.integrations.manage` | — | `{ requestedAt }` (the 5-minute job runs it; the card says "within 5 minutes") |
| GET | `/v1/hr/units` | `hr.people.read` | `kind`, `includeDeleted` | units |
| GET | `/v1/hr/employees` | `hr.people.read` | `page`, `pageSize`, `branch`, `department`, `status`, `q` | `Paginated<Employee>` |
| PUT / DELETE | `/v1/hr/employees/:id/link` | `hr.people.manage` | `{ userId }` | the employee |
| PUT | `/v1/hr/units/:id/branch` | `hr.people.manage` | `{ coreBranchId \| null }` | the unit |
| POST | `/webhooks/hr-app` | **none (webhook)**; see decision D2 | signed body, contract section 4 | `200 {handled}` / `401` / `400` |

Every route except the webhook resolves the caller's org and calls `requirePermission`; the database re-checks the role. Body
limit on the webhook 100 KB (`limitBody`), rate-limited with the other webhooks.

**Sync job** (`apps/api/src/jobs/hrSync.ts`, called from the existing `scheduled` handler next to the outbox): for each company from
`hr__sync_due()` (at most 20 per run), `hr__begin_sync`, then read `/erp/v1/branches`, `/departments`, `/employees` with
`updated_since` (full read without it once a day, which also finds records missing from the HR app → soft-deleted), at most 50 pages
per resource per run, timeout 10 s per call, honour `429 Retry-After` (stop and keep the cursor), then `hr__finish_sync`. Errors are
recorded on `hr_sync_state` and shown on the card; no key or URL query string is ever logged.

## 6. Screens

| Screen | Route | Permission | Notes |
|---|---|---|---|
| HR app card | Settings > Integrations | `core.integrations.view` / `.manage` | not connected: **Connect HR app** (OAuth); connected: HR tenant name, connected by and when, Check connection, Sync now, last sync (time, result, counts), last webhook received, **Disconnect**. Callback page `/settings/integrations/hr-app/callback` finishes the connect and returns to the card |
| People | `/hr/people` (new nav item under Settings or a "People" section, module `hr` on) | `hr.people.read` | table: name, number, branch, department, job title, status, ERP member (or "Not linked" / "Suggested: …" with Confirm); filters; read-only banner "Managed in the HR app" |
| Branch mapping | inside People, a tab | `hr.people.manage` | HR branch → ERP branch, suggested by equal code |

All text in Arabic and English (`i18nScreens.ts`), logical CSS properties. Arabic terms added to the review sheet and glossary:
"تطبيق الموارد البشرية" (HR app), "الموظفون" (People), "مزامنة الآن" (Sync now), "رقم الربط" (connection id).

## 7. Business rules

- The HR app wins for its own fields; the ERP owns only `user_id`, `link_source` and `core_branch_id`, which a sync never touches.
- A record with an older `updated_at` than the stored one is ignored (out-of-order pages and webhooks are harmless).
- An employee whose HR record is deleted or `terminated` keeps their link for history, shown greyed; the ERP membership is **not**
  changed automatically (switching off a member stays a person's decision in Settings > Users). The People screen flags "terminated
  in HR but still an active ERP member" for the owner.
- Email suggestion: exact, case-insensitive match with an active member's sign-in email, only when unique; never linked without a
  person confirming.
- No money in phase 1.

## 8. Org settings this module adds

`hr_app` integration fields (above); sync interval (`settings.config.sync_minutes`, 15-1440, default 15; Ben, 20 Nov); module `hr` on/off in
`org_modules`. Nothing customer-specific is hard-coded.

## 9. Tests

- **SQL** `sql/tests/099_hr_app_link.sql`: RLS on every new table; `anon`/`authenticated` cannot insert, update, delete or truncate;
  a member of org B cannot read org A's units, employees, sync state or webhook events, nor link, map or request a sync for org A;
  members read only the directory columns, never `work_email`, links, dates or sync state; `hr__*` not executable by `authenticated`; upsert ignores older `source_updated_at`; replayed
  event id → `duplicate`; link refuses a user from another org; every change writes `audit_log`; unique connection id across orgs.
- **API** (`apps/api/test/hr*.test.ts`): signature valid / wrong secret / old timestamp (> 5 min) / future timestamp / missing
  headers / unknown connection id (plain 200 `ignored`, nothing revealed) / switched-off integration / body over limit / replay;
  sync job against a fake HR app (pagination, `updated_since`, 429, 401, timeout, malformed JSON, page over 200, unknown fields
  dropped); `route_permissions.test.ts` passes with the webhook under `/webhooks` (not a `/v1` route); `boundaries.test.ts` updated
  for the new master-key files.
- **OAuth** (API tests with a fake HR app): state from another person, another company, expired or reused → refused; wrong PKCE
  verifier; token exchange failure leaves nothing saved; an HR tenant already connected to company A cannot connect to company B;
  refresh rotation saved; 401 after a failed refresh shows "Reconnect"; Disconnect revokes and clears Vault; no token in any response or
  log.
- **Web**: card renders in both languages; People screen empty and filled; no secret ever in a response (`saved_fields` only).
- **Contract fixture**: a small fake HR app in `apps/api/test/fixtures/hrApp.ts` that implements contract v1, so our tests and the
  HR app team's checklist describe the same thing.

## 10. Rollout

1. Ben approves this plan and the decisions in section 11; the contract goes to the HR app team (it can go before we build).
2. Build `sql/102` + test 099; local run of all migrations and tests; dry run on live in a rolled-back transaction; apply via the
   Supabase CLI after Ben's yes; worklog entry with both runs.
3. Deploy the API (webhook route, sync job, check), then the web app.
4. Enable module `hr` for Ben's test company; connect it to the HR app team's staging instance; run the contract checklist
   together (contract section 8).
5. Manual check in the browser by Ben (we give the URL and steps; no browser driving against live without asking).

## 11. Decisions for Ben

| # | Decision | Recommended |
|---|---|---|
| D1 | **New master-key files** (secret-key client): `lib/hr/hrWebhook.ts` (webhook: no person waiting; acts only after the signature is verified and finds the company through our own connection id) and `jobs/hrSync.ts` (scheduled job: reads keys via `core__provider_credentials`, writes via `hr__apply_*`). Plus an `hr_app` branch in the already-allowed `lib/integrationChecks.ts` (Check connection: the signed-in company only). Each needs a line in agents.md and in `boundaries.test.ts`. | Yes |
| D2 | ✅ **Approved by Ben, 20 Nov.** **One new route without a permission check**: `POST /webhooks/hr-app` (like the other `/webhooks/*`; protected by the HMAC signature, timestamp window and event-id de-duplication instead). | Yes |
| D3 | **New secrets** (changed 20 Nov for OAuth): one **new Worker secret** `HR_APP_CLIENT_SECRET` (the ERP's OAuth client secret, given to us by the HR app team; plus plain config `HR_APP_ISSUER`, `HR_APP_CLIENT_ID`), and per company in Vault: access token, refresh token and webhook signing secret, all received during Connect, never typed or shown. | Yes |
| D7 | **v1 with a per-company ERP key, OAuth in v1.1** (20 Nov, after learning more about the HR app's current state): the customer pastes one key from the HR app into the ERP card (stored in Vault, like other providers' keys; no new Worker secret for v1); the ERP then registers its webhook through the subscription API, so the signing secret is never typed. Webhooks optional for the HR app's first release (the 15-minute read covers it). OAuth Connect (D6) stays the v1.1 design, and moving to it changes nothing in the read API. | Recommended; Ben to confirm |
| D6 | **OAuth instead of pasted keys** (Ben, 20 Nov: "make the integration use OAuth so it's smooth to set up"). The HR app must act as an OAuth 2.0 authorization server (authorize, token with PKCE and rotating refresh tokens, revoke) and offer a webhook-subscription API. | ✅ Ben, 20 Nov |
| D4 | People data minimisation: phase 1 stores names, employee number, work email, job title, branch/department, manager, status, hire/leave dates only. | Yes |
| D5 | Webhooks only trigger a re-read from the HR app's API (body not trusted as data). | Yes |

Decided by Ben, 20 Nov: D2 yes; People screen "industry standard" (staff directory for every member, HR details for owners and
admins only, section 4); default sync every 15 minutes. Still open: D1 (explained to Ben, awaiting his answer), D3, D4, D5.

## 12. Phase 2 (plan only, not built)

- **Payroll runs → journal entries.** HR app: `payroll_run.approved` webhook; `GET /erp/v1/payroll-runs/{id}` returns the period,
  currency, and totals per cost line (gross, each deduction, employer contributions, net) in **integer minor units** with an ISO 4217
  code, plus totals per branch/department. ERP: an owner maps each payroll line kind to an account once (`hr_payroll_accounts`); the
  run becomes a **manual journal awaiting approval** (sql/048 path; the approver is not the requester), never posted automatically.
  Net pay becomes a payable settled by a treasury payment. Social insurance (Egypt) and payroll tax lines map to liability accounts.
  Idempotent per run id; a corrected run in the HR app becomes a reversing journal + a new one.
- **Advances and expense claims.** HR app: `advance.approved`, `expense_claim.approved`; ERP creates an employee advance (receivable
  from the employee) or an expense (sql/024 `fin_record_expense`, with VAT data when a tax invoice is attached) **in draft for
  approval**; payment through treasury. The approval in the HR app does not replace the ERP approval of the posting.
- The app is an HR **and payroll** app (Ben, 20 Nov), so phase 2 is the main business value. The contract (section 9) already
  shows the payroll run shape and adds one ERP → HR call: `POST /erp/v1/payroll-runs/{id}/accounting-status` (awaiting approval,
  posted with journal number, paid, rejected), with OAuth scope `erp.payroll.status.write`. This is the only place the ERP writes
  to the HR app.
- Phase 2 needs its own plan revision, new permissions (`hr.payroll.post`), and its contract section 9 moved from "draft" to v1.1.

## 13. Open questions

- Does the HR app team want the ERP to call them on a schedule only, or also need an ERP → HR callback later (e.g. "member
  switched off")? Not in v1; the contract reserves `/erp/v1` for their side and `/v1/integrations/hr/*` on ours.
- Which HR app environment (staging URL) we test against, and when.
