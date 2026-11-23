# Dynamics 365: user experience and workflows (the base for the new Bellvox ERP UI)

**Part of:** [TEARDOWN.md](TEARDOWN.md) (same product family; that file covers purchase features, this one covers how people work).
**Why:** Ben, 23 Nov 2026: the new UI takes Dynamics 365 as its base for **user experience and workflow**. Visuals matter less and
stay Bellvox (red, Rubik). Not Odoo.
**Sources (seen, 23 Nov 2026, read only, in a browser):** Microsoft's public guided tours at guidedtour.microsoft.com:
- *Supply Chain Modernization* (all 6 sections, every step),
- *Business Central* (all 6 sections; Business Central is Microsoft's ERP for small and mid-size companies, the closest to our customers),
- *Finance Modernization* (the start of each section).
Claims marked **seen** were on screen in the tours. Claims marked **documented** come from Microsoft's public product documentation
as Claude knows it and were **not re-checked** this time.
**Studied by:** Claude (track-c) · **Rule:** behaviour only, in our own words. No code, images, icons or text copied. No screenshots in git.

> **In short**
> - Dynamics is built on a few page types that always behave the same: a **home page per role**, **lists**, **record cards**,
>   **documents** (header, lines, totals), **workspaces** (one task area), **wizards** (set-up) and **reports**.
> - Home pages show **what needs you** (counts and alerts you can click) and **quick "create" actions**, not a launcher of apps.
> - Every list and record has the **actions in one bar at the top** and **related facts in a side panel**. You drill from a number to
>   the filtered list to the record, and back.
> - Set-up is a **wizard**: steps on the side, defaults filled in, a review page, then Finish.
> - The newest home pages (2024) open with a greeting and **a count of things that need the person**, one line and one action each, plus a box to type what
>   you want to do.

## 1. The frame (seen in all three tours)
| Part | What it does |
|---|---|
| App bar (top) | Product or app name; one **global search** (find a page, or type what you want to do); company or legal entity; notifications; settings; help; the person's avatar. |
| Navigation, Business Central | A **short row of areas** under the company name, each a drop-down (Finance, Cash management, Sales, Purchasing, Setup). Under it a row of **quick links** to the most-used lists (Customers, Vendors, Items, Bank accounts, Chart of accounts). |
| Navigation, Finance and Supply Chain | A **left menu**: Home, Recent, Pinned (favourites), then the pages in **groups with small headings**. It folds to an **icon rail**. |
| Full map | **"Explore all" / Role Explorer**: one page listing every page of the product, grouped by area, with counts per group; it opens further on click. The short menu shows only the role's areas; the map shows everything. |
| Assistant | A **side panel** (Copilot) that knows the page you are on, offers ready prompts, and shows a **preview** of what it will create; the person confirms. |

## 2. Page types
### 2.1 Home page per role ("Role Center")
- **Seen (Business Central):** a headline; an **Actions** box with quick create links (+ Sales quote, + Sales order, + Sales invoice,
  + Purchase order, + Purchase invoice, Payments, Reports); **Activities**: 4 big figures (sales this month, overdue sales amount,
  overdue purchase amount, invoices predicted to be late), each with "See more"; **count tiles in groups** (Ongoing sales: quotes 2,
  orders 4, invoices 7; Ongoing purchases; Payments; Approvals: requests to approve; Incoming documents); **Insights**: a chart you
  switch with a picker (top customers, cash flow), a small trial balance, favourite accounts.
- **Seen (Finance, 2024):** a greeting by name and a sentence saying how many insights and suggestions need the person. Then one line per
  item with one action each (duplicate vendor payments found → Explore; budget exceeded → Explore; trial balance due on the 28th →
  Run report; 8 period-close tasks overdue → Explore). Two charts on the side. A **box to type what you want to do** at the bottom.
- **Seen (Supply Chain, older):** company banner, calendar, **"Work items assigned to me"** (approvals waiting), and a grid of
  workspaces. (Our UX audit flagged app tiles that copy the menu; the newer Dynamics home pages above do not lead with them.)
- **Behaviour:** every number is a **link to the filtered list behind it** (seen: overdue amount → customer ledger entries, late rows
  in red).

### 2.2 List page
- **Seen:** title with the work date; an **action bar** with groups (New, Edit list, Delete, Process, Report, Navigate, Page, More
  options); a **search** and a **filter** button; a **view picker as the title** ("Active forecasts ▾"); **Edit columns**, **Edit
  filters**, a keyword filter; sortable column headers; the record number or name as a **link**; **paging** at the bottom ("1-3 of 3").
- **Seen:** an **info button opens a side panel ("FactBox")** with facts about the selected row (for a ledger entry: due date, applied
  entries, the customer's credit limit and payment terms). The list stays where it is.
- **Seen:** group rows in **bold**, amounts right-aligned; overdue rows in red.
- **Documented, not re-checked:** saved views per person, a filter pane, "Open in Excel".

### 2.3 Record card (one master record: item, customer, job)
- **Seen:** small type label above; title **"Number · Name"**; icons **Edit, + New, Delete**; **"✓ Saved"**: changes save by
  themselves, no Save button; action bar (Process, the record's own actions, Request approval, More options); **folding sections
  ("FastTabs")**: Item, Inventory, Costs & posting, Prices & sales, Replenishment; each shows the **important fields first** with
  "Show more"; labels and values in two columns; **side panel** with Details / Attachments (picture, attributes, forecast);
  **previous / next arrows** to move through the list without going back.
- **Seen:** a new record from a **template**, the number filled in automatically.

### 2.4 Document (order, invoice, quote, journal)
- **Seen:** a **General** section (party, contact, dates, the other side's document number); the **Lines** grid with its own small
  action bar; a **totals block under the lines** (discount, total before tax, tax, total with tax); more sections below (invoice
  details); the side panel. A **posted** invoice is a separate, read-only page type.
- **Seen:** a journal: header fields (batch, posting date, currency), a lines grid, **totals and balance under the grid**, **Edit in
  Excel** and back with **Publish**.

### 2.5 Workspace (one task area)
- **Seen (maintenance requests):** "My view ▾" + title; tabs **Workspace | Analytics**; a **Summary** row of tiles: counts that filter
  the list below (32 active requests, 0 created since yesterday) and one **"+ Create"** tile; then the list with **ready-made filters
  on the side** ("without work order", "created since yesterday") and the task's actions above it (Create work order, Update state).
- **Seen (purchase order changes):** summary cards (low impact 352, high impact 16, downstream impact 39), each with **Show**; then
  **three linked panes**: orders → the lines of the selected order (warning marks on risky lines) → what they affect downstream.
  After the fix, the warnings turn into green ticks and the counts go down, on the same page; the person never leaves the task.

### 2.6 Wizard (set-up)
- **Seen (new warehouse):** steps listed on the side (Welcome → Warehouse selection → Inbound setup → Complete) with ticks; the
  content on the right; **defaults filled in**, the person can change them; a **required field shows red and Next stays off** until it
  is filled; **Back / Next / Cancel** at the bottom; the **last step is a review** ("these records will be created") with **Finish**.

### 2.7 Report and dashboard
- **Seen:** filter chips at the top (company, currency, period); a **status card** ("Account reconciliation: Completed ✓"); figure
  cards; a summary table with **folding groups**; "Updated at…"; Favourite, Download, Duplicate, Snapshots; report tabs at the bottom.
- **Seen:** an empty module opens on **"Get started"**: 3 cards, each with **one main button** and "Learn more".

### 2.8 Rules and flows without code
- **Seen:** an order journey drawn as a **vertical chain of steps** (check the order, check the lines, choose the warehouse, split
  to own warehouse or partner, update stock) with a settings panel on the side. The stated aim: people handle only the exceptions.

### 2.9 Working from where the message arrives
- **Seen (Outlook):** from an email with an invoice, Business Central opens **beside the email**, suggests the line items it read
  from the email (tick boxes), and creates the purchase invoice there; from a quote request, it builds the sales quote in the side
  panel. The same records, opened from the message.

### 2.10 Assistant actions
- **Seen:** the assistant lists approved vendors with a score, the person asks in plain words, it shows a **preview card** of the new
  purchase order (product, quantity, price), the person presses **Create**, it confirms with a link to the new order.

## 3. What this means for our screens (for Ben and the team to decide; each still comes as 2 or 3 versions)
| Our screen | Dynamics pattern to build one version from |
|---|---|
| 2 Create company / sign up | **Wizard** (2.6): steps on the side, defaults (Egypt, EGP, language), red required fields, review page, Finish. Empty modules open on **Get started** cards (2.7). |
| 3 Main page | **Role home** (2.1): a count of what needs the person, one line and one action each, count tiles that open filtered lists, quick-create actions, 2 to 4 key figures; no app launcher. **Frame** (1): app bar with one search, short area menu or a left menu with Home / Recent / Pinned, and an "Explore all" map. |
| 4 Each tab, list page | **List** (2.2): one action bar, view picker as title, filters, paging, side panel for the selected row. |
| 4 Each tab, detail page | **Record card** (2.3) or **document** (2.4): folding sections with important fields first, side panel, totals under lines, previous / next. |
| 4 Approvals and exceptions | **Workspace** (2.5) with counts that filter the list, and the fix done on the same page. |
| WhatsApp and voice | **Working from the message** (2.9) and **assistant preview, then confirm** (2.10). This fits our rule: a channel or an assistant prepares; a person confirms; the database function decides. |

## 4. Open points (not seen in the tours; would need a trial or Microsoft's docs)
- How Dynamics handles Arabic and right-to-left (Business Central is offered in Arabic in some markets; **not seen**).
- Phone layouts (the tours show desktop only).
- How approvals look to the approver (only the count tile "Requests to approve" was seen).
