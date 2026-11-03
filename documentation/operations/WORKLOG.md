# {{PRODUCT_NAME}} Worklog

Newest first. Every significant fix, schema change, migration run, deployment or data operation
gets an entry with these four headings:

- **Objective.** Why the work was done.
- **Actions Completed.** What changed, with file paths.
- **Database / System Result.** What happened in Supabase / Cloudflare / hosting, or "None".
- **Safety Status.** Tests run, what was not verified, and manual steps still needed.

Entry heading format: `## YYYY-MM-DD — Short title`. If it is not in this file, it has not been
run or deployed.

## 2026-11-03 (round 4) — Home cards get real names; lists become cards on phones; record pages on one facts layout (not deployed)

**Objective.** Ben: the Home tiles have no clear titles ("wtf is money coming in and out, that has a name"), then the next polish round ([plan](../plans/2026-11-03-ui-polish-plan.md)). Built on rounds 2 and 3 (uncommitted in main).

**Actions Completed.**
- `core/OwnerHome.tsx`: card titles renamed to their business names (the plain subtitle under each stays): Profit and loss, Receivables and payables, Pending approvals, Inventory value and expiry, Top products, Supplier concentration; titles one size larger. Arabic replaced on the same dictionary lines. `DEMO_SCRIPT_2026-11-02.md` and `COSMETICS_WALKTHROUGH.md` use the new names.
- Phones (≤720 px): every `ListView` list turns into cards: each row a card, each value labelled with its column (`data-label`), the first cell as the title; summary figures two per row. Hand-built tables still scroll sideways.
- Record pages on the same labelled facts block as the invoice and payment pages (was one long sentence): stock request, stock transfer, purchase order (with total), sales order (with total).

**Database / System Result.** None. Frontend and docs only. Local sample build (port 5199, stopped): request page, purchase order page, and the requests and stock lists framed at 390 px.

**Safety Status.** `npm run typecheck`, `npm test` (shared 30, api 117, web 42) and `vite build` pass. Not seen: Home cards with live data (not in the sample build), the transfer page. Ben to check after deploy, and to rehearse the demo with the new card names.

## 2026-11-03 (round 3) — UI polish: forms behind buttons everywhere, empty Profit overview, Settings sections, Users actions, one date format (not deployed)

**Objective.** The visible items of rounds 2 and 3 in [`documentation/plans/2026-11-03-ui-polish-plan.md`](../plans/2026-11-03-ui-polish-plan.md). Built on top of round 2 (uncommitted in main at the time).

**Actions Completed.**
- Always-open create forms moved behind a button (`FormToggle`) at the top of their section: Batches ("Receive a batch"), Alerts ("Add a rule", now above the rules), Stock adjustments ("New cycle count"), Approval policies. Real `<form>`s kept inside, so Enter still submits.
- Profit overview: with nothing invoiced or spent, an empty state with links to Customer invoices and Expenses instead of zero cards and an axis of zeros; "Made / Lost" and "{n} of {total}" now translated (were English pieces glued in code); load errors shown as errors.
- Settings > General: two titled sections ("Your language", "Company"); the long hints cut to one line each; customer-facing text no longer mentions "machine draft covering N strings".
- Users: Disable asks in place (`ConfirmButton`, no browser `window.confirm`); Enable and "New invite link" are real buttons; role and status shown as translated words (were raw lower-case codes); the confirm question wraps inside the row.
- `components/ui/button.tsx`: ghost variant gets `bg-transparent` (found on screen: with no background of its own, the base `button` fill showed through, white on white).
- `lib/format.ts` `formatDay`: calendar dates (payment day, expense date, invoice date, batch made/expiry) in the company's date format, without time-zone shifting; used on the money screens, record pages and Batches (they printed raw `2026-11-01`).
- Arabic for the new strings (machine draft).

**Database / System Result.** None. Frontend only. Local sample build (port 5199, stopped): Stock adjustments, Settings > General, Users (disable confirm opened and cancelled; nothing saved, sample data only).

**Safety Status.** `npm run typecheck`, `npm test` (shared 30, api 117, web 42) and `vite build` pass. Not seen: Batches, Alerts, Profit overview (not in the sample build); Ben to check after deploy.

## 2026-11-03 (round 2) — UI polish round 2: button variants finally render, 72 buttons on the kit, empty states, aligned widths (not deployed)

**Objective.** Round 2 of [`documentation/plans/2026-11-03-ui-polish-plan.md`](../plans/2026-11-03-ui-polish-plan.md): one component kit. Found the root cause of "every button looks the same": `styles.css` styled the `button` element outside any CSS layer, and unlayered CSS beats Tailwind's layered utilities, so every `Button` was drawn as a filled primary button whatever its variant (outline, ghost, destructive).

**Actions Completed.**
- `theme.css`: layer order declared (`theme, base, components, utilities`). `styles.css`: the plain element styles (button, input, select, textarea, label, fieldset) moved into `@layer base`; component variants now win. Verified in the built CSS (base before utilities) and on screen.
- 72 plain raw `<button>`s converted to `Button` across 16 files by a script: no class → default; `className="secondary"` → `variant="outline"`; a missing `type` became `type="submit"` so forms behave exactly as before. 15 specialised buttons (menu items, sort headers, icon and link buttons) left as they were.
- Empty lists: a quiet tray icon and more room above the sentence (`.empty`).
- Forms and notices use the page's full width, so their edges line up with the tables under them.

**Database / System Result.** None. Frontend only. Checked in the local sample build (`vite --mode demo`, port 5199, stopped afterwards): Stock on hand, Stock transfers, a request page, Stock adjustments, in dark and light mode.

**Safety Status.** `npm run typecheck`, `npm test` (shared 30, api 117, web 42) and `vite build` pass. Not seen: sign-in, create-company and the org picker (converted, not in the sample build), Finance, Alerts and Settings with live data. Ben to check after deploy, especially that every form still submits.

## 2026-11-03 (latest) — UI polish round 1: plain intros, page rhythm, loading skeletons, honest Home cards, stock status (not deployed)

**Objective.** Ben: "the ERP feels vibecoded, I need to polish everything". Looked at the live screens (read-only) and measured the web code; plan with the causes and four rounds: [`documentation/plans/2026-11-03-ui-polish-plan.md`](../plans/2026-11-03-ui-polish-plan.md). This entry is round 1.

**Actions Completed.**
- Copy: 18 page intros rewritten to one plain line each (English and Arabic, in the screens and `lib/i18nScreens.ts`; the old keys were replaced on the same lines). Profit overview's "management view, no VAT, not an accounts report" moved into its footnote.
- `components/Loading.tsx` (new): skeleton while loading, error notice on failure; replaces the plain "Loading…" on 38 screens (script; two table-cell placeholders left).
- `styles.css`: page header rhythm (title, one line, gap), form cards up to 880 px with a wrapping field grid, notices aligned, skeleton styles.
- `core/OwnerHome.tsx`: no colour or "All good" status on cards with no data behind them; the profit card explains itself when nothing is recorded; real singular/plural wording instead of "batch(es)" and "item(s)".
- `inventory/Inventory.tsx` Stock on hand: a status column against the reorder level (Low / OK / —) replaces the always-full stock bar; the "Units on hand" total (kilograms + litres + pieces) replaced by "Low on stock" (links to Reorder levels) and the count of items held for requests; quantities formatted (thousands, at most three decimals); "in {n} warehouses" translated.

**Database / System Result.** None. Frontend only. Browser: live pages opened read-only; the local sample build (`vite --mode demo`, port 5199) for the after-look, stopped afterwards.

**Safety Status.** `npm run typecheck`, `npm test` (shared 30, api 117, web 42) and `vite build` pass. Seen after the change in the sample build: Stock on hand (LTR and RTL), New request. Not seen: Home cards with live data, Profit overview, the money screens; Ben to check after deploy. Arabic for the new lines is a machine draft.

## 2026-11-03 (late night) — Usability pass from a live look: tour language once, lists before forms, confirm before void (not deployed)

**Objective.** Ben: the UI is hard to use, and the tour "asks for the language at every step". Looked at the live site in Chrome (read-only, owner, Demo Cosmetics Factory): every tour card carried the English/Arabic buttons; Payments, Expenses and both invoice screens opened with a large form and the list half a screen down; Customer invoices listed every order ("Fully invoiced" hundreds of times) above the invoices; one-click Void sat on every list row next to the now-clickable row; request numbers wrapped ("OUT-" / "0372"); one request row could list 20+ items; record titles (PAY-0443) were body-text size; New request defaulted to the Packaging store.

**Actions Completed.**
- `modules/help/TourHost.tsx`: the language switch shows on the first tour step only.
- `components/FormToggle.tsx` (new): `FormToggle` keeps a create form closed behind a button; `ConfirmButton` asks in place ("Void this payment? It can not be undone." / "Yes, void it" / Cancel), no browser dialog.
- `finance/Finance.tsx`: Expenses and Payments open with the list; the form opens from "Record an expense" / "Record a payment". Payments accepts `?for=c:<id>|s:<id>|e:<id>`: the form opens on that invoice or expense with what is still owed filled in ("Record a payment →" on a record's page links there). The per-row Void buttons are gone; voiding is on the record's page, behind the confirm.
- `sales/CustomerInvoices.tsx`, `purchasing/SupplierInvoices.tsx`: form behind a button; invoices first; the billing table shows only orders still to invoice / bill, with "Show all N orders". Customer invoice page: Void behind the confirm. `finance/FinanceRecords.tsx`: same for payments and expenses.
- `inventory/Inventory.tsx`: requests list shows the first three items and "+ N more" (full list in search, CSV and the hover title). New request defaults to the last warehouse used here, else the one most requests come from, else the one holding the most stock (units counted the packaging store first).
- `styles.css`: `h1.mono` full heading size; record numbers in tables do not wrap; styles for the form toggle, confirm row and section heads.
- Arabic for the new strings in `lib/i18nScreens.ts` (machine draft).

**Database / System Result.** None. Frontend only; no SQL, data or settings. In the browser only the tour was started and closed and pages were opened; the RTL check set `dir` on the page in memory, not the saved language. Nothing deployed.

**Safety Status.** `npm run typecheck`, `npm test` (shared 30, api 117, web 42) and `vite build` pass. The changed screens were not seen after the change: Ben to check after deploy. Not addressed yet: list caps without pagination (audit #10), "(sample)" names and user full names (data).

## 2026-11-03 (night) — Every invoice, payment and expense opens; clickable rows; tour always offered; audit fixes #3, #11, #12 (not deployed)

**Objective.** Ben: clicking an invoice or a payment did nothing, and the tour could not be found. Customer invoices, supplier invoices, payments and expenses had no page of their own, and every table row turned grey on hover, so a row looked clickable and was not. The tour button only appeared where an owner had switched it on (off in the demo companies).

**Actions Completed.**
- New pages (frontend only, built from the list endpoints the screens already call): `/sales/invoices/:id` (`modules/sales/CustomerInvoices.tsx`), `/purchasing/invoices/:id` (`modules/purchasing/SupplierInvoices.tsx`), `/finance/payments/:id` and `/finance/expenses/:id` (`modules/finance/FinanceRecords.tsx`). Each shows the key facts, the lines (invoices), links to the order / invoice / expense it belongs to, the payments against it with paid and still owed (finance permission only), a Void button where the list already had one (same database function), and the record's History from the audit log. Routes in `modules/registry.tsx`.
- `components/ClickRow.tsx`: a table row that opens its record when clicked anywhere, except on a link, button or input inside it, or while selecting text; Ctrl/Cmd-click opens a new tab. The number in the row stays a real link (keyboard, screen reader, middle-click). Used on invoices, payments, expenses, billing tables; `ListView` gained `rowHref`, used on sales orders, purchase orders, stock requests, transfers and tasks.
- `styles.css`: only rows that open something get the hover and pointer (`tr.row-link`); new `.facts` block for record pages; on phones (≤720 px) controls and in-table links are at least 44 px tall (audit #11).
- `components/RecordHistory.tsx` + `apps/api/src/modules/core/routes.ts`: `GET /v1/core/audit` accepts an optional `entity=<uuid>` filter (read-only, same permission and RLS). The page also filters on its side, so it works with the old API, limited to the latest 200 entries.
- Tour: `modules/help/TourHost.tsx` no longer reads `org.showTour`; "Take the tour" shows on Home, Guide and Getting started in every company. The switch was removed from Settings > General (`GeneralSettings.tsx`); the API route and column stay, unused.
- Audit #3: New request defaults to the warehouse last requested from (this browser, this company), else the one holding the most available stock (`inventory/Inventory.tsx`).
- Audit #12: icons for the Purchasing, Sales, Finance, Alerts, Guide and Getting-started tiles (`core/Home.tsx`). Audit #11: `scope="col"` on `ListView` headers.
- Arabic: page labels in `lib/i18nNav.ts`, new strings in `lib/i18nScreens.ts` (machine draft, needs a native read). Back arrows in Arabic now point right ("→ أوامر البيع") and "go on" arrows left: the English "←" at the start of a right-to-left line pointed into the text.

**Database / System Result.** None. No SQL, no data, no settings. Nothing deployed. The `entity` filter needs a Worker deploy to take effect; the pages work without it.

**Safety Status.** `npm run typecheck` and `npm test` pass at the root (shared 30, api 117, web 42); `vite build` succeeds. Not seen in a browser: Ben to check the URLs in the hand-off on desktop, a phone and in Arabic. Detail pages find the record in the list endpoint (newest 200 invoices, 250 supplier invoices, 300 payments and expenses); an older record shows "not found" until a by-id endpoint is added. Still Ben's decisions: OUT-0372, e-invoicing on in the demo company, "(sample)" names, full names for users (audit #7), empty transfers.

## 2026-11-03 (evening) — UI audit of the live demo path, and four low-risk fixes (not deployed)

**Objective.** Audit the demo path in a browser (read-only, signed in as the owner) before a management demo, and fix the low-risk findings. Report: [`documentation/plans/2026-11-04-ui-audit.md`](../plans/2026-11-04-ui-audit.md). Merged by hand, uncommitted, with the Arabic work below.

**Actions Completed.**
- `apps/api/src/modules/inventory/routes.ts`: the ledger response now includes `requestNumber` (the request's own number, via the existing foreign key to `inv_requests`). The web page showed a chopped UUID.
- `apps/web/src/modules/inventory/Inventory.tsx`, `lib/demoInventory.ts`: ledger "Request" column shows `requestNumber`; falls back to the demo format or "Request" if an older API does not send it.
- `apps/web/src/modules/trade/common.tsx`: `Pill` no longer forces Title Case on finished labels ("34 days", "Solid history", "Expired 14 days ago").
- `apps/web/src/modules/core/settings/AuditLog.tsx`: "Who" shows the person's name (email only for people who are no longer listed); "Action" shows a readable form, the raw key stays in the tooltip and the CSV.
- Audit finding #9 (the two contradictory Arabic-coverage texts) was fixed by the Arabic work instead.

**Database / System Result.** None. No SQL, no data, no settings changed. Nothing deployed.

**Safety Status.** See the checks run after the merge in the hand-off message. Needs a deploy of both the Worker and Pages before the live ledger shows the number. **Not changed, Ben's decisions:** the leftover cancelled request OUT-0372 ("Browser check by Claude"), e-invoicing switched on in the demo company, "(sample)" in customer and supplier names, no transfers in the demo company, and people showing as email prefixes (set a full name on each user: `core_org_people` already prefers `full_name`). `components/LanguageChooser.tsx` still says "other screens stay in English for now", which is out of date now that most screens are translated.

## 2026-11-04 (early) — Arabic for every screen (machine draft), re-runnable translation tooling, not deployed

**Objective.** Make the whole app readable in Arabic before the demo review, with a way to rerun the work when other chats change screens.

**Actions Completed.**
- `scripts/i18n-extract.mjs` (measures untranslated text; `--missing` checks every `tr()`/`trf()` key has Arabic) and `scripts/i18n-wrap.mjs` (wraps English text in `tr()`; `--check` exits 1 if anything is unwrapped). Both use `rolldown/parseAst` and are safe to rerun.
- 34 screens wrapped (inventory, finance, tasks, alerts, owner home, settings, sales, purchasing, messaging, shared components). Sentences with values rewritten as whole-sentence templates (`trf('… {name} …')`) so Arabic word order works; singular/plural split into separate templates.
- `apps/web/src/lib/i18nScreens.ts`: 657 Arabic drafts, merged into the dictionary. Global `tr()`/`trf()` helpers; the page remounts when the language changes.
- Review material: `documentation/reviews/arabic-review-sheet.md`, `documentation/reference/arabic-glossary.md`. Test `i18nScreens.test.ts` checks placeholders and bold markers survive.
- Stale "menus only so far" wording in Settings and the create-company form updated.

**Database / System Result.** None. Web code only.

**Safety Status.** Machine draft: a native speaker must review it. Not browser-checked in Arabic (needs Ben's go-ahead to use Chrome). `npm run typecheck` and `npm test` pass. Uncommitted in the worktree; not deployed. The UI-audit chat may edit the same screens: afterwards run `node scripts/i18n-wrap.mjs --write` then `node scripts/i18n-extract.mjs --missing` and translate whatever new text appears.

## 2026-11-03 (final night) — Language selection finalized, per-company tour switch, Arabic navigation, sign-in checks

**Objective.** Ben: language selection and finishing it is crucial before the demo; the tour must be switchable in any company and stay in the old empty one for now; the demo passwords are in `.temp/demo-credentials.txt` (explicitly authorized).

**Actions Completed.**
- **Sign-in checks (live API, real logins, passwords loaded into the process environment only and never printed):** `scripts/real-login-check.mjs` as chris (owner) 15/15, joseph (manager/admin) 15/15, grant (requester/member) 17/17, all PASS, same as the recorded baseline. The concurrency check was **not** run: it needs separate `CONC_*` logins that are not in that file, and it writes data.
- **Language, finished:** first-run prompt shown once to a signed-in person never asked (English, Arabic, or *use my company's default*); any answer ends the question for good, even the default (a saved account row with no language means *asked*; session field `userLanguageAsked`); the account wins over the browser (five explicit cases in `planAccountSync`, unit tested); the prompt waits until the account has been checked so it cannot flash; the tutorial and the tour use the same rule. Chooser copy corrected to say what is translated.
- **Arabic navigation:** home greeting and date (Arabic names, Western digits), suite headings, app names and descriptions, sidebar and top-bar labels, browser-tab title, role names, Guide app list (`lib/i18nNav.ts`, machine draft). A test reads the registry source and fails if any app, description, page label or suite has no Arabic text. Company names are isolated with `bdi` so a trailing period does not flip in right-to-left lines.
- **Tour per company:** `sql/039_org_tour.sql` (`core_set_tour`, owner/admin, audited, off by default), `POST /v1/core/org/tour`, `showTour` in the session, a Settings > General switch; the Take the tour button shows only where it is on. **Applied to the live project; test 033 passed live; switched ON for Test Organization only** (audited, 'Guided tour switched on'). Cosmetics and Demo Trading are off.
- **UI review against ui-ux-pro-max (from .github/prompts):** dialogs now take and hold keyboard focus (verified: focus lands on the first control and seven Tabs never leave the dialog), have an accessible label, decorative arrows and check marks are hidden from screen readers, tour buttons and the close control are 40px tall.

**Database / System Result.** Production: `core_set_tour` added; one company setting changed (tour on for Test Organization), audited. Typecheck clean; tests: shared 31, API 117 + 7 skipped, web 39.

**Safety Status.** Not committed, not deployed. The first-run prompt, account saving and the tour switch are verified in the local demo build (with temporary patches that were reverted and diff-checked) and by SQL and unit tests, **not yet end to end on the live site**: the live Worker and Pages do not have these changes until Ben pushes. After the push, the first sign-in of chris, joseph and grant in any company will show the language prompt once. Arabic still needs a native reviewer. A GitKraken hook crashed once (out of memory) during the browser work; it was not caused by this repo.

## 2026-11-03 (late night) — Guided tour version 1 (English and Arabic), not deployed

**Objective.** Ben: the tutorial and Arabic were not good enough; build the real walk-through.

**Actions Completed.** `apps/web/src/modules/help/TourHost.tsx` (overlay mounted once in the Shell), `tourSteps.ts` (7 steps on real screens, who sees which, tooltip placement), `tourContent.ts` (English and Arabic words, Arabic is a machine draft and says so on the first step). Buttons on Getting started and the Guide. Rules: language is asked first if none is chosen; steps the role or modules do not allow are skipped; a missing element is skipped after 4 s; Escape and leaving by hand end it; language switch keeps the step; a hardened locator keeps re-resolving the highlighted element every 250 ms.

**Checked in Chrome (local demo build, no temporary patch needed).** Chooser first; Arabic tour end to end across 5 steps (the demo owner has no finance module so the home step is skipped); English tour left-to-right; mid-tour language switch keeps step 2 and flips direction; Escape closes; clicking a link ends it; a 390px frame has every tooltip inside the overlay with 8px margin and no sideways overflow. Bugs found and fixed in the process: the highlight measured the old page during a screen change (now re-resolved continuously); the tour closed itself by comparing the browser URL with React's lagging path (now both use React's); the tooltip covered the highlighted form (side placement added); the tooltip spilled 6 px off the edge on a phone because a right-to-left page puts the scrollbar on the left (now positioned relative to the overlay's own box).

**Database / System Result.** None. Typecheck clean; web tests 32 (new: step visibility per role, tooltip placement incl. both edges and phone width, language parity).

**Safety Status.** Uncommitted, not deployed. Checked only in the local demo build, not in a signed-in real company; the home step (needs the finance module) and the audit and alerts steps were not seen on real data. Arabic needs a native reviewer. Progress is per browser, not on the account.

## 2026-11-03 (late) — Tutorial moved from the cosmetics company to the empty company; live verification findings

**Objective.** Ben: the demo runs on the live (cosmetics) company, so the tutorial belongs in the empty company, not there.

**Actions Completed.** Tutorial switched OFF for Demo Cosmetics Factory and ON for Test Organization (0 warehouses, 0 items, Ben is owner), each through the audited function `core_set_tutorial` as ben@prime-ad.com, 14:31 UTC; both audit rows verified. The company name was NOT touched: Ben confirmed he renamed it himself (`organization.updated` by chris's login, 14:23 UTC, removed "(sample data)").

**Verification findings recorded the same evening (read-only).** Ten SQL tests (001, 002, 013, 016, 018, 022, 029, 030, 031, 032) passed rolled back on the live project. The sign-in scripts (real-login-check, concurrency-check) were not run: no credentials in the environment, and the concurrency check writes data. Ben's pushes today deployed Worker `e1cb6fc6-ee48-41a4-bf14-8add5bc29b5d` and Pages `36072048` (commit c5dc432, 14:21 UTC); yesterday's last deploy was Worker `d529d2d7-9df7-4bb1-ae7e-bfd3cf35a1d5` / Pages `118a85a7` (7b9fff5). The ETA module is on for 0 companies.

**Safety Status.** Two `settings` flags changed, both audited; nothing else.

## 2026-11-03 (night) — Migrations 036 and 037 applied to the live project

**Objective.** Ben: "run them" (the e-invoicing tax data and credit/debit notes migrations, held until after the demo until he said otherwise).

**Actions Completed.** `sql/036_einvoicing_tax_data.sql` then `sql/037_credit_debit_notes.sql` applied by CLI to project ggoerp; tests 030 and 031 run on the live project afterwards.

**Database / System Result.** Both tests ended "ALL TESTS PASSED (everything rolled back)". Verified: 8 new business tables all with row level security, 56 ETA tax subtypes, 143 unit codes, 0 tax profiles, 0 notes, helper function not callable by users. The `einvoicing` module is switched on for **0** organizations, so nothing changes for any user, and the app code that uses these tables is not deployed. Earlier entries that say "not applied" for 036/037 are superseded by this one.

**Safety Status.** Schema only; no data changed. Production mode of ETA is still refused in the database (`PRODUCTION_NOT_READY`).

## 2026-11-03 (evening) — Language saved on the account, tutorial on for the cosmetics company, browser check

**Objective.** Ben: save the language on the account, make the tutorial active for the cosmetics company too, and check it in Chrome.

**Actions Completed.**
- `sql/038_user_language.sql` + `sql/tests/032_user_language.sql`: table `user_preferences` (one row per person, no org_id on purpose because a person's language is the same in every company they belong to; own-row read only; no direct writes) and function `core_set_my_language(text)` (null clears). Dry run: ALL TESTS PASSED; weakening the read policy made the test fail. **Then applied by CLI the same evening on Ben's instruction ("run sql via cli"):** verification rls_on true, users_can_set true, anon_can_set false; test 032 passed on the live project; table empty, one policy.
- API: `/v1/core/session` returns `userLanguage` (tolerates the table not existing yet, so deploying before the migration cannot break sign-in); `POST /v1/core/me/language`. Web: the i18n provider saves every change to the account, applies the account language on sign-in (the account wins), and saves a browser-only choice once (`planAccountSync`, unit tested). Demo build unaffected.
- **Production data change, Ben's explicit request:** the tutorial was switched ON for "Demo Cosmetics Factory (sample data)" (id d16359e1-c8f1-408d-9ae2-1db8244ab9d4) by calling the audited function `core_set_tutorial(true)` as ben@prime-ad.com (admin there). Verified: `show_tutorial` is true and the audit log has "Getting-started tutorial shown" by that user. Nothing else changed. Until the new web build is deployed, that company shows the old English tutorial.
- Chrome check (local demo build with a temporary patch to show the tutorial, reverted and diff-checked): the chooser appears first in both languages; choosing Arabic gives right-to-left layout, Arabic text, left-pointing arrows, a right-to-left progress bar; the Guide follows; the choice survives a reload; English switches back to left-to-right; a 390px-wide frame in Arabic has no sideways overflow. Two defects found and fixed: the active language in the switch was not distinguishable in dark mode (now a check mark, bold and a ring); a Latin company name scrambled the Arabic intro (now isolated). The window-resize tool did not narrow the viewport, so the phone check used a 390px frame.

**Database / System Result.** Production: one setting changed (tutorial on for the cosmetics company), audited. No migration applied. Typecheck clean; tests: shared 31, API 114 + 7 skipped, web 16.

**Safety Status.** Not committed, not deployed. The account-saving path is covered by SQL, API-source and pure-logic tests but has **not been exercised end to end** (needs 038 applied and the new web build deployed). The signed-in tutorial page itself was checked only in the local demo build, not on erp-live.pages.dev. Arabic remains a machine draft.
## 2026-11-03 — Language selection first, then a tutorial in the chosen language (tour planned, not built)

**Objective.** Ben: "arabic is still not implemented, so implement language selection first then allow that selection to influence the tutorial after the person chooses", and plan the in-app tour.

**Actions Completed.**
- `apps/web/src/components/LanguageChooser.tsx`: a bilingual first-choice card (English / العربية, each with its own `lang` and `dir`) and a small `LanguageSwitch`. The Getting-started tutorial now shows only the chooser until the person picks (`personalLang` null), then shows the tutorial in that language and direction; the switch on the tutorial and the Guide changes it without leaving the page.
- `apps/web/src/modules/help/helpContent.ts`: all words of the tutorial (9 steps, 7-item checklist, not-ready list) and the Guide (5 steps, 6-item not-ready list) in English and Arabic; `components/Rich.tsx` renders `**bold**` safely (no HTML injected). `GettingStarted.tsx` and `Guide.tsx` read from it; the step arrow flips in Arabic. The "Arabic covers menus only" statements were corrected (menus, tutorial and Guide). The Arabic is a **machine draft** and says so on screen.
- `documentation/plans/IN_APP_TOUR_PLAN.md`: the tour plan (language-first, 7 steps on real screens, permission-based skipping, open questions). **The tour itself is not built.**
- `apps/web` gained a `test` script and 13 content-parity tests (same structure in both languages, no empty text, Arabic really Arabic, same bold and numbers per step).

**Database / System Result.** None. No API or SQL change. Web typecheck clean, production build succeeds, tests: shared 31, API 110 (+7 skipped), web 13.

**Safety Status.** Not deployed, not committed, **not checked in a browser** (needs Ben's OK to use Chrome). The tutorial exists only in companies that signed up through the app, and the sample and demo companies are unchanged unless a person picks Arabic on the Guide, so the Wednesday demo is not affected. The language choice is per browser (not on the account). Arabic needs a native reviewer before customers rely on it.
## 2026-11-03 (later) — One EtaTransport, simulated by default, production refused (Ben's instruction)

**Objective.** Put every ETA call behind one `EtaTransport` interface with a Simulated and a Real implementation; per-company mode
(simulated | preprod | production, default simulated); one contract suite for both; simulated sends carry a visible badge and store no
real ETA reference; production refused without credentials and a real signer.

**Actions Completed.** `apps/api/src/lib/eta/transport.ts` (interface, `EtaError`, `transportFor()` with refusals), `simulated.ts` (scenarios
accepted, rejected, pending; duplicate window; cancel and reject rules; no network), `client.ts` now implements the interface (`simulated: false`).
Shared `mode.ts` (modes, `SIMULATED_BADGE`, `toSendRecord`, `recordIsConsistent`), `Signer.kind` (`real` | `stub`). `sql/036` changed before it was
ever applied: `tax_profiles.eta_environment` became `eta_mode` (default `simulated`), `eta_save_profile(..., p_mode)` refuses `production`
(`PRODUCTION_NOT_READY`) and audits mode changes; test 030 rewritten for it. API: profile route takes `mode`; reason code mapped.
Tests: `eta_transport.contract.ts` + `eta_transport.test.ts` (31 tests: 24 run, 7 PreProd skipped without credentials).

**Database / System Result.** 036 + 037 + tests 030 and 031 dry-run again (rolled back): ALL TESTS PASSED; live project unchanged (0 new
tables or functions). Typecheck clean; shared 31, API 110 passed + 7 skipped. A deliberate break of the simulator failed the contract.

**Safety Status.** Still nothing deployed, committed or applied. The real client and the PreProd contract have never run against ETA. No screen
shows the badge yet. Production cannot be selected in the database or built by the factory without credentials and a real signer.

## 2026-11-03 — E-invoicing slice A, document builder, ETA client (overnight; not deployed, SQL not applied)

**Objective.** Ben asked to "work on ETA through the night". Do everything that needs neither ETA access nor a business decision:
the tax master data, credit and debit notes with approval, the document builder and canonical serializer tested against ETA's own sample
files, and an ETA HTTP client with a fake network. Not deployed before the Wednesday demo (4 Nov).

**Actions Completed.**
- `packages/shared/src/modules/einvoicing/`: exact decimal arithmetic (bigint, 5 places, half away from zero, default 2 places), JSON that
  keeps number text, ETA canonical serializer and SHA-256 digest, line and document calculation, document builder (invoice, credit,
  debit; v1.0 and v0.9), mapping from our invoice (EGP only), pre-flight validation and credit-note rules, signer interface with a test stub.
  **Verified against the SDK's own files:** the serializer output equals `one-doc-serialized.json.txt` byte for byte, and the arithmetic
  reproduces both lines and all totals of `one-doc.json`.
- `apps/api/src/lib/eta/client.ts`: login with an hour-long token cache and one shared login for concurrent callers, submit (exact body
  text), get submission, cancel, reject, document type; typed errors with correlation id, `Retry-After`, retryable flag; one retry after a
  401, never a loop. `callback.ts`: ApiKey check (constant time) and notification parsing (`deliveryId`, batch cap). Tests use a fake
  network; **nothing was sent to ETA**.
- `sql/036_einvoicing_tax_data.sql` (tax profile, branches, per-company tax rates, ETA subtype and unit code tables, customer tax identity,
  item ETA codes and default rate; module `einvoicing` off by default; audit rows; select-only grants; column grant on `inv_items`) and
  `sql/037_credit_debit_notes.sql` (notes, lines, append-only approvals; a credit note can never credit more than was invoiced; a
  requester cannot approve their own note in the function and in a check constraint; an invoice with open or approved notes cannot be
  voided). Tests `sql/tests/030` and `031`.
- API: `/v1/einvoicing/*` and `/v1/sales/notes*` routes (all behind a permission), reason codes `IN_USE`, `NOTE_EXCEEDS_INVOICE`,
  `ACTIVE_NOTES` and a 409 for unique-index duplicates in `apps/api/src/lib/rpc.ts`; module `einvoicing` and permissions
  `einvoicing.settings.{read,manage}`, `sales.notes.{read,create,approve}` in `packages/shared/src/modules.ts`.
- Found by comparing with ETA's working examples and recorded in the plan (section 14): working-example field casing (`internalID`,
  `branchID`, `"I"`, `signatureType`), 2-decimal rounding in the sample, the confirmed VAT/total equations, the duplicate `ST` unit code.

**Database / System Result.** Dry runs against the live project (project `ggoerp`) in one rolled-back transaction per migration:
036 plus test 030, and 037 plus test 031, each ended with "ALL TESTS PASSED (everything rolled back)". The first 036 run failed (the
new item columns were not readable by signed-in users because `inv_items` uses column grants, sql/023); fixed with an explicit column
grant and a test, then passed. Two deliberate breakages of 037 (remove the cumulative credit cap; remove the self-approval check) were
each caught by the test. After the dry runs a read-only query confirmed none of the new tables or columns exists on the live project.
**The migrations are NOT applied.** Local checks: `npm run typecheck` clean; shared tests 31 passed (including the SDK vector, which
needs `ETA_SDK_DIR` pointing at the offline SDK `files/files` folder, otherwise that one test is skipped); API tests 86 passed.

**Safety Status.** Nothing deployed, nothing committed, no secret written anywhere (the ETA client takes credentials in memory only;
no storage exists yet). No ETA call was made. Approved credit notes do **not** yet reduce owed, receivables or revenue figures. No screens
exist. The client, the callback parser and the builder are checked against the documentation and SDK samples, not against ETA. Applying
036 and 037 needs Ben's yes (dry run first, then `supabase db query --linked -f`, then tests 030 and 031 on the live project).
The worktree's `node_modules` is a set of junctions into the main checkout's `node_modules` (with `@erp/*` pointing at the worktree);
remove it before deleting the worktree (it is not tracked).

## 2026-11-02 — Colleague audit: findings verified, migration 034 applied, docs reconciled, CI job written

**Objective.** Ben asked me to act on a colleague's repository audit (`colluege audit.md`). Every finding was checked against the repository and the live Supabase project before any change; the result is in `documentation/reviews/2026-11-02-colleague-audit-response.md`.

**Actions Completed.**
- Finding 01 (a cold-storage item could be transferred to a warehouse with no storage condition): **confirmed** by extending `sql/tests/029` (new cases S6c to S6e) and running it against the live project, where it failed at S6c. Fixed in `sql/034_inventory_hardening.sql`: an item that needs a condition may only go to a warehouse with exactly that condition; an item with no condition may go anywhere. Dry run first (migration plus full test in one rolled-back transaction): ALL TESTS PASSED. Ben approved; applied.
- Same migration revokes the default execute grant on the trigger function `inv_stock_moves_cost()` (from `sql/023`), which the anonymous role could execute (found by a read-only grants query).
- Finding 02 (stale documentation): confirmed and reconciled: root `README.md` status, `sql/README.md` migration register 001 to 034 plus a seed section, `sql/tests/README.md` (013 to 015, 024 to 029 added), `documentation/plans/checklist.md` status overview and the stale inventory and transfers blocks, the transfers plan status.
- Finding 03 (no SQL tests in CI): confirmed. Ben approved a job; written as a **separate** non-blocking workflow `.github/workflows/sql-tests.yml` and `scripts/ci-sql-tests.sh` (throwaway local Supabase in the runner; the script refuses any database that is not localhost; no secrets). **Untested**: no Docker here and no YAML parser; bash syntax checked only. The deploy workflow was not touched.
- Finding 04 (transfers not deployed): **outdated**; they were deployed and checked on the live app earlier the same day. Docs updated.
- Read-only security check on the live project: 126 security-definer functions; no internal helper callable by signed-in users; every public table has row-level security; no write grants to the app roles; after 034 no security-definer function is callable by the anonymous role. `/v1/core/people` is organization-scoped (it shows an email's local part when a member has no name set).

**Database / System Result.** `sql/034_inventory_hardening.sql` applied to project ggoerp by CLI (Ben's yes). Verified by query: users can still run `inv_submit_transfer` (true); anon cannot execute `inv_stock_moves_cost()` (false). Tests run on the live project afterwards, all ending in "ALL TESTS PASSED (everything rolled back)": 029 (transfers, with the new cases), 002 (inventory approval), 019 (item cost), 022 (batches and storage). No data changed.

**Safety Status.** `npm run typecheck` and `npm test` were not re-run (no TypeScript changed). The CI workflow has not run on GitHub; expect small fixes on its first run. Batch receipts (`sql/026`) kept their older storage rule at that point; Ben then approved all the fixes in the response document and the same rule was applied to batch receipts the same day (next bullet block). Nothing committed.

**Later the same day (Ben: "i approve all fixes, apply sql via cli").** `sql/035_batch_receipt_storage_rule.sql`: `inv_receive_batch` now refuses a conditioned item received into a warehouse with no condition (replaces 026's deliberate "no check when either side is unset"); only the manual Receive-a-batch function is affected (purchase-order receiving and the seed do not use the check). Test 022 gained case S2a2, which **failed on the live database before 035** and passed after. Dry run first (035 plus tests 022, 029 and 002, each in one rolled-back transaction: all passed; live function unchanged afterwards), then applied by CLI to project ggoerp and verified by query (new rule present; users can still execute the function). Tests run on the live project after applying, all ending in "ALL TESTS PASSED (everything rolled back)": 022, 029, 002, 013 (purchasing receiving), 019 (item cost). Not changed on purpose: `/v1/core/people` still falls back to the part of an email before the `@` when a member has no name (changing it would make the sample users appear as generic names in the demo; set display names first, then change it); a second Supabase project for staging cannot be created without Ben.

## 2026-11-02 — Cosmetics-org browser check (Ben's account added to the sample organization)

**Objective.** Ben: give his account access to the cosmetics organization, redo the browser check there, and recheck the "what I need" checklist. The Chrome session is signed in as `ben@prime-ad.com`, who was owner of Test Organization only.

**Actions Completed.**
- Added `ben@prime-ad.com` to `demo-cosmetics` as **admin**, directly in the database (insert into `memberships`, inviter Chris), with a `member.added` audit entry stating it was done by Claude Code at Ben's request. Reversible by disabling that membership.
- Browser check (Claude, with Ben's approval, in his signed-in Chrome, cosmetics org, as admin): owner home, Profit overview, Stock forecast, Stock ledger, Stock requests, Customer invoices, Supplier invoices, Purchase orders, Expenses, Audit log, Alerts, Batches and expiry, Stock transfers and the Guide all loaded with real data, no error messages, every API call 200 in under a second. Then one action cycle: created request OUT-0372 (1 x Lip balm, Finished goods), tried to approve it as its creator (refused: "You cannot approve your own request"), cancelled it (reserved stock released; history shows submitted and cancelled). That request stays in the sample data as a cancelled record; no stock moved.
- Worker log: the tail captured the whole session (1,264 events): 1,263 ok, 1 canceled (a `GET /v1/core/session` aborted at 193 ms by a page navigation), 0 exceptions, no server errors (the only 4xx were my own unauthenticated tests, the expected 403 self-approval refusal, and root 404s). The tail was then stopped.
- `documentation/operations/WHAT_I_NEED_FROM_YOU.md` rechecked and updated (owner-home check done; failed-to-fetch still not reproduced with the new evidence; October loss and 70 percent overdue noted; two UI notes; membership and test request noted; tail stopped).

**Database / System Result.** One membership row and one audit row added; one cancelled request (OUT-0372) and its two audit rows. The `inv_counters` request counter moved to 372. The "month is losing money" alert had fired at 21:10 from the October data (in-app message to owners).

**Safety Status.** No code changed. Nothing committed or deployed. Not reproduced: "failed to fetch". Seen but not changed: on New request the warehouse dropdown defaults to "Cold room"; the ledger and request lists are capped at 500 and 200 rows and the ledger says "500 of 500".

## 2026-11-02 — Audit fixes, sample-data top-up (seed 006), ETA e-invoicing plan (draft)

**Objective.** Ben: fix what the endpoint and button audit found; the sample company had no data for October or November; and, from the 2 Nov meeting notes, start the Egyptian Tax Authority (ETA) e-invoicing work stream with step 1, plan only.

**Actions Completed.**
- `documentation/reviews/2026-11-02-endpoint-and-button-audit.md`: all 140 web calls match one of 109 API routes (0 would 404); 54 of 57 awaited API actions catch and show errors; 2 had no catch; the Worker log (385 requests) showed no errors.
- Code fixes (made in a worktree, verified, copied to main, worktree removed): `GeneralSettings.tsx` (tutorial show/hide now catches and shows errors), `Messaging.tsx` ("Mark all read" now catches and shows errors), `Guide.tsx` (the "New stock request" link is shown only to people who may create requests).
- `sql/seed/006_cosmetics_topup.sql` (new, insert-only, sample organization `demo-cosmetics` only): `sql/seed/004` writes the 12 months before the month it was run in (30 Oct), so Oct 2026 onward had nothing and the owner home read "Made 0". 006 adds every missing month up to today with the same patterns as 004, nothing dated in the future, rerun-safe through `demo.topup` audit records; the near-expiry lots are set aside while older sales are issued (the ledger issues soonest-expiry first) and restored. A dry run (rolled back) first found two defects (the stored sales-order counter was behind the real highest number; a type error in my summary line), both fixed, then Ben approved and it was applied through the CLI to project ggoerp.
- `documentation/plans/ETA_EINVOICING_PLAN.md` (draft, plan only, nothing built): official SDK facts (login, submission, status, callbacks, cancel and reject, invoice/credit/debit v1.0 rules, tax and unit codes, EGS codes, signing and canonical serialization) labelled official, not found or unverified; what already fits our design and what is new; data model; signing options for a cloud app; slice order with sizes calibrated on this project's pace; what Ben must provide; the SDK pages not read.
- Offline snapshot of the ETA SDK at `documentation/reference/eta-sdk/2026-11-02/` (Ben asked for it): 202 pages as markdown and exact HTML, 25 linked files (code tables as JSON, two Postman collections and environments, sample documents with serialized and signed forms, the PreProd root CA certificate), `MANIFEST.json` with sizes and SHA-256, 5.4 MB in total, taken politely (about 3 requests a second or fewer, `robots.txt` allows it). Two e-receipt toolkit programs (`.zip`) were deliberately not downloaded. Nothing was installed or run; the certificate is untrusted data and is not to be installed. Licence terms were not found, so the folder should not be committed to a shared repository without a decision. First downloader hung on one file (no timeout) and was stopped; the finishing script used a timeout.
- The plan was re-checked against the offline copy: the invoice calculation equations (`document-validation-rules`), the standard headers (`correlationId`, rate-limit headers) and error format, signatures (one, or two with an intermediary), optional vs required fields (fields marked `Optional:` are optional, the rest required; my first reading wrongly said "not stated"), and the serialization sample (document property order, exact number text, casing differences such as `I` / `internalID` / version 0.9 to test on PreProd).
- `documentation/operations/COSMETICS_WALKTHROUGH.md`: a 15-minute chapter-by-chapter walkthrough for the sample cosmetics factory (cast Chris, Joseph, Grant; home cards, approval and self-approval refusal, expiry lots, forecast, alerts, transfers, audit log), using facts read from the sample data on 2 Nov (open requests OUT-0340 to 0343, the near-expiry, expired and quarantined lots, the most overdue customers, top sellers, supplier concentration, the October loss). Numbers are marked as of 2 Nov; the screen is the truth. An in-app guided tour is not built yet.

**Database / System Result.** Seed 006 applied (insert-only, demo data). Result by query: Oct 2026 now has 25 invoices (revenue 1,126,202 EGP, cost of goods 592,231, expenses 586,052, so about -52,000 net, a small loss after Jul to Sep profits), Nov 2026 so far has the rent expense only (nothing else is due by 2 Nov); stock balances equal the ledger; 0 rows below zero or under their reservation; special lots restored (NEAR-A, B, C available, HOLD-Q quarantined); 2 `demo.topup` audit records. No schema change.

**Safety Status.** Typecheck clean; `npm test` 5 shared + 39 API passed; web build succeeds. The three fixes are not browser-checked and not deployed. "Failed to fetch" on the cosmetics org is still undiagnosed (API health and CORS fine; a Worker log tail was left running). Nothing committed. No secrets were used or written; the ETA plan contains no credentials.

## 2026-11-02 — Tile subtitles and the Guide page (from the 2 Nov management meeting notes)

**Objective.** Ben relayed the meeting notes: every tile needs a title, and people need a guide to navigate. No new features, no commits.

**Actions Completed.**
- Audit of tiles. Owner home cards: all 6 had titles; 5 lacked a one-line subtitle and/or the period their figure covers (money, decisions, stock and expiry, best sellers, suppliers). Profit overview: 3 of 4 figure tiles and the chart lacked the period. Alerts: the Rules section had no subtitle. The apps grid on the home page already has a name and description on every tile.
- `apps/web/src/modules/core/OwnerHome.tsx`: the Card now takes a subtitle and a period; all 6 cards show a bold title, a plain-words subtitle and the period (for example "last 12 months", "last 90 days", "as of <date>, looking 90 days ahead"). Periods match what `sql/027` computes. `finance/ProfitOverview.tsx`: periods added to the Sales, Costs and Months in the red tiles and the chart heading. `alerts/Alerts.tsx`: subtitle under Rules.
- New "Guide" app (`apps/web/src/modules/help/Guide.tsx`, registered in `registry.tsx`, module `core`, shown in every organization including the sample company and demo mode): where each app is (live list of the apps the person can open), the five-step path (home, request, approve, audit log, forecast), and what is not ready yet. Reuses the tutorial's `Step` component (now exported). Added the missing `.plain-list` style to `styles.css` (also used by the transfers in-transit panel).

**Database / System Result.** None. No API or database change.

**Safety Status.** `npm run typecheck` clean; `npm test` 5 shared + 39 API passed; web production build succeeds (checked in a worktree, then copied into main; worktree removed). Not browser-checked and not deployed. Ben to check in a browser: owner home (cosmetics org, as the owner) for card text wrapping on narrow screens, Profit overview tile labels, Alerts, and the new Guide page (home grid tile and /guide) in the sample company and as a non-owner. Nothing committed.

## 2026-11-02 — Inventory transfers built (not yet run): migration 033, test 029, API, screens

**Objective.** Ben approved [`INVENTORY_TRANSFERS_PLAN.md`](../plans/INVENTORY_TRANSFERS_PLAN.md) with the recommended answers and asked for it to be built: stock transfers between warehouses with approval, in-transit state, batches and expiry carried across.

**Actions Completed.**
- `sql/033_inventory_transfers.sql`: tables `inv_transfers`, `inv_transfer_lines`, `inv_transfer_approvals`, `inv_transfer_batches` (RLS, select-only grants, append-only approvals and batch records, status-order guard); new ledger kinds `transfer_out` and `transfer_in` with `inv_stock_moves.transfer_id`; the ledger guard now refuses a `transfer_out` unless the transfer is approved and a `transfer_in` unless it is dispatched; functions `inv_submit_transfer`, `inv_decide_transfer` (approval policy, no self-approval, trusted-channel rule as in sql/025), `inv_dispatch_transfer`, `inv_receive_transfer`, `inv_cancel_transfer`, `inv_in_transit`; audit rows written in the same transaction; manager and requester notifications through the outbox. Numbering `TR-000001`.
- `sql/tests/029_inventory_transfers.sql` (always rolls back): approval gate on the ledger, self-approval, member/viewer rights, in-transit, reserve and release, batches and expiry across, quarantined batch not moved, storage-condition refusal, another organization sees nothing, append-only records, two-approval policy, audit chain.
- API: `/v1/inventory/transfers` (list, detail, create, approve, reject, dispatch, receive, cancel) and `/in-transit`, each behind its own permission and calling one database function; error codes for `STORAGE_MISMATCH` and `BATCH_STOCK_SHORT`. Shared: permission keys `inventory.transfers.read|create|approve|dispatch|receive` (members get create, dispatch and receive, never approve). Tests added: shared permissions (1) and API (12).
- Web: Stock transfers list with an "in transit now" panel, New transfer, Transfer detail (progress steps, batches moved, approvals, history, buttons by permission); demo data and rules for the demo build.
- Differences from the plan are listed in section 12 of the plan (org settings not built yet; separate approve/reject routes; hand-written validation).

**Database / System Result.** Ben ran `sql/033_inventory_transfers.sql` in Supabase (project `ggoerp`): the verification query returned true for submit, decide, dispatch, receive, cancel and in_transit, and false for both helpers, as expected. The first run of `sql/tests/029_inventory_transfers.sql` failed at S3b because the test was wrong (it expected 0 reserved, but the admin's own open transfer T2 correctly holds 1); the test was corrected and Claude re-ran it with `supabase db query --linked -f` (Ben asked for this; the test always rolls back): **ALL TESTS PASSED (everything rolled back)**. A read-only check afterwards found no leftover test organizations, users or transfers.

**Safety Status.** Root `npm run typecheck` clean; `npm test` 5 shared + 39 API passed (was 4 + 27); web production build succeeds. Not browser-tested yet (demo build available: `npm run dev:demo -w apps/web`). Nothing committed or deployed. The database part is live in Supabase (migration 033 applied); the API and web are not deployed, so the new screens are not available to users yet. Next: deploy the API and web, then a manual browser check.

## 2026-11-02 — Language choice in Settings; inventory transfers plan (draft)

**Objective.** Ben: add a language change in Settings without forcing a language, and start working on the plan from the Odoo review.

**Actions Completed.**
- `apps/web/src/lib/i18n.tsx`, `components/Shell.tsx`, `modules/core/settings/GeneralSettings.tsx`, `components/CreateCompany.tsx`: new "My language" setting in Settings > General (Company default / English / Arabic), stored in the browser. The company language is now only a default: the Shell no longer overrides a person's own choice. The company setting is relabelled "Default language for the company". Four Arabic strings added for the new labels; the Arabic remains a machine draft covering the menus only. No API or database change.
- `documentation/plans/INVENTORY_TRANSFERS_PLAN.md` (draft, needs Ben's approval): approval-gated transfers between warehouses with an in-transit state, batch and expiry carried across, storage-condition check, proposed `sql/033`, SQL test 029, routes and permission keys. Entry added to `documentation/plans/checklist.md`. No code or migration written for it.
- Edits were made in a temporary worktree (Ben approved it for this task) and copied into the main checkout; the worktree was then removed.
- `documentation/research/odoo/ODOO_REVIEW.md` rewritten as a short plain-language summary for management (bottom line, tests we ran, gaps, build order, decisions needed); the previous detailed version is kept as `ODOO_REVIEW_DETAIL.md`. Workbook renamed by Ben to `Trial_capture_workbook_v13.xlsx`; references in the review files and `P1_GAP.md` updated.

**Database / System Result.** None.

**Safety Status.** `npm run typecheck` clean; `npm test` 4 shared + 27 API passed. Browser-tested by Claude with Ben's approval on the local demo build (`vite --mode demo`, port 5199, sample data, no sign-in; server stopped afterwards): Settings > General showed the new "My language" card; choosing Arabic flipped the layout to right-to-left with Arabic menu labels and the rest in English; the choice survived a reload; choosing Company default restored English left-to-right and cleared the stored value. Not covered: the real company-language-from-API path (demo mode skips it), so check once against the real app that a company set to Arabic still lets a person pick English. Nothing committed or deployed.

## 2026-11-02 — UI audit (code-level), Odoo P1 gap, cleanup

**Objective.** Ben: start the UI audit without his list; make Odoo the main benchmark and report which Odoo features are missing from our P1 set; tidy the repo without deleting anything.

**Actions Completed.**
- `documentation/reviews/2026-11-02-ui-audit.md`: 8 findings ranked by severity, what was checked clean, what could not be checked without a browser. No code changed.
- `documentation/research/odoo/` created from the template; `P1_GAP.md` compares the 64-row Odoo list in `Trial_capture_workbook_v12.xlsx` (tab 9) with the code. 7 of 23 P1 rows are Partial, plus 2 P1 rows the workbook marks Built that are only partial (locations, credit notes) and 1 P2 row (CSV) that is partly built; research index updated.
- Cleanup: moved `security-audit-fixes.patch`, `gpreport.html`, `test.ps1`, `test dump.md` into `_to_delete/` (nothing deleted). The old v10 workbook was already gone; v12 untouched. `reply.md`, `migration.md`, `skills-lock.json`, `temp\` left alone as asked. Branch `worktree-security-audit-fixes` was already merged into `main` (no commits ahead, working tree clean): worktree unregistered and the local branch deleted with `git branch -d`. The folder `.claude/worktrees/security-audit-fixes` still exists on disk (git: "Directory not empty", probably `node_modules`); the remote branch `origin/worktree-security-audit-fixes` is untouched.

- Odoo trial (`wazowski.odoo.com`, Odoo 20.0 Enterprise; Chrome use approved by Ben): read the app list, Inventory/Purchase/Sales/Accounting/general settings, Approvals categories, Apps catalog, user roles. Filled `Trial_capture_workbook_v12.xlsx` tab 9 (63 of 66 rows, 2 new rows added: import with test step, physical-inventory apply step) and tab 8 (14 of 16). Still blank: putaway rules, vendor portal, mobile responsive (tab 9). Pricing recorded as *claimed* with a source conflict.
- Tests run in the trial (fake data only): delivery `WH/OUT/00001` (10 x Shampoo) validated in one click by the same user who created it, no approval step; RFQ confirmed to purchase order `P00001` (100 x Glycerin, 6,270.00 LE incl. 14% VAT); receipt `WH/IN/00001` validated on the phone by Ben. Ben's barcode count cut Aloe vera extract from 435 to 1 (a -434 adjustment) with no approval shown. Approvals app works once approvers are set (request admin to Benny accepted) but is a standalone request form, not linked to stock.
- Import files built from `sql/seed/004_cosmetics_factory_demo.sql`, column headings taken from the exported samples in `documentation/research/odoo/templates/`: `documentation/research/odoo/import/` (products, product categories, vendors, customers, opening stock + README). Imported by Ben; categories had to be imported first (no "All" parent in this Odoo).
- Lagged chat's final message recovered from the session transcript to `documentation/reviews/2026-11-02-odoo-chat-output.md`. Worktrees removed at Ben's request (`.claude/worktrees/` deleted; git shows it as a tracked deletion).
- `documentation/research/odoo/ODOO_REVIEW.md`: Odoo strengths seen in the trial, where we are ahead, what we already have, recommended build order.
- Workbook backup (before edits) was kept only in the temporary job folder, not in the repo.

**Database / System Result.** None.

**Safety Status.** `npm run typecheck` clean; `npm test` 4 shared + 27 API passed; web production build succeeds (one 642 kB chunk). Not browser-tested. Nothing committed. Odoo behaviour in `P1_GAP.md` is claimed (general knowledge), not yet seen in the trial. `npm run build -w apps/web` fails in this environment because npm runs scripts in Windows PowerShell 5.1, which has no `&&`; Vite was run directly instead.

## 2026-10-30 — Sign-up flow, getting-started tutorial, Add warehouse: migration 032, test 028; end-of-day checks

**Objective.** Ben: "build the sign-up flow next, tutorial page as well"; the tutorial only in new empty companies, never the sample company; then (leaving for the weekend) check, clean up and write the day report.

**Actions Completed.**
- `sql/032_signup.sql`: `core_create_organization(name, language, currency, time zone)` callable by a signed-in user whose email is CONFIRMED; at most 3 companies owned per person; validated inputs; unique slug from the name; the caller becomes owner (through `bootstrap_organization`), every shipped app is switched on, language is stored, the company gets `settings.show_tutorial = true`, audited ("organization.created" and "organization.setup"). `core_set_tutorial(bool)` (owner/admin, audited, no-op silent). Test `028_signup` PASSES (rolled back): company, owner, 7 apps on, language/currency/time zone, flag, 2 audit entries, slug `nile-cosmetics`; same name gets a different slug; a 4th company refused; unconfirmed email, anonymous, 1-letter name, language `fr`, 2-letter currency and unknown time zone refused; symbol-only name gets a usable slug; no other company touched; owner can turn the flag off, a member cannot, another company keeps its flag.
- Web: sign-in card has "Create an account" (email + password twice, confirmation link, same message whether or not the address exists); a signed-in person with no company and no invitations lands on "Set up your company" (name, language, currency, time zone); the picker also has "Create a new company". New app "Getting started" (`modules/help/GettingStarted.tsx`) with a live checklist and 9 steps matching screens that exist, and an honest "what is not ready yet" list; it is visible only when the session carries `showTutorial` (never in the sample companies or the demo build); owners can hide it and bring it back in Settings > General. `GET /v1/core/session` now carries `showTutorial`; `POST /v1/core/org/tutorial`.
- Gap fixed: there was no way to create a warehouse in the UI. Inventory > Stock on hand has "Add warehouse" (permission `inventory.warehouses.manage`) and a first-warehouse prompt; "Add item" shows only once a warehouse exists.

**Database / System Result.** 032 applied via CLI. Final checks: typecheck clean; `npm test` 4 + 27; web build passed; SQL tests 28 of 28; live login checks owner 15 / manager 15 / requester 17; concurrency 12 of 12; live spot checks listed in `DAY_REPORT_2026-10-30.md`. CI for commit `db4d4bf` succeeded; live Worker `5bc38345-127c-4d3e-a8ef-edd9296a6e4f` (previous `3ad4c027-99c1-4b79-ba7d-e26b6f936e70`).

**Safety Status.** The sign-up screens and the tutorial are deployed but were NOT exercised in a browser or end to end; whether the Supabase project requires email confirmation and delivers the email is not verified; no real accounts or companies were created in the live project. UI audit with the `.agents` skills not started. Nothing deleted; leftover clutter listed in the day report for Ben to decide.
## 2026-10-30 — Company-wide language setting (sql/031, test 027) and an overflow fix on the money cards

**Objective.** Ben: "build the language setting next and do a UI check for overflow" (screenshot of the Profit overview: the Sales and Costs figures ran past their boxes).

**Actions Completed.**
- Language: ONE setting for the whole organization (`organizations.settings.language`, `en` or `ar`, missing = English), replacing the per-browser switch. `sql/031_org_language.sql`: `core_set_language(text)` (owner/admin, audited with before and after, a no-op change writes nothing, other settings kept). Session (`/v1/core/session`) and `/v1/core/org` now carry `language`; `POST /v1/core/org/language`; Settings > General has the selector; the app shell applies the organization's language and text direction (`lang`, `dir=rtl`) whenever the session loads; the user-menu language toggle was removed. The sample-data demo build stays English with its own RTL preview button. Not built: the choice at SIGN-UP (no sign-up flow exists; organizations are created by `bootstrap_organization`, which defaults to English), a translation of the screens beyond the 11 menu strings in `lib/i18n.tsx` (machine draft, needs a native speaker), and right-to-left visual checks.
- Overflow: the four boxes on the Profit overview sat in a fixed 4-column grid and showed money with decimals at a fixed 30px. Now: the grid is `auto-fit` (as many columns as fit, each at least 17rem), cards have `min-w-0` and `break-words`, headline figures use a size that scales with the window (`clamp`) and show whole currency units (new `lib/money.ts` `formatWhole`, e.g. "EGP 14,974,593"); exact amounts stay in the tables. The same treatment was applied to the owner home cards (21rem minimum, scaled figures, whole units) and the button group in the Alerts table now wraps.

**Database / System Result.** 031 applied via CLI. Test `027_org_language` PASSES (rolled back): default English, owner sets Arabic and the date format setting survives, audit entry with before `en` and after `ar`, same-language change writes no second entry, `fr` and null refused, a member refused and the language unchanged, another organization unaffected and its owner cannot reach ours, anonymous refused, audit chain intact. Typecheck clean; `npm test` 4 + 27.

**Safety Status.** NOT deployed and NOT seen in a browser: I cannot measure layout without one, so the overflow fixes are defensive and unverified at Ben's window width. Other screens were swept by search only (no fixed pixel widths found; tables already scroll inside `.table-wrap`).
## 2026-10-30 — Forecast alert rule (alerts app): migration 030, test 026

**Objective.** Ben: "build the forecast alert rule next".

**Actions Completed.** `sql/030_forecast_alert_rule.sql`: new rule kind `forecast_stockout` ("tell these people when an item has N days of stock left or fewer", for every item or one item). The forecast (sql/029) is split into an internal `inv__forecast_for(org)` (no caller check, not callable by users) so the evaluator, which runs without a signed-in user, can use it; `inv_forecast()` is now a wrapper with the same guard and ordering. The rule table constraints were replaced to accept the new kind; `alr_run` was replaced (same digest, repeat and recipient logic). The message states days left, run-out date, available stock, daily use, whether the history is solid or THIN (a guess), and the suggested order. Items with no use in 90 days are ignored. API `KINDS` and the Alerts page know the new kind. Demo: seed 005 gained a starter rule "Will run out within 45 days (forecast)" for Purchasing.

**Database / System Result.** 030 applied via CLI. Test `026_forecast_alert_rule` PASSES (rolled back): nearly-out F-2 (about 4 days) fires once to the Purchasing team member, F-1 (84 days) and F-3 (no use) do not; text carries "day(s) left", "using 1.5", "suggested order" and "THIN history"; no repeat inside the interval; an item-specific rule (100 days) fires for F-1 only and does not report F-2; a rule without a number of days is refused; a member cannot create it; the public forecast still returns the soonest item first; the older low-stock rule kind still works after the evaluator was replaced; audit chain intact. Tests 024 and 025 re-run PASS. Live demo: the first run queued 1 alert (Joseph: "Running out soon: F-SUN", 35 days).

**Safety Status.** NOT deployed (the job and screen change are not live), not seen in a browser. Not built: a rule that reacts to confidence only, quiet hours, WhatsApp delivery of alerts.
## 2026-10-30 — Stock forecast (slice P): migration 029, test 025, API, page

**Objective.** "Keep working": next unblocked item of the plan order (the WhatsApp slice needs Ben's Meta account first).

**Actions Completed.** `sql/029_stock_forecast.sql`: `inv_forecast()` (any member may read; no costs): usage per day = recency-weighted average of issues in the last 90 days (latest 30 days 50%, previous 30 days 30%, the 30 before 20%); days of cover = (on hand - reserved) / usage; run-out date; lead time = average order-to-receipt days of the item's purchases in the last 12 months (7 if never bought); on order = open purchase orders; suggested order = usage x (lead + 7 safety days) - available - on order, never below zero; confidence `good` (8+ issues over 60+ days), `thin` (a guess) or `none` (no use in 90 days, no forecast shown). API `GET /v1/inventory/forecast` (permission `inventory.forecast.read`, granted to members like other read keys). Web: Inventory > Stock forecast with three headline counts, a table sorted by days left, a "Solid history / Thin: a guess" label per item, and the method written under the table. Not built: seasonality, a forecast-based alert rule kind, per-warehouse forecast.

**Database / System Result.** 029 applied via CLI. Test `025_stock_forecast` is a known-answer test and PASSES (rolled back): 200 received, 60 issued in the latest 30 days and 30 in the 30 before = 1.3 per day, 110 available, 84 days of cover, run-out date today + 84, thin confidence with 3 issues, lead 7; a nearly-out item gets a reorder suggestion; an unused item gets no forecast; a long-history item is good; purchases set lead time 10 and subtract 4 already on order; ordering soonest first with unused items last; isolation; anonymous refused. Run on the cosmetics demo: sunscreen soonest (35 days, 96/day), most finished goods 60-140 days, packaging items thin. Because the demo history ends last month, the latest 30 days are empty and daily rates are underestimated (the demo overstates cover). Typecheck clean; web build passed.

**Safety Status.** NOT deployed, not seen in a browser. Full test run after this entry: see the summary given to Ben.
## 2026-10-30 — Profit overview page (the big version of the "making or losing money" card)

**Objective.** Ben: clicking the card on the owner home page should open a bigger dashboard.

**Actions Completed.** New page Finance > Profit overview (`apps/web/src/modules/finance/ProfitOverview.tsx`, route `/finance/overview`, permission `finance.reports.view`): four headline boxes (result for 12 months with margin, sales, costs split into cost of goods and running costs, months in the red with best and weakest month), a large 12-month chart of sales against total costs with money axis and a green/red result dot per month, and a month-by-month table with margin and a 12-month total row. The home card now links there (it linked to Payments). Uses the existing `GET /v1/finance/insights` numbers: no new database or API change.

**Database / System Result.** None. Typecheck clean; web build passed.

**Safety Status.** NOT deployed and NOT seen in a browser (layout, chart scaling and dark-mode colours are unverified). The current month shows "nothing recorded" until it has activity.
## 2026-10-30 — Alerts and triggers app (slice T): migration 028, test 024, API, screen, starter rules for the demo

**Objective.** Ben: "start working on the alert and triggers app" (`OWNER_INSIGHTS_PLAN.md` section 6).

**Actions Completed.**
- `sql/028_alert_rules.sql`: module `alerts`; teams (`alr_teams`, `alr_team_members`; Purchasing / Warehouse / Management on demand), rules (`alr_rules`), recipients (a team, everyone with a role, or a person), firing memory (`alr_firings`); owner/admin-only read, no direct writes. Rule kinds: `stock_below` (a number, or each item's reorder level), `expiry_within` (days; also already-expired), `receivable_overdue` (days after the invoice date), `profit_negative` (this month so far). Functions (owner/admin, audited): create/retire/enable rule, set recipients, create team, set team members, "send me a test". `alr_run` (service role, called by the five-minute job): a subject is told again only after the repeat interval, or sooner if clearly worse and an hour has passed (stock fell further, unpaid amount grew, loss deepened). Design change made during testing: everything due in one run goes to each person as ONE digest message (up to 10 lines plus "and N more"), never one per item or invoice. Message keys include the recipient (a test caught a bug where the second recipient was silently dropped). Rules only make messages; they cannot change stock or approve. `core_enable_all_modules` now includes `alerts`.
- API `apps/api/src/modules/alerts/routes.ts` (`/v1/alerts/...`); the job `apps/api/src/jobs/outbox.ts` calls `alr_run` (a failure is logged and does not stop delivery); the Messages screen shows "Alert rules fired". Web: Alerts > Rules and teams (`apps/web/src/modules/alerts/Alerts.tsx`): rule table with turn on/off, send me a test, remove; add-a-rule form; team members as tick boxes.
- `sql/seed/005_cosmetics_alert_rules.sql`: teams (Joseph in Purchasing, Grant in Warehouse, Chris in Management) and 4 starter rules for the cosmetics demo organization. Alerts switched on for the cosmetics demo organization and Test Organization (no rules in Test).

**Database / System Result.** 028 applied via CLI. Test `024_alert_rules` ALL TESTS PASSED (rolled back): fires only for the right people (team, role, person), no repeat inside the interval, repeats after it, new items fire on their own and two items make one digest, worse after an hour re-fires but not within it, expiry window, overdue invoice then paid clears it, losing month, disabled and retired rules silent, test message only to the caller, members cannot manage or read rules, bad input refused, isolation, module off = nothing runs, audit chain. All 24 SQL test files pass; typecheck clean; `npm test` 4 + 27; web build passed. First live evaluation on the cosmetics demo (run by hand as the database role): 78 subjects due, 4 digest messages queued: Chris "Overdue invoices: 72", Joseph and Chris "Expiring stock: 3 batches", Joseph "Low stock: 3 items".

**Safety Status.** NOT deployed: the screen, routes and job hook are not live (the job still runs the old code), so the 4 queued messages stay pending until a deploy runs the delivery. Not seen in a browser. Not built: WhatsApp/voice delivery of alerts (in-app only), supplier-dependency and forecast-stock-out rule kinds (need the forecast slice), quiet hours, per-user channel preference. "Overdue" uses the invoice date plus the rule's days, not payment terms.
## 2026-10-30 — Login checks re-run after the merge; "Try to issue without approval" button removed

**Objective.** Ben: re-run the login checks and keep `email to grant.md` current; "the try to issue without approval is a stupid button for demo purposes".

**Actions Completed.** `scripts/real-login-check.mjs` against the live deployment: owner 15, manager 15, requester 17 checks passed. `scripts/concurrency-check.mjs` first failed only because the throwaway users now also belong to Test Organization and the script took their first membership (FORBIDDEN); it now looks up the `concurrency-check` organization by slug and passes 12 of 12. `email to grant.md` (Ben's own text) updated with the check results, light/dark, and honest not-verified lines; its "23 test files pass" claim verified: 23 of 23. Removed the "Try to issue without approval" button on the stock request screen: "Issue stock" now shows only when the request is approved (the database still refuses an issue without approval, test 002 and the live-login checks cover that). The two demo-only hints on that screen (yellow bar) now show only in the demo build.

**Database / System Result.** No database change. Typecheck clean; web build passed.

**Safety Status.** The button removal is NOT deployed and not seen in a browser. `scripts/concurrency-check.mjs` edit is uncommitted.
## 2026-10-30 — Memberships moved to the cosmetics demo organization (Ben's instruction)

**Objective.** Ben could not see the dummy data: his accounts were only in the (empty) Test Organization. Instruction: `ben.arthur.wiz` at the same level as grant, `ben@prime-ad.com` stays owner of the empty org, the four gmail accounts move to the filled demo organization.

**Actions Completed.** Added `ben.arthur.wiz@gmail.com` to "Demo Cosmetics Factory (sample data)" as member. Disabled (not deleted, reversible by clearing `disabled_at`) the Test Organization memberships of chris, joseph, grant and ben.arthur.wiz. `ben@prime-ad.com` unchanged: owner of Test Organization only. chris, joseph and grant also still belong to "Demo Trading Co." (the older demo), which I left alone because it was not mentioned.

**Database / System Result.** Verified by query, one line per membership: ben.arthur.wiz: cosmetics member ENABLED, Test disabled; ben@prime-ad.com: Test owner ENABLED; chris: cosmetics owner + Demo Trading owner ENABLED, Test disabled; grant: cosmetics member + Demo Trading member ENABLED, Test disabled; joseph: cosmetics admin + Demo Trading admin ENABLED, Test disabled. Audit chain of the cosmetics organization: 0 broken.

**Safety Status.** No rows deleted. Nothing deployed (data only). Not checked in a browser.
## 2026-10-30 — Audit branch merged into main, deployed with wrangler

**Objective.** Ben: "merge branches and deploy, I need to sync up branches".

**Actions Completed.** Staged `git merge --no-commit` of `worktree-security-audit-fixes` into main (3 documentation conflicts resolved by keeping both sides); Ben committed it (`914f3a4`). Typecheck clean, `npm test` 4 + 27, SQL tests 001-023 pass. Deployed from the merged tree: Worker `erp-api` f541974e-848e-4083-b549-5ca29e48a845 (previous 1bea1ab5-d707-40b3-86ad-cdb6ff2e435c, before that 4df4569e-37b3-4d06-a137-9ae80eaeeb64); Pages `erp-live` deployment db57c526.

**Database / System Result.** No database change. Live API as owner in the cosmetics demo organization: insights, expiry, identities, people, sales invoices all 200; the same insights route as a member: 403. Live site sends the CSP header.

**Safety Status.** Screens not opened in a browser (not verified); real-login, concurrency and invite-path checks not re-run after the merge; WhatsApp not tested end to end. Report for the chat: `REPLY_TO_CLAUDE_CHAT.md`.
## 2026-10-30 — Security audit 025 applied; cosmetics demo data; owner home page (027); phone binding page; seed flooded the outbox (fixed)

**Objective.** Ben: "run 025, then do the order you proposed, add demo data for the factory, add home page, apply sql".

**Actions Completed.**
- `sql/025_security_audit_fixes.sql` (from the audit worktree) applied with the CLI; `sql/tests/021_security_audit_fixes.sql` PASS; tests 001-021 re-run PASS right after. The API/web side of the audit (member functions, `_headers`, CSP) is still on that branch and NOT deployed; the old API keeps working against the new database. Not done: real-login and invite-path checks.
- `sql/seed/004_cosmetics_factory_demo.sql`: invented cosmetics factory "Demo Cosmetics Factory (sample data)" (45 items: 21 raw materials, 12 packaging, 12 finished goods; 12 suppliers and 10 customers all marked "(sample)"; storage conditions Ambient / Cold room; ~300 sales orders over 12 months with approvals, issues, invoices and payments; monthly purchase orders with batches, supplier invoices and payments; monthly expenses; today: near-expiry, expired and quarantined lots, 4 open requests, 3 items under reorder level). Written by direct inserts with back-dated times, so history rows have NO individual audit entries (one summary row). No WhatsApp delivery is faked (all approvals channel `app`). Manufacturing does not exist, so raw/packaging are issued to production in monthly lump sums: profit is approximate. First load was too small (revenue 2.7M vs expenses 7.3M EGP a year), so volumes were scaled 6x; the first org was renamed `demo-cosmetics-v1-superseded`, soft-deleted with memberships disabled (cannot be deleted: append-only audit).
- `sql/027_owner_insights.sql`: `insights_home()` (owner/admin only): 12-month revenue, cost of goods, expenses, net; owed to me and overdue; I owe; stock value; items low; expiry buckets; decisions waiting; best sellers; supplier dependence. Test `023_owner_insights` is a known-answer test (net 1200 from revenue 2500, cost 1000, expenses 300) and PASSES. API `GET /v1/finance/insights`; web `OwnerHome.tsx` shown above the app tiles for people with `finance.reports.view`.
- Phone binding: `/v1/messaging/identities` routes and the Messaging > Connect WhatsApp page over `sql/008`. Not testable end to end until WhatsApp is set up.

**Incident (my bug).** The seed's direct inserts fired the `inv_requests_notify` trigger for ~600 historical requests: 1,337 "needs your approval" messages queued in the outbox, 46 sent / 27 in flight into the hidden v1 organization (invisible: org hidden, memberships disabled), and SQL tests 003 and 004 failed because their message was no longer within the claim batch. Fix: all pending messages in the two demo organizations were set to `cancelled` (status change only; 6 legitimate ones for still-open requests kept); the seed now disables that trigger while loading and re-enables it before the 4 open requests. Nothing was deleted.

**Database / System Result.** After the fix all 22 SQL tests in the main tree pass (001-023 incl. 023 owner insights); audit test 021 passed earlier the same day. Seed re-run on the existing organization does nothing (verified).

**Safety Status.** Nothing deployed. Not exercised in a browser or against the live API: Owner home, Finance, Batches, Customer invoices, Connect WhatsApp. The demo numbers (11 of 12 months profitable, November a loss, about 6% net) come from the seed's own rules, not real data.
## 2026-10-30 — Batches, expiry and storage conditions: migration 026, test 022, API, page; .env from the linked project

**Objective.** Slice B of `OWNER_INSIGHTS_PLAN.md` (expiry triggers need batches with expiry dates; boss asked for storage options). Also: Ben asked to pull `.env` values from the cloud.

**Actions Completed.**
- `.env` (git-ignored): added the PUBLIC `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the linked project plus `APP_ENV` and `ALLOWED_ORIGINS` (local). The secret key was NOT pulled; Ben adds `SUPABASE_SECRET_KEY` himself if needed locally.
- `sql/026_batches_expiry_storage.sql` (26, because 025 belongs to the security-audit branch): `inv_storage_conditions` (organization data: name and temperature range), warehouse and item storage condition, `inv_items.tracks_batches`, `inv_batches`, `inv_batch_balances`, append-only `inv_batch_moves`. A trigger on the stock ledger mirrors every move of a tracked item into batches: receipts go to the named batch (else UNBATCHED), issues and negative adjustments are taken first-expiry-first-out from available, non-expired batches (UNBATCHED last) and the whole issue is refused with `BATCH_STOCK_SHORT` if they do not cover it. Functions: `inv_create_storage_condition`, `inv_set_warehouse_storage`, `inv_set_item_batching` (backfills existing stock into UNBATCHED; off refused while batch stock exists), `inv_receive_batch` (storage mismatch, expired and same-batch-different-expiry refused), `inv_set_batch_status` (quarantine / release), `inv_expiry_report(days)`. Untracked items behave exactly as before.
- Bug found by the test and fixed before it counted: a negative balance update was written as an insert-then-conflict, which trips the check constraint first.
- API (`inventory/routes.ts`): storage conditions, warehouse storage, item batching, batches list/receive/status, expiry report; items now return `tracksBatches` and `storageConditionId`. Permissions `inventory.batches.read/receive/manage` (members get receive). Web: Inventory > Batches and expiry (real app only): 90-day expiry list with 30/60/90 colouring, receive a batch, quarantine / release, storage conditions, per-item tracking switch.

**Database / System Result.** 026 applied via CLI. Test `022_batches_expiry_storage` ALL TESTS PASSED (rolled back): backfill, storage mismatch / expired / untracked / changed-expiry refused, FEFO order (SOON before LATE, UNBATCHED last), quarantine blocks and leaves no ledger row behind, expired stock not issued, expiry report windows, untracked item unaffected, ledger total equals batch total, tracking-off refused with stock, no direct writes, append-only moves, isolation, audit chain. All SQL tests 001-022 pass; typecheck clean; `npm test` 4 + 30; web build passed.

**Safety Status.** NOT deployed; screens and routes not exercised live or in a browser. Known limits: approver cannot pick the batch (FEFO is automatic); no transfers between warehouses exist yet; request availability checks still use the item total, so an issue can be refused at the last step if the remaining stock is quarantined or expired; no temperature sensor logs. Expiry NOTIFICATIONS need the trigger slice (T). Audit-branch note: its `sql/025` rewrites decision/adjustment functions; the batch mirror is a ledger trigger so it should still apply (re-run test 022 after 025).
## 2026-10-30 — Security audit hand-off picked up: report written, local env added

**Objective.** Opus handed over the security-audit branch (`worktree-security-audit-fixes`). Ben said yes to writing the missing report and to adding the local env settings.

**Actions Completed.** Wrote `documentation/reviews/2026-10-30-security-audit.md` (reconstructed from the hand-off note and the `sql/025` header; says so; severities not independently verified). There was NO `.env` anywhere in the repo, so I created a git-ignored root `.env` containing only `APP_ENV=development` and `ALLOWED_ORIGINS=http://localhost:5173` (no secrets) and documented both keys in `.env.example`. Compared `sql/025` with my 023/024: no function or table clash (025 rewrites decision/adjustment/member functions; the cost snapshot in 023 is a trigger so it still applies).

**Database / System Result.** None. `sql/025` and `sql/tests/021` are NOT run; waiting for Ben to commit the branch and say "run 025".

**Safety Status.** The local `.env` has no Supabase values, so local sign-in still needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` added by Ben. Nothing deployed.
## 2026-10-30 — Security audit fixes (branch worktree-security-audit-fixes), synced with main

**Objective.** Fix the findings of the 2026-10-30 security audit ([report](../reviews/2026-10-30-security-audit.md)), then bring the branch up to date with main (now `b8aabec`).

**Actions Completed.**
- Synced: audit changes stashed, branch fast-forwarded to main `68c6c31`, changes reapplied; conflicts only in `sql/README.md` and `sql/tests/README.md` (kept main's text plus the 025 / 021 rows). Then fast-forwarded to `b8aabec` (no conflicts). The audit also covered main's new finance module (`sql/024`, `modules/finance/routes.ts`, `Finance.tsx`): no findings.
- Found: `68c6c31` and `b8aabec` committed this worktree folder into main as a gitlink (`.claude/worktrees/security-audit-fixes`). `.gitignore` now ignores `.claude/worktrees/`; the gitlink still has to be untracked on main (`git rm --cached .claude/worktrees/security-audit-fixes`).
- Review report written: `documentation/reviews/2026-10-30-security-audit.md` (findings and what was done about each).
- `sql/025_security_audit_fixes.sql` + `sql/tests/021_security_audit_fixes.sql`: M-1 member list / invite / role / disable / enable as database functions run with the caller's login, rules and audit in the same transaction (API no longer writes these rows with the secret key; `apps/api/src/lib/audit.ts` and `modules/core/members.ts` removed); M-2 an existing account gets a `core_invitations` row it must accept (`OrgPicker.tsx` shows and accepts invitations; `UsersSettings.tsx` lists pending ones); L-2 decision channel other than `app` only when vouched by the webhook function; L-3 a WhatsApp number verified in several orgs works in all; L-4 `msg_claim_due_for_org` so "process now" delivers only the caller's org; L-5 a new sign-in link only for an account that belongs to no other org.
- API: `lib/authAdmin.ts` holds the only Auth admin calls (create invited account, recovery link); on-demand outbox pass is per org and skips the all-org audit check (`jobs/outbox.ts`); timing-safe compare of the WhatsApp verify token (`lib/whatsapp.ts`, `index.ts`); `wrangler.toml` now production values (`APP_ENV=production`, only `https://erp-live.pages.dev` allowed), local values documented in `.dev.vars.example`.
- Web: security headers in `public/_headers` (HSTS, frame denial, permissions policy, content security policy).

**Database / System Result.** None. `sql/025` and test 021 not run; nothing deployed.

**Safety Status.** `npm run typecheck` clean; `npm test` 31/31 (shared 4, api 27, including a new `safeEqual` test and a boundary test that only member routes use the Auth admin helpers); web build passes and the built page has no inline script (CSP-compatible). Not run: `sql/025`, `sql/tests/021`, real-login check, browser. Not done: I-2 (stale comment in `sql/001`; the file is write-protected for agents) and I-3 (Cloudflare rate-limiting rule; dashboard setting). Local API needs `APP_ENV=development` and `ALLOWED_ORIGINS=http://localhost:5173` in the root `.env` now that `wrangler.toml` holds production values. The CSP allows `https://*.supabase.co`; if Supabase moves to a custom domain, add it to `connect-src` in `apps/web/public/_headers`. Deploy order: run `sql/025` before deploying the Worker, or member pages fail until it is run.

## 2026-10-30 — Finance foundation: item cost (023), expenses and payments (024), Finance screens; Ben's answers recorded

**Objective.** Slice F of `OWNER_INSIGHTS_PLAN.md`: cost per item, expenses, payments, so profit and "who owes whom" can be computed. Ben answered `QUESTIONS_FOR_BEN.md` (average cost; manufacturing later; language is an organization-wide setting chosen at sign-up; teams are named groups; EGP changeable; profit without VAT; deny rules yes; no password rotation). Decisions are written into that file and the plan.

**Actions Completed.**
- `sql/023_item_cost.sql`: weighted average cost per item (`inv_items.avg_cost_minor`), append-only `inv_cost_log`, issue/adjust ledger moves remember the average at that moment (`inv_stock_moves.unit_cost_minor`), `pur_receive_order` now updates the average on every purchase receipt, `inv_set_item_cost` (owner/admin, audited) for opening stock and corrections, `inv_item_costs()` (owner/admin) with stock value. Cost columns are hidden from members and viewers with COLUMN grants on `inv_items` and `inv_stock_moves` (future columns on those tables must be granted explicitly).
- `sql/024_finance_expenses_payments.sql`: module `finance`; `fin_categories`, `fin_expenses`, `fin_payments` (RLS: owner/admin read only; no direct writes); functions `fin_create_category`, `fin_record_expense`, `fin_void_expense`, `fin_record_payment` (in = customer invoice; out = supplier invoice or expense; never above what is owed; void documents cannot be paid), `fin_void_payment`; all audited; `core_enable_all_modules` now includes finance.
- Shared: module `finance` with permissions `finance.reports.view` and `finance.entries.manage` (named so members do not get them by default). API: `apps/api/src/modules/finance/routes.ts`. Web: Finance app with Expenses and Payments pages (`apps/web/src/modules/finance/Finance.tsx`), real app only.
- `.claude/settings.json` deny rules (edits to applied migrations 001-024, node_modules, dist, env files, ADRs, research, reviews, .agents, lockfile; reads of .env files). `.claudeignore` extended to 024. Finance switched on for Test Organization (one module, audited).

**Database / System Result.** 023 and 024 applied with the CLI. Tests: `019_item_cost` (average 100 then 150 after a receipt of 10 at 200; issue remembers 150 and a later change does not rewrite it; stock value 2400; members cannot read cost columns or call cost functions; cost log append-only; isolation) and `020_finance_expenses_payments` (expense numbering, member refused and sees nothing, payments 1000 + 1500 fit an invoice of 2500 and 1 more is refused, void frees the amount, supplier invoice and expense payments, expense with a payment cannot be voided, bad combinations refused, isolation, audit chain) both ALL TESTS PASSED. SQL tests 001-020 all pass. Typecheck clean, `npm test` 4 + 30 passed, web build passed.

**Safety Status.** NOT deployed; the Finance API and screens are not live (database is). Not tried in a browser or against the live API. Customer-facing totals use lines rounded per line. Not built yet: balances (owed to me / I owe) as database functions, profit, the owner home page, batches and expiry, triggers, forecast, demo data, organization-wide language setting, manufacturing.
## 2026-10-30 — Owner insights plan written; .claudeignore added

**Objective.** Ben relayed the boss's notes: the owner must see at a glance whether the company is making or losing money; triggers and notification settings; forecast from the org's own history; expiry and storage conditions; demo data for an Egyptian cosmetics factory. "Do not take it lightly."

**Actions Completed.** Wrote `documentation/plans/OWNER_INSIGHTS_PLAN.md` (goal, boss notes mapped, gaps found in the current system, finance formula, owner home page rules, trigger rules and notification settings, forecast method, batches/expiry/storage, manufacturing question, demo data design, data model, permissions, build order, tests, risks, 7 open questions). Added it to `checklist.md`. Added `.claudeignore` at the repo root (build output, secrets/local state, applied migrations 001-022, decided ADRs, research, reviews, other agents' scratch).

**Database / System Result.** None. No code or migration written for this plan; waiting for approval per `agents.md`.

**Safety Status.** Nothing deployed. Key gaps recorded: no item cost (so no profit), no payments, no expenses, no batches/expiry, no rules engine, no manufacturing. `.claudeignore` is a convention file; Claude Code's hard guarantee is permission deny rules in `.claude/settings.json`, not yet set.
## 2026-10-30 — UI components started; coss licence finding; theme tokens replaced

**Objective.** Start porting screens to a component layer in the coss style.

**Finding (licence).** The coss repo (`cosscom/coss`, cloned to `Desktop\coss`, outside this repo) is AGPL-3.0-only; only `sdk`, `mcp`, `cli`, `kloq`, the generated SDKs and the framework drivers are MIT. The component source in `packages/ui` is therefore AGPL. This product is to be sold, so NO coss component code is copied. My earlier `apps/web/src/theme.css` had taken token values from coss's `packages/ui/src/styles/theme.css`; I replaced them with the public shadcn/ui neutral theme (MIT) values. Do not copy from `Desktop\coss` into this repo; if exact coss components are wanted, get written permission or a commercial licence from its authors first.

**Actions Completed.** Added MIT dependencies `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` (Base UI is installed but not used yet). New own-written `apps/web/src/lib/cn.ts`, `components/ui/button.tsx`, `components/ui/badge.tsx`. `Pill` (status chips in Purchasing, Sales and Supplier/Customer invoices) now renders the new Badge; Customer invoices uses the new Button. All other screens still use the old class-based CSS.

**Database / System Result.** None. Typecheck clean, `npm test` 4 + 30 passed, web build passed, Tailwind utilities (rounded-lg, bg-primary, bg-success/10, dark) confirmed in the built CSS. Not looked at in a browser.

**Safety Status.** Not deployed. Remaining port (tables, forms, dialogs, tabs, Base UI parts) is not done.
## 2026-10-30 — Customer invoices (Sales): migration 022, test 018, API, screen

**Objective.** Bill delivered sales orders and show ordered / delivered / invoiced per line with a mismatch flag (`CUSTOMER_INVOICES_PLAN.md`).

**Actions Completed.** `sql/022_customer_invoices.sql`: `sal_invoices`, `sal_invoice_lines` (RLS select-only), `sal_create_invoice` (owner/admin; order must be delivered; invoiced qty never above ordered qty; price copied from the order line; numbers INV-0001...), `sal_void_invoice` (never edit or delete; void frees the quantity); audited. Shared: permissions `sales.invoices.read` and `.manage`, `billingFor` in `packages/shared/src/billing.ts`. API (`apps/api/src/modules/sales/routes.ts`): `GET /v1/sales/invoices`, `GET /v1/sales/orders/:id/billing`, `POST /v1/sales/orders/:id/invoices`, `POST /v1/sales/invoices/:id/void`; order lines now carry their id. Web: Sales > Customer invoices (`CustomerInvoices.tsx`). The plan's two questions were assumed (price from the order line, no PDF); Ben said he answered but the plan file shows no answers.

**Database / System Result.** 022 applied via CLI. Test 018 ALL TESTS PASSED (rolled back): undelivered refused, member refused, price from order line, partial then final invoicing, over-invoicing refused with no stray invoice, void frees quantity, no direct writes, isolation, audit chain. Unit test `apps/api/test/billing.test.ts` (4 cases). Typecheck clean; `npm test` 4 + 30 passed; web build passed; SQL tests 001-018 all pass.

**Safety Status.** Not deployed, so the new routes and screen are not live (the database part is). The screen and API routes were not exercised against the live API or in a browser. The sample-data demo build has no invoices page. Not done: porting screens to real coss components (only the coss tokens and light/dark are in); credit notes, tax, payments, PDF.
## 2026-10-30 — Apps on by default for new organizations: sql/021, test 017

**Objective.** Make "all apps on" repeatable for any organization, not just Test Organization.

**Actions Completed.** `sql/021_enable_all_modules.sql`: `core_enable_all_modules(org)` (service role only) switches on inventory, tasks, messaging, purchasing and sales, audited, repeat is a no-op. Not a trigger (the SQL tests add their own module rows after `bootstrap_organization`). Whatever creates an organization (onboarding, seed script) must call it; no API route creates organizations today. `sql/tests/017_enable_all_modules.sql` added; README rows added.

**Database / System Result.** Applied with the CLI (signed-in users cannot call it). Test 017 ALL TESTS PASSED (rolled back); tests 001-017 all pass.

**Safety Status.** Additive function, no data changed. Not deployed. The module list in the function must be extended when a new app ships.
## 2026-10-30 — All apps on for Test Organization; coss look on Tailwind v4; light/dark toggle

**Objective.** Ben asked to turn apps on by default, make the UI look less improvised using coss ui, and add a light/dark toggle.

**Actions Completed.**
- Cloned `cosscom/coss` to `C:\Users\ben.arthur\Desktop\coss` (outside this repo, reference only; its `packages/ui/src/styles/theme.css` supplied the tokens).
- Added `tailwindcss` and `@tailwindcss/vite` to `apps/web`. `apps/web/src/theme.css` holds the coss colour tokens (light and `.dark`), 0.625rem radius, and loads Tailwind's theme and utilities WITHOUT its reset, so existing screens are not broken. `apps/web/src/styles.css` old colour names now map onto these tokens (the warm paper/green/amber look, dark bar and hazard stripe are gone; light topbar with a hairline border; neutral primary).
- `apps/web/src/lib/theme.tsx`: light, dark or follow the system, remembered in the browser, `dark` class on `<html>`; sun/moon button in the top bar (Shell, so the sample-data build has it too). Two Arabic strings added (machine draft).
- Data: switched on inventory, tasks, messaging, purchasing and sales for Test Organization (CLI, additive, one audit entry per module that was off). Demo and concurrency organizations untouched.

**Database / System Result.** Test Organization modules now: inventory, messaging, purchasing, sales, tasks; audit chain verifies (0 broken). Typecheck clean, `npm test` 4 + 26 passed, web build passed.

**Safety Status.** NOT deployed. Not looked at in a browser by me, so how it looks is not verified. A default-on rule for NEW organizations is not built: SQL tests insert their own module rows after `bootstrap_organization`, so a trigger would break them; needs a decision. Existing screens still use the old class-based CSS, not coss components; porting screens to coss components (Base UI) is the next step.
## 2026-10-30 — Sales gap closed: migration 020 (retry after rejection, no cancel after delivery); Customer Invoices plan

**Objective.** SALES_PLAN said a rejected or cancelled request lets the order retry and an issued one means delivered. `sql/019` allowed neither retry nor protected delivered orders.

**Actions Completed.** `sql/020_sales_retry.sql` replaces `sal_request_stock` (allowed again when the linked request is rejected or cancelled; blocked while live or issued; audit says "retry after ...") and `sal_cancel_order` (refuses a delivered order; only cancels a still-live request). `apps/api/src/modules/sales/routes.ts` shows such an order as `open` again. `sql/tests/016_sales_retry.sql` added. `documentation/plans/CUSTOMER_INVOICES_PLAN.md` proposed (not built). Deleted `codex last turn.md` at Ben's request.

**Database / System Result.** 020 applied to the linked project with the CLI. Test 016 ALL TESTS PASSED (rolled back). Typecheck clean; `npm test` 4 + 26 passed; SQL tests 001-016 all passed.

**Safety Status.** Additive function replacement, no data changed. The API tweak in `routes.ts` is NOT deployed (the Worker `6ed077a4-c091-4ae4-b243-b287cdb0c54d` was deployed before it). Sales stays switched off for Test Organization.
## 2026-10-30 — Manual deploy of Worker and Pages (sales, names, language switch)

**Objective.** Get the latest code live while CI run `41099967978` sat queued.

**Actions Completed.** Typecheck clean, `npm test` (4 shared + 26 API) passed, web build passed. Deployed with wrangler from this machine (same commands and variables as `.github/workflows/ci-deploy.yml`): Worker `erp-api` and Pages `erp-live`.

**Database / System Result.** Worker version `6ed077a4-c091-4ae4-b243-b287cdb0c54d` (previous version: see Cloudflare dashboard, versions list of `erp-api`; the one before the sales code was deployed by CI run `41096417103`). Pages deployment `c06cc1d4` (https://c06cc1d4.erp-live.pages.dev, promoted to https://erp-live.pages.dev). Live check as grant (member): `/v1/core/people` 200, `/v1/purchasing/orders` 200, `/v1/sales/orders` 403 because the Sales module is not switched on for Test Organization (enabled modules there: inventory, messaging, purchasing, tasks). Not opened in a browser.

**Safety Status.** No database change. The queued CI run may later deploy the same code over this; harmless. Sales gap found: SALES_PLAN says an order becomes delivered once its request is issued and can retry after rejection, but `sql/019` only has statuses open, stock_requested, cancelled. Not built yet.
## 2026-10-30 — Sales orders: migration 019 applied (after a syntax fix)

**Objective.** Apply the staged `sql/019_sales_orders.sql` and prove it with test 015.

**Actions Completed.** The first run failed: `sal_create_order` closed an `if` with `end;` instead of `end if;` (Postgres syntax error, nothing was created). Fixed that one token in `sql/019_sales_orders.sql` and re-ran it through the Supabase CLI.

**Database / System Result.** Applied to the linked project: `sal_customers`, `sal_orders`, `sal_order_lines` exist with RLS. `sql/tests/015_sales_orders.sql` reached ALL TESTS PASSED (everything rolled back). Tests 001-014 re-run at the same time, all passed. Note: the Sales code was already pushed (commit b512fdf) and its CI deploy started before this migration existed, so Sales screens would have errored until now.

**Safety Status.** Additive only; no data changed or deleted. The one-token fix to 019 is an uncommitted working-tree change that Ben must commit; the migration file in git still has the bug until then.
## 2026-10-30 — Purchasing & Receiving module: migration 017

**Objective.** Turn the sample purchasing screen into the first real purchasing workflow: suppliers, purchase orders and controlled receipt of goods into warehouse stock.

**Actions Completed.** Added the approved [Purchasing plan](../plans/PURCHASING_PLAN.md), shared module permissions, user-scoped API routes, and registered Purchasing in the real web application. `sql/017_purchasing_core.sql` adds organization-isolated suppliers, orders and lines; all signed-in writes remain closed except audited database functions. `pur_receive_order` locks an ordered purchase order, posts each line with the inventory receipt helper, marks the order received, and appends the purchasing audit event in the same transaction. Added `sql/tests/013_purchasing_receiving.sql` and enabled Purchasing for Test Organization with the audited `core_set_module` function.

**Database / System Result.** Migration 017 was applied to the linked Supabase project. Its verification returned all three purchasing tables with RLS; the direct-write privilege query returned no rows. Test 013 reached its deliberate `ALL TESTS PASSED (everything rolled back)` result, so its setup rows were not retained. Test Organization now has the `purchasing` module enabled; enabling it adds the normal audited module-change event only.

**Safety Status.** The schema change is additive: no existing table or business record was deleted or modified. The proof checks direct writes are refused, receipts happen once, stock changes once, the audit chain verifies, and another organization cannot read or cancel the order. Root typecheck and tests passed; the web production build also passed. No commit, push, Worker deployment or Pages deployment was made.

## 2026-10-30 — Supplier invoices against received purchase orders

**Objective.** Add the next purchasing app so the test organization can record supplier bills and compare billed quantities and value with what was received.

**Actions Completed.** Added `SUPPLIER_INVOICES_PLAN.md`, migration `sql/018_supplier_invoices.sql`, API routes for invoice recording and billing summaries, and `Purchasing → Supplier invoices`. The first slice supports partial bills, stores invoice number/date, derives prices/currency from the received order, prevents duplicate supplier invoice numbers, and refuses cumulative billed quantities above received quantities. Added rollback-safe `sql/tests/014_supplier_invoices.sql`.

**Database / System Result.** Migration 018 applied to the linked Supabase test project; two invoice tables have RLS. Test 014 reached the intentional `ALL TESTS PASSED (everything rolled back)` marker, verifying partial then final bill, over-billing and duplicate refusal, audit-chain integrity, and cross-organization isolation. No test data remains.

**Safety Status.** Root typecheck passed, shared/API tests passed (4 + 26), web production build passed, and `git diff --check` passed. No commit, push or Cloudflare deployment occurred. Tax, payments, credit notes and accounting export are outside this slice.

## 2026-10-30 — Added all Auth users to Test Organization

**Objective.** During testing, make every existing Supabase Auth account available in the single Test Organization.

**Actions Completed.** Read the live Auth users and memberships, preserved the existing `ben@prime-ad.com` owner and `ben.arthur.wiz@gmail.com` member, and added the other six Auth accounts to Test Organization as regular members. Added matching `member.added` audit entries in the same transaction. No roles in the other organizations were changed.

**Database / System Result.** Test Organization now has 8 active memberships: 1 owner and 7 members. The added accounts are the three demo users and three concurrency-test users.

**Safety Status.** This was an explicitly authorized additive data operation against the named Test Organization. No users were deleted, disabled or moved from another organization. The app should be refreshed before checking Settings → Users.

## 2026-10-30 — Deploy stock adjustments app via GitHub Actions

**Objective.** Publish the Inventory stock-adjustment app after the automatic deployment workflow was enabled.

**Actions Completed.** GitHub Actions run `41084167662` passed the typecheck, shared/API tests and web build, then deployed both the `erp-api` Worker and `erp-live` Pages site from `main`.

**Database / System Result.** None; the existing stock-adjustment migration was reused and no database mutation was run by the deployment.

**Safety Status.** CI and both Cloudflare deployment jobs completed successfully. The Node.js 20 messages are third-party action deprecation warnings, not deployment errors. Manual browser refresh and click-through remain needed.

## 2026-10-30 — Inventory stock adjustments and cycle counts app

**Objective.** Add the next warehouse workflow after approval policies: physical counts that become ledger adjustments only after manager approval.

**Actions Completed.** Added `Inventory → Stock adjustments`. Staff can select an item and warehouse, enter a counted quantity and reason, submit a count, and cancel their pending count. Owners/admins can approve or reject it. The API uses `inv_submit_adjustment`, `inv_decide_adjustment` and `inv_cancel_adjustment`; the database remains responsible for reserved-stock checks, stale-count refusal, approval enforcement, ledger posting and audit. Added adjustment permissions and demo-mode behavior.

**Database / System Result.** None; `sql/012_stock_adjustments.sql` was already applied and tested, so no migration or production data change was run.

**Safety Status.** Root typecheck passed; shared tests (4) and API tests (26) passed; web Vite production build passed; diff check passed. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — Inventory approval policies app

**Objective.** Add the next small Inventory app after reorder levels, while keeping the existing database-enforced approval path.

**Actions Completed.** Added `Inventory → Approval policies`. Owners and admins can add or update quantity thresholds, choose all warehouses or one warehouse, choose 1–3 required approvals, and remove policies. Inventory users can view the rules. Added API routes backed by `inv_set_approval_policy` and `inv_remove_approval_policy`, the `inventory.approval_policies.manage` permission, and equivalent demo-mode behavior. The highest matching policy continues to be enforced by `inv_decide_request`.

**Database / System Result.** None; `sql/011_approval_policies.sql` was already applied and tested, so no migration or production data change was run.

**Safety Status.** Root typecheck passed; shared tests (4) and API tests (26) passed; web typecheck and production Vite build passed; diff check passed. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — Inventory reorder levels app

**Objective.** Build a smaller useful Inventory feature while deferring real WhatsApp integration.

**Actions Completed.** Added the Reorder levels page to the real Inventory app. It shows available stock across warehouses, configured reorder levels, and low-stock status. Owners and admins can save or clear a non-negative reorder level. Added the API route `POST /v1/inventory/items/:id/reorder-level`, exposed the existing `reorder_level` field on item reads, added the `inventory.reorder.manage` permission, and added equivalent demo-mode behavior. The database function `inv_set_reorder_level` remains the mutation and audit boundary; no new migration was needed because `sql/013_reorder_levels.sql` is already live and tested.

**Database / System Result.** None; no database migration or production data change was run in this turn.

**Safety Status.** Typecheck passed; API tests passed (26); shared tests passed (4); web production build passed when run as separate TypeScript and Vite steps. The normal Windows `npm run build -w apps/web` wrapper still fails on PowerShell's unsupported `&&`, while the GitHub Ubuntu workflow is unaffected. Browser testing and deployment remain pending Ben's commit/push.

## 2026-10-30 — GitHub Actions deployment automation prepared

**Objective.** Make the API Worker and real web app deploy automatically after a successful push to `main`.

**Actions Completed.** Added `.github/workflows/ci-deploy.yml`. Pull requests and pushes run dependency installation, typecheck, tests and the production web build. A successful push to `main` deploys `erp-api` with Wrangler and publishes `apps/web/dist` to the `erp-live` Cloudflare Pages project. Database migrations remain manual and are not part of the push deployment.

**Database / System Result.** None. No Supabase or Cloudflare production state was changed.

**Safety Status.** The workflow is not active yet because the GitHub repository currently has no secrets. Before the first push deployment, configure the `production` environment with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. The existing Worker secret `SUPABASE_SECRET_KEY` remains stored remotely in Cloudflare and is not copied to GitHub. The workflow file needs to be committed and pushed by Ben; no commit was created by Codex.

## 2026-10-30 — Live database verification resumed

**Objective.** Complete the three read-only Supabase checks left open after the SQL test suite.

**Actions Completed.** Using the linked Supabase project, ran `audit_verify` for every active organization, ran `msg_cleanup(90, true)` as a dry run, and ran `supabase db advisors --linked`.

**Database / System Result.** There are 3 active organizations; all 3 audit chains returned `first_bad_seq = null` and `reason = null`. The 90-day cleanup dry run reported 0 outbox, 0 notifications, and 0 tokens. Advisors returned the existing intentional warnings for authenticated callers of SECURITY DEFINER application functions, plus the existing Auth warning that leaked-password protection is disabled; no new database mutation was made.

**Safety Status.** All checks were read-only. No cleanup was executed, no rows changed, no deployment occurred, and no secrets were printed. The advisor warnings should remain until the application-function exposure policy and Auth setting are deliberately reviewed.

---

## 2026-10-30 (overnight 1/n) — S2 identity binding, S3 decision tokens, S4 task replies: sql/008, 009, 010 and tests 004, 005, 006

**Objective.** Overnight queue from Ben, in order. S2, S3 and S4 are the database side of the real WhatsApp approvals and task replies in `documentation/plans/FEATURE_SET_AND_TECH_STACK.md`. No message provider is involved yet: the webhook functions take a number and a text, so they are testable on a real database and will be called by the WhatsApp webhook (S1 adapter, next).

**Actions Completed.**
- `sql/008_identity_binding.sql`: `msg_identities`; `msg_identity_start/confirm/revoke`; codes are a 6-digit random value stored only as a hash, expire in 10 minutes, 5 tries, 5 starts per hour; outbox gets `secret_body` (no SELECT for signed-in users, wiped on sent, failed or expired) so a code or token is never readable in the outbox; audit rows mask numbers (last 3 digits). New message kinds `verification` and `alert`.
- `sql/009_decision_tokens.sql`: `msg_tokens` (hash only, one per request, approver and channel, expiring, single use, no access for signed-in users); a manager with a verified WhatsApp number gets a WhatsApp message with a token; `msg_decide_by_token` (service role) turns "APPROVE/YES/REJECT/NO <token>" into a call to `inv_decide_request` as the approver with channel `whatsapp`, so role check, self-approval refusal, state check and audit are the app's own. Tokens issued before a number was (re-)verified stop working. Refusals return a code and are audited (a refusal never raises, so its audit row is kept).
- `sql/010_task_replies.sql`: `msg_task_reply` (service role): "ACK/START/DONE [ref]" from the assignee's verified number calls `tsk_set_status` as that person; ambiguity (several open tasks) returns the list instead of guessing; assignees with a verified number get a WhatsApp message with their task reference.
- Tests (each rolls back): `004_identity_binding.sql` (code only through the outbox and hashed, unreadable to signed-in users and owners, wrong and expired codes, 5-try lockout, duplicate number refused, rebind replaces old, viewer and module-off refused, rate limit, direct writes refused, secret wiped after sending, masked audit); `005_decision_tokens.sql` (tokens only for verified managers, hashed, unreadable; wrong number, unknown number, free text, replay, expired, already decided in the app, rebound number, forged token for own request all refused and audited; valid reply approves through the same function and leaves the same records as the app except the channel; reject by reply releases the reservation); `006_task_replies.sql` (ack and complete by reply, same audit as the app, unknown number, wrong person, no open task, ambiguity, reference, closed to signed-in users).

**Database / System Result.** Project now holds `sql/001`-`010`. Test runs through the CLI: 004, 005 and 006 each failed once on a mistake in the test itself (a column my own privilege rules hide; a wrong expected reservation; a regex that matched hex digits) and then **ALL TESTS PASSED**; regression run of tests 001 to 006 after the migrations: all pass (see the line printed by that run in the final summary).

**Safety Status.** Nothing here sends a real message: a channel adapter is still needed (next item). Webhook functions are callable only by the service role. Rollback: re-running the earlier version of a function's file (`sql/007_tasks_and_outbox.sql` for `inv_requests_notify`-era behaviour is superseded by `009`; the 007 definitions of `msg_complete`, `msg_claim_due` and `tsk_tasks_notify` are restored by re-running `sql/007` then `sql/008` without the new parts); no table was dropped, so data is not at risk.

## 2026-10-30 (overnight 2/n): O10 concurrency check

**Objective:** prove the rules hold when several people act at the same time, through the real login path (SQL tests run in one transaction and cannot do this).

**Actions Completed:**
- `sql/seed/003_concurrency_org.sql`: throwaway organization "Concurrency Check (test)" (owner, admin, member; inventory, messaging, tasks). Three test users created with the CLI; passwords only in `.temp/concurrency-credentials.txt` (git-ignored). Not the demo organization.
- `scripts/concurrency-check.mjs`: signs in as the three users and races: six reservations of 4 against 10 units; owner and manager approving the same request; three people issuing the same approved request; two delivery job runs. Creates its own `CONC-` warehouse and item each run.

**Database / System Result:** run against the live project, ALL 12 CHECKS PASSED: exactly 2 of 6 reservations succeeded and 4 were refused INSUFFICIENT_AVAILABLE (reserved 8 of 10); exactly one of two approvals accepted and one approval record; exactly one of three issues accepted, one -4 ledger movement, on hand 6 and reserved 4; both job runs answered 200 and 6 claimed = 6 sent, no message tried twice. The check leaves `CONC-` test rows in the throwaway organization only; nothing was deleted.

**Safety Status:** no existing data changed, no destructive SQL, no secrets in the repo, nothing deployed, nothing committed.
## 2026-10-30 (overnight 3/n): X7 names for every member: sql/016, test 012

**Objective:** a requester saw "Someone" instead of names because the members list is admin-only.

**Actions Completed:** `sql/016_org_people.sql` adds `core_org_people()` (id and display name only, active members of the caller's own organization; no email, role or sign-in data). `GET /v1/core/people` in `apps/api/src/modules/core/routes.ts`; `usePeople` in `apps/web/src/lib/people.ts` now uses it (demo mode unchanged). `sql/tests/012_org_people.sql` added.

**Database / System Result:** applied to the live project with the CLI (authenticated can run it, anonymous cannot). Test 012 ALL TESTS PASSED (everything rolled back): member sees 2 active people by name, full name and email-prefix fallback, disabled member and other organization not listed, wrong organization refused (NOT_A_MEMBER), missing header refused (ORG_REQUIRED), anonymous refused. `npm run typecheck` clean; `npm test` 26 API tests + 4 shared tests passed. The new API route is NOT deployed yet, so the live app still shows the old behaviour until the Worker and Pages are deployed.

**Safety Status:** read-only function, no table changed, nothing deleted, nothing deployed, nothing committed.
## 2026-10-30 (overnight 4/n): X1 language framework; I5, I3, I6, O3, O9 records; full regression

**Objective:** finish the overnight queue and record what was done after "overnight 1/n".

**Actions Completed:**
- I5 `sql/011_approval_policies.sql` (N approvals above a quantity), I3 `sql/012_stock_adjustments.sql` (counted vs system, approval, stale count refused), I6 `sql/013_reorder_levels.sql` (reorder level, low-stock message in `msg_run_chasing`), O3 `sql/014_audit_check.sql` (`audit_check_all`, hourly, alerts owners; also called by the 5-minute job in `apps/api/src/jobs/outbox.ts`), O9 `sql/015_outbox_retention.sql` (`msg_cleanup`, dry run by default, NOT scheduled). Each applied with the CLI and tested with `sql/tests/007` to `011` (all passed when run). Test 004 and 005 had flawed hash assertions (a 6-digit run can occur inside a 64-hex hash); fixed to exact checks and repeated 5 times.
- X1: `apps/web/src/lib/i18n.tsx` (English/Arabic, English text is the key so a missing translation shows English, sets `lang` and `dir=rtl`, choice kept in the browser), language switch in the user menu, applied to the top bar, user menu and page-not-found. Coverage is 9 strings only. The Arabic is a machine draft and needs review by a native speaker. The rest of the app is English only. Right-to-left layout is not checked in a browser (styles.css has no hard-coded left/right rules, which is all I verified).
- `Messaging.tsx` shows low-stock and audit-check results of a delivery pass.

**Database / System Result (regression, 2026-10-30, live project via CLI):** SQL tests 001 to 012 all ALL TESTS PASSED. `scripts/real-login-check.mjs`: owner 15, manager 15, requester 17 checks passed. `scripts/concurrency-check.mjs`: 12 of 12 passed. `npm run typecheck` clean, `npm test` 26 API + 4 shared passed, `vite build` succeeded.

**Safety Status:** nothing deployed overnight (Worker and Pages are unchanged: Worker `9d7095fc-f77d-4c6e-b2cb-32b3a9f854b2`, previous `3d6ff8ce-fb30-412e-8970-0e1dd74b837b`; Pages erp-live `232a6013-eeed-4dac-bef9-9f7efc47d399`, previous `91bdab5d-54c9-4b61-a48e-579d829e5ccd`). Database changes are additive; no table, row or audit entry was dropped or deleted; `msg_cleanup` is not scheduled. No secrets in files; nothing committed.
## 2026-10-29 — Feature set and tech stack written; task detail screen with acknowledge and complete

**Objective.** Ben asked for "no fake shit": a real feature set and the tech stack needed, written down. Two pasted notes arrived at the same time: "Activating Stock Requests" and "the employee receives an in-app notification; clicking it takes them to the Task Details screen where they can acknowledge or complete the task."

**Actions Completed.**
- `documentation/plans/FEATURE_SET_AND_TECH_STACK.md`: what is real today with evidence; every feature with status, phase, how and dependencies (star feature S1-S10, inventory I1-I11, purchasing and sales, platform, reporting, compliance, security and operations O1-O10); current stack; needed stack per capability with labelled outside claims; the real path for the star feature step by step (Meta Cloud API free test number, up to 5 verified recipients, no customer messages, then business verification); decisions table with owners. Outside facts were checked by web search and are labelled; unconfirmed items say **Unverified** (Egyptian-Arabic speech accuracy, ETA signing details, Supabase email limits, Egypt WhatsApp rates, availability of WhatsApp calling for Egypt and the GCC). The `fake` channel is documented as a test seam only. No costs or dates.
- Intake loop (`neworder.md` section 6) for the pasted notes: **"Activating Stock Requests"** is ambiguous (module switch, a draft step, or re-opening); recorded as B12 with one question for Ben, nothing built. **Task details** (B11): `GET /v1/tasks/:id`; web route `/tasks/:id` with the task, status, who and when, **Acknowledge** (sets `in_progress`; labelled "Acknowledged" in lists), **Complete**, **Cancel task**, and its audit history; task notifications now open it (the bell and the Notifications page); the task list links to it and the "Start" button is now "Acknowledge". No database change: acknowledge reuses the existing `in_progress` transition and every button calls `tsk_set_status` with the person's rights (opening the page changes nothing). Rule check: a notification only navigates; it never changes a task by itself.
- Deployed: Worker version `9d7095fc`, web deployment `232a6013`; bundle scanned clean.

**Database / System Result.** None.

**Safety Status.** Typecheck clean; 17 tests pass. Live API check as grant: `GET /v1/tasks/:id` 200 for "Count aisle 4" (still open, untouched), the task notification's entity id equals the task id, a malformed id gives 404. The page itself has not been opened in a browser by me. "Acknowledge" is not a separate stored fact (no timestamp of when it was acknowledged beyond the audit entry); if the reminder logic should stop on acknowledgement, that is a design change to ask Ben about.

## 2026-10-29 — Slice 2 built end to end: job, routes, screens, demo seed, deploy; demo path verified over the live API

**Objective.** Finish slice 2 for the demo path in `neworder.md` task 8: manager gets a notification for the pending request, staff gets a task, a reminder fires if nobody answers.

**Actions Completed.**
- API: channel adapter interface with in-app and fake adapters (`lib/channels/index.ts`; WhatsApp, voice and email fail visibly as "not configured"); the delivery and chasing job (`jobs/outbox.ts`, admin client, only calls the service-role functions); routes `tasks` (`GET/POST /v1/tasks`, `POST /v1/tasks/:id/status`) and `messaging` (`GET /notifications`, `POST /notifications/read`, `GET /outbox`, `POST /process`); Cloudflare cron trigger `*/5 * * * *` plus the Worker `scheduled` handler; boundary test allow-list extended by exactly the job and the adapter file. New modules `tasks` and `messaging` with permission keys in `packages/shared/src/modules.ts` (`messaging.outbox.manage`, not `.read`, so members do not receive it).
- Web: notification bell in the top bar (unread count, latest messages, mark read, opens the request or task), Tasks page (my/all, new task, start/done/cancel), Messages app (notifications; message outbox with "Run delivery and reminders now"). Real API only; the sample-data demo is unchanged.
- Demo data: `sql/seed/002_demo_slice2.sql` (run via CLI): messaging and tasks on for the demo organization, chasing times 1 minute (reminder) and 3 minutes (escalation), joseph assigns grant the task "Count aisle 4" due in 3 minutes, grant submits a request for 20 gloves (OUT-0003). 3 messages queued.
- Deploys: Worker `erp-api` version `3d6ff8ce` (cron schedule confirmed in the deploy output; secret still set); web `erp-live` deployment `91bdab5d`, bundle scanned clean (no passwords, no secret keys) and confirmed to contain the new screens.

**Database / System Result.** Seed 002 only (rows in `tsk_tasks`, `msg_outbox`, `org_modules`, organization settings, plus the new request and audit rows). Live API run with real logins for chris, joseph and grant: grant gets 403 on running the job, reading the outbox and creating a task; chris runs delivery: 2 reminders and 1 escalation queued (for the older waiting request OUT-0002), 6 messages claimed, 6 sent, 0 failed; joseph has 2 unread ("OUT-0003 needs your approval", "Reminder: OUT-0002 is still waiting for approval"); chris has 3 (adds "Escalation: OUT-0002 has had no decision"); grant has 1 ("New task: Count aisle 4"); the outbox shows all 6 as sent; an immediate second run queued and sent nothing; mark-all-read changed 2 rows.

**Safety Status.** Typecheck clean; 17 tests pass; SQL tests 001, 002, 003 pass (CLI). The screens have **not** been opened in a browser by me. The cron trigger is deployed but its first scheduled run has not been observed. Not done: slice 3 (WhatsApp adapter, identity binding, decision tokens), slice 4 (voice), a concurrency test for two job runs at once, outbox retention. The demo's first delivery pass already happened during my test, so Ben will see reminders for OUT-0003 and the overdue task only after the reminder and due times pass (1 and 3 minutes after the seed) and a pass runs (cron or the "Run now" button).

## 2026-10-29 — Slice 2 database layer: plan, sql/007 applied, sql/tests/003 passes

**Objective.** Start slice 2 of `neworder.md` (tasks and the notification outbox with a fake channel adapter) database-first, and review it against ADR-0003 before building screens.

**Actions Completed.**
- Plan: `documentation/plans/TASKS_AND_OUTBOX_PLAN.md` (modules `tasks` and `messaging`, tables `tsk_`/`msg_`, behaviour, permissions, tests, rollout).
- Migration `sql/007_tasks_and_outbox.sql` applied via CLI (twice more after edits; rerun-safe). Tables `tsk_tasks`, `msg_outbox`, `msg_notifications` (RLS on, select-only for signed-in users). Functions: `tsk_create_task`, `tsk_set_status`, `msg_mark_read` (signed-in users, role and module checked, audit in the same transaction); `msg_claim_due`, `msg_complete`, `msg_deliver_in_app`, `msg_run_chasing` (service role only, for the scheduled job); internal `mod__guard`, `msg__managers`, `msg__enqueue`; triggers that write outbox rows in the same transaction as the event (`inv_requests_notify`, `tsk_tasks_notify`) and transition guards. Verification: 3 tables RLS on; no non-SELECT privilege for anon/authenticated; signed-in users can execute exactly `tsk_create_task`, `tsk_set_status`, `msg_mark_read` of these.
- **Review of 007 against ADR-0003.** Conforms: changes only through security-definer functions with pinned `search_path`, called with the user's identity; organization from the validated header; direct writes revoked; audit written in the same transaction as the change; the admin client is needed only by the scheduled job (service-role functions), not by request routes. Gaps found and fixed: (1) delivery outcomes were not audited, so sent, failed and expired messages are now written to the append-only, hash-chained audit log (`messaging.message.sent/failed/expired`, metadata: channel, kind, recipient, attempts); (2) a task could be "changed" to the status it already had, which rewrote the completion time: now `INVALID_STATE`. Accepted: outbox rows are operational state and mutable by the service role (retries need that); the audit entries are the permanent record of outcomes. Not covered by this slice: retention and cleanup of old outbox rows.
- `sql/tests/003_tasks_and_outbox.sql`: covers outbox row in the same transaction as its event (S1, S2), idempotent enqueue and idempotent delivery (S1c-d, S3), retry with backoff and giving up (S4), expiry (S5), stuck-message recovery (S6), reminders and escalation fire once and only when due, and stop after a decision or completion (S7-S9), task rules (S9), notifications and outbox visibility (S10-S11), service functions and direct writes closed to signed-in users (S12), channel cannot change stock or approve (S14: requests stay submitted, no approvals, ledger and balances unchanged, messaging functions contain no inventory writes), organization isolation (S11, S2), audit chain clean (S13).

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds `sql/001`-`007`. Test runs through the CLI, all rolled back: `003` first run **ALL TESTS PASSED** (before the audit additions); after the audit-of-outcomes edit and re-applying 007: `003`, `002` and `001` **all ALL TESTS PASSED**.

**Safety Status.** Not yet built: API routes, the scheduled job (cron), screens, demo seed for this slice, deploy. The demo organization does not have the `tasks` and `messaging` modules enabled yet, so nothing is queued there.

## 2026-10-29 — Worker secret set; audit log ordering fix; Worker redeployed

**Objective.** Close the open item from task 1 (Settings → Users error, "Someone" names) and check it works.

**Actions Completed.** Ben ran `npx wrangler secret put SUPABASE_SECRET_KEY --name erp-api` himself (pasted at the prompt; I did not see the value). `wrangler secret list --name erp-api` now shows the name `SUPABASE_SECRET_KEY` (type `secret_text`), the only secret. Through the deployed Worker as chris (owner): `GET /v1/core/members` returns 200 with all three users and their roles (so Settings → Users and names on request pages work); `GET /v1/core/audit` returns 200. The check also showed the audit log shuffling entries that share one timestamp (one database function writes several rows in one transaction): `apps/api/src/modules/core/routes.ts` now orders by `id` (insertion order) instead of `occurred_at`. Worker redeployed (version `0ec3eb58`), secret confirmed still set after the redeploy.

**Database / System Result.** None.

**Safety Status.** Typecheck clean; 17 tests pass. The Settings → Users page and the audit screen were checked at API level only, not in a browser. B1 remains open until Ben's browser click-through.

## 2026-10-29 — neworder.md tasks 1-7: branding, demo banner, hygiene, tests re-run, redeploy

**Objective.** Work through `neworder.md` ("Next tasks"), tasks 1 to 7. Task 8 (slice 2) not started.

**Actions Completed.**
- Task 1 (verify deploy): the Worker holds the Supabase URL, publishable key and allowed origins (checked through behaviour: sign-in token accepted, CORS correct). **`SUPABASE_SECRET_KEY` is not set**: `wrangler secret list --name erp-api` returns `[]`. Ben's first attempt failed because he ran `wrangler secret put` from the repo root (no Worker name there); the command needs `cd apps\api` or `--name erp-api`. So the "Supabase isn't configured on this server" error on Settings → Users is **still present**, and user names fall back to "Someone" on request pages because the members list also needs the admin client. Sign-in in a real browser as the three users has **not** been done by me (no browser testing); the same sign-in was proven over the API.
- Task 2 (GGO branding): no "GGO" in any code, UI string, style, seed or script. The header showed "GGO" because the old organization was literally named GGO in the database: renamed it to "Test Organization" (slug `test-organization`) through SQL with an `organization.updated` audit row (written with `audit_append_admin`), chain still clean. Doc mentions neutralised in `TECHNICAL_PLAN.md` and `WORKLOG.md`. `migration.md` and `neworder.md` are Ben's own files and still mention GGO as history. The Supabase project's dashboard name is "ggoerp" (not user-facing; rename in the dashboard if wanted).
- Task 3 (banner): new `components/EnvBanner.tsx`, "Demo environment: sample data only. Changes are saved to a test database; do not enter real customer data." on the live build (flag `DEMO_ENVIRONMENT=true` at build time via `vite.config.ts`); the sample-data build's own bar now starts with "Demo environment: sample data only. Nothing is saved; reload resets it." Both redeployed (erp-live deployment `2cf38fa4`, erp-demo deployment `55f75635`); both bundles confirmed to contain the text.
- Task 4 (hygiene): `.temp/demo-credentials.txt`, `.env`, `.env.local`, `apps/api/.dev.vars`, `test.ps1`, `supabase/.temp/linked-project.json` are git-ignored; added `dist-*/` to `.gitignore`. Scanned all 124 non-ignored files, both web bundles, the worklog and update.md for the three demo passwords, `sb_secret_` keys and JWTs: none found. Worker secrets by name: none set yet (plain variables: `APP_ENV`, `ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). Recommendations: rotate the three demo passwords after the demo; set Supabase Authentication → URL Configuration → Site URL to `https://erp-live.pages.dev` and add it to the redirect URLs so invite and reset links return to the app; the Supabase secret key will become visible in your shell history if typed instead of pasted at the prompt (paste at the prompt).
- Task 5 (tests): `sql/tests/` already covers every listed item. `002_inventory_approval.sql`: direct ledger insert refused (S6b signed-in user, S6c privileged role), issue without approval refused (S6a, S10c), self-approval refused (S5b function, S7a table constraint), reservation (S3, S4, S10, S11), audit entry per step (S1c, S15a-e), hash chain verifies (S15f, S15g), other-organization isolation (S12a-f). `001_core_isolation_and_audit.sql` covers core isolation and the chain. Both re-run via CLI after the rename: **ALL TESTS PASSED**, nothing left behind (2 organizations, 5 users, 2 requests, audit rows unchanged apart from the rename entry).
- Task 6 (commit grouping) and task 7 (status block and backlog in `neworder.md`; the brief names it `CLAUDE_CODE_LIVING_BRIEF.md`, the actual file is `neworder.md`) done; see `update.md`.

**Database / System Result.** One organization renamed (name and slug) with an audit row. No migration run. Cloudflare: both Pages projects redeployed; Worker unchanged.

**Safety Status.** Typecheck clean; 17 tests pass; SQL tests pass. Not browser-tested by me. Open: Worker secret key, browser sign-in check by Ben, Supabase Site URL, names without the admin client (idea: a user-scoped database function that returns the organization's people; not built), slice 2.

## 2026-10-29 — Deploy: API Worker `erp-api` and real web app `erp-live` on Cloudflare

**Objective.** Put the real inventory slice (real sign-in, real database) behind a URL Ben and management can click through.

**Actions Completed.**
- Cloudflare account `meetings.dmedeskai@gmail.com` (login still active). Created Pages project `erp-live` (`wrangler pages project create ... --force`) and deployed the real web build: `https://erp-live.pages.dev` (deployment `3f93bfc5`). Built with `npx vite build` in `apps/web` (the `build` script's `&&` fails in this shell) with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (public by design) and `VITE_API_BASE_URL` set for the build only. Demo mode is off in this build; the demo code is still bundled (checklist item open).
- Deployed Worker `erp-api` from `apps/api`: `https://erp-api.meetings-dmedeskai.workers.dev` (version `31028900`). `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` passed at deploy time with `--var` (not stored in the repo); `ALLOWED_ORIGINS` set in `apps/api/wrangler.toml` to `https://erp-live.pages.dev,http://localhost:5173` after a first deploy with the value passed via `--var` produced no CORS header at all (cause not investigated; the toml value works).
- **`SUPABASE_SECRET_KEY` is not set on the Worker yet** (Ben sets it with `wrangler secret put`; I must not see it). Without it, only the routes that use the admin client fail with 503: Settings → Users (invite, role changes) and member audit events. The inventory flow does not need it.

**Database / System Result.** None.

**Safety Status.** Smoke test through the deployed Worker with a real login as grant (member): `/health` ok, no token gives 401, session 200 (Demo Trading Co., role member, modules core and inventory), items 5, stock 9 rows, requests OUT-0001 issued and OUT-0002 submitted, ledger 11 rows, a foreign `X-Org-Id` gives 403 `not_a_member`. CORS: `erp-live.pages.dev` and `localhost:5173` allowed, an unknown origin gets no allow header. The web app pages return 200; the sign-in screen and the click-through are **not yet tested by anyone in a browser**. Supabase Auth "Site URL" and redirect URLs still point to defaults, so password-reset and invite links will not return to `erp-live`.

## 2026-10-29 — Demo users created, demo organization seeded, real-login checks pass (all via the CLI)

**Objective.** Put real data and real sign-in behind the inventory slice, per `neworder.md` (slice 1) and "run the Supabase stuff using the CLI".

**Actions Completed.**
- Created three Supabase Auth users by SQL through the CLI (`auth.users` plus `auth.identities`, bcrypt via `extensions.crypt`, email pre-confirmed; no email sent): `chris.johnson.wiz@gmail.com`, `joseph.brown.wiz@gmail.com`, `grant.holden.wiz@gmail.com`. Passwords were generated randomly and saved only to `.temp/demo-credentials.txt` (git-ignored); they were not printed or committed. The temporary SQL file that held them was blanked.
- Ran `sql/seed/001_demo_organization.sql` via CLI. Result: organization "Demo Trading Co." (EGP, Africa/Cairo), 3 members (chris owner, joseph admin, grant member), module `inventory` on, 2 warehouses, 5 items, 2 requests (one issued, one waiting for approval), 21 audit rows, `audit_verify` 0 problems. Stock read back: cartons 460 (500 − 40 issued), tape 54 (60 − 6), gloves 120 on hand with 30 reserved for the waiting request.
- `scripts/real-login-check.mjs` extended with inventory checks (items readable, direct ledger insert refused, direct balance change refused with a permission error, issue of an unapproved request refused, member cannot approve) and a clearer sign-in error message.

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds the demo organization and 3 more auth users (5 in total). Real sign-in worked for all three through Supabase's password sign-in, which also shows the SQL-created users are accepted by Supabase Auth.

**Safety Status.** Real-login check (real password sign-in, then Supabase REST calls with `X-Org-Id`): **chris 15/15, joseph 15/15, grant 17/17 passed**. This proves the browser path the SQL tests could only simulate: header accepted for own organization and refused for another or missing, isolation, no direct writes, admin functions closed, approval enforced for real users. Skipped on purpose (would change data): approving as owner/admin. Not yet tested: the Worker routes and the screens against this data. Credentials created by direct SQL is non-standard; if Supabase Auth ever misbehaves for these users, recreate them from the dashboard.

## 2026-10-29 — Workstream C: inventory API routes, screens on the real API, demo seed script (not run)

**Objective.** Connect the inventory database layer (`sql/006`) to the API and the web screens, and prepare the demo organization.

**Actions Completed.**
- Roles for the demo users (from Ben): `chris.johnson.wiz@gmail.com` owner, `joseph.brown.wiz@gmail.com` manager (admin), `grant.holden.wiz@gmail.com` requester (member). **These three users do not exist in Supabase Auth yet** (checked via CLI: only `ben@prime-ad.com` and `ben.arthur.wiz@gmail.com`).
- `packages/shared/src/modules.ts`: inventory permissions (`inventory.items.read`, `.items.manage`, `.warehouses.manage`, `.request.create`, `.request.approve`, `.stock.issue`) and member grants.
- `apps/api/src/modules/inventory/routes.ts`: reads (warehouses, items, stock, ledger, requests) filtered by the caller's organization, and changes through the seven `sql/006` functions; response shapes match the existing screens. No admin client used.
- Web: `modules/inventory/InventoryDemo.tsx` renamed `Inventory.tsx` and now registered in every build (sales and purchasing stay demo-only); new `lib/people.ts` resolves user ids to names from the members list (fixed names in demo mode); the warehouse default no longer assumes a demo id.
- `sql/seed/001_demo_organization.sql` (written, **not run**): creates "Demo Trading Co." with the three users above, two warehouses, five items with opening stock, one issued request and one waiting for approval, all through the real functions. Stops with a clear message if a user is missing; does nothing if the organization already exists.

**Database / System Result.** None from this entry.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. API routes and screens not run against the real database yet (needs the users, the seed, a running API). Known gaps: no API test for the new routes; Worker not deployed; web not built against the real API.

## 2026-10-29 — Workstream C started: sql/005 and sql/006 applied via the Supabase CLI, inventory tests pass

**Objective.** Start the live demo on a real database (orders.md, workstream C): database layer for the inventory slice.

**Actions Completed.**
- Ben ran `supabase init` and `supabase link --project-ref plhuuhcpvlytozyedamt` in the repo; from now on Supabase work uses the CLI (`supabase db query --linked -f <file>`, `supabase db advisors --linked`). Read-only state check first: 4 core tables with RLS, 14 functions, 3 audit triggers, 1 organization, 5 audit rows, 0 chain problems.
- `supabase db advisors --linked`: warnings only. Fixed by new `sql/005_advisor_fixes.sql` (pinned `search_path` on `set_updated_at`, `audit_log_is_append_only`, `audit_log_no_truncate`; `auth.uid()` wrapped in the `memberships_own_read` policy). Applied via CLI; verified (all three functions show `search_path=public`, the policy shows the wrapped call, the advisors no longer list those items). `001` and `004` edited to carry the same changes for fresh installs. Remaining advisor warnings are intentional (four `SECURITY DEFINER` functions callable by signed-in users by design) plus **leaked password protection is off** (Auth setting in the dashboard; Ben to decide).
- `documentation/plans/INVENTORY_PLAN.md` written (slice 1 only, approved by Ben through `orders.md`).
- `sql/006_inventory_core.sql` applied via CLI: eight `inv_` tables (warehouses, items, counters, requests, request lines, approvals, stock moves, stock balances), RLS select-only, seven public functions (`inv_create_warehouse`, `inv_create_item`, `inv_receive_stock`, `inv_submit_request`, `inv_decide_request`, `inv_post_issue`, `inv_cancel_request`), triggers: request status transitions, issue only for an approved request, ledger and approvals append-only. Table check: nobody decides their own request. Verification: 8 tables RLS on; no non-SELECT privilege for anon/authenticated; exactly the 7 public functions executable by signed-in users.
- `sql/tests/002_inventory_approval.sql` run via CLI: **ALL TESTS PASSED (everything rolled back)** on first run. Covers viewer read-only, reservation and over-reservation refusal, member cannot approve, owner cannot approve own request, issue without approval refused (function, signed-in direct insert, and even a privileged direct insert), table refuses self-approval and a skipped state, manager approves, issue once only, reject and cancel release reservations, organization isolation, module switch enforced in the database, ledger and approvals append-only, audit row per step, audit chains clean. `sql/tests/001` re-run via CLI: still passes.
- API: `lib/rpc.ts` maps `INVALID_STATE`, `NOT_FOUND`, `MODULE_DISABLED` and includes the database's detail text (for example "30 available, 80 requested").

**Database / System Result.** Project `plhuuhcpvlytozyedamt` now holds `sql/001`-`006`. After the rolled-back tests: 1 organization, 0 items, 0 requests, 2 auth users, 5 audit rows (nothing left behind).

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Not done yet: API routes for inventory, wiring the web screens to the API, test users and demo organization, Worker deploy with secrets, web deploy against the real API, the real-login script for inventory calls. Known limit (in INVENTORY_PLAN): a refused action raises an error, so the refusal is not itself audit-logged.

## 2026-10-29 — Real-login check script written (not run)

**Objective.** Prove over the real path (sign-in, then Supabase REST calls with `X-Org-Id`) what the SQL tests could only simulate.

**Actions Completed.** `scripts/real-login-check.mjs`: signs in with `TEST_EMAIL`/`TEST_PASSWORD`, then checks that the user sees only their organizations and audit rows, that `current_org_id` accepts their own organization header and refuses a random organization (`NOT_A_MEMBER`) and a missing header (`ORG_REQUIRED`), that direct update of `organizations`, delete from and insert into `audit_log` are refused, that `audit_append_admin` and `audit_verify` are not callable, and, for a plain member, that `core_update_org` is `FORBIDDEN` (skipped for owners and admins because it would change data). Never prints the password or token. Reads settings from environment variables or the repo-root `.env`. Supabase Auth currently has two users (from a screenshot): `ben@prime-ad.com` (signed in) and `ben.arthur.wiz@gmail.com` (invited 28 Oct, not yet accepted).

**Database / System Result.** None yet; the script has not been run against Supabase.

**Safety Status.** Syntax checked with `node --check`, and confirmed to stop with a clear message when settings are missing. The only write it attempts is the member-role call, which must be refused; the other write attempts must also be refused. The password is entered by the user in their own terminal, never in chat or a file.

## 2026-10-29 — SQL test script run: all passed

**Objective.** Record the run of `sql/tests/001_core_isolation_and_audit.sql`.

**Actions Completed.** Ben ran the script in the Supabase SQL Editor (postgres role). Result: `ERROR: P0001: ALL TESTS PASSED (everything rolled back)`, raised at line 144 of the block, i.e. the final deliberate `raise exception` after every check (T1 to T11) had passed. No setup problem with `auth.users` occurred.

**Database / System Result.** Proven on the real database: organizations cannot see each other (RLS), the `X-Org-Id` header is refused when missing or for a non-member, owners can change settings and plain members get `FORBIDDEN`, signed-in users have no direct writes (no inserts, updates, deletes, forged audit rows or TRUNCATE), `audit_append_admin` and `audit_verify` are closed to signed-in users, anon is blocked, each organization has its own gapless audit chain that verifies clean, and even the owner cannot update, delete or truncate `audit_log`. Everything was rolled back; no test data remains.

**Safety Status.** Still unproven: the browser path (`X-Org-Id` through PostgREST with a real token from the API) and a real second sign-in. The script simulates sign-in with `set_config`, which matches what PostgREST does but is not the same path. Re-run this script after every change to `sql/`.

## 2026-10-29 — Plans moved into documentation; SQL test script written

**Objective.** Finish the documentation layout from the migration brief and add runnable proof for the database rules.

**Actions Completed.** `TECHNICAL_PLAN.md` moved to `documentation/plans/`, `MANAGEMENT_PLAN.md` to `documentation/planning/`; links in the checklist, `PRODUCT_BRIEF.md`, plans README and planning README fixed (the dead `INPUT_NEEDED.md` pointer replaced by `update.md`). A relative-link check over all repo markdown found only the two intentional template placeholders. New `sql/tests/001_core_isolation_and_audit.sql` plus `sql/tests/README.md`: creates three throwaway users and two organizations, then checks organization isolation (RLS), the `X-Org-Id` header (missing and non-member refused), owner versus member roles, no direct writes by signed-in users (including forged audit rows and TRUNCATE), admin-only functions closed, anon blocked, separate gapless audit chains verified clean, and append-only refusal even for the owner. It always rolls back by ending with a deliberate error: "ALL TESTS PASSED (everything rolled back)" means pass.

**Database / System Result.** None. The test script has **not been run**; it was written without access to the database and may need small fixes (for example if inserting into `auth.users` needs more columns).

**Safety Status.** Link check passed. Not covered by this script and still open: the browser path through PostgREST with a real token. Typecheck and tests unchanged.

## 2026-10-29 — Root README and PRODUCT_BRIEF written

**Objective.** Complete the migration documents from `migration.md` step 3 (README and product brief; `agents.md`, research README and first worklog entry were done earlier).

**Actions Completed.** `README.md` (what it is, four hypotheses with the demand caveat, architecture table, how to run the demo and the real app, the PowerShell `&&` caveat) and `PRODUCT_BRIEF.md` (what it is, why it might win, first vertical slice and its rules, module table by wave, out of scope, open decisions, non-negotiable rules). Product name stays `{{PRODUCT_NAME}}`.

**Database / System Result.** None.

**Safety Status.** Documents only. Commands in the README were written from the existing scripts (`npm run dev:demo -w apps/web`, `build:demo`, `dev:api`, `dev:web`); only the demo commands have been run. The "run the real app" steps have not been tried against the new Supabase project.

## 2026-10-29 — sql/004 run in Supabase and verified

**Objective.** Record the run of `sql/004_revoke_extra_privileges.sql`.

**Actions Completed.** Ben ran `sql/004` and both verification queries (screenshots): query 2, triggers on `audit_log` are `audit_log_append_only`, `audit_log_chain`, `audit_log_no_truncate` (PASS); query 1, no non-SELECT privileges for `anon`/`authenticated` on the four core tables (PASS, zero rows). The TRUNCATE refusal itself was not exercised (deliberately not tested on real data).

**Database / System Result.** `audit_log` has the `audit_log_no_truncate` trigger (query 2: three triggers). Query 1 then returned "Success. No rows returned" (screenshot): `anon` and `authenticated` hold no privilege other than SELECT on `organizations`, `memberships`, `org_modules` and `audit_log`. **`sql/004` is verified; the privilege gap is closed** for those four tables and, by default privileges, for future tables created by the same role.

**Safety Status.** The TRUNCATE refusal was not exercised on real data (deliberately). Still unproven, as before: the browser path (`X-Org-Id` through PostgREST with a real token) and cross-organization refusal.

## 2026-10-29 — sql/003 verified on a database; privilege gap found, sql/004 written

**Objective.** Record the verification results Ben pasted and the gap they exposed.

**Actions Completed.** Results reported by Ben from the Supabase SQL Editor (postgres role): check 5, hash chain: after two `core_update_org` calls as a simulated authenticated owner, `audit_log` shows `seq` 1 (`prev_hash` null, `hash` 4fc1aa5dae) and `seq` 2 (`prev_hash` 4fc1aa5dae, `hash` 8ccaa9eeec), channel `api`, action `organization.updated`; `bad_rows` 0 from `audit_verify` on every row; the three older rows from before `003` have null seq and hash and are ignored by the chain, as designed. Check 6: update on `audit_log` refused (see entry below). Query 3b: `anon` holds nothing; `authenticated` holds **REFERENCES, TRIGGER and TRUNCATE** on all four core tables and no INSERT, UPDATE or DELETE (so query 3 would return zero rows; query 3 and query 4 were not run as separate statements, their conditions are covered by 3b and by `bad_rows` 0). New `sql/004_revoke_extra_privileges.sql` (written, **not run**): revokes TRUNCATE, REFERENCES, TRIGGER from `anon` and `authenticated`, adds a trigger that refuses TRUNCATE on `audit_log`, and revokes those rights by default on future tables. `agents.md` gains the rule for new tables.

**Database / System Result.** `sql/003` is verified for: chain numbering and linking, `audit_verify`, `core_update_org` writing its audit row in the same transaction, append-only update refusal, admin-function privileges. Two real audit rows (`organization.updated`, no setting changed) were added by the test. Not yet verified: the browser path (`X-Org-Id` header through PostgREST, needs an API test with a real token) and cross-organization refusal (needs a second organization and user). The TRUNCATE gap exists in the database until `sql/004` is run.

**Safety Status.** TRUNCATE is not exposed through the Supabase API, so the gap was not remotely reachable, but it let a signed-in role empty the audit log over a direct database connection; treat `sql/004` as required before real data. Typecheck and tests unchanged.

## 2026-10-29 — sql/003 run in Supabase, partly checked (superseded by the entry above)

**Objective.** Record what is known about `sql/003` after Ben ran it.

**Actions Completed.** Ben ran `sql/001`-`003` in the Supabase SQL Editor (as reported; not seen by Claude). Verification results reported by Ben: query 1 PASS (triggers `audit_log_append_only` and `audit_log_chain`); query 2 PASS (anon and authenticated false for `append_admin`, `verify`, `require_role`; service_role true). Check 6 (`update public.audit_log set summary = 'x' where id = 1;`) PASS: refused with `ERROR: P0001: audit_log is append-only (UPDATE refused)` from `audit_log_is_append_only()` (run as the SQL Editor's postgres role, so the rule holds even for the owner). Queries 3, 3b and 4 not confirmed. Chain check (two `core_update_org` calls as an authenticated user, then `audit_verify`) not run.

**Database / System Result.** The Supabase project holds `001`-`003`. Existing audit rows from before `003` have no sequence or hash and are ignored by `audit_verify`.

**Safety Status.** `003` is **not verified** until queries 3 and 4 and the chain check are confirmed. The signed-in path through PostgREST (the `X-Org-Id` header reaching `current_org_id()`) cannot be proven from the SQL Editor; it waits for an API test with a real user token. Cross-organization refusal needs a second organization and user. Open point to check with the extended privileges query: whether `authenticated` still holds TRUNCATE, REFERENCES or TRIGGER on the four core tables (`sql/001` only revoked INSERT, UPDATE, DELETE).

## 2026-10-29 — Demo: purchasing and sales (wave 2 sample) and redeploy

**Objective.** Show on the demo how the product grows past the first slice: buying goods, selling goods, and how both connect to stock and approvals.

**Actions Completed.** `apps/web/src/lib/demoTrade.ts` (sample suppliers, customers, purchase orders, sales orders; money in integer minor units, EGP). `demoInventory.ts`: stock requests can carry a sales-order source, ledger moves carry a reference (purchase order number), exported `createRequest`/`receiveGoods`. `demo.ts`: `/v1/purchasing` and `/v1/sales` routes; Purchasing and Sales appear as demo-only modules in Settings → Apps. Screens: `modules/trade/common.tsx`, `modules/purchasing/PurchasingDemo.tsx` (suppliers, purchase orders, receive goods adds stock), `modules/sales/SalesDemo.tsx` (customers, sales orders, "request stock" raises a stock request that still needs manager approval; the order shows delivered once that request is issued). Request page links back to its sales order; ledger links receipts to their purchase order. Registered in `modules/registry.tsx` in demo mode only. No SQL, API or real module manifest changes.

**Database / System Result.** None. Redeployed the demo to the same Cloudflare Pages project `erp-demo` (deployment `c7e52f6a`); https://erp-demo-bas.pages.dev serves the new bundle.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Live URL answers 200 on `/` and `/sales/orders`. Screens not clicked through in a browser by me. Demo-only: these two apps are a sample of wave 2 and are not committed scope; the real modules wait for the trials and interviews and approved plans.

## 2026-10-28 — Demo published on Cloudflare Pages

**Objective.** Give management a link to the same clickable demo that runs locally.

**Actions Completed.** Added `npm run build:demo` (Vite `demo` mode; ignores any `.env`, so no Supabase values can reach the bundle) and `apps/web/public/_headers` (`X-Robots-Tag: noindex, nofollow`, `nosniff`, no referrer). Built `apps/web/dist`, checked the bundle contains no project address or key. Logged in with `wrangler login`, created the Pages project `erp-demo` (needed `--force`: wrangler 4.154 otherwise delegates Pages to Workers and fails in a workspace root), and deployed with `wrangler pages deploy apps/web/dist --project-name erp-demo --branch main`.

**Database / System Result.** Cloudflare account "Meetings.dmedeskai@gmail.com's Account": Pages project `erp-demo`, production URL **https://erp-demo-bas.pages.dev**, first deployment `d7820af9` (47 files). No Supabase project, API or database involved; sample data only, no sign-in. Public: anyone with the link can open it.

**Safety Status.** Root URL and the deep link `/inventory/requests` answer 200 and the `noindex` header is present. Not opened in a browser by me. Updates are manual: rebuild with `npm run build:demo`, then run the deploy command again (no `--force`). The per-deployment URL `d7820af9.erp-demo-bas.pages.dev` did not resolve from here at the time of checking. Not done: access restriction (Cloudflare Access), GitHub-connected automatic deploys, a custom domain.

## 2026-10-28 — UI restyle: "loading dock" look, logical CSS, Home and stock screens

**Objective.** Make the web UI look designed and ready for right-to-left use, and remove CRM-era leftovers.

**Actions Completed.** `apps/web/src/styles.css` rewritten (warm paper and ink palette with cargo-green accent and signal amber for items that need a person, light and dark, logical properties for RTL, motion that respects reduced-motion; CRM-only styles removed). Self-hosted IBM Plex Sans Arabic and IBM Plex Mono via `@fontsource` (new dependencies in `apps/web`). Home page: line icons, date, staggered tiles. Stock screen: summary cards, stock-level bars. Request page: progress steps. Topbar brand mark. Demo bar: RTL layout toggle.

**Database / System Result.** None.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17; dev server compiles the changed files. **Not looked at in a browser by me**, so spacing, contrast and the RTL flip are unchecked. Screen text is still English only; the toggle flips layout, not language.

## 2026-10-28 — Demo mode: clickable sample of the app and the first inventory slice

**Objective.** Let the screens and the first vertical slice (item, stock request, manager approval, issue, audit entry) be tried in a browser before the real inventory module and a running API exist.

**Actions Completed.** `npm run dev:demo -w apps/web` (Vite `demo` mode, flag `VITE_DEMO_MODE`, off in every other mode). `apps/web/src/lib/demo.ts` (in-memory org, members, modules, audit and a switchable acting person), `lib/demoInventory.ts` (pretend inventory rules: approval gate, no self-approval, reservation, append-only ledger), `DemoApp.tsx` (yellow banner to act as owner, admin, member or viewer), `modules/inventory/InventoryDemo.tsx` (stock on hand, requests, new request, request page with approve/reject/issue, ledger), registered in `modules/registry.tsx` only in demo mode. `lib/api.ts` routes to the demo handlers in demo mode. No API, SQL or `inventory` manifest changes.

**Database / System Result.** None. The demo never talks to Supabase.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17. Dev server answers on http://localhost:5173 and compiles the new files; the screens have **not** been clicked through by me and are not browser-tested. The demo imitates the rules in the browser; it proves nothing about the database. Demo code is still bundled in normal builds (registered only when the flag is on); to be split out before any deploy.

## 2026-10-28 — ADR-0003: user-scoped database access, audit hash chain, first RPC functions

**Objective.** Make the audit log and tenant checks hold in the database instead of depending on every API route, as required before any stock or approval feature (ADR-0003, `TECHNICAL_PLAN.md` section 3.4).

**Actions Completed.**
- `documentation/architecture/decisions/ADR-0003-mutations-via-rpc.md` (Proposed); active organization is the `X-Org-Id` header checked against membership in the database, not a JWT claim.
- `sql/003_audit_chain_and_core_rpc.sql` (new, **not run**): `audit_log` gains `seq`, `prev_hash`, `hash`, `channel`, `request_id`; per-organization hash-chain trigger with an advisory lock; `audit_verify`; service-role-only `audit_append_admin`; `current_org_id()`, `require_org_role()`; `core_set_module()` and `core_update_org()` which change data and write the audit row in one transaction.
- API: `lib/db.ts` replaced by `lib/db.user.ts` (publishable key plus the caller's JWT) and `lib/db.admin.ts` (secret key); new `lib/rpc.ts` mapping reason codes to HTTP errors; `lib/audit.ts` reduced to an admin-path helper that calls `audit_append_admin`. `tenant.ts`, org settings, module enable/disable and the audit read now run as the user; `memberRoutes.ts` stays on the admin client for Supabase Auth admin calls. New `SUPABASE_PUBLISHABLE_KEY` binding.
- `apps/api/test/boundaries.test.ts`: fails if a file outside an allow-list imports the admin client, or inserts into `audit_log` directly. Added `@types/node` for it.

**Database / System Result.** At the time of writing `sql/003` had not been run (see the later entry: run by Ben, partly checked), so the `X-Org-Id` header check, the hash chain and the two RPC functions are untested against a real database.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17 (shared 4, api 13). Not browser-tested. Not done: SQL tests (state machine, isolation, audit verification); a second-organization isolation test; ADR-0003 is still Proposed. Manual: run `sql/001`, `002`, `003` in order on a staging Supabase project, run the verification queries, then record the run here.

## 2026-10-28 — Migration: generic foundation copied from the previous internal ERP

**Objective.** Start the new product ({{PRODUCT_NAME}}, warehouse-first ERP for Egypt and the GCC) by reusing the generic parts of the previous internal ERP, without carrying over CRM, time tracking or customer-specific content. The old repository was only read, never modified.

**Actions Completed.**
- Documentation system: `agents.md` (rewritten for this product, logging rules kept, stock/approval/audit and competitor-licensing rules added), `CLAUDE.md`, `PLANS.md`, `documentation/` structure with reset worklog, checklist, plan template, ADR format and research/teardown template, competitor index (Edara, Daftra, Odoo, Wafeq, Zoho, ERPNext, Business Central).
- Code foundation: monorepo tooling; `apps/api` (auth, tenant resolution, permission/module guards, response helpers, core org/members/modules/audit routes); `apps/web` (module-driven shell, sign-in, org picker, core settings screens, list view); `packages/shared` (API types, permissions, module manifest, money); `sql/001`, `sql/002`.
- Changed on the way: the old package scope to `@erp/*`; default currency `USD` to `EGP` in `sql/001`; CRM manifest replaced by an empty `inventory` placeholder module (API routes file, empty web and shared folders); CRM wiring removed from the API and web registries, Home and Shell.
- Left behind: CRM and activities/timeline/my-tasks code and SQL, the generic record-page/field components built for CRM, the old internal plans, discovery notes, old worklog and checklist content.
- `apps/api/src/lib/db.ts` and `audit.ts` copied as-is and marked `TODO(ADR-0003)`: they use the secret key and a separate-call audit insert, which must be reworked before the stock and approval features (see `TECHNICAL_PLAN.md`).

**Database / System Result.** None. `sql/001` and `sql/002` have not been run against any Supabase project.

**Safety Status.** `npm install` ok (0 vulnerabilities); `npm run typecheck` clean in shared, api and web; `npm test` passing (shared 4, api 11). Not browser-tested. No `.env` files, secrets, node_modules or git history copied. Open: product name and deciders placeholders, README, PRODUCT_BRIEF, ADR-0003, the db/audit rework.

