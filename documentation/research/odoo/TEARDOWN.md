# Teardown: <System name>

**Slug:** `<system-slug>`
**URL:** <public URL>
**Studied by:** <name / agent> · **Dates:** <YYYY-MM-DD> to <YYYY-MM-DD>
**Access used:** <public site / trial account / company account: no credentials in this file>
**Status:** Not started | In progress | Complete | Parked
**Feeds plan(s):** <links to plans/…, once written>

> Record what the system does, in our own words. No copied code, assets or copy text. Mark
> anything inferred rather than observed with *(inferred)*. Replace real people's data with
> made-up values. See [`../README.md`](../README.md).

---

## 1. Summary

- What problem it solves and for whom (2–4 sentences).
- Which of our modules it maps to (e.g. inventory, invoicing, HR, CRM).
- Pricing model and tiers, if public (useful for our own packaging).

## 2. Users and roles

| Role | What they can do | What they can't |
|---|---|---|
| | | |

Note how permissions are granted (fixed roles, custom roles, per-record sharing).

## 3. Navigation and screen inventory

The full menu tree, then one row per screen.

| # | Screen | Path / menu location | Purpose | Screenshot |
|---|---|---|---|---|
| S1 | | | | `screenshots/S1-<name>.png` |

## 4. Data model (entities and fields)

One table per entity. This becomes our SQL.

### <Entity name>

| Field | Type (as it behaves) | Required | Rules / validation | Notes |
|---|---|---|---|---|
| | text / number / money / date / choice / reference → Entity | | | |

**Relationships:** e.g. an Invoice has many Line Items; a Line Item references one Product.
**Identifiers:** human-facing numbering (e.g. `INV-0001`), whether it is per-company and resettable.
**Lifecycle / statuses:** e.g. Draft → Sent → Paid → Void. Who can move it, and what is locked after each step.

## 5. Workflows

One subsection per workflow, as numbered steps with screen references.

### W1: <name>

1. User opens S2, clicks "New".
2. …

**Business rules:** calculations (tax, discounts, rounding), defaults, validations, side effects
(stock moves, emails, ledger entries).
**Edge cases observed:** partial payments, cancellations, back-dating, multi-currency…

## 6. Reports and dashboards

| Report | Filters | Columns / measures | Export formats |
|---|---|---|---|
| | | | |

## 7. Integrations, imports and exports

- Imports (CSV/Excel templates and their columns), exports, public API, webhooks.
- Third-party connections (payments, email, accounting, e-commerce, banks).

## 8. Settings and configuration

What a customer admin can configure: numbering, taxes, currencies, templates, custom fields,
workflows. This tells us what must be **org settings**, not hardcoded.

## 9. Notifications

What triggers an email, in-app notification or reminder, and who gets it.

## 10. UX observations

What works well, what is painful, what we should do better. Opinions go here, not above.

## 11. Parity matrix

| # | Feature | Seen in (screen / workflow) | Priority | Our module | Notes |
|---|---|---|---|---|---|
| F1 | | S1, W1 | Must / Should / Could / Won't | | |

## 12. Open questions

Things we couldn't see or need to confirm with the business before planning.
