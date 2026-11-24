> **Round 2 (24 Nov 2026), part of [DOCS_ROUND_2.md](../DOCS_ROUND_2.md).** Read from Microsoft's public Dynamics 365 documentation
> (github.com/MicrosoftDocs/dynamics-365-unified-operations-public, licence CC BY 4.0, (c) Microsoft), downloaded on 24 Nov 2026.
> Our own words; only UI labels are quoted. Paths are relative to that repo's `articles/` folder. The download is kept locally
> in `.temp/d365-docs` (not in git).

# D365 Finance & SCM: sales to cash, AI, phone apps, language and Arabic

Round 2, research file 5. Source: Microsoft public docs (CC-BY-4.0) in `.temp/d365-docs/articles`.
All paths below are relative to `articles/`. Every claim is **documented** (it is in the docs).
Nothing here was seen in a live system. Text is our own words. Only short UI labels are quoted.

> **In short**
>
> - **Sales order** = one page with two views: **Header view** and **Lines view**. A list of orders sits on the left. Actions sit in a tab bar on top (Sell, Pick and pack, Invoice...).
> - The flow is: quotation → sales order → confirm → (pick) → packing slip → invoice. Each step is a "post" dialog with a **Parameters** part and a **Lines** part. Status moves Open → Delivered → Invoiced.
> - **Holds** block the order. On hold, the Pick and pack buttons are greyed out. A hold has a code, and only a set role can clear it.
> - **Prices** come in by themselves from agreements. The line shows unit price, discount, discount %, net amount. A **Totals** dialog shows the whole order.
> - **AI on screen** has three shapes: a chat panel on the side ("sidecar"), AI inside a page (a **Summary by Copilot** box on a record), and agents that work in the background and leave **work items** for a person.
> - **Rule everywhere**: the AI proposes, the person checks and applies. The docs say again and again: never use AI text without a human review.
> - **Scanned supplier bill** ("Invoice capture"): picture on one side, filled form on the other side. Status path Captured → In review → Verified → Transferred. Each field links to its place on the picture. Low confidence gives a warning. The system learns from corrections.
> - **Phone**: the old general phone app is **retired**. What lives on: an **Approvals** app (approve / reject / delegate / ask for changes, no offline, **no right-to-left**) and the **Warehouse** app (camera scanning, big buttons, themes, screen readers).
> - **Arabic**: the web client has right-to-left layout. Help exists in Arabic (Saudi, UAE). There is a long note on mixed Arabic + numbers problems. **Egypt**: tax registration numbers, e-invoice to the Tax Authority, VAT and withholding returns, an Egyptian invoice layout. **No Egypt-specific Arabic UI** is documented.

---

## Part 1. Sales order to cash, as the person sees it

### 1.1 The page shape (one page, two views)

| What | How it behaves | Source |
|---|---|---|
| Page pattern | A "details with lines" page. The person switches between **Header view** (all header fields) and **Lines view** (the lines grid, details of the selected line, and a short block of the most important header fields). | fin-ops-core/dev-itpro/user-interface/details-transaction-form-pattern.md |
| List on the left | A narrow list of records sits at the left of the details. The person jumps between orders without going back to the list page. | same |
| Standard buttons | Edit, New, Delete, Save, Refresh, Attachments, Export to Excel come from the platform on every page. Apps do not add their own copies. | same |
| Title block | The page has a title and an optional **status** group (status fields) at the top. | same |
| Switch view | Options → Change view → Header view. After confirm, the header shows **Document status** = Confirmation. | supply-chain/sales-marketing/tasks/confirm-sales-orders.md |

### 1.2 Create a sales order (Form)

| Step | Behaviour | Source |
|---|---|---|
| Start | Two ways: a menu item **Create sales order** (quick) or **New** on the **All sales orders** list. Both open a small **Create sales order** dialog. | supply-chain/sales-marketing/tasks/create-sales-orders.md |
| Dialog | First field is **Customer account**. Then **OK** opens the full order. | same |
| Order type | Five types: Journal (a draft, no stock effect), Subscription (repeats), Sales order, Returned order (gets an RMA number), Item requirements (from projects). | supply-chain/sales-marketing/overview-sales-marketing.md |
| Lines | Person picks item, enters quantity. Many fields fill themselves: unit (sales unit), site (from header), **Unit price** (from a trade agreement or the item), **Discount** (amount per unit), **Discount percent**, **Net amount** (calculated, can be overwritten). | supply-chain/sales-marketing/tasks/create-sales-orders.md |
| Extra columns | A **Dimensions** button lets the person add columns (colour, size, warehouse) to the line grid and save this choice. | same |
| Totals | Action tab **Sales order** → **Totals**: subtotal, order discount, charges, tax, invoice amount, and the customer's **credit limit** situation. | same |
| Up-sell / cross-sell | Product lists can suggest a different or an extra product while the order is entered. | supply-chain/sales-marketing/overview-sales-marketing.md |

### 1.3 Price and discount display

| Item | Behaviour | Source |
|---|---|---|
| Where prices come from | Trade agreements (by customer, item, quantity, date). A sales agreement price wins over a trade agreement. | supply-chain/sales-marketing/overview-sales-marketing.md |
| Look up a price | Page **Find prices**: pick customer, item, quantity, date. It shows the valid price, cost, and profit. Quantity breaks change the discount (example: 5% for 1-10, 7% above 10). Buttons open all price and discount agreements behind the result. | supply-chain/sales-marketing/tasks/look-up-applicable-prices-discounts.md |
| Price simulation | On a quotation line: **Price simulation**. The person types a target (price, discount, total, margin) and all other fields recalculate. Then the person applies it to the line. Old line discounts are removed. | supply-chain/sales-marketing/tasks/create-edit-sales-quotations.md |

### 1.4 Quotation

| Step | Behaviour | Source |
|---|---|---|
| Create | **All quotations** → **New**. Account type can be **Prospect** (not yet a customer). Lines work like order lines; a line can be a sales category when the item is not known. | supply-chain/sales-marketing/tasks/create-edit-sales-quotations.md |
| Send | **Send quotation** with an option to print. | same |
| Convert prospect | **Follow up** → **Convert to customer**, with a **Check** button that tells if the new account number is free. | same |
| Win | **Follow up** → **Confirm**, with a **Reason**. This makes a sales order. | same |

### 1.5 Confirm, ship, invoice

| Step | Behaviour | Source |
|---|---|---|
| Confirm one | Open order → tab **Sell** → **Confirm sales order**. A dialog with a **Parameters** section: **Posting** yes/no, **Print confirmation** yes/no, **Check credit limit** (can be set to None, unless the customer has a mandatory credit limit). Then **OK** and a **Yes** check. | supply-chain/sales-marketing/tasks/confirm-sales-orders.md |
| Confirm many | A separate page selects orders by a filter (for example one customer). **Summary update** can join many orders into one document, only if invoice account and currency are the same. | same |
| Packing slip (no warehouse app) | Tab **Pick and pack** → **Post packing slip**. **Quantity** choice: All / Deliver now / Picked. **Lines** tab lets the person lower the quantity for a part delivery. Lines from different sites (or addresses) split into more documents automatically. | supply-chain/sales-marketing/tasks/ship-sales-orders-without-warehousing.md |
| Status after ship | All lines shipped → order status **Delivered**. Part shipped → stays **Open**, but **Document status** = Packing slip. **Line quantity** shows what is delivered and what is left. A **Packing slip journal** keeps every document for reprint. | same |
| Invoice | Invoice from the order or from one or more packing slips (for example one invoice per customer per month). When both "deliver remainder" and "invoice remainder" are zero, status = **Invoiced**. | supply-chain/sales-marketing/overview-sales-marketing.md |
| Other invoices | **Free text invoice** (no items, ledger account lines). **Pro forma invoice** (an estimate before posting). | same |
| Cancel / delete | Only orders in a created state can be cancelled. | supply-chain/sales-marketing/sales-orders-faq.md |

### 1.6 Holds and credit

| Item | Behaviour | Source |
|---|---|---|
| Hold codes | Set up per reason (for example "Call back"). Each code names the **Role** that may clear it, can be default, and can remove stock reservations. | supply-chain/sales-marketing/tasks/manage-order-holds.md |
| On the list | A held order shows a tick in **Do not process** and a pause symbol in **Hold**. | same |
| Blocking | On a held order, the picking-list and packing-slip buttons are disabled. | same |
| Hold workbench | **Order holds** page lists all holds. A person can **Check out** a hold (others cannot clear it meanwhile), clear checkout, or reassign. Clear options: **Clear holds**, **Clear and modify** (opens the order). | same |
| Credit limit check | Checked when lines are added, at packing slip, and at invoice (settings). Limit compares to balance, or balance + deliveries, or balance + deliveries + open orders. If over, a message shows (warning or error, by setting). | supply-chain/sales-marketing/credit-limits-customers.md |
| Credit management holds | Rule-based: days overdue, account status, payment terms, expired limit, overdue amount, order amount, % of credit used. **Exclusion** rules can release an order. | finance/accounts-receivable/cm-sales-order-credit-holds.md |

### 1.7 Returns (RMA)

| Item | Behaviour | Source |
|---|---|---|
| Two kinds | **Physical return** (goods come back) and **Credit only** (credit without goods). | supply-chain/sales-marketing/sales-returns.md |
| Steps | Create return order → arrival and inspection → choose **disposition** → packing slip → invoice (credit note). | same |
| Header | Customer, delivery address (our warehouse), **RMA number** (own number sequence), **Deadline** (today + validity days), **Return reason code**. | same |
| Lines | Typed by hand, or **Find sales order**: picks the original invoiced line and copies item, quantity, price, discount, cost. This links the return to the sale. | same |
| Disposition codes | Credit only / Credit / Replace and credit / Replace and scrap / Return to customer / Scrap. Each code decides money, stock, and whether a replacement order is made. | same |
| Replacement | A second sales order linked to the RMA, made by hand (ship now) or automatically after inspection. | same |
| Charges | Fees can come automatically from the reason code or disposition code. | same |

### 1.8 Customer page

| Item | Behaviour | Source |
|---|---|---|
| Customer summary (AI) | On **All customers**, a **Summary** FastTab holds AI text about the past year: invoices, payments, orders, agreements, rebates, overdue invoices, late lines. Numbers are calculated in the ERP, not by the AI. Admin can switch it off. | finance/accounts-receivable/CustomerPageSummary.md, finance/accounts-receivable/CustomerPageSummaryFAQ.md |
| Collections | A **Collections coordinator** workspace with a **Summary by Copilot** field and a **Create reminder email** button (see Part 2). | finance/accounts-receivable/CollectionsCoordinatorSummary.md |
| Payment predictions | Lists show the chance that each invoice is paid **On time / Late / Very late**, with **Top factors** that explain the prediction, plus customer history. | finance/finance-insights/use-customer-payment-predictions.md |

---

## Part 2. Copilot and AI

### 2.1 Where AI appears on screen

| Shape | What the person sees | Source |
|---|---|---|
| **Sidecar** (chat panel at the side) | The main AI surface. Natural-language chat next to the page. It knows the current page and record ("page context") and the menus the person may open. | fin-ops-core/fin-ops/copilot/copilot-for-finance-operations.md, fin-ops-core/dev-itpro/copilot/copilot-application-context.md |
| Help in the sidecar | Answers "how do I" questions from Microsoft's public docs, with citations. Admin can add own documents. Thumbs up/down under each answer. | fin-ops-core/fin-ops/copilot/copilot-generative-help.md |
| Starter prompts | When the chat opens, a card with suggested prompts can show. One click sends it, or puts it in the box to edit first. Can differ per page (example: only on the Vendors page). Preview. | fin-ops-core/dev-itpro/copilot/copilot-zero-prompt.md |
| Attach file / screenshot | **Attach** button: add a file or a screenshot of the current tab. By default the chat does not use it; a maker must add a skill. | fin-ops-core/dev-itpro/copilot/copilot-attachments.md |
| **Embedded** (AI inside a page) | A **Summary by Copilot** FastTab on the record: sales order, purchase order, vendor, released product. Has a **Status** part and an **Insights** part with buttons that filter the lines (example: show only late lines). | supply-chain/get-started/copilot-summaries-overview.md |
| Hover summary | Hover over an item number on most pages → a short AI summary of the item. | same |
| Workflow history | AI summary at the top of the **Workflow history** page; the latest actions under it. | fin-ops-core/fin-ops/copilot/workflow-history-summary-FAQ.md |
| **Immersive Home** (AI-first start page) | Greeting with a short summary, **Suggestions**, a ranked list of **Work items** (cards), **Agent activity**, and workspace tiles. A card shows: type, short summary, action buttons, a link to the full page. Many similar items fold into one card. Finished cards disappear. Cards can be pinned. | fin-ops-core/fin-ops/copilot/immersive-home.md |
| Agents pages | **Agents** page with **Library** (templates) and **Manage** tabs; **Agent activity** is a trace list of everything agents did. | fin-ops-core/fin-ops/copilot/agent-mgmt.md |
| Outside the ERP | Chat over ERP data from Microsoft 365 Copilot or own agents (preview). | fin-ops-core/dev-itpro/copilot/chat-with-fno-data.md |

### 2.2 Preview-then-confirm: how the person accepts AI work

| Feature | Proposal | How the person accepts | Source |
|---|---|---|---|
| Reminder email to customer | AI draft of a payment reminder | Before drafting, a message warns that AI wrote it and must be checked, and asks yes/no. The person edits, then sends. | finance/accounts-receivable/CollectionsCoordinatorSummary.md |
| Follow-up emails to vendors | Drafts per group of late or unconfirmed POs; person sets tone, length, urgency | Person reviews and edits, copies to mail or sends. | supply-chain/faq-supplier-communications-agent.md |
| **Vendor emails → PO changes** (Procurement Agent) | Agent reads a mailbox, sorts each email: confirmation / change request / rejected / other, finds the PO, compares with the system | Review page: emails list on the left, AI summary on the right; shows **original email, current value, proposed value**. Buttons: **Apply all suggestions**, **Apply suggestions** for one header, or for selected lines. Fields: quantity, unit, price, confirmation, delivery date, cancellation. | supply-chain/procurement/procurement-agent-supplier-com-apply-email-changes.md |
| Low confidence | Agent says some columns are mapped with low confidence | **Review** opens a choice of mappings; person picks one and chooses how wide to apply it (one vendor or all). Lessons are listed under **Taught items** and can be deleted. | same |
| Attachments the agent reads | PDF and Excel; not Word. | same |
| Confirmed PO changes workspace | AI summary of the knock-on effect and a draft vendor message | Person first re-confirms changes with little effect, then works on the rest. Drafts are reviewed before email or Teams. | supply-chain/faq-confirmed-po-changes.md |
| Agent work items | Example: agent prepares a vendor reminder email; it waits on Immersive Home for a person to review before sending. | Card buttons on the home page. | fin-ops-core/fin-ops/copilot/immersive-home.md |

### 2.3 Responsible-AI notes (repeated in every AI FAQ)

| Note | Source |
|---|---|
| AI text must never be used without a human review. | supply-chain/faq-summaries.md, supply-chain/faq-confirmed-po-changes.md, supply-chain/faq-wma-copilot.md |
| The summary only sees data the user may see (security roles). | supply-chain/faq-summaries.md |
| Calculations are done by the ERP; the language model only writes text. | finance/accounts-receivable/CustomerPageSummaryFAQ.md |
| Each AI feature has an admin on/off switch in Feature management. | finance/accounts-receivable/CustomerPageSummary.md, fin-ops-core/fin-ops/copilot/workflow-history-summary-FAQ.md |
| Thumbs up / down under summaries and answers; written feedback optional. | supply-chain/get-started/copilot-summaries-overview.md, fin-ops-core/fin-ops/copilot/copilot-generative-help.md |
| Features are tested for a list of languages only; other languages "might not work as intended". | finance/accounts-receivable/CustomerPageSummaryFAQ.md, finance/accounts-receivable/CollectionsCoordinatorSummary.md |
| Protect data so that business data cannot be used to steer the AI. | supply-chain/faq-confirmed-po-changes.md |

### 2.4 Reading supplier bills: "Invoice capture" (most important for us)

**How bills come in**

| Item | Behaviour | Source |
|---|---|---|
| Channels | Upload by hand (default channel), or watch an email inbox / shared mailbox / SharePoint / OneDrive folder. | finance/accounts-payable/invoice-capture-channel.md, finance/accounts-payable/invoice-capture-advanced-settings.md |
| Upload | **Upload file**, plus sign, drag and drop, up to 20 files at once. | finance/accounts-payable/invoice-capture-rec-files.md, finance/accounts-payable/invoice-capture-faq.md |
| File types | PDF, PNG, JPG, JPEG, TIF, TIFF. Word not supported. | finance/accounts-payable/invoice-capture-faq.md |
| Speed | About 15–30 seconds per invoice. | same |
| Duplicates | Same file twice (checksum) → **Cancelled**, reason "duplicate file". A check for the same invoice **number** is NOT built in. | finance/accounts-payable/invoice-capture-rec-files.md |
| Received files statuses | Waiting → In-process → Captured (or Cancelled / Voided). **Reset processing status** if stuck. **View history** per file. | same |

**What the person does with one bill: the side-by-side viewer**

| Item | Behaviour | Source |
|---|---|---|
| Layout | Left: the original picture, with page, zoom, fit, rotate controls; a drag line resizes the two panes. Right: the invoice form as cards. | finance/accounts-payable/invoice-capture-workspace.md |
| Header strip | **Status**, **Legal entity**, **Vendor account**, **Invoice type**. **Classify invoice** opens a side pane to fix these three. | same |
| Cards | **Message** card (errors, warnings, info; can filter by type), **Invoice header**, **Invoice lines** (5 per page with arrows), **Charges**, **Sales tax**. | same |
| Link to picture | An eye symbol next to each read field. Click → the picture jumps to and highlights that value. | same |
| Mapping mode | Icon on the picture pane. Read values show in colours: yellow = already used for a field, blue = not used. The person clicks a value and chooses the field. | same |
| Learning | After transfer, the system remembers the person's choices (legal entity, vendor, item, charge code, value mapping) and uses them for the next bill from the same vendor. | same, finance/accounts-payable/invoice-capture-faq.md |
| Derivation | The system finds company, vendor (by name, address, tax number), item (also by the vendor's own item number), currency (from symbol, PO, or vendor). If one fails, it stops and asks. | finance/accounts-payable/invoice-capture-workspace.md |
| Checks | Mandatory fields, **confidence score** below a warning or error level, existence of vendor / item / PO, stock items must link to a PO line. | same |
| Link to PO | **Link purchase line with invoice line** page: candidate PO lines; green tick when linked, red cross when not. | same |

**Status path and buttons**

| Status | Person can | Source |
|---|---|---|
| Captured | **Classify invoice**, **Start review**, **Void** | finance/accounts-payable/invoice-capture-workspace.md |
| In review (form becomes editable, "Modified version") | Edit header, lines, charges, tax; **Remove all** lines; **Complete review**; **Void** | same |
| Verified | **Transfer**, Classify, Start review again, Void | same |
| Transferring / Transferred | Open the created invoice in the ERP | same |
| Voided | Delete forever (**Obsolete**) | same |
| When review is needed | Setting per group: always / only on errors / on errors or warnings. Without errors, it can go through "touchless". | finance/accounts-payable/invoice-capture-faq.md |
| Download | Original file can always be downloaded. | finance/accounts-payable/invoice-capture-workspace.md |
| Manager dashboard | Charts: bills by status, volume by period, top vendors, days to finish with exceptions, bills waiting by age. | finance/accounts-payable/invoice-capture-dashboard.md |
| Bill languages | Whatever the underlying Microsoft reading service supports (list not in our docs). | finance/accounts-payable/invoice-capture-faq.md |

---

## Part 3. Phone apps

| App | Status | What it shows | Offline | RTL | Source |
|---|---|---|---|---|---|
| General "finance and operations" mobile app | **No longer supported**, removed from app stores. Old installs still work. | Dashboard → workspaces → pages → actions. Lists and details built from web pages by a designer. | Yes: view, edit, act offline; syncs later. | not stated | fin-ops-core/dev-itpro/includes/mobile-app-deprecation-banner.md, fin-ops-core/fin-ops/mobile-apps/Mobile-app-home-page.md |
| Old Sales orders mobile workspace | Part of the retired app | Search by order, customer, status, date. Details: customer, dates, order taker contact, lines, shipments. Read only. | (app) | – | supply-chain/sales-marketing/sales-orders-mobile-workspace.md |
| Old Invoice approvals workspace | Part of the retired app | Invoice header, line details, **Distributions** (accounts), **Attachments**, workflow action, **Done**. | (app) | – | fin-ops-core/fin-ops/mobile-apps/invoice-approval-mobile-workspace.md |
| **Approvals Management** app (current) | Runs inside Power Apps. Needs a licence. | See next table. | **No** | **No** (planned later) | supply-chain/approval-management-mobile-app/approval-management-app-faq.md |
| **Warehouse Management** app (current) | Active, frequent updates | Task flows with scanning; workload insights by AI at shift start. | Device locks work offline; general offline not stated | RTL fixes listed in release notes | supply-chain/warehousing/warehouse-app-whats-new.md, supply-chain/warehousing/warehouse-app-client-settings.md |

**Approvals app layout** (supply-chain/approval-management-mobile-app/manage-approvals.md)

| Screen | Parts |
|---|---|
| Home | About, navigator (Home, Purchase orders, Purchase requisitions), **Search** (order no., vendor, company, item), **Alerts** with red dot, count tiles per document type, filter, sort, refresh (auto every 30 s). |
| List | Each row = summary of a header or line; **View comments**; **Header/Lines** switch; **Multiselect** on → select all, then approve / reject / delegate / request changes for all. |
| Header details | Back; tabs **Details**, **Attachments**, **Timeline**; accounting distribution; workflow instructions; lines under the header; action buttons. |
| Line details | Back; standard details; expandable extra details; action buttons (not on every line page). |
| Four actions | Approve, reject (deny), delegate, ask for changes. (supply-chain/approval-management-mobile-app/approval-management-app-overview.md) |

**Warehouse app details worth copying**

| Feature | Behaviour | Source |
|---|---|---|
| Camera scanning | Scans all the time while the camera page is open; outlines each code and shows its value; **Accept** turns green; asks which one if several codes; flashlight button; pencil to type by hand. | supply-chain/warehousing/scan-bar-codes-using-a-camera.md |
| Promoted fields | Admin picks which fields show on the main card per step; up to two in bold; the rest one tap away. | supply-chain/warehousing/warehouse-app-promoted-fields.md |
| Accessibility | Font size 50–400 %, button size 50–200 %, Auto / Light / Dark / two high-contrast themes, buttons placed at any corner (default bottom right for thumbs), TalkBack / Narrator / VoiceOver. | supply-chain/warehousing/warehouse-app-accessibility.md |
| Personal themes | Colour theme per worker (to see who is signed in on a shared device); sound themes after a scan. | supply-chain/warehousing/warehouse-app-user-settings.md |
| Photos | Take photos or videos and attach them to records (preview). | supply-chain/warehousing/warehouse-app-media-capture.md |

---

## Part 4. Language, Arabic, right-to-left, accessibility, many companies

### 4.1 User options (per person)

| Option | Where | Source |
|---|---|---|
| Language | User options → Preferences → **Language and country/region preference** | fin-ops-core/fin-ops/get-started/whats-new-platform-updates-10-0-31.md |
| Date, time, and number format | Same tab; separate from language. Reports can format by this setting. | fin-ops-core/dev-itpro/get-started/personalize-user-experience.md, fin-ops-core/dev-itpro/analytics/er-design-multilingual-reports.md |
| Time zone | Same tab; admin can also set it for a user. | fin-ops-core/fin-ops/organization-administration/tasks/set-users-preferred-time-zone.md |
| Default company, start page, view/edit mode | Same tab. | fin-ops-core/dev-itpro/get-started/personalize-user-experience.md |
| Colour theme, element size | **Visual** tab. | same |
| Open User options | **Settings** (gear) on the top bar → User options. | same |

### 4.2 Many companies (legal entities)

| Item | Behaviour | Source |
|---|---|---|
| Company picker | On the top navigation bar, next to Search; shortcut Ctrl+Shift+O. | fin-ops-core/fin-ops/get-started/user-interface-elements.md, fin-ops-core/fin-ops/get-started/shortcut-keys.md |
| Pop-out windows | A page opened in a new window shows which company it belongs to, read only. | fin-ops-core/fin-ops/get-started/display-pages-side-by-side.md |
| Multi-company selection | Newer: a parent-child tree to pick several companies for cross-company work (search, sort, multi-select), instead of a flat list. On by default from 10.0.47. | fin-ops-core/fin-ops/organization-administration/plan-organizational-hierarchy.md |
| AI and company | Invoice capture asks for **Legal entity** first; nothing moves on without it. | finance/accounts-payable/invoice-capture-workspace.md |

### 4.3 Arabic and right-to-left: exactly what exists

| Fact | Source |
|---|---|
| The web client has right-to-left layout for every page (added in an early platform update). | fin-ops-core/dev-itpro/get-started/ax-2012-features-not-implemented-but-not-deprecated.md, fin-ops-core/dev-itpro/user-interface/bidirectional-support.md |
| Custom controls are tested for RTL by setting the page direction attribute; the browser flips the layout. | fin-ops-core/dev-itpro/user-interface/build-extensible-control.md |
| Text is never mirrored: English stays left-to-right, Arabic right-to-left, inside one line. | fin-ops-core/dev-itpro/user-interface/bidirectional-support.md |
| Known problems with mixed text: codes with underscore (123_456 shows as 456_123), hyphens with numbers, English text with neutral signs in an RTL box. Microsoft says no standard control solves all of them; one idea is to flag such fields to keep their direction. | same |
| Chart of accounts in RTL: use a **double** separator (--, ||, ..), use only numbers and Arabic letters in account and dimension values, never the separator inside a value. | fin-ops-core/fin-ops/financial/financial-dimensions-main-accounts-right-left-language.md |
| Help content languages include Arabic (Saudi Arabia) `ar` and Arabic (UAE) `ar-ae`. No Egyptian Arabic. | fin-ops-core/dev-itpro/help/language-locale.md |
| UAE sales invoices and credit notes print in two languages; an ar-AE user interface language was added. | fin-ops-core/dev-itpro/get-started/whats-new-changed-8-1-October-2018.md |
| Warehouse labels can print Arabic on Zebra printers with the right font and encoding. | supply-chain/warehousing/custom-label-layouts-and-printing.md |
| Approvals app and Asset Management app: all languages **except RTL**. | supply-chain/approval-management-mobile-app/approval-management-app-faq.md, supply-chain/asset-management/asset-management-mobile-app/asset-management-app-faq.md |
| Warehouse app: RTL layout fixes in recent versions. | supply-chain/warehousing/warehouse-app-whats-new.md |
| AI features: tested only for a listed set of languages (the list is a web link, not in our docs). | finance/accounts-receivable/CustomerPageSummaryFAQ.md |

### 4.4 Egypt: exactly what exists

| Feature | What it covers | Source |
|---|---|---|
| Egypt overview | Links to the five items below. | finance/localizations/mea/egypt.md |
| Registration numbers | Commercial registration number, national number, file tax number; for company, customers, vendors. | finance/localizations/mea/emea-egy-reg-numbers.md |
| Invoice layout (EG) | Egyptian sales, free text and project invoice formats (made as Excel, can convert to PDF); credit-invoice layout. | finance/localizations/mea/emea-egy-invoice-layout.md |
| Customer e-invoices | Electronic submission of customer invoices to the Tax Authority; company branch and activity code. | finance/localizations/mea/emea-egy-e-invoices.md, finance/localizations/mea/e-invoicing-eg-get-started.md |
| VAT return | Egyptian VAT declaration report. | finance/localizations/mea/emea-egy-vat-declaration.md |
| Withholding tax | Egyptian withholding declarations. | finance/localizations/mea/emea-egy-wht-declaration.md |
| Tax engine | Egypt is in the country list of the global tax calculation service. | finance/localizations/global/global-tax-calcuation-service-overview.md |

### 4.5 Accessibility (web client)

| Item | Behaviour | Source |
|---|---|---|
| Labels | Every field and control has a label and shortcut description for screen readers. | fin-ops-core/fin-ops/get-started/accessibility-features.md |
| Search pages | Alt+G → type a page name. | same |
| Search actions | Ctrl+' → type part of an action name and run it. | same |
| Tab order | Short by default (only key fields); can be widened. | same |

---

## What this means for our screens

### Document page = sales order
- Copy the shape: **one page, Header view / Lines view switch**, a narrow order list at the side (start side in RTL), title + status chips at the top.
- Action tabs by stage: **Sell** (confirm), **Pick and pack** (deliver), **Invoice**. Grey out buttons the status does not allow; show *why* (for example "on hold").
- Show **two statuses**: order status (Open / Delivered / Invoiced) and document status (last document made). Plus a **Line quantity** view: ordered / delivered / invoiced / left.
- A **Totals** panel on the page (not a hidden dialog): subtotal, discount, tax, total, and the customer's credit left.
- Holds: tick + pause icon in the list; on the page a red banner with hold code and who may clear it. This fits our database-enforced approvals.
- A **Summary** card at the top with numbers from our database, and AI text only as words around those numbers. Buttons in the card filter lines (late, not delivered).
- Returns: start from the original invoice ("Find sales order"), pick a reason and a disposition per line.

### Form = new order
- Small first step: pick **customer** only, then the full form. Price, discount, discount %, net fill in by themselves and stay editable, with a small "from price list" hint.
- Order type at start: draft / order / return.
- Let the person add columns (unit, warehouse) and remember them.
- Credit check message when a line pushes the customer over the limit.

### Scanning a supplier bill
- Copy the **side-by-side** idea: photo on one side, form on the other, resize bar between.
- **Click a field → highlight it on the photo.** Colour low-confidence fields; show a messages card at the top.
- Clear status path: received → read → in review → checked → posted. Buttons fit each status. Void keeps the file.
- Ask first for **company and supplier**; match supplier by tax registration number (Egypt has one).
- Duplicate check by file hash **and** by supplier + bill number (Microsoft lacks the second one).
- Remember corrections per supplier. Show "learned from your last bill" so the person trusts it.
- Upload from phone camera, WhatsApp photo, or many files at once. Posting must still go through our own approval and audit function.

### Assistant
- A side panel that knows the current page and record, with 3–4 starter prompts per page.
- Any change the assistant proposes shows **current value → proposed value** with **Apply all / Apply selected / Edit**. Nothing changes without a click.
- A warning line on AI drafts (emails, reminders) and a yes/no before drafting. Thumbs up/down.
- A "work items" list on the home page for agent proposals waiting for a person (same queue as WhatsApp approvals).
- An admin on/off switch per AI feature, and an activity log of what agents did.

### Phone menu
- Follow the Approvals app: Home with count tiles, Search, Alerts with dot, list with **multiselect** and bulk Approve / Reject / Delegate / Ask for changes, detail with Details / Attachments / Timeline tabs.
- Microsoft's approvals app has **no Arabic RTL and no offline**. We can win here: full RTL from day one.
- From the Warehouse app: camera scanning that never times out, bigger-text and bigger-button settings, thumb-zone buttons, high contrast.

### Arabic / RTL
- Logical CSS everywhere (we already do). Test mixed strings: item codes with `_` and `-`, phone numbers, amounts with EGP, English names inside Arabic text. Force LTR on code-like fields (item code, invoice no., account no., tax no.) with `dir="ltr"` or bidi isolation.
- Account codes: avoid single `-` separators in RTL.
- Separate settings: language, number/date format, time zone, default company — like D365 User options.
- Company switch in the top bar; every pop-up or print shows the company name.

---

## Not found in the docs

- A dedicated **customer workspace for sales** (only the customer page summary and the collections workspace were found).
- A full step-by-step for **posting a sales invoice** from the order (only the overview text).
- Sidecar **actions that change data** with a built-in confirm dialog. Docs only show navigation actions and maker-built tools.
- **Voice** input for Copilot or approvals. **WhatsApp** in any form.
- Invoice capture **from a phone camera** directly. (An expense receipt phone workspace is listed, but its article is not in our download.)
- The list of **languages** Copilot is tested for, and the list of bill languages Invoice capture can read (both are web links only).
- **Egyptian Arabic** (ar-EG) as a UI or help language; any **Arabic invoice layout** for Egypt (UAE has a two-language invoice, Egypt does not say).
- **Arabic-Indic digits** setting as its own option (only the number-format culture setting).
- Offline mode in the current phone apps (Approvals: clearly no; Warehouse: not stated beyond device locks).
