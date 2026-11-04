# First-run setup wizard ("welcome me into the app")

**Status:** Built on branch `worktree-onboarding-wizard` (2026-11-04), **not merged, not deployed**; awaiting Ben's review after the demo.
**Owner:** Ben · **Author:** Claude (Opus 5.5)
**Requested by Ben (2026-11-04):** "it needs to welcome me into the app, ask me the language, name of company, and stuff". The sample companies keep their data; Ben will create a new company to use it.

## 1. Goal

A new owner is welcomed and walked through setting the company up, one step at a time. Each step does the real setup (it saves), instead of pointing at a screen as the Getting-started checklist does. At the end it offers the guided tour.

## 2. What already existed

- Sign-up asks for the company name and language only.
- Getting started (a language chooser, then a checklist that ticks itself off) guides but does not set anything up.
- The 7-step tour explains screens; it doesn't set anything up either.

## 3. The steps

| # | Step | What it saves | Through (existing route) |
|---|---|---|---|
| 1 | Welcome | nothing: what the app does, then "Start setup" / "Not now" | — |
| 2 | Language | the person's language; optionally the company default too (owner or admin) | the person's own language setting; `POST /v1/core/org/language` |
| 3 | Company | name, currency, time zone, date format (prefilled) | `PATCH /v1/core/org` |
| 4 | First warehouse | code and name | `POST /v1/inventory/warehouses` |
| 5 | Items | up to 10 rows: code, name, unit, stock today (opening stock goes into the first warehouse) | `POST /v1/inventory/items` |
| 6 | Team | invite by email, full name and role (manager, member, viewer) | `POST /v1/core/members` |
| 7 | Approvals | states that one manager's approval is always required and self-approval is impossible; optional rule "from N total quantity, require 2 or 3 approvers" | `POST /v1/inventory/approval-policies` |
| 8 | Done | marks setup finished; buttons: take the tour, go to Home, open the checklist | — |

Every step can be skipped, and there are Back and "Leave setup" buttons. A step the person's role cannot do says so and can be skipped.

## 4. Rules

- **No database or API change.** Every save uses a route the Settings and Inventory screens already use, so it goes through the same audited database functions, with the same role and isolation checks.
- **Starts by itself only in a brand-new company:** the tutorial flag is on (companies created through sign-up, `sql/032`), the person can manage the company, the company has **no warehouse yet**, and setup was neither finished nor dismissed. The sample companies (Demo Cosmetics Factory, Demo Trading Co.) have warehouses, so it never starts there. Anyone can still open it from Getting started ("Start setup").
- **Progress** is kept in the browser per company (`erp.onboarding.<orgId>`), like the tour's done flag. "Not now" / "Leave setup" stops the automatic start for the browser session; finishing stops it for good.
- **Bilingual:** every sentence is in `modules/help/onboardingContent.ts` (English and Arabic). A test fails if the two languages differ in shape. The Arabic is a first draft for native review.

## 5. Files (branch `worktree-onboarding-wizard`)

| File | Change |
|---|---|
| `apps/web/src/modules/help/Onboarding.tsx` | new: the wizard |
| `apps/web/src/modules/help/onboardingContent.ts` | new: English/Arabic text, progress storage, the auto-start rule |
| `apps/web/src/modules/help/onboarding.test.ts` | new: language parity, auto-start rule, progress parsing |
| `apps/web/src/modules/registry.tsx` | page `/start/setup` in the Getting-started app |
| `apps/web/src/modules/help/GettingStarted.tsx` | "Start setup" card at the top |
| `apps/web/src/modules/core/Home.tsx` | first-run automatic start (rule above) |
| `apps/web/src/lib/i18nNav.ts` | Arabic for the new page label |

## 6. Checks run

`npm run typecheck`, `biome ci`, `npm test` (shared 30 + 1 skipped, API 132 + 7 skipped, web 54) and `vite build` pass on the branch. **Not seen in a browser yet:** it can only be tried against the real API once deployed, or with a local API.

## 7. To try it after merging

1. Create a new company (account menu → Switch organization → Create a new company).
2. Home should open the wizard by itself. Go through it in English, then switch to Arabic on step 2 and check that the layout flips.
3. Check that each saved step shows in Settings → Audit log.

## 8. Later (not built)

- Spreadsheet import of items, once import exists.
- Saving progress on the account instead of the browser (it would need a migration).
- A "VAT / ETA registered?" question that switches e-invoicing on, once e-invoicing is finished.
