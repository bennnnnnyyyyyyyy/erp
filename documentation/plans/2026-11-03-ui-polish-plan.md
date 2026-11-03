# UI polish plan: from "vibecoded" to finished (2026-11-03)

Ben: "the ERP feels vibecoded, I need to polish everything; the audit does not cover everything I need." The earlier audits
([`2026-11-04-ui-audit.md`](2026-11-04-ui-audit.md), [`../reviews/2026-11-02-ui-audit.md`](../reviews/2026-11-02-ui-audit.md)) listed
symptoms page by page. This plan goes after the **causes**, so the fixes land on every screen at once and stay fixed.

## Why it feels unfinished (measured in `apps/web/src`, 47 screen files)

| Cause | Evidence | Effect on screen |
|---|---|---|
| Two styling systems side by side | 87 hand-styled `<button>` vs 35 shared `Button`; 90 Tailwind utility classNames next to 285 old CSS classes; 25 inline `style={{}}` | Similar things look slightly different everywhere; no clear main action |
| No page structure | 48 pages each build their own title, intro, form and tables; 34 hand-built `<table>` vs 12 `ListView` | Uneven spacing, forms floating half-width, inconsistent toolbars |
| Developer-voice copy | 25 intros averaging 137 characters, explaining internals ("Available = on hand minus reserved", "No VAT. Not an accounts report") | Reads like a spec, not a product |
| Bare states | 40 plain "Loading…" texts; errors shown as grey text; empty states with no next step; Home shows "Made EGP 0" in green with "All good" for a company with no data | Feels unfinished the moment data is slow or missing |
| Numbers without meaning | "287,963.501 units on hand" adds kilograms, litres and pieces; a stock bar that is always full | Figures a manager cannot use |
| Forms before content | Create forms open above the lists on most screens | The thing people came to see starts half a screen down |

## Rounds

Each round is frontend only unless stated, ends with typecheck, tests, a build, a local look in the sample build and a WORKLOG entry.

### Round 1: foundations and honesty (done 2026-11-03, see WORKLOG)
- One plain line under every title: 18 intros rewritten (English and Arabic); detail stays in the Guide. Profit overview keeps its
  "management view, not an accounts report" note as a footnote.
- Page rhythm: title, one line, a clear gap; forms fill a proper width on a grid that wraps (two to four fields a row, one on a phone).
- `components/Loading.tsx`: a page-shaped skeleton instead of "Loading…" on 38 screens; a failed load shows as an error.
- Home: cards with nothing behind them say so, without a colour or an "All good" dot; real plurals instead of "batch(es)", "item(s)".
- Stock on hand: status against the reorder level (Low / OK / —) instead of an always-full bar; "Low on stock" card instead of unit totals.
- Earlier the same day (separate entries): lists before forms on the money screens, confirm before void, clickable rows, record pages.

### Round 2: one component kit (started 2026-11-03)
- **Done:** the cause of identical buttons fixed (unlayered `button {}` beat every Button variant; element styles now in `@layer base`);
  72 plain raw buttons moved to `Button` (15 specialised ones remain by design); empty-list state; forms and notices aligned to the page width.
- Still to do in this round:
- `PageHeader` (title, one line, actions on the end side, optional back link) on every page; the page's main action is the only filled button.
- `Field` (label, control, hint, error) and `Select` / `Input` from the kit for the 38 selects and 67 inputs; required marks; inline errors.
- `EmptyState` (what is empty, why it matters, the one action that fills it) for every list.
- Move the remaining 22 hand-built tables onto `ListView` or a shared `DataTable` (same header, density, numeric alignment, sort, empty state).

### Round 3: screen by screen
- **Done 2026-11-03:** forms behind a button on Batches, Alerts, Stock adjustments and Approval policies; Profit overview empty state;
  Settings > General sections and short hints; Users actions (in-place confirm, real buttons, translated role and status); one
  calendar-date format (`formatDay`). Still open below: request, transfer and order pages on the shared facts block, Users names.
- Remaining always-open forms behind a button (Batches, Alerts, Transfers, Adjustments, Users invite already a modal).
- Settings > General: cut the long help paragraphs; group into sections; save bar.
- Users: names before emails (needs full names, a data step for Ben), role as a pill, "Disable" as a real button with confirm.
- Profit overview with no data: an empty state instead of an axis of zeros.
- Request, transfer, order pages: the same `facts` block and action bar as the new invoice and payment pages.
- Dates: one format everywhere (some lists show `2026-11-01`, others `01/11/2026 18:40`); follow the company's date format.

### Round 4: phone and Arabic
- **Done 2026-11-03:** `ListView` lists as cards on phones; record pages (request, transfer, purchase and sales order) on the facts
  block; Home card titles use business names. Still open: hand-built tables on phones, native Arabic review, keyboard pass.
- Lists become cards under 720 px (number, status, one line), not sideways-scrolling tables.
- A real Arabic pass by a native speaker of every screen (the texts are a machine draft); numbers and dates in Arabic mode.
- Keyboard pass: focus order, visible focus on rows, skip link.

### Round 5: ERP terminology and finishing (done 2026-11-03)
- 145 texts moved from everyday wording to standard ERP terms (English and Arabic), Guide and tour included; every table a card on
  phones (`TableLabels`); skip link; `scope="col"` on all table headers. See the WORKLOG.
- Left on purpose: a shared `PageHeader` / `Field` component refactor (the pages already look consistent after rounds 1 to 3; the
  refactor is internal and touches all 48 pages) and the native Arabic review (needs a person).

### Not in these rounds
- Pagination of long lists (API change, touches every list; separate plan).
- Bundle splitting (750 kB single file), a second theme, branding per customer.
