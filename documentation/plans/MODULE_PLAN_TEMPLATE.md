# <Module name> Plan

**Module key:** `<key>` (lowercase, matches `packages/shared/src/modules.ts`)
**Status:** `[📝 Draft / RFC]`
**Owner:** <name> · **Reviewers:** <names>
**Research:** [<system>](../research/<system-slug>/TEARDOWN.md)
**Depends on modules:** core, …

---

## 1. Goal

What this module lets a customer do, in 2–3 sentences. Who uses it.

## 2. Scope

**In (this version):** features from the teardown parity matrix marked *Must*, by ID (F1, F3…).
**Out (later):** *Should* / *Could* items, and why they wait.
**Won't:** anything deliberately left out.

## 3. Data model

One table per entity. Every table gets `id`, `org_id`, `created_at`, `updated_at`,
`deleted_at`, RLS, and an index leading with `org_id`.

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| | | | | |

Statuses and allowed transitions. Numbering. What is locked after which status.
**Migration file:** `sql/NNN_<key>_….sql`

## 4. Permissions

| Key | Granted to by default | Allows |
|---|---|---|
| `<key>.<resource>.read` | viewer+ | |
| `<key>.<resource>.manage` | admin+ | |

## 5. API

| Method | Path | Permission | Body / query | Returns |
|---|---|---|---|---|
| GET | `/v1/<key>/<resource>` | `<key>.<resource>.read` | `page`, `pageSize`, filters | `Paginated<…>` |

Validation rules, and what is written to `audit_log`.

## 6. Screens

| Screen | Route | Permission | Notes |
|---|---|---|---|
| | | | |

## 7. Business rules and calculations

Tax, rounding (always on minor units), discounts, stock effects, side effects. Worked examples
with numbers.

## 8. Org settings this module adds

Everything a customer may want different. Nothing customer-specific is hardcoded.

## 9. Tests

Unit tests for rules; API tests including **a second org cannot read or change this org's data**.

## 10. Rollout

1. Run `sql/NNN_…` and its verification queries; log in the worklog.
2. Deploy the API.
3. Deploy the web app.
4. Enable for the pilot organization: `insert into org_modules (org_id, module_key) values (…, '<key>');`
5. Manual check in the browser (URL + steps for the user).

## 11. Open questions
