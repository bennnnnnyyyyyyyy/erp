# In-app guided tour (English and Arabic)

**Module:** core (help), no new module key · **Status:** `[📝 Draft / RFC]`. **Plan only.** The tour is not built. What exists today is described in section 2.
**Owner:** Ben Arthur · **Version 1 built 3 Nov 2026** (uncommitted, not deployed); screens in section 4 are the built steps.
**Depends on:** language selection (section 3, built 3 Nov 2026), the Getting-started tutorial and the Guide.

## 1. Goal

A new person is walked through the real app, one screen at a time: a short highlight on the actual button, a sentence saying what it does and why, then "next". It follows the language they chose, in the right direction. It replaces nothing: the Guide and the tutorial stay as reference pages.

## 2. What exists today (3 Nov 2026)

- **Guide** (every company) and **Getting started** tutorial (companies that signed up through the app): pages that describe the app and link to the real screens. Both now read their text from `apps/web/src/modules/help/helpContent.ts`, in English and Arabic.
- **Language selection:** the tutorial first shows a bilingual chooser (English / العربية) and shows nothing else until the person picks; the choice is saved on the person's **account** (`sql/038`, `/v1/core/me/language`; follows them to another browser) and also kept in the browser (`erp.lang`, `apps/web/src/lib/i18n.tsx`) so it applies before sign-in finishes; it can be changed with the switch on the tutorial and Guide pages or in Settings > General. Sets `lang` and `dir` on the page, so layout flips for Arabic.
- **Built (version 1, 3 Nov 2026, not deployed):** the tour. A "Take the tour" button on the Getting-started page and on the Guide opens it; it asks for a language first if none is chosen; walks up to 7 real screens (home, new request, requests, ledger, audit log, alerts, Guide) with a highlight and a tooltip; skips steps the person's permissions or modules do not allow; skips a step whose element never appears; Back, Next, Finish, Skip, Escape; language switch inside it keeps the step; leaving by hand ends it; the button reads "Take the tour again" afterwards (per browser). Files: `apps/web/src/modules/help/{TourHost.tsx,tourSteps.ts,tourContent.ts}`. **Not built:** progress saved on the account, automatic start for new people (it is offered, never forced), sample companies' own setting, translated screens (they stay English).
- **Arabic coverage, stated honestly:** shell menus (16 strings), the tutorial and the Guide. Everything else is English. All Arabic is a machine draft awaiting a native reviewer.

## 3. How language drives the tour

1. The tour never starts before a language is chosen. If the person has not chosen (`personalLang` is null) the same bilingual chooser is shown first; after the choice the tour starts in that language. A company default language (Settings) applies to menus but does not skip the question.
2. Every tour string lives in a per-language content object (same pattern as `helpContent.ts`), never inside the component. A test fails if a step exists in one language and not the other, or if the bolded or numbered parts differ.
3. Direction: the tooltip, the arrows ("Next" points left in Arabic) and the highlight's placement use logical sides (start/end), not left/right, and are checked in both directions.
4. Changing language in the middle of a tour keeps the current step and re-renders its text; it never restarts the tour.
5. Where a screen itself is still English (most of them), the tour text is in the chosen language and says so once ("this screen is still in English"), rather than pretending.
6. Arabic text is reviewed by a native speaker before it is shown to a customer; until then the draft note stays visible, as it is on the tutorial today.

## 4. The tour (proposed 7 steps, on real screens)

Each step needs a permission or module; a step the person cannot use is skipped, so staff, admins and viewers get different, shorter tours.

| # | Screen | Says | Shown to |
|---|---|---|---|
| 1 | Home | What the cards mean (title, subtitle, period) | everyone with the cards |
| 2 | Inventory > New stock request | Asking for stock reserves it; nothing leaves yet | can create requests |
| 3 | Inventory > Requests | A different person approves; the database refuses self-approval | can approve |
| 4 | Inventory > Stock ledger | Every movement is recorded and cannot be edited | can read inventory |
| 5 | Settings > Audit log | Who did what and when | owner, admin |
| 6 | Alerts | The system watches for you | owner, admin |
| 7 | Guide | Where to read more; replay the tour | everyone |

Demo and sample companies: the tour is **off** unless switched on, so a demo is never interrupted.

## 5. Approach

- A small component written for this product (no tour library: licences and weight are not worth it for seven steps): a step list, a target selector per step (`data-tour="..."` attributes on the real buttons), a tooltip anchored with logical placement, focus management and Escape to close. Keyboard and screen-reader friendly (focus moves to the tooltip, `aria-live` announces the step).
- State: current step and "done / skipped" per person. Start in `localStorage` (like the language); moving it to the database (per user) is an open question below.
- A missing target (a button hidden by permission or screen size) skips its step silently instead of breaking the tour.
- No new API routes and no database change for the first version.

## 6. Tests

Pure tests: content parity between languages, step skipping by permission, "never start before a language is chosen", language change keeps the step. Rendering checks in a browser (needs Ben's OK to use Chrome): both directions, narrow screen, keyboard only. Existing tests must keep passing.

## 7. Open questions for Ben

1. ~~Save the language on the account?~~ **Decided yes (3 Nov 2026):** built as `sql/038` (one row per person, own-row read only, written only by `core_set_my_language`). **Applied to the live database 3 Nov 2026**; the web build that uses it is not deployed yet.
2. Should the tour start automatically for a new person, or only when they press "Take the tour"? (Recommended: offer it once, never force it.)
3. Which Arabic reviewer, and which terms for approval, ledger, batch and expiry should be fixed first?
4. Should the sample companies offer the tour (as an optional button), or never?

## 8. Order of work

1. Language selection and tutorial text in both languages (done, 3 Nov; not yet checked in a browser).
2. Native review of the Arabic.
3. The tour component and its first 4 steps, then the rest.
4. ~~Server-side language preference~~ built 3 Nov 2026 (not applied).
