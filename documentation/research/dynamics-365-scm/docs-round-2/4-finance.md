> **Round 2 (24 Nov 2026), part of [DOCS_ROUND_2.md](../DOCS_ROUND_2.md).** Read from Microsoft's public Dynamics 365 documentation
> (github.com/MicrosoftDocs/dynamics-365-unified-operations-public, licence CC BY 4.0, (c) Microsoft), downloaded on 24 Nov 2026.
> Our own words; only UI labels are quoted. Paths are relative to that repo's `articles/` folder. The download is kept locally
> in `.temp/d365-docs` (not in git).

# 4. How accounting work feels in Dynamics 365 Finance

Source: Microsoft public docs (CC-BY-4.0), downloaded to `.temp/d365-docs/articles`.
All claims below are **documented** (read in the docs). Nothing here is seen in a live trial.
Text is in our own words. Labels in **bold** are UI labels.

Path rule: a path that starts with `finance/` or `fin-ops-core/` is relative to `articles/`.
Short forms used in tables:
- `GL/` = `finance/general-ledger/`
- `AP/` = `finance/accounts-payable/`
- `AR/` = `finance/accounts-receivable/`
- `CB/` = `finance/cash-bank-management/`
- `EG/` = `finance/localizations/mea/`

> **In short**
> - D365 Finance puts each finance role in a **workspace**: tiles with counts at the top, task lists and grids below, links on the side, and an **Analytics** tab (Power BI).
> - A journal is a **header** (journal name = purpose and rules) plus **lines**. The user can **Validate**, **Simulate posting**, then **Post**. Posted entries are never deleted; they are **reversed**.
> - Period control is a **ledger calendar** with three states per period: **Open**, **On hold**, **Permanently closed**. Access can also be limited per module and per user group.
> - Month end is run from the **Financial period close** workspace: a template of tasks, due dates relative to period end, owners, dependencies (padlock icon), past-due marks (red).
> - Vendor invoices move through visible stages (import, manual entry, automation, workflow, to post). Matching to PO and receipt shows **Passed/Failed** per line, with tolerances.
> - Bank reconciliation is a **worksheet**: bank lines on one side, book lines on the other, **Match**, then mark reconciled.
> - VAT is set up as codes + groups + settlement periods. The VAT return is a periodic job (**Settle and post sales tax**) that produces a report.
> - Egypt: Microsoft offers ETA e-invoicing (sales, project, credit and debit notes), an Egypt VAT return (form 10 + sales and purchase books), WHT forms 41 and 11, Egyptian invoice layouts, and registration numbers. The VAT and WHT reports can print in **ar-eg**. Setup is heavy (Azure, Electronic reporting, external signing with a hardware token).

---

## 1. Chart of accounts, main accounts, dimensions

| Behaviour | Source |
|---|---|
| A chart of accounts is a shared list of main accounts. Many companies can share one chart; each company has exactly one chart. | `GL/plan-local-chart-of-accounts.md` |
| Microsoft prefers one global chart. For local (statutory) needs it lists four options: local consolidation (recommended), a dimension that holds the local account, local accounts inside the global chart, or external mapping. | `GL/plan-local-chart-of-accounts.md` |
| Main account types: Profit and loss / Revenue / Expense; Balance sheet / Asset / Liability / Equity; **Total** (sums account intervals); **Reporting** (Brazil only). The type decides year-end treatment. | `GL/main-account-types.md`, `GL/year-end-close.md` |
| Main account controls: debit-only or credit-only, default offset account, **Suspended**, **Do not allow manual entry**, default/validate currency, fixed default dimension, which users and which posting types may post. | `GL/general-journal-processing.md` |
| Financial dimensions are extra segments on the ledger account (for example department, cost center). Two kinds: custom (own value list) and entity-backed (values come from customers, projects, and so on). | `GL/financial-dimensions.md` |
| Dimension values can be limited per company (**Legal entity overrides**) and per date range. | `GL/financial-dimensions.md` |
| **Account structures** and **advanced rules** decide which dimensions are allowed or required for which accounts. | `GL/general-journal-processing.md`, `GL/plan-chart-of-accounts.md` |
| The account field is a **segmented entry control**: main account and dimensions in one field, split by a delimiter. The user types freely; the check runs when the user leaves the field. A lookup shows one segment at a time, with a **Show all / Show valid** switch. | `GL/enter-account-dimension-combinations-segmented-entry-control.md` |
| Right-to-left note: Microsoft advises a double delimiter (`--`, `..`, and so on) and only digits and RTL letters in account and dimension values, so the order shows correctly in RTL languages. | `fin-ops-core/fin-ops/financial/financial-dimensions-main-accounts-right-left-language.md` |

## 2. General journals (journal entry)

| Behaviour | Source |
|---|---|
| A **journal name** defines the purpose (for example accrual, correction). It carries: approval workflow (with amount limits), default offset account, currency and dimensions, and **journal control** (which account types and account ranges are allowed). | `GL/general-journal-processing.md` |
| The journal name locks after the header is saved. A wrong journal cannot be renamed; the user must empty it or re-create it. | `GL/general-journal-processing.md` |
| Flow: **New** header, pick name, open **Lines**, enter account, description, **Debit** or **Credit**, offset account, then **Validate**, **Post**, and open **Voucher** to see the result. | `GL/tasks/create-validate-journals.md` |
| A line can carry both the account and the **offset account** (one-line balanced entry). | `GL/tasks/create-validate-journals.md` |
| **Validate** checks known error rules. **Simulate posting** runs the full posting logic without posting and shows the messages. Then the user posts. | `GL/general-journal-processing.md` |
| **Automatic reversal** on a journal (for accruals). | `GL/general-journal-processing.md` |
| **Voucher templates**: save a posted voucher as a template, by amount or by percent; apply it to a new journal and type the total. | `GL/tasks/create-journal-entry-template.md` |
| **Periodic journals** (recurring): lines with a unit (for example months), number of units and last date. The user pulls them into a daily journal with **Retrieve journal** up to a cutoff date. | `GL/tasks/post-periodic-journals.md` |
| **Open lines in Excel** for bulk entry, and a **Global general journal** to enter journals for any company without switching. | `GL/general-journal-processing.md` |
| **Load ledger transactions** copies posted lines into a new journal, with an **Invert sign** option (gives "Void of ..." descriptions) and a date shift. | `GL/general-journal-processing.md` |
| Posted transactions cannot be deleted. | `GL/general-journal-processing.md` |
| **Reverse entire journal**: shows count of vouchers, lines and total amount; asks to keep the original date or enter a new one (needed if that period is closed); asks for a comment. Up to 100 lines runs at once; more runs in the background. | `GL/reverse-journal-posting.md` |
| Many vouchers can be reversed from the **Voucher transactions** list, across all subledgers (vendor payments excluded). | `GL/reverse-journal-posting.md` |
| Journal types list (about 30): daily, periodic, allocation, vendor invoice, invoice register, invoice approval, customer payment, vendor disbursement, bills of exchange, promissory notes, and more. | `GL/ledger-journal-types.md` |

## 3. Looking at the ledger

| Behaviour | Source |
|---|---|
| **Trial balance** list page: balances by account and dimension set for a date range; dimensions in separate columns if wanted; drill down to transactions. | `GL/general-ledger-account-balances.md` |
| **Trial balance snapshots** can be scheduled (daily, weekly, monthly) and opened in Excel. | `GL/general-ledger-account-balances.md` |
| **Voucher transactions** inquiry: search by date, account, type, posting layer. **Audit trail** inquiry: who created which transaction and when. | `GL/view-journal-entries-transactions.md` |
| Ledger reports: dimension statement, ledger transaction list, print journal, posted transactions by journal, transaction list by date, transaction origin. PDF drill-through links can be turned on. | `GL/view-journal-entries-transactions.md` |
| **Account reconciliation** workspace: tiles for open and addressed exceptions; a grid per module and company. Exception types: in subledger not in ledger, in ledger not in subledger, amount mismatch. Actions: create journal, match, reverse voucher, **Accept without change**, undo with reason. An AI agent can suggest the action. | `GL/account-reconciliation.md` |

## 4. Ledger settlement (matching debits and credits inside one GL account)

| Behaviour | Source |
|---|---|
| Purpose: match debits and credits on a GL account (for example a clearing account) so only open items remain in reports. | `GL/ledger-settlements.md` |
| The company chooses which main accounts can be settled. | `GL/ledger-settlements.md` |
| Page flow: set filters (date range, main account, posting layer, dimension set), **Display transactions**, tick lines, watch **Selected amount** / **Marked amount**, settle only when the marked total is zero. | `GL/ledger-settlements.md` |
| Newer flow shows **Marked debits**, **Marked credits** and **Difference** at the top. **Sort by absolute amount** puts equal debits and credits together. | `GL/ledger-settlements.md` |
| Reverse a settlement from a history page; all lines with the same settlement ID reverse together. Settlement must stay inside one fiscal year when year-end awareness is on. | `GL/ledger-settlements.md` |
| AP/AR settlement does not settle the GL lines by itself; an optional **Subledger to ledger auto settlement** parameter exists. | `GL/ledger-settlements.md` |

## 5. Ledger calendar, period close, year-end

| Behaviour | Source |
|---|---|
| Each company has a fiscal calendar; posting fails if none is set. The **Ledger calendar** opens from the **Ledger** page. | `GL/configure-ledger.md` |
| Period states: **Open** (can post, if the user has access), **On hold** (no posting, can reopen), **Permanently closed** (cannot reopen). | `GL/tasks/mass-financial-period-close.md` |
| Per period and per module, access can be **All**, **None**, or one user group. Many companies can be updated at once. | `GL/tasks/mass-financial-period-close.md` |
| Microsoft advises **On hold** at month end, not **Permanently closed**. | `GL/close-general-ledger-at-period-end.md`, `GL/year-end-close.md` |
| Typical month-end list: finish AR/AP/inventory, post all journals, FX revaluation, ledger settlement, allocations, adjustments, statements, set period **On hold**. | `GL/close-general-ledger-at-period-end.md` |
| Year-end close: a template per group of companies (same fiscal calendar), retained-earnings account per company, choice of dimensions to carry. Run creates an opening transaction (and optional closing transaction). It can run many times; each run is listed with date, time and a link to its vouchers; it can be reversed. | `GL/year-end-close.md` |
| A **Validate year-end close** check exists before the run. | `GL/year-end-close.md` |

### Financial period close workspace

| Part | What the user sees | Source |
|---|---|---|
| Schedule picker | Pick one closing schedule at the top; everything filters to it. | `GL/financial-period-close-workspace.md` |
| Summary tiles | Past due, due today, blocked by dependencies, all remaining. | same |
| Tasks and status | Progress by company, by area, by person (% done and tasks left). Filter all / due today / past due. | same |
| Task list | Filter by due date, company, area; hide done tasks. Red date + exclamation icon = past due; padlock = waiting for another task. | same |
| Task row | Task name is a link to the page where the work is done. Attachments (notes, files, journal numbers). **Task complete** stamps the date and time. | same |
| Roles | Each person sees **Only assigned tasks** or **All tasks and status**. Assigned-only users cannot edit the list. | same |
| Setup | Task areas (AP, AR, GL), working-day calendars with holidays, templates (due date = days before/after period end, due time, companies, dependencies), closing schedules (template + period end + companies). Closed schedule leaves the workspace; history stays in **All financial period close tasks** (export to Excel). | same |

## 6. Financial reports

| Behaviour | Source |
|---|---|
| 22 default reports, for example Balance Sheet, Income Statement, Cash Flow, 12-month trend, rolling quarter, side-by-side balance sheet. | `GL/financial-reporting-getting-started.md` |
| Three default trial balance reports: detailed, summary, summary year over year (opening, debits, credits, net, closing). | `GL/trial-balance-financial-reports.md` |
| Opening a report the first time generates it for the previous month. | `GL/view-financial-reports.md` |
| Drill path: report line, then account, then transactions (formatted) or the voucher inquiry. Esc returns. | `GL/view-financial-reports.md` |
| **Report options**: attribute filter, dimension filter, budget scenario. **Currency** switches display currency. Summary-only view. **Print** to PDF (page size, layout, margins). **Export** to Excel. | `GL/view-financial-reports.md` |
| Reports are built from row definitions, column definitions and reporting trees in a separate designer. | `GL/trial-balance-financial-reports.md`, `GL/financial-reporting-getting-started.md` |

## 7. Accounts payable

### Vendor invoice center workspace (newer, preview)

| Stage tile | Statuses inside | Source |
|---|---|---|
| Capture and import | Import failed | `AP/vendor-invoice-workspace.md` |
| Manual entry | Without errors; With validation errors (matching); With other errors | same |
| Automation | In process; Apply prepayment error; Receipt match error; Workflow submission error; Others | same |
| Workflow | In process (shows approver, waiting time, due date); Workflow failed; Workflow rejected (with reason); For my approvals | same |
| To post | Complete not posted | same |

Each status has quick actions (for example **Accept price discrepancy**, **Include in automation**, **Exclude from automation**). A company filter sits at the top. (`AP/vendor-invoice-workspace.md`)

### Vendor invoice automation workspace (older)

| Part | Content | Source |
|---|---|---|
| Summary tiles | Unposted journals, invoices on hold, manual receipt match needed, matching validation not successful, not submitted to workflow, not imported, recover invoices | `AP/vendor-invoices-workspace.md` |
| **New** button | Vendor invoice, invoice journal, global invoice journal, invoice register, invoice approval | same |
| Grids | Open purchase orders (**Invoice now**, **Prepayment invoice now**), product receipts not invoiced, pending invoices, find PO | same |
| Links | Open vendor invoices, invoice journal, invoice history and matching details | same |
| Analytics | Touchless invoices, failed imports, failure reasons, workflow time per approver | same |

### Invoice entry and matching

| Behaviour | Source |
|---|---|
| Ways to enter: invoice register + approval journal, invoice journal (no PO, one step), invoice pool, **Pending vendor invoices** from a PO, invoice capture from images. | `AP/vendor-invoices-overview.md` |
| From a PO, the quantity default is a choice: receive now, ordered, registered, product receipt quantity. | `AP/vendor-invoices-overview.md` |
| Before workflow, the system can block: totals not equal, unallocated charges, duplicate invoice number, invoice quantity below matched receipt quantity. | `AP/vendor-invoices-overview.md` |
| Matching types: invoice totals, two-way (price vs PO), three-way (price vs PO, quantity vs receipt), charges. Price by unit price or line total, with % and/or amount tolerance. | `AP/accounts-payable-invoice-matching.md` |
| Invoice totals check shows a table: balance, discount, charges, sales tax, round-off, invoice amount, each with actual, expected, variance %, **Passed/Failed**. | `AP/accounts-payable-invoice-matching.md` |
| Invoice lines show **Product receipt quantity match**, **Price match**, **Price total match** columns. | `AP/three-way-matching-policies.md` |
| With a discrepancy the clerk can accept it (maybe with approval), change the amount, or ask the vendor for a credit note. | `AP/resolve-invoice-totals-invoice-matching-discrepancies.md` |
| Stuck invoices can be released after four hours (**Recover vendor invoices**). | `AP/vendor-invoices-overview.md` |

### Vendor payments

| Behaviour | Source |
|---|---|
| **Vendor payments** workspace: tiles (unposted payment journals, past-due invoices, vendors, vendors on hold); grids (invoices past due, unsettled payments); links (vendor aging, payment summary); analytics (due today, discounts taken vs lost, paid late, on hold). | `AP/Vendor-payments-workspace.md` |
| **Payment proposal**: pick invoices by due date or cash discount date, date range, amount limit, payment currency, bank offset account; can preview first or create payments directly. | `AP/create-vendor-payments-payment-proposal.md` |
| **Vendor aging** report: balance-as-of date, aging periods or day/month interval, detail, negative balances, unsettled payments column. | `AP/vendor-aging-report.md` |
| **Vendor open transactions** report as of a date, for audit. | `AP/vendor-invoices-overview.md` |

## 8. Accounts receivable

| Behaviour | Source |
|---|---|
| **Free text invoice** (invoice without sales order): customer, lines with main account + dimensions, optional quantity and unit price, **Sales tax** button (view and adjust tax), **Charges**, **Totals**, **Post** (print and post options). Number is given at posting. Status starts **In process**. | `AR/create-free-text-invoice-new.md` |
| **Copy selected lines** and **New from template** for repeat invoices. | `AR/create-free-text-invoice-new.md` |
| Settlement: settle when entering a payment, or later on **Settle transactions** (manual or **Mark by priority**); automatic settlement is a parameter. Over-, under- and exact payment results are described. | `CB/settlement-overview.md` |
| Customer transactions: **View settlements**, **View history**, **View accounting**, **Undo settlements**; **Global transactions** across companies. | `AR/customer-transactions-list-page.md` |
| **Collections coordinator** workspace: overview page with my activities; customer page with tabs **Open transactions**, **Disputed invoices**, **Promised to pay**, **Unsettled payments**; actions change status, NSF payment, write-off, settle; a customer timeline (invoices, payments, letters, activities); contact details at the bottom. | `AR/CollectionsWorkspace.md` |
| **Collections** page: cases on top, transactions in the middle, activities below; side boxes with aged balance and credit limit. Aging comes from an **aging snapshot**; customer pools split work between agents. | `AR/collections-credit-accounts-receivable.md` |
| **Customer aging** report with aging-as-of and balance-as-of dates. | `AR/customer-aging.md` |
| AI customer summary on the customer page (optional). | `AR/CustomerPageSummary.md` |

## 9. Cash and bank

| Behaviour | Source |
|---|---|
| **Bank management** workspace: summary tiles; one card per bank account with current balance and **last reconciled** date; balance history chart; links to general journal, bank transactions, bridged transactions; analytics. | `CB/Bank-management-workspace.md` |
| **Cash overview** (Power BI): inflows and outflows, forecast currency balances, total bank balance, actual vs forecast. | `CB/Cash-Overview-Power-BI-content.md` |
| Advanced bank reconciliation: import statement (ISO20022, BAI2, MT940, or extended), matching rules, automatic match, reconciliation statement. Duplicate statements are refused. | `CB/advanced-bank-reconciliation-overview.md`, `CB/reconcile-bank-statements-advanced-bank-reconciliation.md` |
| One open reconciliation per bank account. **Worksheet**: unmatched bank lines and unmatched book lines in upper grids; select both, **Match**; matched pairs drop below; **Unmatch** moves back. Small "penny" differences allowed within tolerance. | `CB/reconcile-bank-statements-advanced-bank-reconciliation.md` |
| Bank fees or interest not in the books: mark as **New** and post from the statement; with the newer feature, create GL vouchers or customer/vendor payment journals from the worksheet. Finally mark the worksheet reconciled. | `CB/reconcile-bank-statements-advanced-bank-reconciliation.md` |

## 10. Sales tax / VAT

| Behaviour | Source |
|---|---|
| Setup order: main accounts, ledger posting groups, tax authorities, settlement periods, (optional) reporting codes, tax codes (rates), sales tax groups (by party), item sales tax groups (by item), module parameters. Tax applies where a code is in both groups. | `GL/indirect-taxes-overview.md` |
| Settlement period = authority + interval (for example 1 month, 3 months) + payment terms. The authority can be a vendor, so settlement creates an open vendor invoice. | `GL/tasks/set-up-sales-tax-settlement-periods.md` |
| **Settle and post sales tax**: pick settlement period and from-date; offsets tax accounts to the settlement account; prints the **Sales tax payments** report (can be separate). Versions **Original** and corrections. | `GL/tasks/create-sales-tax-payment.md` |
| Posted tax can be viewed from **Posted sales tax**, a settlement period interval, or a tax code; posted tax cannot be deleted. | `GL/tasks/view-posted-sales-tax-transactions.md` |
| On any document, a **Sales tax transaction** view shows tax per line or per document; on free text invoices it can be adjusted. | `GL/indirect-taxes-overview.md`, `AR/create-free-text-invoice-new.md` |
| Conditional (cash-basis) VAT is a parameter. | `GL/indirect-taxes-overview.md` |

---

## 11. Egypt (what Microsoft offers)

| Feature | What it does | Source |
|---|---|---|
| Egypt overview | Five Egypt pages: registration numbers, invoice layout, customer e-invoices, VAT declaration, WHT declaration. Plus links to credit-note references to original invoice, reverse charge VAT, global WHT. | `EG/egypt.md` |
| Registration numbers | Commercial registration number (organization), national number (person), tax file number (VAT ID). Entered on company, customer and vendor. | `EG/emea-egy-reg-numbers.md` |
| ETA e-invoicing (Finance side) | Company needs Egypt address, branch code, registration ID and **taxpayerActivityCode**. Customers need address and registration ID. Tax codes get ETA tax-type codes; exempt codes act as tax subtypes; units get ETA unit codes; products need GTIN or GS1 GPC brick codes (else the internal item number is sent). | `EG/emea-egy-e-invoices.md` |
| ETA e-invoicing (service side) | Builds JSON in the ETA format and sends it. Needs ETA **Client ID** and **Client secret**, Azure Key Vault, and a file share. | `EG/gs-e-invoicing-eg-get-started.md`, `EG/e-invoicing-eg-get-started.md` |
| Signing | ETA gives the signing key only on a hardware token. So D365 writes unsigned files to one folder; signing happens outside; signed files go to a second folder; D365 keeps checking (retry settings) and then sends. Manual steps are involved. | `EG/gs-e-invoicing-eg-get-started.md` |
| Sending and log | User submits posted invoices from **Submit electronic documents**; results are in **Electronic document submission log**. Shipped config points to ETA pre-production URLs. | `EG/emea-egy-e-invoices.md`, `EG/gs-e-invoicing-eg-get-started.md` |
| Coverage | Sales and project invoices, credit notes and debit notes. | `finance/localizations/global/e-invoicing-coverage.md`, `finance/localizations/global/e-invoicing-country-specific-availability.md` |
| Invoice layout | Egypt formats for sales invoice, free text invoice, project invoices (Excel, can convert to PDF, portrait). Plus a "credit invoicing" layout option. | `EG/emea-egy-invoice-layout.md` |
| VAT return (EG-00002) | VAT return form no. 10 + **Sales VAT book** + **Purchase VAT book**. User runs it from the tax settlement job, enters prior-period credit, picks which report, the signer name, and language. | `EG/emea-egy-vat-declaration.md` |
| VAT classification | Lookups map tax groups, item tax groups and tax codes to Egyptian columns: document type, tax type, item type (domestic, export, machines and equipment, parts, exemptions), operation type (goods, services, adjustments). Last rule = **Not applicable**. | `EG/emea-egy-vat-declaration.md` |
| WHT forms 41 and 11 | Form 41 sums tax withheld from local suppliers; form 11 is the other form. Run from **Withholding tax payment**; enter bank, branch, cheque and document numbers, entity type, signer. Needs **Global withholding tax**. | `EG/emea-egy-wht-declaration.md` |
| Language | VAT and WHT reports are translated to **en-us** and **ar-eg**. | `EG/emea-egy-vat-declaration.md`, `EG/emea-egy-wht-declaration.md` |
| Tax engine | Egypt is in the country list of the Tax Calculation service since 10.0.22. | `finance/localizations/global/global-tax-calcuation-service-overview.md` |

---

## 12. What this means for our screens

These are our design notes, based on the documented behaviour above. They are proposals, not D365 facts.

### 12.1 Home page for an accountant (role workspace)

- Top row of **count tiles**, each a filtered list: journals not posted, invoices waiting for approval, invoices with matching errors, invoices past due (AR and AP), bank accounts not reconciled this month, close tasks past due. (Pattern: `AP/Vendor-payments-workspace.md`, `AP/vendor-invoices-workspace.md`, `GL/financial-period-close-workspace.md`.)
- Below: **My work** grids (pending invoices, unsettled payments) with a search box and row actions (**Edit**, **Invoice now**).
- **Bank cards**: one per account, balance and last reconciled date (`CB/Bank-management-workspace.md`).
- Side **Related links** to reports (aging, trial balance).
- **Company filter** at the top for multi-company users. For us: only the companies the person belongs to.
- Separate **Analytics** tab later; first release can use simple charts.

### 12.2 Document page (sales invoice, supplier invoice)

- Header + lines + totals, like the free text invoice: customer, lines (account or item, qty, price, amount, VAT group), buttons **Sales tax** (view, adjust with audit), **Charges**, **Totals**, **Post** (`AR/create-free-text-invoice-new.md`).
- Number given at posting; status chip (Draft / In approval / Posted). This fits our approval rules.
- Supplier invoice: show matching columns per line (**Receipt qty match**, **Price match**: Passed / Failed) and a totals check table (`AP/three-way-matching-policies.md`, `AP/accounts-payable-invoice-matching.md`). Block submit on duplicate number and totals mismatch (`AP/vendor-invoices-overview.md`).
- ETA panel on the posted sales invoice: submission status, response, retry. A log page like **Electronic document submission log** (`EG/emea-egy-e-invoices.md`). We sign on our side, so no manual folder step.
- **Copy lines** and **New from template** (`AR/create-free-text-invoice-new.md`).
- Related actions: **View settlements**, **View accounting** (voucher) (`AR/customer-transactions-list-page.md`).

### 12.3 Report page (financial statements)

- List of standard reports: trial balance (summary, detailed, year over year), balance sheet, income statement, cash flow (`GL/financial-reporting-getting-started.md`, `GL/trial-balance-financial-reports.md`).
- Default period = last month on first open (`GL/view-financial-reports.md`).
- Drill: line, then account, then transactions, then voucher. Back with Esc.
- Options: dimension filter, currency, summary-only, print to PDF, export to Excel.
- For Egypt: EAS layout and Arabic printing as settings (D365 only shows Arabic for tax reports).

### 12.4 Form = journal entry

- Header: journal type (purpose), date, description. The type carries rules: allowed account ranges, approval limits, default offset (`GL/general-journal-processing.md`).
- Lines grid: account (segmented: account + dimensions, check on leaving the field), description, debit, credit, optional offset account, VAT group.
- Live footer: total debit, total credit, difference (D365 shows this in ledger settlement: `GL/ledger-settlements.md`).
- Buttons in order: **Validate** (rule check), **Preview posting** (like **Simulate posting**: show the voucher lines that would post), **Submit for approval**, **Post**.
- After posting: read-only, with **Reverse** (keep date or choose date in an open period, comment required) (`GL/reverse-journal-posting.md`).
- Extras: recurring journal (unit, count, last date, retrieve up to a cutoff), voucher templates by amount or percent, automatic reversal for accruals (`GL/tasks/post-periodic-journals.md`, `GL/tasks/create-journal-entry-template.md`).

### 12.5 Settings overview (finance)

Group settings in the D365 setup order (`GL/indirect-taxes-overview.md`, `GL/configure-ledger.md`):
1. Ledger: currency (EGP default), fiscal calendar, chart of accounts (Egyptian unified chart as seed).
2. Dimensions and account rules.
3. Journal types (purposes, rules, approval limits).
4. Period calendar: per period Open / On hold / Closed, per module access, many companies at once (`GL/tasks/mass-financial-period-close.md`).
5. VAT: authority, settlement period, tax codes (with ETA codes), party groups, item groups, posting accounts.
6. Withholding tax.
7. Egypt identity: tax file number, commercial registration, branch, activity code; customer and supplier IDs; unit codes; item GS1/EGS codes (`EG/emea-egy-reg-numbers.md`, `EG/emea-egy-e-invoices.md`).
8. Close templates: tasks, areas, owners, due days, dependencies (`GL/financial-period-close-workspace.md`).
9. Bank: accounts, statement format, matching rules, tolerance.

Each group should show a status (done / missing) so a new company sees what is left.

---

## 13. Not found in the docs

- No screenshot-level description of the **General journal** page layout (where totals sit, column order). The docs list fields and buttons only. Mark as unconfirmed until a trial.
- No documented live debit/credit/difference footer on the general journal page itself (only on ledger settlement).
- No Egypt-specific chart of accounts (Egyptian unified chart) and no EAS financial statement layout.
- No Arabic UI note for finance screens beyond the RTL dimension advice and **ar-eg** on Egypt tax reports.
- No Egypt e-receipt (B2C POS receipt) in the Egypt pages read.
- No description of the ETA response flow from the user's point of view (rejected invoice, cancel, re-submit). Only the submission log page is named.
- No dedicated "VAT return" workspace; the VAT return is a periodic job plus reports.
- The **Vendor invoice entry** workspace is named but no article describing its tiles was found; the newer **Vendor invoice center** replaces it.
- No tile list for the **Customer payments** or **Customer invoicing** workspaces (names only).
- **CFO** workspace: only a developer note about adding dimensions to Power BI; no user description.
