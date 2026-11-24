# Dynamics 365 round 2: what Microsoft's own documentation says (24 Nov 2026)

**Part of:** [TEARDOWN.md](TEARDOWN.md) and [UX_WORKFLOWS.md](UX_WORKFLOWS.md) (round 1: guided tours, 23 Nov).
**Product:** Dynamics 365 **Finance** and **Supply Chain Management** (the "Finance and Operations apps"). Not Business Central.
**Source:** Microsoft's public documentation repo `github.com/MicrosoftDocs/dynamics-365-unified-operations-public`
(licence CC BY 4.0, (c) Microsoft). 5,151 pages (text only) downloaded on 24 Nov 2026 to `.temp/d365-docs` (local, not in git).
**Studied by:** Claude (track-c), five readers in parallel, one topic each. **Rule:** behaviour only, in our own words; only UI labels
are quoted. Every claim in the topic files gives the source page. All claims are **documented** (read in the docs), not seen on screen.

> **In short**
> - Round 1 showed the look. Round 2 shows the **rules behind it**: about 90% of Dynamics pages use a few fixed page types, each with
>   strict rules (what goes where, how saving, errors and buttons work).
> - Most of our "Dynamics" versions (the A options on the decision page) are confirmed by the docs. Some other versions are also
>   supported: settings B (two panes), clerk B (steps), confirm B (dialog with a safe default).
> - **Approvals:** Dynamics lets a person approve their own document **by default**. Our database rule is stricter. Keep ours.
>   But Dynamics has actions we lack: **Request change**, **Recall**, **Delegate**, time limits and reminders.
> - **Stock:** journals (draft → validate → post), never edited after posting (same as our ledger). Phone app: one step per screen,
>   scan first, **blind counts** with a supervisor review of big differences, short lists of reasons.
> - **Accounting:** month-end close workspace, period **On hold** before final close, "simulate posting" before posting, invoice
>   matching with Passed / Failed per line, bank reconciliation worksheet. Egypt: ETA e-invoicing, VAT form 10, WHT forms 41 and 11.
> - **AI:** the AI proposes, the person applies. Changes show **current value → proposed value** with **Apply**. Bill scanning shows
>   the photo beside the form; clicking a field highlights it on the photo.
> - **Where we are ahead:** strict self-approval in the database; Arabic right-to-left also on the phone (Microsoft's approval app has
>   none); Egyptian chart of accounts and EAS statements (not in Microsoft's docs); WhatsApp and voice (none); duplicate check by
>   supplier + bill number (Microsoft checks only the file).

## Topic files
| File | Covers |
|---|---|
| [docs-round-2/1-frame-and-pages.md](docs-round-2/1-frame-and-pages.md) | Frame, menu, search, page types and their rules, saving, errors, lists, saved views, keyboard, right-to-left |
| [docs-round-2/2-approvals.md](docs-round-2/2-approvals.md) | Requester and approver sides, routing, time limits, delegation, what blocks posting, phone approvals app, compared with our rules |
| [docs-round-2/3-stock-and-warehouse.md](docs-round-2/3-stock-and-warehouse.md) | Stock journals, counting, on-hand page, transfers, low stock, the warehouse phone app |
| [docs-round-2/4-finance.md](docs-round-2/4-finance.md) | Chart of accounts, journals, period close, financial reports, payables, receivables, bank, VAT, Egypt |
| [docs-round-2/5-sales-ai-mobile-language.md](docs-round-2/5-sales-ai-mobile-language.md) | Sales order to cash, Copilot and bill scanning, phone apps, language, Arabic, Egypt |

## 1. Our screen questions: what the docs support
"Supports" means the documented Dynamics behaviour is closest to that version. It is evidence for Ben and Grant, not a decision.

| Screen | What Dynamics does (documented) | Closest version |
|---|---|---|
| Create company | A wizard: one question per step, title and instruction per step, Next / Previous, Cancel goes back to the start, last step is a review. | **A** (wizard). B also fits "one question per step". |
| Menu | Left menu: Home, Favourites (star), Recent, Workspaces, Modules (a module opens a second panel). Can be pinned or folded. A separate page search (title and menu path, top 10). | **B** (left menu) |
| Home page | Old: tiles to workspaces + "Work items assigned to me". Newest ("Immersive Home"): greeting, a ranked list of work cards with action buttons, act without leaving the page. | **A** (attention list) |
| List page | List and record are one page: a grid view and a details view with a short list on the left. Quick filter, filter pane, saved views as the page title, totals footer, side panel of facts. | **A**. B matches the details view with the list beside it. |
| Document page | Header view and Lines view. Status at top right. Line actions on the lines toolbar, not the top bar. Approval state in a bar on the record. Post is off until approved. | **A**. C's "only the next valid actions" is also advised by the stock reader. |
| Record page | Sections that fold; the first section holds the most important fields; a read-only facts panel at the side; previous / next. | **A** |
| Form page | A small "create" panel first (customer only), then the full document. Mandatory fields marked; errors show in a bar and do not stop typing. | **A**, with a small first step |
| Report page | On-hand list: filter pane, a "show by" chooser (warehouse, location, batch), fixed quantity columns, drill to the movements behind a number. Financial reports: line → account → transactions. | **A** |
| Approvals | Desktop: workspace with count tiles, filtered lists, act from the record. Phone app: count tiles, list with multi-select, detail with a timeline. No one-click buttons per row. | **A** on desktop; **B** fits the phone and WhatsApp; C is not a Dynamics pattern. |
| Settings | Vertical list of setting groups on the start side, content beside it, in the order you fill them in. | **B** (two panes) |
| Empty start | Not in the docs (only: never add a blank row by itself). | Our own call |
| Phone menu | The general phone app is retired. The warehouse app uses menus per role; the approvals app opens on count tiles. | No direct match. Our own call. |
| Send goods out (phone) | Warehouse app: one step per screen, big short title, scan first, number pad, short list of reasons, confirm step, sound on success or error. | **B**, with C's −/+ cards as the items step |
| Confirm a risky action | A blocking box only when the user cannot go on. The default button is the safest one; never a destructive default unless undo is easy. | **B** (dialog with a safe default). C (undo) is allowed by their rule only where undo is real. |
| Where reports live | Reports live inside each workspace (an Analytics tab) and every list exports to Excel. Any page can pop out into its own window. | **A**; B exists as "pop out" on every page |

## 2. Ideas worth taking (not in our current plans)
| Idea | From | Where it would go |
|---|---|---|
| Request change, Recall (requester), Delegate | Approvals | Approvals; WhatsApp replies stay Approve / Reject |
| Time limits and reminders, then another owner or admin | Approvals | Our version of escalation |
| Re-approval when an approved request changes (items, quantity, warehouse) | Approvals | Request rules |
| Blind count + "review differences" list above a limit | Stock | Counts |
| Short list of reasons per action, mandatory by setting | Stock | Adjust, send out, count |
| "Show by" chooser + drill to the ledger lines behind a number | Stock | Stock report |
| Transfer in two steps: shipped (in transit) → received, partial receive | Stock | Transfers |
| Errors in a bar on the page, not a box; the bar goes when fixed | Frame | All forms |
| Saved views per person, published views per role | Frame | All lists |
| Keyboard shortcuts (page search, save, edit, new) | Frame | All pages |
| Validate and "preview posting" before Post | Finance | Journals, invoices |
| Period **On hold** before final close; month-end task list | Finance | Accounting |
| Invoice lines: receipt quantity match, price match: Passed / Failed | Finance | Supplier invoices |
| Bill scan: photo beside form, field → highlight on photo, learn per supplier | AI | Scanning |
| AI changes as "current → proposed", Apply all / Apply selected | AI | Assistant |
| Force codes, phone numbers and account numbers to stay left-to-right inside Arabic | Language | All pages (Arabic) |

## 3. Still open
- Real screens: a trial needs a work email and a Microsoft 365 admin. Not needed for the current questions.
- Not in the docs: empty-list design, delete-confirmation text, report viewer layout, journal page layout, phone menu for the web app,
  Egyptian Arabic interface, what the ETA rejection flow looks like to a user.
