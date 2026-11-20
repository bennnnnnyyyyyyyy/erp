# HR app ↔ ERP integration contract, v1

**Status:** v1 draft for the HR app team, 19 Nov 2026. Our side is planned in
[HR_APP_INTEGRATION_PLAN.md](../plans/HR_APP_INTEGRATION_PLAN.md) and not built yet; changes to this document before both sides
ship are agreed together. After that, v1 only grows by additions (section 7).

**In one paragraph.** The ERP treats the HR app like any outside provider (as it does Shopify or a courier). The HR app exposes a
small **read-only HTTP API** (section 3) that the ERP calls on a schedule and on demand, and sends **signed webhooks** (section 4)
to the ERP when something changes. A webhook only tells the ERP "please re-read this"; the data itself always comes from the API.
Phase 1 is branches, departments and employees. Phase 2 (payroll, advances, expense claims) is sketched in section 9 and is not
part of v1. A machine-readable copy (OpenAPI 3.1, for code generators and API tools) is in
[hr-app-integration-openapi.yaml](hr-app-integration-openapi.yaml).

---

## 1. Words used here

| Word | Meaning |
|---|---|
| Tenant | One customer company in the HR app. One ERP company connects to exactly one HR tenant. |
| API key | A secret the HR app issues per tenant for the ERP. Read-only. |
| Webhook secret | A second secret the HR app issues per tenant, used to sign webhooks. Different from the API key. |
| Connection id | A value the **ERP** generates per company (looks like `hrc_6fQk2Lm9Xa1Bc3De4Fg5Hj7K`). The HR app stores it and sends it with every webhook so the ERP knows which company it is for. Not a secret. |
| Base URL | Where the HR app's API lives for this tenant, e.g. `https://hr.example.com` (or a tenant subdomain). HTTPS only. |

## 2. Setting up a connection (what each side shows)

**In the HR app ("ERP" card), the HR app team builds:**

1. Generate (and later rotate or revoke) the **API key** and the **webhook secret** for this tenant. Show each once on creation.
2. Show the **Base URL** to copy.
3. Two input fields: **ERP webhook URL** and **ERP connection id**, pasted from the ERP.
4. A **Send test webhook** button (sends `ping`, section 4.4) and the result of the last delivery.
5. An on/off switch. While off: the API answers `401 integration_disabled` and no webhooks are sent.

**In the ERP (Settings > Integrations > HR app card), we build:** fields for Base URL, API key, webhook secret (the secrets are
stored encrypted and never shown again), on/off, **Check connection** (calls `GET /erp/v1/ping`), **Sync now**, last sync result,
last webhook received, and a box with the ERP webhook URL and connection id to paste into the HR app.

The person setting up copies three values HR → ERP and two values ERP → HR. The ERP never needs an account in the HR app, and
the HR app never needs credentials for the ERP in v1.

## 3. The API the HR app exposes

### 3.1 General rules

- Base path: `{base_url}/erp/v1`. All responses `application/json; charset=utf-8`. HTTPS only (TLS 1.2+).
- **Auth:** `Authorization: Bearer <api_key>`. The key alone identifies the tenant; the ERP never sends a tenant id. Compare keys in
  constant time. A key can only read this tenant's data.
- The ERP also sends `User-Agent: ERP-HR-Connector/1` and `X-Request-Id: <uuid>`; please log the request id and echo it back in
  `X-Request-Id`.
- **Ids** are opaque strings ≤ 64 characters, stable forever, never reused. **Timestamps** are ISO 8601 in UTC with `Z`
  (`2026-11-19T08:30:00Z`). **Dates** are `YYYY-MM-DD`. Text is UTF-8; Arabic names go in the `_ar` fields.
- Unknown query parameters are ignored. The ERP ignores fields it does not know, so you may add fields at any time (section 7).
- Rate: the ERP makes at most 2 requests per second per tenant. If you must slow it down, answer `429` with `Retry-After` (seconds).
- Timeout: the ERP waits 10 seconds per request.

### 3.2 Pagination and incremental reads (all list endpoints)

Query parameters:

| Parameter | Meaning |
|---|---|
| `limit` | 1-200, default 100. |
| `cursor` | Opaque value from the previous page's `next_cursor`. When present, the other filters are those of the first page. |
| `updated_since` | ISO timestamp. Only records whose `updated_at` ≥ this value, **including deleted ones** (as tombstones, below). Without it: all current (not deleted) records. |

Order: by `updated_at` ascending, then `id` ascending. Records changed while the ERP pages through must not be skipped (a cursor
based on `(updated_at, id)` does this; an offset does not).

Response shape:

```json
{
  "data": [ { "...": "records" } ],
  "next_cursor": "eyJ1IjoiMjAyNi0xMS0xOVQwODozMDowMFoiLCJpIjoiZW1wXzEyMyJ9",
  "has_more": true
}
```

On the last page `has_more` is `false` and `next_cursor` is `null`.

**Deleted records.** With `updated_since`, a deleted record appears once as a tombstone:

```json
{ "id": "emp_123", "deleted": true, "updated_at": "2026-11-19T09:00:00Z" }
```

Keep tombstones for at least 30 days. The ERP also does one full read a day (no `updated_since`) and treats a record missing from
it as deleted.

### 3.3 `GET /erp/v1/ping`

Used by the ERP's **Check connection** button. No side effects.

```json
{
  "app": "hr-app",
  "api_version": "1",
  "tenant": { "id": "ten_7Kd9", "name": "Example Trading Co." },
  "integration_enabled": true,
  "server_time": "2026-11-19T08:30:00Z"
}
```

The ERP shows `tenant.name` so the person can confirm they connected the right company, and warns when `server_time` differs from
its own by more than 2 minutes (webhook timestamps depend on it).

### 3.4 `GET /erp/v1/branches`

```json
{
  "data": [
    {
      "id": "br_cai01",
      "code": "CAI-01",
      "name": "Cairo head office",
      "name_ar": "المقر الرئيسي - القاهرة",
      "active": true,
      "updated_at": "2026-11-18T12:00:00Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| id | string | yes | |
| code | string ≤ 30 | no | The ERP uses an equal code to suggest the matching ERP branch. |
| name | string ≤ 120 | yes | |
| name_ar | string ≤ 120 | no | |
| active | boolean | yes | |
| updated_at | timestamp | yes | changes on every change to the record |

### 3.5 `GET /erp/v1/departments`

```json
{
  "data": [
    {
      "id": "dep_fin",
      "code": "FIN",
      "name": "Finance",
      "name_ar": "المالية",
      "branch_id": "br_cai01",
      "parent_department_id": null,
      "active": true,
      "updated_at": "2026-11-18T12:00:00Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

`branch_id` and `parent_department_id` are optional (`null` when the department is company-wide or top-level). No cycles.

### 3.6 `GET /erp/v1/employees` and `GET /erp/v1/employees/{id}`

Extra filter on the list: `status` (`active`, `on_leave`, `terminated`; repeatable). The single read returns one record (not
wrapped in `data`) or `404 not_found`, and `200` with a tombstone for a deleted employee.

```json
{
  "data": [
    {
      "id": "emp_123",
      "employee_number": "E-0042",
      "display_name": "Sample Employee",
      "display_name_ar": "موظف تجريبي",
      "work_email": "employee@example.com",
      "job_title": "Accountant",
      "job_title_ar": "محاسب",
      "branch_id": "br_cai01",
      "department_id": "dep_fin",
      "manager_id": "emp_007",
      "status": "active",
      "hired_on": "2024-03-01",
      "left_on": null,
      "updated_at": "2026-11-19T08:30:00Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| id | string | yes | |
| employee_number | string ≤ 40 | no | |
| display_name | string ≤ 160 | yes | |
| display_name_ar | string ≤ 160 | no | |
| work_email | string | no | **Work** address only. The ERP uses it to suggest linking the employee to an ERP user; a person confirms. |
| job_title, job_title_ar | string ≤ 120 | no | |
| branch_id, department_id, manager_id | string | no | ids from the endpoints above |
| status | `active` \| `on_leave` \| `terminated` | yes | |
| hired_on, left_on | date | no | |
| updated_at | timestamp | yes | |

**Do not send** (v1): salary or any pay data, national ID, passport, phone numbers, home address, birth date, gender, religion,
health, bank details, photos, documents. The ERP does not need them and drops unknown fields anyway; leaving them out keeps both
products' data-protection duties small.

### 3.7 Errors (every endpoint)

Non-2xx responses use one shape:

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The API key is not valid for any tenant.",
    "request_id": "0b9c6f1e-3a52-4d1e-9a7e-2f1c4e5d6a7b"
  }
}
```

| HTTP | `code` | When | What the ERP does |
|---|---|---|---|
| 400 | `invalid_request` | bad parameter (e.g. `limit=500`, bad timestamp) | records the error, stops this run |
| 401 | `invalid_api_key` | missing, wrong or revoked key | shows "the HR app refused the API key" on the card |
| 401 | `integration_disabled` | the tenant switched the ERP card off | shows "switched off in the HR app" |
| 404 | `not_found` | unknown id or path | single read: treated as deleted |
| 410 | `cursor_expired` | cursor too old | restarts the read from the saved `updated_since` |
| 429 | `rate_limited` | too many requests; send `Retry-After` | waits and continues next run |
| 5xx | `server_error` | anything else | retries next run (every 5 minutes, then backs off) |

`message` is English, for logs and screens; never put secrets or personal data in it.

## 4. Webhooks the HR app sends to the ERP

### 4.1 Delivery

`POST {erp_webhook_url}` (given on the ERP card; it looks like `https://<erp-api-host>/webhooks/hr-app`), with:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-ERP-Connection` | the connection id pasted from the ERP |
| `X-HR-Event-Id` | unique id of this event (same id on every retry) |
| `X-HR-Timestamp` | Unix time in seconds when **this attempt** was signed |
| `X-HR-Signature` | `v1=` + lowercase hex HMAC-SHA256 (section 4.2) |

Body (≤ 64 KB):

```json
{
  "id": "evt_01JD3K8Q2V",
  "type": "employee.updated",
  "api_version": "1",
  "occurred_at": "2026-11-19T08:30:00Z",
  "data": { "object": "employee", "id": "emp_123" }
}
```

Events carry ids only, not the record. On receiving one, the ERP re-reads from the API (usually within 5 minutes). So a lost
or late webhook is never a data problem; it only delays the update until the next scheduled read.

### 4.2 Signing (HMAC-SHA256 with a timestamp)

```
signed_payload = X-HR-Timestamp + "." + raw_request_body      (the exact bytes sent)
signature      = hex( HMAC_SHA256( key = webhook_secret, message = signed_payload ) )
X-HR-Signature: v1=<signature>
```

During a secret rotation, send both signatures separated by a comma: `v1=<new>,v1=<old>`; the ERP accepts the request if any one
matches. Sign the body **after** serialising it and send exactly those bytes (do not re-serialise).

Example (use it as a unit test on your side):

```
webhook_secret = whsec_test_5b1f0c2e9d8a4f7b
X-HR-Timestamp = 1763541000
raw body       = {"id":"evt_test_1","type":"ping","api_version":"1","occurred_at":"2025-11-19T08:30:00Z","data":null}
signed_payload = 1763541000.{"id":"evt_test_1","type":"ping","api_version":"1","occurred_at":"2025-11-19T08:30:00Z","data":null}
```

Expected header: `X-HR-Signature: v1=2407aec730788a553066421dc56d64d5bbd595f26b71b142f3e74f88b45b4460`. Check it with:

```bash
printf '%s' '1763541000.{"id":"evt_test_1","type":"ping","api_version":"1","occurred_at":"2025-11-19T08:30:00Z","data":null}' \
  | openssl dgst -sha256 -hmac 'whsec_test_5b1f0c2e9d8a4f7b' -hex
```

```js
// Node.js
import { createHmac } from 'node:crypto';
const sig = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
headers['X-HR-Signature'] = `v1=${sig}`;
```

### 4.3 How the ERP verifies (so you know what will be rejected)

1. Finds the company by `X-ERP-Connection`. Unknown or switched-off connection: `200 {"handled":"ignored"}` (so you stop retrying;
   nothing is revealed). Fix the pasted connection id if your test webhook shows `ignored`.
2. Rejects with `401 {"handled":"bad_signature"}` when the signature is missing or wrong, or when `X-HR-Timestamp` is more than
   **300 seconds** away from the ERP's clock (past or future). Comparison is constant-time.
3. Rejects with `400 {"handled":"invalid"}` when the body is not the JSON above or is over 64 KB.
4. Records `X-HR-Event-Id`; a repeat within 7 days answers `200 {"handled":"duplicate"}` and does nothing.
5. Otherwise `200 {"handled":"ok"}` (or `"ignored"` for an event type it does not use).

The ERP answers within 5 seconds. Treat any `2xx` as delivered. On `401`, show "signature refused" on your ERP card and retry like
an error (the person may be mid-rotation). On timeout, network error or `5xx`, retry with backoff: 1 min, 5 min, 30 min, 2 h,
6 h, then every 6 h for 24 h in total; then mark failed and show it on your ERP card. Do not retry `400`.

### 4.4 Event types (v1)

| `type` | `data.object` | When |
|---|---|---|
| `ping` | — (`data` is `null`) | "Send test webhook" on your ERP card |
| `branch.created`, `branch.updated`, `branch.deleted` | `branch` | |
| `department.created`, `department.updated`, `department.deleted` | `department` | |
| `employee.created`, `employee.updated`, `employee.deleted` | `employee` | includes status changes (leave, termination) |
| `sync.requested` | — | e.g. after a bulk import: the ERP does a full read |

Send events in roughly the order they happen; order is not guaranteed and the ERP does not depend on it (it compares
`updated_at`).

## 5. Security requirements for the HR app

- API keys and webhook secrets: at least 32 random bytes, stored hashed (API key) or encrypted (webhook secret), shown once, can be
  rotated without downtime (old key valid for up to 24 h after rotation, then revoked) and revoked at once.
- The API key is read-only and limited to the endpoints in section 3.
- Never log keys, secrets, full request bodies with personal data, or the `Authorization` header.
- Webhooks go only to the HTTPS URL pasted by the tenant's admin; do not follow redirects.
- Answer only for the tenant the key belongs to: one tenant's key must never read another's data (please test this, section 8).

## 6. Calling the ERP back

**Not needed in v1.** Everything flows HR → ERP (the ERP reads; the HR app notifies). If a later version needs the ERP to tell
the HR app something (for example "this person's ERP access was switched off"), the ERP will call a new endpoint under
`{base_url}/erp/v1/…` with the same API key, signed the same way, and this document will add it as v1.x. No ERP credentials are
given to the HR app.

## 7. Versioning and change rules

- The version is in the path (`/erp/v1`) and in `api_version` of webhooks.
- Allowed in v1 without notice: new endpoints, new optional fields, new event types (the ERP ignores what it does not know), new
  error `code`s within the listed HTTP statuses.
- Not allowed in v1: removing or renaming a field, changing a type or meaning, making an optional field required, changing the
  signing scheme. Those need `/erp/v2`, run side by side with v1 for at least 6 months.
- Tell us of any change with at least 2 weeks' notice in the shared changelog at the end of this document.

## 8. Test checklist for the HR app team

Run these against your staging instance before connecting a real tenant. Items marked **(ERP)** need our staging ERP; until it
exists, use the signing example in 4.2 and a request bin you control.

**API**

- [ ] `GET /erp/v1/ping` with a valid key returns 200 and the tenant name.
- [ ] No `Authorization` header → 401 `invalid_api_key` in the error shape of 3.7.
- [ ] A wrong key, a revoked key, and a key of tenant B used for tenant A data → 401 / never tenant A's data.
- [ ] ERP card switched off → 401 `integration_disabled`.
- [ ] `limit=0` and `limit=201` → 400 `invalid_request`; `limit=200` works.
- [ ] 250 employees: paging with `limit=100` returns 3 pages, 250 unique ids, last page `has_more: false`, `next_cursor: null`.
- [ ] Change an employee while paging: it is not skipped (it appears on a later page or in the next `updated_since` read).
- [ ] `updated_since` returns only records changed at or after that time, ordered by `updated_at`, `id`.
- [ ] Delete an employee: it appears as a tombstone in `updated_since` reads for 30 days; it is absent from a full read.
- [ ] `GET /erp/v1/employees/{unknown}` → 404 `not_found`.
- [ ] Arabic names come back intact (UTF-8), e.g. `"موظف تجريبي"`.
- [ ] No field from the "do not send" list (3.6) appears in any response.
- [ ] Every response carries `X-Request-Id`.
- [ ] Over the rate limit → 429 with `Retry-After`.

**Webhooks**

- [ ] Your signer reproduces the example in 4.2 (same input → same hex as `openssl`).
- [ ] Every webhook has all five headers; the timestamp is the time of the attempt, not of the event.
- [ ] Retries reuse the same `X-HR-Event-Id` and re-sign with a new timestamp.
- [ ] Retry schedule follows 4.3; `400` is not retried; failures show on your ERP card.
- [ ] During rotation both signatures are sent (`v1=…,v1=…`).
- [ ] Creating, editing, terminating and deleting an employee each send the matching event with only ids in `data`.
- [ ] **(ERP)** "Send test webhook" → ERP answers `{"handled":"ok"}` and its card shows "last webhook received".
- [ ] **(ERP)** Wrong secret → ERP answers 401 `bad_signature`; clock off by 10 minutes → 401.
- [ ] **(ERP)** Wrong connection id → ERP answers 200 `ignored`.
- [ ] **(ERP)** Same event sent twice → second answer `duplicate`.
- [ ] **(ERP)** After `employee.updated`, the ERP's People screen shows the change within 5 minutes.

## 9. Phase 2 preview (draft, not part of v1)

Shared so the HR app's data model can prepare; the final shapes come in v1.1 after a separate ERP plan.

- **Money** is always an integer in **minor units** plus an ISO 4217 currency code: EGP 1,250.50 is `{"amount_minor": 125050,
  "currency": "EGP"}`. Never floats.
- `GET /erp/v1/payroll-runs?updated_since=…` and `GET /erp/v1/payroll-runs/{id}`: period (`from`, `to`), `status`
  (`approved`, `paid`, `reversed`), `currency`, and `lines`: one per cost kind (`basic`, `allowance`, `overtime`, `social_insurance_employee`,
  `social_insurance_employer`, `income_tax`, `deduction`, `net_pay`, …) with `amount_minor`, and optional split by `branch_id` /
  `department_id`. Per-employee detail stays in the HR app.
- `GET /erp/v1/advances/{id}` and `GET /erp/v1/expense-claims/{id}`: employee id, date, `amount_minor`, `currency`, description,
  approved by/at, and for claims: supplier name, supplier tax number and tax invoice reference when present.
- Webhooks: `payroll_run.approved`, `payroll_run.reversed`, `advance.approved`, `expense_claim.approved`. The ERP turns each into
  an accounting entry **awaiting approval in the ERP**; an HR approval never posts to the books on its own.

## 10. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-11-19 | v1 draft | First version, for review by the HR app team and Ben. |
