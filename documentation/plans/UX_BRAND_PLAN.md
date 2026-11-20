# New look and UX plan (Bellvox)

**Module:** none. This plan changes the app frame and the screens of all modules. It does not change the database.
**Status:** Draft. Ben must approve it.
**Owner:** Ben · **Approve the mockups:** Ben and Chris
**Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md), phase 0 and step 1b
**Earlier work:** [UI polish plan](2026-11-03-ui-polish-plan.md) · [UI audit](2026-11-04-ui-audit.md) ·
[UX decisions, 9 Nov](../planning/2026-11-09-ux-decisions.md) · [walkthrough review, 10 Nov](../planning/2026-11-10-walkthrough-review.md)

> **In short**
> 1. **Fix broken links now** (hours).
> 2. **Check every screen** on the live test site, in English and Arabic.
> 3. **Make the Bellvox look**: colours and font from bellvox.ai, light and dark mode.
> 4. **Make the menu smaller**: about 6 sections.
> 5. **Show mockups** to Ben and Chris. Get approval.
> 6. **Change the screens** one by one.

---

## 1. Goal

A buyer's first ten minutes must feel calm, clear and branded.

What Chris said on 20 Nov:
- too many menu items
- crowded screens
- an old or plain look
- "everything is a mess"

The product becomes **Bellvox ERP**. It uses Bellvox colours and font. Each customer adds its own logo.

## 2. What we do

### Phase 0: quick fixes (first, a few hours)

1. **Wrong tile links.** In `apps/web/src/modules/core/OwnerHome.tsx`, two tiles open `/sales/invoices`:
   - **Top products** must open a list of products by sales.
   - **Receivables and payables** must open the list of money owed to us and money we owe.
2. **Bell notifications that open nothing.**
   - Low stock: the low stock plan adds the link.
   - Overdue invoices: link to the invoice.
3. **Other broken links** that the check finds: fix them at once. They need no decision.

### Step 1b: the new look

**1. Check every screen**
- Claude uses a browser on the **live test site**. Ben allowed this on 20 Nov. The site has only test data.
- Each screen: English and Arabic, computer width and phone width.
- For each screen we write down:
  - a screenshot
  - the problems, most serious first: clutter, unclear order, wording, broken parts, right-to-left problems
  - the fix
- The report is [`documentation/planning/2026-11-20-ux-audit.md`](../planning/2026-11-20-ux-audit.md) (done 20 Nov). Screenshots stay on the computer. They do not go into git.

**2. Bellvox look**
- For now we take colours and fonts from **bellvox.ai**. There is no brand guide yet. We ask Grant for one.
- We set colour, font, corner radius and shadows for **light and dark** mode.
- The app already keeps these in CSS variables (`--primary`, `--font` in `styles.css`). So we change the look in one place.
  Today's font is IBM Plex Sans Arabic.
- The font must support Arabic. If the Bellvox font has no Arabic, we pick an Arabic font with a similar style.

**3. A smaller menu**
- About **6 sections:** **Home, Sell, Buy, Stock, Money, Settings.** Sub-pages go inside them.
- The menu shows **only modules that are turned on**.
- It **hides** what a person has no permission for. Today some of these items show in grey.
- Later, companies can hide, reorder, pin and rename menu items (roadmap step 3a).

**4. Mockups**
- Key screens: home, a list screen, an invoice, stock overview, settings.
- We build them in a **separate git worktree with its own preview links**, the same way as the earlier new UI.
- **Ben and Chris approve** before we change the real screens.

**5. Change the screens one by one**
- After approval, the new look replaces the old one. There is no on/off switch.
- Order:
  1. app frame and menu
  2. home
  3. sales and invoices
  4. stock
  5. purchasing
  6. money
  7. settings

**6. Product name**
- "Bellvox ERP" shows in the app frame, sign-in page, browser tab, emails and the printout footer.
- The printout footer says "Made with Bellvox ERP". We can remove it later.
- The customer's logo and name show in the header.

### Not now
- Customer colour themes and white-label. Ben said no on 20 Nov.
- Patterns from reference apps. Ben is looking at reference apps. We add these when he decides.

### Never
- Changes to data, approvals or permissions.
- Hiding a menu item never gives or takes away access.

## 3. Database changes

None. The menu stays in code (`registry.tsx`).
The company logo goes in company settings. The invoice printing plan uses the same logo.

## 4. Permissions

No new permissions. The menu reads the existing permissions to hide items.

## 5. API

None. `GET /v1/core/session` already gives the modules and permissions.

## 6. Screens

All screens.
- Every new text has English and Arabic. Arabic machine drafts go on the Arabic review sheet.
- Use only logical CSS properties (start and end, not left and right).
- The screen check covers right-to-left layout.

## 7. Design rules for the mockups and screens

1. One main button on each screen, at the top, on the "end" side. Other actions go in a "More" menu.
2. Lists show fewer columns at first. More columns come with saved views later.
3. A list has one search box and at most three visible filters.
4. Money: show the currency one time at the top of the column, not in each cell.
5. An empty screen says what to do next. It has one button.
6. Use plain words. Say "Receive goods", not "Receipts".

## 8. Tests

- The existing web tests and the CI smoke test (`apps/web/e2e`) must pass after each screen.
- **New test:** a role without a module sees no menu item for that module.
- **New test:** every tile link and menu link opens a real page.

## 9. Open questions

1. Which font does bellvox.ai use? Does it support Arabic? If not, which Arabic font goes with it?
   We find out in step 2. We also ask Grant for the brand guide.
2. Which reference apps did Ben choose? (Later.)
3. Preview links: we used preview deployments for the earlier new UI. Check that this still works before the mockup step.
