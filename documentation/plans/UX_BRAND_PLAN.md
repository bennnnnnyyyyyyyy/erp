# UX overhaul and Bellvox look plan

**Module key:** none (web app shell and every module's screens; no database change except where noted)
**Status:** `[📝 Draft, awaiting Ben's approval]`
**Owner:** Ben · **Reviewers:** Ben and Chris (mockups) · **Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md) phases 0 and 1b
**Earlier work:** [UI polish plan](2026-11-03-ui-polish-plan.md), [UI audit](2026-11-04-ui-audit.md),
[UX decisions 9 Nov](../planning/2026-11-09-ux-decisions.md), [walkthrough review 10 Nov](../planning/2026-11-10-walkthrough-review.md)
(task-first Inventory built 11 Nov)

---

## 1. Goal

A buyer's first ten minutes should feel calm, branded and obvious. Chris (20 Nov): **too many menu items, crowded screens, a dated or
plain look**, and "everything is a mess". The product becomes **Bellvox ERP**, in Bellvox colours and font, with each customer's logo.

## 2. Scope

**Phase 0, quick fixes (first, hours):**
- Q1. Tiles open the wrong page: in `apps/web/src/modules/core/OwnerHome.tsx`, **Top products** and **Receivables and payables** both
  link to `/sales/invoices`. Top products → a products ranking; Receivables → receivables and payables.
- Q2. Bell notifications for low stock and overdue invoices open nothing (they carry no link). Low-stock links are covered by the
  low-stock plan; overdue invoices link to the invoice.
- Q3. Any other dead or wrong link found in step 1 of the audit is fixed straight away (no decision needed).

**Phase 1b, the overhaul:**
1. **Audit** (Claude drives a browser on the **live test site**, Ben's permission 20 Nov; test data only): every screen in English and
   Arabic, desktop and phone width. For each screen: screenshot, problems ranked (clutter, hierarchy, wording, broken, RTL), fix.
   Output: `documentation/reviews/2026-11-ux-audit/` (written report; screenshots stay local, git-ignored).
2. **Bellvox design tokens**, taken from **bellvox.ai** for now (no brand guide yet; Grant document asks for one): colours, font,
   radius, shadows, **light and dark**. The app already uses CSS variables (`--primary`, `--font` in `styles.css`; font today IBM Plex
   Sans Arabic), so the look changes in one place. The font must cover Arabic; if Bellvox's font has no Arabic, pair it with an Arabic
   font of similar style (decision §9).
3. **Navigation: about 6 top-level sections**: **Home, Sell, Buy, Stock, Money, Settings**, with sub-pages inside. **Only switched-on
   modules** are shown, and items the person has no permission for are hidden (today some show greyed). Later, with customisation
   (roadmap 3a), companies can hide, reorder, pin and rename.
4. **Mockups** of the key screens (home, a list screen, an invoice, stock overview, settings), built in **a separate git worktree with
   its own preview links**, the same way as the earlier new UI. Ben and Chris approve before rollout.
5. **Rollout screen by screen** behind no switch (the approved look replaces the old). Order: shell and navigation → home → sales
   and invoices → stock → purchasing → money → settings.
6. **Product name** "Bellvox ERP" in the shell, sign-in, browser title, emails and printouts footer ("Made with Bellvox ERP", removable
   later). Customer logo and name in the header.

**Out:** customer colour themes, white-label (Ben, 20 Nov: no). Reference-app patterns: Ben is researching them; added when he
decides.
**Won't:** changes to data, approvals or permissions. Hiding a menu item never grants or removes access.

## 3. Data model

None for the overhaul. Navigation stays in code (`registry.tsx`). Company logo already exists or goes to company settings (shared
with the invoice printing plan).

## 4. Permissions

No new keys. The menu reads existing permissions to hide what a person can't use.

## 5. API

None, except `GET /v1/core/session` already returns modules and permissions.

## 6. Screens

All. Every new string gets English and Arabic (machine drafts listed for the Arabic review sheet); logical CSS properties only; RTL
checked in the audit.

## 7. Design rules (for the mockups and rollout)

- One main action per screen, top-inline-end; secondary actions in a "More" menu.
- Lists: fewer default columns (the rest via saved views later, roadmap 3a); a search box and at most three visible filters.
- Numbers right-aligned in LTR, logical alignment in RTL; money with the currency once per column, not per cell.
- Empty screens say what to do next with one button.
- Plain words over record names ("Receive goods", not "Receipts").

## 8. Tests

Existing web tests and the CI smoke test (`apps/web/e2e`) must pass after each screen; add a navigation test: a role without a module
sees no menu entry for it; a test that every tile and menu link resolves to a real route.

## 9. Open questions

1. Bellvox font: which font does bellvox.ai use, and does it cover Arabic? If not, which Arabic pairing? (Settled by reading the site
   during step 2; Grant is asked for the brand guide.)
2. Which reference apps did Ben pick? (Later.)
3. Preview links: same mechanism as the earlier new UI (a preview deployment per branch). Confirm it still works on the current
   Cloudflare set-up before the mockup step.
