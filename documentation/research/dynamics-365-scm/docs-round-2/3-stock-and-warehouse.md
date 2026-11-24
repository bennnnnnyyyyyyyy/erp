> **Round 2 (24 Nov 2026), part of [DOCS_ROUND_2.md](../DOCS_ROUND_2.md).** Read from Microsoft's public Dynamics 365 documentation
> (github.com/MicrosoftDocs/dynamics-365-unified-operations-public, licence CC BY 4.0, (c) Microsoft), downloaded on 24 Nov 2026.
> Our own words; only UI labels are quoted. Paths are relative to that repo's `articles/` folder. The download is kept locally
> in `.temp/d365-docs` (not in git).

# D365 Supply Chain Management: stock and warehouse work, as the user sees it

Round 2, topic 3. Source: Microsoft public docs (CC-BY-4.0), downloaded to
`.temp/d365-docs/articles/`. Every path below is relative to `articles/`.
All claims are **documented** (read in the docs). Nothing here was seen in a live system.
We describe behaviour in our own words. We copied no text, only UI labels.

> **In short**
>
> - D365 does all stock changes with **journals**: a header, then lines, then **Validate**, then **Post**.
>   One journal type does one job: movement, adjustment, transfer, counting, tag counting, BOM, item arrival.
> - An optional **approval workflow** can be put on each journal type. Then **Post** is not available until the
>   journal is approved. This is close to our rule. But D365 does not put this on the warehouse (mobile) flows.
> - After posting, a journal is not edited. To fix a mistake you post a **new** journal (for example, a transfer
>   journal from the wrong batch to the right batch). This matches our append-only ledger.
> - The **On-hand list** is one report page: a filter pane, a "Dimensions" button to choose the columns
>   (site, warehouse, location, batch...), and fixed quantity columns (physical, reserved, available, ordered).
>   From a row you jump to the transactions behind the number, or to **Quantity adjustment**.
> - The **warehouse mobile app** shows **one step per screen**: a large short title, one input, a pop-up
>   instruction, and an actions menu. It is built for scanning. The worker signs in to one warehouse.
> - Counting on the phone is **blind**: the app never shows the expected quantity. Differences above a limit go
>   to a supervisor review list. Reason codes can be mandatory per warehouse or per item.
> - Transfer orders between warehouses go through a **transit warehouse**: ship takes stock out, receive puts it in.
>
> For us: keep our draft → submit → approve → post model. Copy the D365 shape: one-step phone screens, blind
> counts, reason codes with a short list per menu item, an on-hand page with a "show by" chooser.

---

## 1. Inventory journals (the back-office way to change stock)

### 1.1 Journal types

| Journal type | What it does | Source |
|---|---|---|
| Movement | Stock in or out; the user picks the money offset account by hand | supply-chain/inventory/inventory-journals.md |
| Inventory adjustment | Stock in or out (gains and losses); the money account comes from item setup | supply-chain/inventory/inventory-journals.md |
| Transfer | Move stock between warehouses, locations, batches or variants. No cost effect. Each line has "From" and "To" fields. No in-transit tracking (use a transfer order for that) | supply-chain/inventory/inventory-journals.md |
| BOM | Report a kit as made: stock in for the kit, stock out for the parts | supply-chain/inventory/inventory-journals.md |
| Item arrival | Register goods that arrive (for example, against a purchase order) | supply-chain/inventory/inventory-journals.md |
| Counting | Enter counted quantities; posting makes the in/out for the difference | supply-chain/inventory/inventory-journals.md |
| Tag counting | Numbered paper tags; posting it creates a normal counting journal | supply-chain/inventory/inventory-tag-counting.md |

### 1.2 How a journal is used (the screen flow)

| Step | What the user does | Source |
|---|---|---|
| 1. New | Selects **New**. A small dialog asks for the journal **Name** (a pre-set template). Other header fields fill from that name | supply-chain/inventory/tasks/adjust-stock-levels-warehouse-basic-warehousing.md |
| 2. Lines | Selects **New** on the lines grid. Enters Item number, Site, Warehouse (Location if the item needs it), Quantity, cost price if needed | same file |
| 3. Validate | Selects **Validate**, then **OK**. This checks the lines without posting | same file |
| 4. Post | Selects **Post**, then **OK**. Stock and value change. Ledger entries are made | same file |
| 5. Check | From a line: **Inventory > Transactions** shows the movements that the posting made | supply-chain/inventory/tasks/count-inventory-warehouse.md |

Other documented rules:

- A saved journal keeps its lines even if the user closes it without posting. It is a draft. (supply-chain/inventory/inventory-journals.md)
- Only one user at a time can open a journal. The docs advise one journal name per department to avoid clashes. (same file)
- Counting line: the user types **Counted**. The grid already shows **On-hand**. The **Quantity** field then shows the difference. (supply-chain/inventory/tasks/count-inventory-warehouse.md)
- Transfer line: the user fills From site / To site, From warehouse / To warehouse, From location / To location. A "Line details" tab holds extra From/To dimensions (license plate, batch). (supply-chain/inventory/tasks/transfer-physical-inventory-within-warehouse.md)

### 1.3 Approval of journals

| Behaviour | Source |
|---|---|
| A workflow can be set per journal type: tag counting, ownership change, movement, transfer, counting, BOM, adjustment | supply-chain/inventory/inventory-journal-workflow.md |
| Workflow is switched on per **journal name** ("Approval workflow" = Yes) | same |
| A **Workflow** button appears on the journal. The maker selects **Submit**. They can **Recall** it (this resets it) | same |
| The approver opens the journal and chooses **Approve**, **Reject**, **Request change**, **Delegate**, or views **Workflow history** | same |
| **Post** stays inactive until the journal is approved | same |
| Limit: this does not apply to journals that the Warehouse management (mobile) flows create | same |

### 1.4 Correcting after posting

| Behaviour | Source |
|---|---|
| The docs show no "edit posted journal" action. To fix a wrong batch, the user posts a new **transfer journal** from the wrong batch to the right batch. Then **Inventory > Trace** shows the link | supply-chain/inventory/tasks/correct-inventory-tracking-information.md |
| Posting a journal is allowed "until the item is locked" (for example, during a count) | supply-chain/inventory/inventory-journals.md |

### 1.5 Reason codes (counting and adjustments)

| Behaviour | Source |
|---|---|
| A **reason code policy** is *Mandatory* or *Optional*. It is set per warehouse and can be overridden per item | supply-chain/warehousing/reason-codes-for-counting-journals.md |
| The policy covers: cycle count, spot count, threshold count, adjustment in, adjustment out (all on the phone), counting journal, and quantity adjustment (both on the desktop) | same |
| If the code is mandatory, the counting journal cannot be finished until a code is given | same |
| Each reason code can have its own money offset account | same |
| **Reason code groups** make a short list for one phone menu item (for example, only "Damaged", "Expired" for Adjustment out) | same |
| Per phone menu item: a default code, show it or hide it ("Line" / "Hide"), and whether the worker can change it | same |
| A per-worker **Adjustment quantity limit** stops very large adjustments, for example when a worker scans a barcode into the quantity field by mistake | same |
| The desktop **On-hand list** has **Quantity adjustment**, where the user also picks a counting reason code | same |
| **Counting history** shows the reason code of each past count | same |

---

## 2. Counting

### 2.1 Basic counting (Inventory management)

| Behaviour | Source |
|---|---|
| **Counting groups** decide which items go in a count. Codes: *Manual*, *Period* (every N days), *Zero in stock*, *Minimum* (at or below the minimum) | supply-chain/inventory/tasks/define-inventory-counting-processes.md |
| A setting **Lock items during count**: while counting, packing slips and picking for the item are blocked | same |
| By default an item can be in only one open counting journal at a time (to stop double counts). This can be relaxed per warehouse or switched off | same |
| Tag counting: each tag is *Used*, *Voided* or *Missing*. Every item has its own tag number series, so no tag is used twice | supply-chain/inventory/inventory-journals.md |

### 2.2 Cycle counting (Warehouse management, on the phone)

| Behaviour | Source |
|---|---|
| Three stages: create counting work, count on the phone, resolve differences | supply-chain/warehousing/cycle-counting.md |
| Work is made automatically (a threshold per location, or a scheduled **plan**) or by hand (**by item** / **by location**, with a maximum number of counts) | same |
| Counting work always covers a **whole location** (except the partial-count option) | same; supply-chain/warehousing/partial-location-cycle-counting.md |
| Stock is **not** blocked while cycle-count work is open. It can still be reserved | supply-chain/warehousing/cycle-counting.md |
| Four phone modes: **User directed** (worker enters a work ID), **System directed** (the system gives the next one), **Cycle count grouping** (by location, zone or pool), **Spot cycle counting** (worker enters any location, and work is made on the spot) | same |
| The app **never shows the expected quantity** (blind count). **Number of attempts** lets the worker count again | same |
| An **Add LP or item** button lets the worker count stock the system did not expect | same |
| If an item has several units (boxes and pieces), the worker enters each one. The app adds them up | same |
| No **Cancel** button in counting flows (to stop mistakes). **Skip** skips the whole work, not one line | same |
| Differences: if a worker is not a **cycle count supervisor** and the count is outside their limits (percent, quantity, value), the work becomes **Pending review** | same; supply-chain/warehousing/mobile-device-work-users.md |
| A supervisor opens **Cycle count work pending review**, may change the quantity or reason code, then accepts or rejects | supply-chain/warehousing/cycle-counting.md; reason-codes-for-counting-journals.md |
| A supervisor's own counts are approved at once | supply-chain/warehousing/mobile-device-work-users.md |
| Menu-item options can hide the item number or license plate during the count ("blind" menu item) | supply-chain/warehousing/cycle-counting-scenarios.md |

---

## 3. Seeing stock: on-hand pages

### 3.1 On-hand list (desktop)

| Element | Behaviour | Source |
|---|---|---|
| Filters pane | Add or remove filter fields; operator + value; **Apply** | supply-chain/inventory/inventory-on-hand-list.md |
| **Dimensions** button | Ticks which dimensions are columns (site, warehouse, location, batch, serial, status...). More ticks = more rows. **Save setup** keeps the choice for next time | same |
| Grid quick filter | Filters the shown rows only; does not change totals | same |
| Columns | Physical inventory, Physical reserved, Available physical (= physical − reserved), Ordered in total, On order, Ordered reserved, Available for reservation, Total available (= available physical + ordered − on order) | same |
| Drill down | **Transactions** and **Warehouse transactions** open with the same filters, to explain a number | same |
| Act from the list | **Quantity adjustment**; **Intercompany on-hand** | same |
| Empty rows | A row with zero can appear: it means there was stock or orders before | same |
| Warning | Filters apply to the detail rows, not to the summed rows; the docs give examples where this surprises users | same |

### 3.2 Other stock views

| Page | Behaviour | Source |
|---|---|---|
| Physical on-hand inventory | Item + site + warehouse fields at the top, **Refresh**, **Display Dimensions** | supply-chain/inventory/tasks/check-availability-stock.md |
| On-hand by location | Pick site/warehouse/location; the upper grid lists locations; select one to see its stock below. Also used to change **inventory status** | same; supply-chain/inventory/inventory-statuses.md |
| Inventory on-hand mobile workspace (old phone app, now deprecated) | Search by product number or name; see stock per site, warehouse, location, batch, status; shown as physical / reserved / available | supply-chain/inventory/inventory-on-hand-mobile-workspace.md |
| Item inquiry (warehouse app) | Scan an item; see its locations and available and reserved quantities | supply-chain/warehousing/warehouse-app-item-inquiry.md |

### 3.3 Dimensions, reservations, blocking

| Topic | Behaviour | Source |
|---|---|---|
| Dimensions | Product (variant), storage (site, warehouse, location, status, license plate), tracking (batch, serial) | supply-chain/inventory/inventory-on-hand-list.md |
| Locations (basic) | Aisle, rack, shelf, bin; type (bulk, picking, inbound dock...); a location can be blocked for a time (input only, output only, or both) | supply-chain/inventory/inventory-locations.md |
| Reservation | Reserved stock cannot be taken by another order. Automatic or manual. FIFO / FEFO / same-batch policies | supply-chain/inventory/reserve-inventory-quantities.md |
| Manual blocking | **Inventory blocking** page: item, quantity, site, warehouse. An optional expected date. **Delete** = unblock (with a Yes/No question) | supply-chain/inventory/tasks/create-maintain-inventory-blocking.md |
| Status blocking | An inventory status (for example *Damaged*) can be marked as blocking. It is still counted as physical stock but cannot be issued | supply-chain/inventory/inventory-statuses.md |
| Status change rule | Status cannot be changed where open warehouse work exists; an error is shown | same |
| Quarantine order | Moves stock to a quarantine warehouse. Statuses: Created → Started → Reported as finished → Ended; scrap possible | supply-chain/inventory/quarantine-orders.md |

---

## 4. Transfers between warehouses

| Behaviour | Source |
|---|---|
| Transfer **journal** = instant move, no in-transit stage | supply-chain/inventory/inventory-journals.md |
| Transfer **order** = ship, then receive, through a **transit warehouse** | finance/general-ledger/inventory-posting.md |
| On **ship**: stock leaves the source (issue). It enters the transit warehouse. It is reserved there so nothing else can use it. An expected receipt appears at the destination | same |
| On **receive**: transit stock goes out and destination stock comes in | same |
| A missing transit warehouse is a typical setup error when a transfer order is made | supply-chain/warehousing/create-transfer-order-from-warehouse-app.md |
| Transport days per pair of warehouses (and per delivery mode) give the receipt date | supply-chain/warehousing/transfer-orders-warehouse.md |
| Phone flow **Create transfer order from license plates**: (1) enter the destination warehouse (the source is the warehouse the worker is signed in to), (2) scan each license plate, (3) menu > **Complete order**. **Complete order** appears only after one plate is scanned. Several workers can add to the same order. After Complete, no more plates can be added | same |
| Over-pick on transfer orders is allowed per worker and per menu item, up to the over-delivery limit on the line | supply-chain/warehousing/over-picking-for-sales-and-transfer-orders.md |
| Receiving can split "registration" (fast, on the phone) from the money posting (later, in a batch) | supply-chain/warehousing/configure-transfer-order-receiving-process.md |
| Item arrival journal: **Create lines** from the order. **Initialize quantity** Yes = full quantity, No = blank, for a partial delivery. Then **Post** | supply-chain/inventory/register-items-item-arrival-journal.md |
| **Arrival overview** lists what is expected today; select lines, then **Start arrival** makes the journal | supply-chain/inventory/arrival-overview.md |

---

## 5. Low stock and replenishment

| Behaviour | Source |
|---|---|
| Planning coverage code **Min/Max**: if projected stock falls below the minimum, the plan orders up to the maximum | supply-chain/master-planning/coverage-settings.md |
| Warehouse **Min/Max replenishment**: a template per item and location; usually runs daily; it creates move work to fill pick locations | supply-chain/warehousing/replenishment.md |
| An empty location can be refilled only if it is a **fixed location** for the item | supply-chain/warehousing/tasks/set-up-min-max-replenishment-process.md |
| Other strategies: wave demand, load demand, immediate | supply-chain/warehousing/replenishment.md |
| Counting group *Minimum* adds items at or below minimum to the next count | supply-chain/inventory/tasks/define-inventory-counting-processes.md |
| Alerts are generic: a user makes an alert rule on any page (record created, field changed, date due). Notices go to the **Action center** and optional email. No stock-specific low-stock alert page was found | fin-ops-core/fin-ops/get-started/alerts-overview.md; alert-email-notifications.md |

---

## 6. The Warehouse Management mobile app

### 6.1 Sign-in and menu

| Behaviour | Source |
|---|---|
| Each worker has one or more mobile user accounts. Each account has a **Default warehouse** and a **root menu** | supply-chain/warehousing/mobile-device-work-users.md |
| The worker can switch warehouse with the **Change warehouse** menu item | same; configure-mobile-devices-warehouse.md |
| Five wrong passwords in a row make the account inactive | supply-chain/warehousing/mobile-device-work-users.md |
| Language, number format and time zone follow the worker's user settings | same |
| Menus have submenus. A worker sees only items in their root menu (and its submenus) | supply-chain/warehousing/configure-mobile-devices-warehouse.md |
| Menu item kinds: **Indirect** (an inquiry or activity, no work: item inquiry, location inquiry, change warehouse, create transfer order...) and **Work** (creates work or does existing work: receive, pick, move, count, adjust in/out) | same |
| Example menu names: **Inbound**, **Outbound**, **Inventory**, **Main** | supply-chain/warehousing/warehouse-app-detours.md; create-transfer-order-from-warehouse-app.md |

### 6.2 One step per screen

| Element | Behaviour | Source |
|---|---|---|
| Step | Each flow is a chain of steps. Each step has an ID (Item, Location, Quantity, Batch, Reason code, **Confirmation**...) | supply-chain/warehousing/step-icons-titles.md |
| Step title | Large, short text at the top. Long titles are cut; press and hold to read all of it | supply-chain/warehousing/mobile-app-titles-instructions.md |
| Title for input vs confirmation | Two titles: one when the field is empty (enter it), one when the value is known (confirm it) | same |
| Step icon | An icon per step type | supply-chain/warehousing/step-icons-titles.md |
| Instruction pop-up | Opens with the step; tap outside to close; **Don't show again** box | supply-chain/warehousing/mobile-app-titles-instructions.md |
| Own words, all languages | Admins edit titles and instructions per language, and per menu item | same |
| Main card | Shows only **promoted** fields (up to two in bold). Other fields are on a details page | supply-chain/warehousing/warehouse-app-promoted-fields.md |
| Field priority | Fields are grouped in priority rows (for example Item + Quantity + Unit first) | supply-chain/warehousing/configure-app-field-names-priorities-warehouse.md |
| Input mode | Each field is *Scanning* or manual. Input types include selection lists and dates | same |
| Numbers | A built-in number pad/calculator opens for quantity fields (+ − × ÷) | supply-chain/warehousing/warehouse-app-calculator.md |
| Submit | Recommended: the scanner sends "Enter" after each scan; the app does not guess | supply-chain/warehousing/warehouse-app-autosubmit-behavior.md |
| Cancel | A menu item can ask "are you sure" before cancel (**Confirm cancel**) | supply-chain/warehousing/mobile-device-movement-menu.md |

### 6.3 Detours, scanning, feedback, errors

| Behaviour | Source |
|---|---|
| **Detour**: from a step, open another menu item (for example, location inquiry), then come back. Values can be copied there and back. The button is in the actions menu, marked with an arrow | supply-chain/warehousing/warehouse-app-detours.md |
| Data inquiry detours: card lists such as "orders for today" or "orders by vendor", for when a barcode is damaged. Tap a card to fill the field | supply-chain/warehousing/warehouse-app-data-inquiry.md |
| Camera scanning: it scans all the time, with no timeout; it outlines each code; flashlight button; **Accept** turns green; if several codes are seen, it asks which one. A pencil icon switches to typing | supply-chain/warehousing/scan-bar-codes-using-a-camera.md |
| Sounds: different sounds for success, rescan and error | supply-chain/warehousing/warehouse-app-user-settings.md |
| Haptics on wearables: one short pulse = OK; a double pulse = error, look at the screen | supply-chain/warehousing/warehouse-app-haptic-feedback.md |
| Errors are short, plain messages, for example **Invalid license plate.** | supply-chain/warehousing/configure-mobile-devices-warehouse.md |
| Short pick: the worker selects **Short Pick** and gives a reason. This makes a **work exception** that managers see in a log | supply-chain/warehousing/work-exceptions-log.md |
| Local log on the device (errors, steps), searchable, can be exported | supply-chain/warehousing/warehouse-app-log-view.md |
| Accessibility: font 50–400%, buttons 50–200%, high-contrast themes, buttons placed **bottom-right** by default (for the thumb), or other corners | supply-chain/warehousing/warehouse-app-accessibility.md |
| A colour theme per worker shows at a glance who is signed in on a shared device | supply-chain/warehousing/warehouse-app-user-settings.md |

### 6.4 Movement and adjustment on the phone

| Behaviour | Source |
|---|---|
| **Movement** menu item: the worker chooses what to move and where. Options: show inventory status, default data, generate license plate, move a full plate without scanning each item | supply-chain/warehousing/mobile-device-movement-menu.md |
| **Adjustment in / Adjustment out**: Work mode, "process guide" on, reason code (default, show, edit, short list), and a quantity limit per worker | supply-chain/warehousing/reason-codes-for-counting-journals.md |
| Workers may be allowed to override the pick or put location when the shelf does not match | supply-chain/warehousing/mobile-device-work-users.md |

---

## 7. Manager pages (workspaces and monitors)

| Page | What it shows | Source |
|---|---|---|
| **Outbound work monitoring** workspace | Tiles with counts, for example **Locations with open work exceptions**, failed and waiting deferred tasks | supply-chain/warehousing/work-exceptions-log.md; deferred-put.md |
| **Outbound workload visualization** | Charts the manager builds (for example, open work lines per zone); auto refresh; tap a bar to see the work lines; made for a floor screen | supply-chain/warehousing/outbound-workload-visualization.md |
| **Work exceptions log** | List of problems (short picks, missing goods), filter by status, clean-up job | supply-chain/warehousing/work-exceptions-log.md |
| **Cycle count work pending review** | Counts waiting for a supervisor | supply-chain/warehousing/cycle-counting.md |
| **Warehouse mobile devices** workspace | Device health and licence tiles | supply-chain/warehousing/mobile-device-workspace.md |
| **Warehouse implementation tasks** workspace | A setup checklist with links | supply-chain/warehousing/warehouse-management-overview.md |
| **Cancel work** (admin) | Clears stuck work; stock is then moved by hand to the right place | supply-chain/warehousing/cancel-warehouse-work.md |

---

## What this means for our screens

Our rules stay: append-only ledger, approved request before stock goes out, approver ≠ requester,
audit in the same transaction. D365 confirms the shape: **draft → validate → submit → approve → post**,
and **fix by a new document, never by an edit**.

### A. Report page: stock on hand

- **Top bar:** search box (item name, code, **barcode**), warehouse picker, "Show by" chooser
  (like **Dimensions**): *Item* / *Item + warehouse* / *Item + warehouse + location* / *+ batch*. Remember the choice per user.
- **Columns (fixed order):** Item · Unit · **On hand** · **Reserved** (approved requests not yet posted) ·
  **Available** (= on hand − reserved) · **Incoming** (transfers in transit to this warehouse) · Min level · status chip.
- **Status chips:** "Low" (available ≤ minimum), "Out" (0), "Blocked" (if we add blocking). Use colour **and** text (RTL-safe).
- **Row click** opens a side panel: the ledger lines behind the number (like **Transactions**), newest first,
  with a link to each source document. This answers "why is this number this".
- **Row actions:** *Request stock out*, *Transfer*, *Count this item*, *Adjust* (each opens a draft document, prefilled).
- Show the rule in one line under the totals: "Available = on hand − reserved". D365 users get confused by
  filter vs. summed rows; we avoid it by filtering only the shown rows.
- Export to Excel/CSV. Arabic and English column labels from the glossary.

### B. Send goods out on a phone (stock request)

D365 evidence: one step per screen, large title, scan first, number pad for quantity, reason codes from a short
list, confirm step, success/error sound. But D365 mobile flows skip the journal approval workflow; ours must not.

| Our version | Fit with D365 evidence | Advice |
|---|---|---|
| **A. One phone form, sticky Submit** | Like a desktop journal squeezed onto a phone. Fast for 1–2 lines. Weak for scanning | Keep as a fallback for office staff |
| **B. Steps: warehouse → items → reason → submit** | Closest to D365 (one step per screen, warehouse set at sign-in, reason step, confirm step) | **Recommended base**. Skip the warehouse step when the user has one default warehouse (as D365 does at sign-in) |
| **C. Items first with −/+** | Close to D365 "scan item, then quantity" and the item card. Good for many lines | Use C as the **items step inside B**: a scan/search bar on top, a list of item cards with − / + and a tap-to-type quantity, with available stock shown under each item |

Concrete details for B (with C inside):

1. **Title** large and short ("Choose items"). An **i** icon opens a one-line instruction, with "Don't show again".
2. **Scan** button (camera, it keeps scanning, flashlight, Accept) plus a pencil icon to type.
   Scanning the same item again adds +1.
3. Quantity: − / + buttons of 48px or more; tap the number to open the number pad. Warn if the quantity is more than available
   (do not block the draft; the database blocks the post).
4. **Reason** step: a short list per company (like reason code groups). Mandatory or optional per setting.
5. **Review** step = confirmation: warehouse, lines, reason, "will be sent for approval to …".
   Button **Send for approval** sticky at the bottom (bottom-right in LTR, bottom-left in RTL).
6. After submit: a success screen with the request number, status "Waiting for approval", and buttons "New request" / "My requests".
7. Errors: one short sentence plus what to do ("Item not found. Scan again or search by name.").
   Vibrate twice on error, once on success (where the browser supports it).
8. Optional quantity limit per user (like **Adjustment quantity limit**) to catch a barcode scanned into the quantity field.

### C. Phone menu

- Large tiles in groups, like D365 menus: **Stock out** (request), **Receive**, **Transfer**, **Count**,
  **Find item** (inquiry), **My requests**, **To approve** (with a count badge, for approvers).
- The menu is set per role (D365: a root menu per worker). A clerk sees only the tiles they may use.
- Show the current warehouse in the header, with "Change" (D365 **Change warehouse**).
- **Find item** works as a detour from any step: open it, pick a result, come back with the item filled in.

### D. Document page (request, transfer, count, adjustment)

- Header: number, type, status chip (*Draft · Waiting for approval · Approved · Posted · Rejected · Cancelled*),
  warehouse(s), requester, dates.
- Action bar shows **only the next valid actions**: Draft → *Validate*, *Send for approval*, *Delete draft*;
  Waiting → approver: *Approve*, *Reject*, *Ask for change*; requester: *Recall*; Approved → *Post*.
  D365 greys out **Post** until approved; we hide or disable it with a reason tooltip.
- **Validate** shows problems inline per line (no stock, missing location, mandatory reason missing) before sending.
- Lines grid: item, unit, quantity, (from/to for transfers), on hand at that moment, reason.
- **History** tab: the audit timeline (created, submitted, approved by, posted), like **Workflow history**.
- Posted document: read only. Button **Correct…** creates a new reverse/correcting draft linked to this one.

### E. Empty start of a list

- Stock on hand with no stock: one line ("No stock in this warehouse yet") plus two buttons:
  *Receive goods* and *Import opening stock* (D365 imports opening stock through adjustment/movement journals).
- Requests list empty: "No requests yet" plus *New stock request*. For an approver: "Nothing waiting for you".
- Counts list empty: "No counts yet" plus *Start a count*, with a hint: "Count one shelf at a time".
- Never show an empty grid with headers only.

### F. Ideas for the stock transfer screen

- Two states, as in D365 transfer orders: **Shipped (in transit)** and **Received**. Show "In transit" stock on
  the report page under *Incoming* for the destination.
- Phone flow: *To warehouse* (from = current) → scan or add items → review → send for approval → (after approval)
  *Ship*. The receiving warehouse gets "Receive transfer #…" in its menu with lines prefilled.
- Receive step: the quantity is prefilled with the shipped quantity; allow less (partial) with a reason; the rest stays in transit
  until closed. Over-receipt: blocked or limited by a company setting.
- Same-warehouse location moves: an instant transfer (like the transfer journal), still audited.

### G. Ideas for the count screen

- **Blind count** by default: do not show the expected quantity on the phone (D365 never shows it).
  Allow "count again" (number of attempts setting).
- Start by location or by item list; "Add an item that is not listed" button.
- Box + piece entry when an item has two units; the app adds them up.
- No Cancel button in the middle of a count; "Save and finish later" instead.
- After submit: differences within a set limit (percent or quantity) post on approval as usual. Bigger differences
  go to a **Review differences** list for an owner/admin with the counted vs. system numbers, the reason code, and
  Accept / Recount / Reject per line.
- Optional "lock during count" setting: block stock-out posts for counted items until the count is posted.

---

## Not found in the docs

- A plain walkthrough of the **transfer order page** itself (create, ship, receive buttons, partial shipping screens).
  Only the posting effects (finance/general-ledger/inventory-posting.md) and the phone flow were found.
- What a **Validate** error looks like on a journal (the wording or layout of the message list). Only the
  general "message bar" and "Action center" names were found (fin-ops-core/fin-ops/get-started/user-interface-elements.md).
- An **undo** or reverse button for a posted inventory journal. The docs only show correction by a new journal.
- A dedicated **low-stock alert** or low-stock page. Only general alert rules and min/max planning were found.
- An **inbound work monitoring** workspace (only the outbound one is named).
- Approval of stock movements done **on the phone**. The journal workflow does not cover warehouse mobile flows.
- Screenshots of the app screens (the docs refer to images that we did not download). So the layout is from the text only.
