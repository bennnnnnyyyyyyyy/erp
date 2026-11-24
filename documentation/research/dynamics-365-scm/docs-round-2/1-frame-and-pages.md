> **Round 2 (24 Nov 2026), part of [DOCS_ROUND_2.md](../DOCS_ROUND_2.md).** Read from Microsoft's public Dynamics 365 documentation
> (github.com/MicrosoftDocs/dynamics-365-unified-operations-public, licence CC BY 4.0, (c) Microsoft), downloaded on 24 Nov 2026.
> Our own words; only UI labels are quoted. Paths are relative to that repo's `articles/` folder. The download is kept locally
> in `.temp/d365-docs` (not in git).

# Dynamics 365 Finance & Operations: the frame and the page types

Research for the new Bellvox UI. Topic 1 of round 2: the frame (navigation) and the page types (form patterns).

**Status of every claim: documented.** Each fact comes from Microsoft's public docs (CC-BY-4.0). We have not seen any of it on screen.
The text is in our own words. Only UI labels are copied.

**Source path short forms** (all relative to `articles/`):

| Short form | Full folder |
|---|---|
| `UI/` | `fin-ops-core/dev-itpro/user-interface/` |
| `GS/` | `fin-ops-core/fin-ops/get-started/` |
| `DGS/` | `fin-ops-core/dev-itpro/get-started/` |
| `OA/` | `fin-ops-core/fin-ops/organization-administration/` |

---

## In short

- **One frame for all pages.** A top navigation bar (search, company picker, Action center, settings, help, user). A left navigation pane with 4 parts: Favorites, Recent, Workspaces, Modules. Under the bar, each page has an Action Pane. (documented: `GS/user-interface-elements.md`, `UI/page-navigation.md`)
- **About 90% of pages use a small set of fixed patterns.** The main ones: Details Master (customer), Details Transaction (sales order with header and lines), Simple List, Simple List and Details, Table of Contents (settings), Dialog, Drop Dialog, Workspace. (documented: `GS/accessibility-features.md`, `UI/select-form-pattern.md`)
- **The list and the record are one page.** For customers and orders, the list page and the details page are merged. In details view, a narrow list stays on the left so you can jump to the next record. (documented: `UI/details-master-form-pattern.md`, `UI/details-transaction-form-pattern.md`)
- **Pages open in View mode.** The user presses **Edit** (or F2) to change data. **Save**, **New**, **Delete**, **Edit**, **Attach**, **Export**, **Refresh** are system buttons, the same on every page. (documented: `UI/general-form-guidelines.md`, `UI/system-defined-buttons.md`)
- **Validation does not block typing.** A bad value shows a message bar at the top of the page. The message goes away when the value is fixed. Only real "you cannot continue" errors use a blocking message box. Background jobs report to the Action center. (documented: `UI/messaging-user.md`)
- **Workspaces replace role home pages.** One workspace per business activity. Fixed order: summary tiles (counts) first, then tabbed lists, then optional charts, then links. (documented: `UI/workspace-form-pattern.md`)
- **Lists are strong.** Quick filter above the grid, a Filter pane from the left, column-header filters, saved views (personal and published per role), totals footer, grouping (5 levels), freeze columns, bulk edit of selected rows, paste from Excel. (documented: `UI/filtering.md`, `DGS/grid-capabilities.md`, `DGS/saved-views.md`)
- **Keyboard first.** Every action is reachable by keyboard. Alt+N new, Alt+S / Ctrl+S save, F2 edit mode, Ctrl+' action search, Ctrl+/ page search. (documented: `GS/shortcut-keys.md`)

---

## 1. The frame

### 1.1 Parts of the screen

| Part | Where | What it holds | Source (documented) |
|---|---|---|---|
| Navigation bar | Top edge | Dynamics 365 portal link, **Search**, company picker, **Action center**, **Settings** (gear), **Help & Support**, user profile | `GS/user-interface-elements.md` |
| Navigation pane | Left edge, opens from the "hamburger" button | Home, Favorites, Recent, Workspaces, Modules | `UI/page-navigation.md`, `DGS/personalize-user-experience.md` |
| Action Pane | Under the navigation bar, top of each page | Page actions in tabs; action search field | `GS/user-interface-elements.md`, `UI/action-controls.md` |
| Message bar | Under the Action Pane | Info, warning, error for this page | `GS/user-interface-elements.md`, `UI/messaging-user.md` |
| Page | Centre | The content | `GS/user-interface-elements.md` |
| FactBox pane ("Related information") | Right edge | Read-only facts about the selected record | `GS/user-interface-elements.md`, `DGS/personalize-user-experience.md` |
| Filter pane | Slides in from the left, pushes content right | Filter fields for the main list | `UI/filtering.md` |
| Navigation list | Left side of a details page | Short list of records to switch between | `GS/user-interface-elements.md` |
| Slider (side dialog) | Slides in from the right edge over the page | A form that collects input (for example a new record) | `UI/slider-messagebox.md` |

### 1.2 Navigation pane

- It has 4 sections that each collapse: **Favorites**, **Recent**, **Workspaces**, **Modules**. (documented: `UI/page-navigation.md`)
- Click a module: a second panel opens to the right with that module's pages. (documented: `UI/page-navigation.md`)
- A star next to a page in the pane adds it to Favorites. Keyboard: Shift+F on the focused page. (documented: `UI/page-navigation.md`, `GS/shortcut-keys.md`)
- A **Home** icon in the pane returns to the dashboard. (documented: `UI/page-navigation.md`)
- The user can pin the pane open or keep it collapsed; the choice is remembered. Alt+F1 cycles open / pinned / closed. (documented: `DGS/personalize-user-experience.md`, `GS/shortcut-keys.md`)
- Workspaces in the pane and on the dashboard come from one shared menu tree. Users only see what their role allows. (documented: `UI/page-navigation.md`, `GS/default-dashboard.md`)

### 1.3 Search (two kinds)

| Search | What it finds | How | Source (documented) |
|---|---|---|---|
| Navigation search (**Search for a page**) | Pages and workspaces only. Not data, not actions. | Matches words against the page title AND its menu path ("receivable" finds all Accounts receivable pages). Max 10 results. Each result shows title + path. Only pages the role can open. Power users can type `form:` + technical name. Ctrl+/ or Alt+G. | `GS/navigation-search.md`, `UI/page-navigation.md`, `GS/shortcut-keys.md` |
| Action search (in the Action Pane, magnifier) | Buttons on the current page (Action Pane and visible toolbars) | Type 2-4 letters. Each result shows its path, for example "Sales order > View". After the action runs, focus returns to where you were. Ctrl+' or Alt+Q. Drop-dialog buttons and sub-form buttons are not found. | `GS/action-search.md`, `GS/accessibility-features.md` |

### 1.4 Company picker

- The company picker is in the navigation bar. Keyboard: Ctrl+Shift+O. (documented: `GS/user-interface-elements.md`, `GS/shortcut-keys.md`)
- The default company is a user option. (documented: `DGS/personalize-user-experience.md`)
- The dashboard header shows the name of the current company. (documented: `GS/default-dashboard.md`)
- Some workspaces add their own **Company** field at the top. It filters the whole workspace, and **New** creates the record in the filtered company, not the sign-in company. (documented: `finance/accounts-payable/vendor-invoices-workspace.md`)
- A pop-out window shows the company in a read-only top bar. (documented: `GS/display-pages-side-by-side.md`)

### 1.5 Messages: where they go

| Channel | Used for | Behaviour | Source (documented) |
|---|---|---|---|
| Message bar | Result of something the user is waiting for on this page; mostly validation | Info / warning / error. Belongs to the page: gone when you leave, back when you return. Should say the condition and what happens if you go on. | `UI/messaging-user.md` |
| Action center | Results of background work (batch job, report done) | Info / warning / error. Badge shows count since last opened. Keeps up to 500 messages, oldest drop first. | `UI/messaging-user.md` |
| Message box | Only when the user cannot continue | Full-width modal "light box". Page is shaded. Cannot be closed by clicking outside. Bold main line + details. Should say what went wrong, why, and how to fix. | `UI/messaging-user.md`, `UI/slider-messagebox.md` |
| Feature callout | Introduces a new feature next to a control | Can be reset in user options | `GS/user-interface-elements.md`, `DGS/personalize-user-experience.md` |

Rules for the level of a message (documented: `UI/messaging-user.md`):
- Notification = information, no action needed.
- Warning = the data is in a wrong state now (validation).
- Error = an action already failed. It can be passive (message bar / Action center) or interrupting (message box).
- A slider dialog has its own message bar, because the page bar is hidden behind it. Messages sent while the slider closes go to the parent page.
- A group of related messages shows as one bar. Its colour is the worst message in the group.

Alerts: a user can make a rule from any list or record (**Options** tab > **Share** > **Create a custom alert**), for example "record has been created" or "delivery date has been postponed". Alerts arrive as notifications. (documented: `GS/alerts-overview.md`)

### 1.6 Home page (dashboard)

- The default start page is the **default dashboard**. Users can choose another start page in **User options**. (documented: `UI/page-navigation.md`, `GS/default-dashboard.md`)
- Default parts: company header with banner/logo, **Apps** tiles, **Workspaces** tiles (one per allowed workspace), people search, a session date picker, and **Work items assigned to me** (workflow items with links). (documented: `GS/default-dashboard.md`)
- A count tile from a workspace can be pinned to the dashboard; the count then shows under that workspace's tile. (documented: `DGS/personalize-user-experience.md`)
- Newer option, **Immersive Home**: greeting with a short summary, a priority-ranked list of **Work items** as cards (title, summary, action buttons, link), a pinned-items list, and workspace tiles ranked by recent use, favourites first. Many cards let you act without leaving the page; similar items merge into one card. (documented: `fin-ops-core/fin-ops/copilot/immersive-home.md`)

### 1.7 Tiles

| Tile type | Shows | Source (documented) |
|---|---|---|
| Standard | Label only, opens a page | `UI/page-navigation.md` |
| Count | Number of records in the target page's query | `UI/page-navigation.md` |
| KPI | Summary of a KPI | `UI/page-navigation.md` |
| Link | Opens a URL | `UI/page-navigation.md` |

- Standard tile is a 130 px square. Users can pick one of 4 tile sizes (not for KPI tiles). (documented: `UI/page-navigation.md`, `DGS/personalize-user-experience.md`)
- No two tiles in a workspace share a symbol; at most one "New" tile. (documented: `UI/section-tiles-subpattern.md`)

---

## 2. Page patterns

### 2.1 Which pattern for what

| Pattern | Use it for | Our equivalent | Source (documented) |
|---|---|---|---|
| Details Master | Complex master record (customer, vendor) | Record page | `UI/details-master-form-pattern.md` |
| Details Master with Tabs | Master with more than 15 FastTabs, grouped in tabs | Big record page | `UI/details-master-form-pattern.md` |
| Details Transaction | Document with header + lines (sales order) | Document page | `UI/details-transaction-form-pattern.md` |
| List Page | Only when there is no 1:1 details page (mixed lists) | Rare | `UI/list-page-form-pattern.md` |
| Simple List | Simple entity, about 6 fields or fewer (max 15), no children | Small setup lists (units, payment terms) | `UI/simple-list-form-pattern.md` |
| Simple List and Details | Medium entity, more than 6 fields, 0-5 child lists | Setup with details (warehouses) | `UI/simple-list-details-form-pattern.md` |
| Simple Details | A few fields for one record (totals, balances) | Info panels | `UI/simple-details-form-pattern.md` |
| Table of Contents | Setup pages with several related parts | Settings | `UI/table-of-contents-form-pattern.md` |
| Workspace (Operational) | Overview of one activity | Approvals, sales workspace | `UI/workspace-form-pattern.md` |
| Dialog (slider) | Collect input for an action; commit or cancel | New order quick-create, post | `UI/dialog-form-pattern.md` |
| Drop Dialog | 7 fields or fewer, quick, from a button | Small actions | `UI/drop-dialog-form-pattern.md` |
| Wizard | Ordered steps, rare or complex tasks | Company setup | `UI/wizard-form-pattern.md` |
| Lookup | Pick a value for a field | Customer picker | `UI/lookup-form-pattern.md` |
| FactBox (card or grid) | Related facts on the right | Side panel | `UI/factbox-form-patterns.md` |
| Task Single / Task Double | Legacy only, no new pages | none | `UI/task-single-form-pattern.md`, `UI/task-double-form-pattern.md` |

### 2.2 Details Master (record page, for example customer)

Layout (documented: `UI/details-master-form-pattern.md`):
- Two views in one page: **Grid view** (the full list) and **Details view** (one record). The buttons **Grid view** / **Details view** / **Show list** are system buttons, on the **Options** tab. Keys: Ctrl+Shift+G grid, Ctrl+Shift+D details. (documented: `UI/system-defined-buttons.md`, `GS/shortcut-keys.md`)
- Grid view: Quick filter + up to 5 custom filters above the grid. Grid has 2-15 columns, usually all mandatory fields so you can add records right in the grid. First column ID (or Name), shown as a link to open the details.
- Details view, left: side panel with Quick filter and a **navigation list** (list-style grid). Each row max 3 lines, at least 2 fields, usually ID + name.
- Details view, top: title in the form "ID : Name". Optional status fields on the upper right, next to the title. (documented: also `UI/general-form-guidelines.md`)
- Details view, body: FastTabs (collapsible sections, several open at once). The first FastTab is the most important one and must fit without scrolling. Collapsed FastTabs show summary fields in the header line. (documented: `UI/general-form-guidelines.md`)
- Right: FactBox pane.
- Page title is plural (for example "Customers").

### 2.3 Details Transaction (document page, for example sales order)

Layout (documented: `UI/details-transaction-form-pattern.md`):
- Same as Details Master, plus two details views: **Header** view and **Lines** view. Keys: Ctrl+Shift+H header, Ctrl+Shift+L lines. (documented: `GS/shortcut-keys.md`)
- Lines view has 3 FastTabs in this order: a short header summary (the most important header fields), the **lines grid**, and **line details** (standard tabs for the selected line).
- Header view: all header fields in FastTabs. It is required even if small.
- Switching header/lines: native tabs under the record title (older versions used radio buttons next to the title; removed for accessibility in 10.0.23).
- Navigation list on the left: the **last field should be the order total**.
- Grid view columns: document ID first, then the customer/vendor ID and name. Focus starts in the Quick filter.
- Each FastTab with a grid has its own toolbar (Toolbar and List: under 10 actions, under 10 columns). Actions for lines go on that toolbar, never on the page Action Pane. (documented: `UI/toolbar-list-subpattern.md`, `UI/general-form-guidelines.md`)
- Example path in action search: the **On-hand inventory** button sits under **Sales order lines** > **Inventory** > **View**; **Totals** sits under **Sales order** > **View**. (documented: `GS/action-search.md`)
- Approvals on a document: Action Pane button **Workflow** opens a drop dialog with **Submit**, **Recall**, **Approve**, **Reject**, **Request change**, **Delegate**, **Workflow history**. A workflow message bar on the record shows state and the submit instructions. (documented: `supply-chain/inventory/quality-order-approval-workflow.md`, `OA/workflow-actions.md`, `OA/configure-workflow-properties.md`)

### 2.4 Simple List and Simple List and Details

- Simple List: Action Pane, Quick filter (+ custom filters), one grid, optional footer. Up to 15 columns. Several rows can be selected. Opens in View mode. If the list is empty, it must NOT add a blank row by itself. (documented: `UI/simple-list-form-pattern.md`)
- Simple List and Details: list on the left (list-style grid with 2-5 fields, max 3 lines per row; or a read-only tabular grid; or a tree), details on the right. The details header repeats the list fields first, in the same order. Header fields are side by side. Max 2 custom filters. No standard tabs for fields. If empty, no automatic new row. (documented: `UI/simple-list-details-form-pattern.md`)
- When opened from a parent record, the parent's context shows above the page caption automatically. (documented: `UI/simple-list-form-pattern.md`)

### 2.5 Table of Contents (settings)

(documented: `UI/table-of-contents-form-pattern.md`)
- Vertical tabs on the left. Their order = the order in which you usually fill them in. First tab is selected on open.
- Each tab holds a Simple List, a nested Simple List and Details, or simple fields.
- Page Action Pane has only system actions. Special buttons go on a toolbar inside the related tab (or on the first tab).
- No FactBoxes. No standard tabs inside a tab. The **Show filters** button is hidden by default here. (documented: also `UI/system-defined-buttons.md`)
- Related: **User options** has 4 tabs: **Visual** (theme, element size), **Preferences** (default company, start page, default view/edit mode, language, time zone, date/number formats), **Account**, **Workflow**. (documented: `DGS/personalize-user-experience.md`)

### 2.6 Workspace (Operational workspace)

Structure, top to bottom (documented: `UI/workspace-form-pattern.md`):
1. Optional Action Pane: only frequent actions for the whole workspace. Variants of one command go in one drop-down (for example New sales quote / New sales order / New return order).
2. Optional workspace filter: at most 1 field under the title, a drop-down changed many times a day. Up to 5 filters in total; the rest go in a configure dialog. (documented: also `UI/workspace-filter-group-subpattern.md`, `GS/configure-filter-workspaces.md`)
3. **Summary** section: tiles, small charts, cards. Chart sizes are tile multiples (1x2, 2x2 ... 4x8). (documented: `UI/section-tiles-subpattern.md`)
4. **Tabbed lists** section: vertical tabs, each a filtered list. Each list: up to 2 filters and 3 actions above it, a **See more** button below if a full page exists. List-style rows max 3 lines; card lists max 4 fields; tabular lists max 8 columns. (documented: `UI/section-tabbed-list-subpattern.md`, `UI/section-list-form-pattern.md`, `UI/filters-toolbar-subpattern.md`)
5. Optional charts (max 2) and Power BI. (documented: `UI/section-stacked-chart-subpattern.md`)
6. **Related links** section: links to less frequent pages.

- Since 10.0.25 the sections stack vertically and collapse (FastTab style); no side scroll. A variant uses standard tabs at the top (for example **My work** and **Analytics**). (documented: `UI/workspace-form-pattern.md`, `finance/accounts-payable/vendor-invoices-workspace.md`)
- Every section has a title. Title is a noun phrase. (documented: `UI/workspace-form-pattern.md`)
- Users can push a filtered list from any list page into a workspace as a list, tile (with count) or link: **Options** > **Add to workspace**. (documented: `DGS/personalize-user-experience.md`)

### 2.7 Dialogs, drop dialogs, wizards, lookups

| | Dialog (slider) | Drop dialog | Message box |
|---|---|---|---|
| Opens | Slides from the right over the page | Next to the button that opened it | Full-width over the page |
| Size | Small (1 column), Medium (2), Large (3), Full (viewport minus a "peek") | Small | Fixed |
| Fields | Only what the task needs; constrained inputs; good defaults | 7 or fewer; quick; little validation | none |
| Buttons | Commit button named as a reply to the instruction; **Cancel** is right-most; read-only variant has **Close** only | One verb button (for example **Create**), right-aligned; **no Cancel** | Reply buttons |
| Close by clicking outside | Yes, = cancel | (not stated) | No |
| Not allowed | FactBoxes; validation must not open another dialog | Toolbars, tabs, FastTabs, FactBoxes, buttons to other pages | |
| Source (documented) | `UI/dialog-form-pattern.md`, `UI/slider-messagebox.md` | `UI/drop-dialog-form-pattern.md` | `UI/slider-messagebox.md` |

- Title of a dialog = main instruction (no full stop; question mark if a question). Optional second line = a full sentence. Focus starts in the first editable field. (documented: `UI/dialog-form-pattern.md`)
- **Default button = the safest choice.** Never make a destructive button the default unless undo is easy. (documented: `UI/dialog-form-pattern.md`, `UI/general-form-guidelines.md`)
- Alt+Enter runs the default button. (documented: `GS/shortcut-keys.md`)
- Wizard: one question per step, a title and instruction per step, **Next** / **Previous**, Cancel returns to the state before the wizard. Radio buttons for choices. No FactBoxes, no FastTabs. (documented: `UI/wizard-form-pattern.md`)
- Lookup: max 5 columns. Several views switch with a combo box, not tabs. Optional preview to tell apart two similar records (for example two people with the same name). Recent values are possible but not built in. (documented: `UI/lookup-form-pattern.md`)

### 2.8 FactBoxes (right side panel)

(documented: `UI/factbox-form-patterns.md`, `DGS/personalize-user-experience.md`, `GS/shortcut-keys.md`)
- Purpose: totals, balances, overdue orders, contact details, so the user does not open another page.
- Card FactBox: 2-10 labelled fields; currency last; do not repeat the record's own ID/name.
- Grid FactBox: 1-4 columns; a **More** link opens the full list.
- Read-only. No typing in a FactBox. Title is a noun, not a verb, and not record-specific.
- The pane and each FactBox collapse; the state is remembered. Keys: Ctrl+F2 open/focus; Alt+1..9 jump to FactBox n.
- Old list-page "preview pane" was removed; its content went into FactBoxes (lines max 5 rows). (documented: `UI/list-page-form-pattern.md`)

---

## 3. Actions, edit mode, saving, validation

### 3.1 Action Pane rules

(documented: `UI/general-form-guidelines.md`, `UI/action-controls.md`)
- Max 10 tabs. 1-8 actions per group.
- First tab = the entity name, singular (for example **Sales order**). Then activity tabs named with verbs (for example **Sell**). Last tab **General** for rare common actions. Framework adds **Options** (personalize, alerts, view switches).
- Page Action Pane actions act on the whole record. Part-of-record actions go on local toolbars near the part.
- Action Pane buttons are text only (no icons) except system buttons. Toolbars: **Add** / **Remove** first with icons, then common actions, then rare ones as text. Toolbar groups can be set to always sit in the overflow menu.
- When the browser is narrow, extra buttons and tabs move into an overflow menu (no side scroll).
- The pane can be pinned open (pushes content down) or used as a fly-out.
- Right side of the Action Pane: **Refresh**, **Popout** (open in a new window), **Close** (= browser back). Cannot be removed. (documented: `UI/system-defined-buttons.md`)

### 3.2 View mode and Edit mode

(documented: `UI/system-defined-buttons.md`, `UI/general-form-guidelines.md`, `DGS/personalize-user-experience.md`)
- Default: pages open in View mode. Users can change the default in **User options** > **Preferences**.
- In View mode the Action Pane shows **Edit**. In Edit mode it shows **Save**; **Read mode** and **Revert** are on the **Options** tab.
- Always-edit pages show only **Save** and **Revert**. Always-read pages show none of them.
- A posted (locked) record opens in View mode and **Edit** is disabled.
- **New** and **Delete** are system buttons; never duplicate them. A page may replace **New** with a menu of "New ..." choices.
- Keys: F2 toggle edit; Alt+N new; Alt+Del delete; Alt+S or Ctrl+S save; Ctrl+Shift+F5 revert; Shift+Esc close and save; Alt+Shift+Q close and discard. Alt+N and Alt+Del act on the part that has focus (for example the lines grid). (documented: `GS/shortcut-keys.md`, `UI/action-controls.md`)

### 3.3 Field states and mandatory fields

(documented: `UI/general-form-guidelines.md`, `DGS/personalize-user-experience.md`)

| State | Meaning | Looks | Tab key |
|---|---|---|---|
| Disabled | Value not valid now; user can change something to enable it | Grey | Skipped |
| Read-only | Value valid but cannot be changed | Normal | Not skipped |
| View-only | Never editable, for information | Text | |
| Secured | User has no access | Padlock in the grid cell | |
| Not applicable | Cell does not apply to this row | "Not" symbol | |

- Hide a control if the user can never enable it; disable it if the user can.
- All mandatory fields are marked. Mark fields mandatory by record state (for example required to post). A message about an empty field that was not marked is a bad experience.
- A required empty field shows a red border and an asterisk.
- Editable grids must show the mandatory columns; do not wait until save to complain.

### 3.4 Validation and saving

(documented: `UI/messaging-user.md`, `DGS/grid-capabilities.md`)
- A field-level problem shows in the message bar; the bad value stays, flagged. The user may go on typing and fix it before saving.
- Field-level messages disappear when the value is fixed. Record-level messages disappear at the next save.
- Saving with invalid data shows a blocking error box.
- Grids: the user can "type ahead". A row status column shows: blank = saved, **Processing pending** (italic text), **Invalid state** (with **Fix this issue**), **Paused** (with **Resume processing**). Alt+T, A jumps to the problem row.
- Numeric fields accept formulas that start with `=` (for example `=15*4`).

---

## 4. Lists: filters, views, grid

### 4.1 Filters

| Tool | Where | Behaviour | Source (documented) |
|---|---|---|---|
| Quick filter | Above the grid | One box. While typing, a drop-down lets you pick the column. Remembers the last column. Focus starts here on list pages. | `UI/filtering.md`, `DGS/personalize-user-experience.md`, `UI/list-page-form-pattern.md` |
| Custom filters | Next to the Quick filter | Max 5, only constrained inputs (lookup, date, combo, check box). Labels all on or all off. "Legal entity" is a typical one. | `UI/custom-filter-group-subpattern.md` |
| Filter pane | **Show filters** button; slides in from the left | Starts with current filters, else key fields. **Add a filter field**. Operator per field, value, **Apply**. Ctrl+F3. | `UI/filtering.md`, `GS/shortcut-keys.md` |
| Column header filter | Click a column header | Drop dialog with operator + value + sort. Ctrl+G. Computed columns cannot be filtered or sorted. | `UI/filtering.md` |
| Advanced filter/sort | Ctrl+Shift+F3 | Joins, more columns, multi-sort | `UI/filtering.md`, `GS/advanced-filtering-query-options.md` |

Operators shown in words: is exactly, is not, is one of, contains, does not contain, begins with, greater/less than (or after/before), between, and **matches** for power syntax. (documented: `UI/filtering.md`)
Power syntax under **matches**: `!x` not, `a..b` range, `..x` / `x..`, `>` `<`, `x*` / `*x` / `*x*`, `?` one char, `a,b,c` list, `""` blank, `T` today, plus relative-date functions. (documented: `GS/advanced-filtering-query-options.md`)
Developers can lock or hide a filter so users see it but cannot change it. (documented: `UI/filtering.md`)

### 4.2 Saved views

(documented: `DGS/saved-views.md`)
- A view selector shows the current view name at the top of the page.
- **Large selector** on list pages: the view includes filters, sort and grouping. **Small selector** next to the caption on other pages: layout only.
- Views: **Standard** (out of the box, locked), personal views, published views (padlock, read-only). New published views show a "spark" mark.
- Changing a filter or layout puts an asterisk after the view name. Nothing is saved until **Save** or **Save as**. Column widths and FastTab open/closed state save by themselves.
- **Save as** pane: name, description, **Pin as default**, optional limit to some companies.
- **Manage my views**: pin as default, move up/down, rename, delete.
- Admins (or the **Saved views administrator** role) **Publish** a view to security roles and companies, with name translations per language. Can be set as default for those users.
- Opening a page from a tile runs the tile's query, not the default view's.

### 4.3 Grid features

(documented: `DGS/grid-capabilities.md`, `GS/shortcut-keys.md`, `UI/general-form-guidelines.md`)
- **Footer** (off by default; **Grid options** > **Show footer**): selected-row count, row count, per-column value. Per column: Total, Minimum, Maximum, Average. With several rows selected, the footer values use only the selected rows.
- Large data: footer shows dashes and a **Calculate** button; limit 25,000 rows by default; the user is told to filter more.
- **Group by this column** (right-click): up to 5 levels; group header row shows value, column name, row count, subtotals; group check box selects the group. Dates group by year/month/day.
- **Freeze column**; autofit width (double-click edge or key A); reorder and resize from the keyboard.
- Multi-select: check box column, Ctrl+Space, Shift+Click, Ctrl+Shift+M select all.
- **Edit selected rows** (bulk edit): choose columns and values, preview in italics, **Save** or **Discard**; each row still runs all validation.
- Paste a block from Excel straight into the grid; extra rows are added at the bottom.
- Sort by first column ascending (document ID for documents, name for master data). Most important columns left, amounts right. Numbers right-aligned, others left-aligned. Status icon column on the left, no header, meaning in the tooltip.
- Paging: Page Up / Page Down moves one page of data; Down arrow on the last row adds a new row. (A visible pager control is not described.)

### 4.4 Excel and attachments

- **Open in Microsoft Office** menu: **Export to Excel** (static copy of the grid with the current filter, up to 10,000 rows) and **Open in Excel** (live workbook through an add-in with **Refresh** and **Publish**). Ctrl+Shift+E. (documented: `fin-ops-core/dev-itpro/office-integration/office-integration-edit-excel.md`, `DGS/whats-new-platform-update-7.md` for the 10,000-row limit, `GS/shortcut-keys.md`)
- **Attach** (paperclip) is a system button in the upper right of any page with data; it shows when the record has attachments. **Attachments** page: **New** (+), types File / Image / Note / URL, a **Preview** FastTab. Ctrl+Shift+A. Admin sets allowed file types and max size. (documented: `fin-ops-core/dev-itpro/office-integration/office-integration.md`, `fin-ops-core/dev-itpro/organization-administration/configure-document-management.md`, `GS/shortcut-keys.md`)

---

## 5. Personalisation (short)

(documented: `DGS/personalize-user-experience.md`)
- Remembered without asking: column widths, footer and totals, FastTab open/closed, FactBox open/closed, Action Pane pinned, Quick filter column, filter operator, navigation pane pinned.
- Right-click menu: **Insert columns**, **Hide this column**, **Personalize** (rename label, hide, show in FastTab summary, skip in Tab order, lock, make required).
- **Personalization** toolbar (Ctrl+Shift+P): Select, Hide, Add fields, Move, Skip, Show in header, Require, Lock, Add an app, Clear, Import, Export.
- Admins can switch off personalisation for everyone or per user.

---

## 6. Keyboard shortcuts worth copying

(documented: `GS/shortcut-keys.md`, `GS/action-search.md`)

| Action | Keys |
|---|---|
| Search for a page | Ctrl+/ (or Alt+G) |
| Action search | Ctrl+' (or Alt+Q) |
| New / Delete / Save | Alt+N / Alt+Del / Alt+S or Ctrl+S |
| Toggle edit mode | F2 |
| Revert | Ctrl+Shift+F5 |
| Refresh data | Shift+F5 |
| Close page (back) / save and close / discard and close | Esc / Shift+Esc / Alt+Shift+Q |
| Previous / next record (details view) | Ctrl+Up / Ctrl+Down |
| Grid / details / header / lines view | Ctrl+Shift+G / D / H / L |
| Next FastTab / FastTab n | Alt+Shift+Down / Alt+n |
| Filter pane / column filter | Ctrl+F3 / Ctrl+G |
| FactBox pane | Ctrl+F2 |
| Company picker | Ctrl+Shift+O |
| Dashboard | Alt+Shift+Home |
| Run default dialog button | Alt+Enter |
| Show available shortcuts | Alt+Shift+K |
| Date field: today / session date | T / D |
| Open lookup or date picker | Alt+Down |
| Attach / Export to Excel | Ctrl+Shift+A / Ctrl+Shift+E |

Rules for new shortcuts: do not reuse existing ones; prefer 3-key combinations for control-specific keys; **never use Ctrl+Alt**, because it equals AltGr on some keyboards. (documented: `UI/keyboard-shortcuts-controls.md`)

---

## 7. Accessibility, right-to-left, language

- Every control has a label and a shortcut description for screen readers. (documented: `GS/accessibility-features.md`)
- Tab order is "optimized": only key fields are tab stops. **Enhanced tab sequence** user option includes all fields. (documented: `GS/accessibility-features.md`)
- Zoom to 200% supported. Small screens: groups drop to 1 column, shell parts hide, Action Pane collapses. (documented: `GS/accessibility-features.md`)
- Do not use colour alone for status; add a symbol, text or column. Status images need a text label. (documented: `UI/enable-accessibility.md`)
- Arabic and Hebrew: each form flips to right-to-left. Text itself is never mirrored. (documented: `UI/bidirectional-support.md`)
- Known bidi problems in mixed text (documented: `UI/bidirectional-support.md`):
  - Codes with underscores and numbers (`123_456`) can show reversed in RTL.
  - Hyphens with numbers act differently in Arabic and Hebrew.
  - Phone numbers with brackets show broken (`)701(225-2188`); Microsoft suggests forcing such fields to LTR.
  - English with brackets in an RTL field ("Dynamics (DAT)") breaks.
  - Advice: let a customizer mark some fields (codes, phones) as LTR for input.
- Labels in sentence case. The framework shows some labels (group titles, FactBox titles, Action Pane tabs) in ALL CAPS. (documented: `UI/general-form-guidelines.md`)
- Published view names can have translations per language. (documented: `DGS/saved-views.md`)
- Form captions max about 30 characters if set in code. (documented: `UI/general-form-guidelines.md`)

---

## 8. What this means for our screens

| Our screen | What Dynamics does (documented) | Direction it supports |
|---|---|---|
| **Menu / frame** | Top bar: page search, company picker, Action center (badge count), settings, help, user. Left pane: Home, Favorites (star), Recent, Workspaces, Modules (module opens a second panel). Pane can be pinned. Page search matches title and menu path, top 10, shows the path. (`GS/user-interface-elements.md`, `UI/page-navigation.md`, `GS/navigation-search.md`) | A fixed shell: top bar + collapsible left menu with Favourites and Recent at the top. One search box for pages; a second, separate search for actions on the current page. Company switch in the top bar. |
| **Home page** | Default dashboard: company banner, one tile per workspace (pinned counts under tiles), **Work items assigned to me**, session date. Newer Immersive Home: greeting + summary, ranked work-item cards with action buttons, workspaces ranked by use. (`GS/default-dashboard.md`, `fin-ops-core/fin-ops/copilot/immersive-home.md`) | Two options: (a) tiles to workspaces + "my approvals" list; (b) a task-first feed of cards that can be approved in place. Microsoft's newest direction is (b). Both fit our approvals-first product. |
| **List page** | Title plural. Action Pane on top. Quick filter (focus here) + up to 5 constrained filters above the grid. Grid ≤15 columns, ID or Name first as a link. Filter pane from the left. View selector at top. Optional footer with totals. Multi-select + **Edit selected rows**. FactBoxes right. (`UI/list-page-form-pattern.md`, `UI/details-master-form-pattern.md`, `UI/filtering.md`, `DGS/saved-views.md`, `DGS/grid-capabilities.md`) | A dense, filter-heavy grid with saved views. Supports "list and record on one page" (grid view ↔ details view) rather than two separate routes. |
| **Document page (sales order)** | Details Transaction: left narrow list (order no., customer, total last); title "ID : Name"; status upper right; **Lines** view (header summary FastTab, lines grid with its own toolbar, line details tabs) and **Header** view (all header FastTabs). **Workflow** button on Action Pane; workflow message bar. FactBoxes right. Opens in View mode. (`UI/details-transaction-form-pattern.md`, `UI/general-form-guidelines.md`, `OA/workflow-actions.md`) | Header/lines split with a lines-first default. Line actions sit on the lines toolbar, not the top bar. Approval state shown as a bar on the record. |
| **Record page (customer)** | Details Master: FastTabs (first one most important, no scroll), summary fields on collapsed FastTabs, status upper right, navigation list left, FactBoxes (balance, open orders, contacts) right. Over 15 FastTabs → group them in tabs. (`UI/details-master-form-pattern.md`, `UI/factbox-form-patterns.md`) | Long single page of collapsible sections + read-only side panel of facts. Supports "sections, not tabs" for most records. |
| **Form (new order)** | Usually a slider dialog from the right ("create" dialog), then the full document page. Only needed fields, constrained inputs, good defaults; title = instruction; commit button named as the reply; **Cancel** right-most; click outside = cancel. Validation in the dialog's own message bar, never another dialog. (`UI/slider-messagebox.md`, `UI/dialog-form-pattern.md`, `UI/messaging-user.md`) | Short quick-create panel from the side, then land in the full document in Edit mode. |
| **Report page** | Workspaces have optional chart and Power BI sections, and an **Analytics** tab variant. Lists export with **Export to Excel** / **Open in Excel**. (`UI/workspace-form-pattern.md`, `finance/accounts-payable/vendor-invoices-workspace.md`, `fin-ops-core/dev-itpro/office-integration/office-integration-edit-excel.md`) | Reports live inside workspaces as an analytics tab, plus Excel export from any list. The docs we read give no layout for a classic report viewer (parameters + preview). |
| **Approvals workspace** | Operational workspace: Summary tiles (counts like "assigned to me", "on hold"), tabbed filtered lists (≤2 filters, ≤3 actions each, **See more**), links at the bottom. One workspace-wide filter (for example company). Approver actions: **Approve**, **Reject**, **Request change**, **Delegate**. **New** as one drop-down. (`UI/workspace-form-pattern.md`, `UI/section-list-form-pattern.md`, `OA/workflow-actions.md`, `finance/accounts-payable/vendor-invoices-workspace.md`) | Counts on top, work lists below, act from the list. Supports a workspace layout over a plain inbox. Note: Dynamics has no "self-approve" concept in these pages; our D1 rule must be our own UI. |
| **Settings overview** | Table of Contents: vertical tabs in fill-in order, only system actions on top, tab-specific buttons inside the tab, no FactBoxes. User options: 4 tabs (Visual, Preferences, Account, Workflow). (`UI/table-of-contents-form-pattern.md`, `DGS/personalize-user-experience.md`) | Left vertical list of setting groups, content on the right. Order shows the setup sequence. |
| **Empty start of a list** | Lists must not add a blank row by themselves when empty. Nothing else documented about empty-state text or help. (`UI/simple-list-form-pattern.md`, `UI/simple-list-details-form-pattern.md`, `UI/general-form-guidelines.md`) | Open question for us. Dynamics gives no model for a friendly empty state; we design our own. |
| **Phone menu** | Responsive web: 1 column, shell parts hidden, Action Pane collapsed. The separate mobile app platform is marked deprecated in the docs. (`GS/accessibility-features.md`, `fin-ops-core/dev-itpro/mobile-apps/platform/page-design-guidelines.md`) | Same app, responsive. No separate phone menu design to copy. |
| **Confirm a risky action** | Modal message box only when the user cannot go on; it cannot be closed by clicking outside. Dialog default button = safest; never a destructive default unless undo is easy. Drop dialogs have no Cancel. (`UI/messaging-user.md`, `UI/slider-messagebox.md`, `UI/dialog-form-pattern.md`, `UI/general-form-guidelines.md`) | A centred modal with "Cancel" as the default (focused) button and a clearly named destructive button. Exact delete-confirm wording is not documented. |

---

## 9. Not found in the docs

- The exact text or layout of a **delete confirmation** box.
- An **empty-state** design (text, illustration, "create your first ..." button) for a list with no rows.
- A visible **pager** (page numbers, "load more"). Only keyboard Page Up / Page Down is documented.
- A **report viewer** page layout (parameters panel + preview + print). Only workspace analytics and Excel export were found in the files read.
- How the **Recent** list is limited (count, per company) and how Favorites are ordered.
- What the company picker looks like (drop-down or list, search inside it).
- Notification **toast** look and timing when a new Action center message arrives (only "a notification informs the user").
- Arabic-specific UI notes beyond bidi text (for example numerals, calendar, label length in Arabic).
- An **auto-save** rule when leaving a record in Edit mode (only explicit save keys and close-with-save / close-with-discard are documented).
- Any phone-specific navigation for the current web client (the mobile app platform is deprecated).
- Pixel sizes of the frame (bar height, pane width), except: tile 130 px square, wrap column 280 px. (`UI/page-navigation.md`, `UI/page-layout.md`)
