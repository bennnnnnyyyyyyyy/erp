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

## 8. Part B: demo autofill ("click to autofill") — BUILT on the branch 2026-11-04, not merged

**Ben's answers (2026-11-04), as built:**
- **D1:** only the demo account, Chris. The build setting `DEMO_AUTOFILL_EMAILS` is set on the production build in `ci-deploy.yml`, with a repository variable able to override it. Every new company Chris creates gets the wizard (auto-start) and the fill buttons.
- **D2:** a visible "Fill everything with sample data" button on the welcome step, plus a button on each step.
- **D3:** the team step stays, never autofilled.
- **D4:** names keep "(sample)", as recommended. Ben didn't follow the question; see the worklog note.
- **D5:** Ben names the company himself at sign-up. The fill never changes the name; it sets only currency, time zone and date format.
- **Item costs:** option (a), the new route `PUT /v1/inventory/items/:id/cost` (API-only, calls the existing audited `inv_set_item_cost`).

**Files:**
- `modules/help/sampleCompany.ts`: the data. It copies 5 warehouses, 2 conditions, 19 items, 12 suppliers and 10 customers from the seed.
- `modules/help/sampleFill.ts`: the fill logic. It skips anything that already exists, saves row by row with progress, and lists failures.
- `modules/help/onboardingSample.test.ts`: the tests.
- New steps: Storage conditions, Suppliers, Customers.
- `apps/web/vite.config.ts` and `.github/workflows/ci-deploy.yml`: the build setting.
- `apps/api/src/modules/inventory/routes.ts`: the cost route.

**Asked by Ben (2026-11-04):** for the demo, each wizard step gets a one-click autofill with the **same data as Demo Cosmetics Factory**, so no time is spent typing. After finishing setup in a brand-new company, Ben switches to Demo Cosmetics Factory to show what the app looks like with a year of real use.

### 8.1 The demo story

1. Sign up a fresh company live, for example "Nile Cosmetics".
2. The wizard opens by itself. On each step, click **"Fill with sample data"**: the fields fill instantly. Then click **Save**, so the audience sees a real save, with a real audit row and real stock.
3. Finish, then switch organization to **Demo Cosmetics Factory**. It's the same items, warehouses and partners, but with 12 months of orders, invoices, approvals, forecast and alerts.

### 8.2 What each step autofills (copied from `sql/seed/004_cosmetics_factory_demo.sql`)

| Step | Autofill values | Size |
|---|---|---|
| Language | Unchanged: the presenter picks | — |
| Company | Name "Nile Cosmetics (demo)", EGP, Africa/Cairo, DD/MM/YYYY | 1 |
| Storage conditions (new small step) | Ambient 15–25 °C, Cold room 2–8 °C | 2 |
| Warehouses | RAW Raw materials, PACK Packaging, COLD Cold room (cold), FG Finished goods, QRN Quarantine, with Arabic names | 5 |
| Items | The 12 finished goods (F-SHA Shampoo 400 ml … F-MSK Clay face mask) plus ~6 key raw and packaging items (glycerin, shea butter, aloe vera, PET bottle 250 ml, pump, carton), with Arabic names, units and an opening stock in the right warehouse (cold items go to COLD) | about 18 |
| Item costs | Each item's average cost from the seed (for example Shampoo 24.00 EGP), so the profit card has numbers on day one | same items |
| Suppliers (new step) | The 12 "(sample)" suppliers: Delta Chemical Trading, Nile Naturals Oils, … | 12 (or the top 5) |
| Customers (new step) | The 10 "(sample)" customers: Cairo Pharmacy Chain, Delta Supermarkets Distribution, … | 10 (or the top 5) |
| Team | **Not autofilled** (see D3) | — |
| Approvals | "From 100 total quantity, 2 approvers" | 1 rule |

**Not copied:** the 12 months of history (orders, invoices, payments, expenses, batches). That's the point of switching to Demo Cosmetics Factory. The new company starts like a real customer would.

### 8.3 How it works

- **The sample data is a fixed list in the web code** (`modules/help/sampleCompany.ts`), generated once from the seed file. It does **not** read the cosmetics company live. Row-level security forbids reading another organization, and that's correct. A test checks the list against the seed file, so the two cannot drift.
- **"Fill" only fills the form.** Saving still goes through the same existing API routes and audited database functions as a normal save. No new database function, no direct insert, no migration.
- **Lists of many rows** (items, suppliers, customers) are saved one at a time with a visible progress counter ("Saving 7 of 18"). If one fails, for example because the code already exists, the rest continue and the failures are listed.
- Two new steps, **Suppliers** and **Customers**, are added to the wizard. They are useful without autofill too. **Storage conditions** become a small step before Warehouses, so the cold room rule works.
- **Item costs (correction, checked 2026-11-04):** the database function `inv_set_item_cost` (`sql/023`, owner or admin, audited) exists, but **no API route calls it**. Two choices:
  - **(a)** add one small route, `PUT /v1/inventory/items/:id/cost`. It is API-only (no migration) and calls the existing audited function. It must be merged with or after the web change, never before the wizard needs it.
  - **(b)** skip costs in autofill. The new company's profit card would then show a cost of zero.

  Recommended: **(a)**. It is the only API change in Part B.

### 8.4 Decisions for Ben (recommended answer first)

| # | Question | Options |
|---|---|---|
| D1 | Who sees the "Fill with sample data" button? | **(a) Only the demo accounts** (Chris, Joseph, Grant, Ben), from a list in a build setting, never hard-coded; (b) everyone, labelled "sample"; (c) only when the company name contains "(demo)" |
| D2 | One button per step, or also "Fill everything and finish" on the welcome step? | **Per step** (the audience sees each screen), plus a hidden "fill all" for rehearsals |
| D3 | Autofill the team? | **No.** Inviting sends real emails, and the demo users already belong to the sample companies. The presenter can invite Joseph by hand if wanted. |
| D4 | Keep "(sample)" on supplier and customer names? | **Yes**, the same names as the cosmetics company, so the switch is obviously "the same business, a year later" |
| D5 | Company name default | **"Nile Cosmetics (demo)"**, editable |

### 8.5 Tests

- The sample list matches the seed file (codes, names, units, costs).
- Both languages are complete for the new steps (the existing parity test).
- The fill button shows only for D1's audience.
- Pure functions for "which warehouse does an item go to".
- A browser rehearsal in a new company after merge: time from sign-up to finished setup (target: under 3 minutes).

### 8.6 Build order

1. Data list and test.
2. Suppliers, Customers and Storage conditions steps.
3. Fill buttons and the bulk save with progress.
4. D1 gating.
5. Docs, then the rehearsal in a throwaway company.

All on this branch; nothing merges before the demo freeze is over.

## 9. Later (not built)

- Spreadsheet import of items, once import exists.
- Saving progress on the account instead of the browser (it would need a migration).
- A "VAT / ETA registered?" question that switches e-invoicing on, once e-invoicing is finished.
