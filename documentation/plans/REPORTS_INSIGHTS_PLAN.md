# Reports & Insights Plan

**Module key:** `reports` (tables start with `rpt_`)
**Status:** `[✅ Approved]`: Ben's yes, 24 Nov 2026 (through erp-master). Building step by step.
**Owner:** coding chat "reports" · **Reviewers:** Ben, erp-master
**Research:** none new. The scope comes from the feasibility note `.temp/2026-11-23-reports-insights-feasibility.md` (local, not in the repo) and Ben's decisions of 23 Nov.
**Depends on modules:** core. Each data source also needs its own module switched on (sales, purchasing, inventory, finance, accounting).

> **In short**
> - One new app, **Reports & Insights**. It is the **last item in the menu** of the current UI. Same sign-in, same permissions.
> - Six build steps. Each step can merge on its own:
>   1. **Report library**: all reports we already have, in one place, by area. No database change.
>   2. **Report builder**: pick a source, columns, filters, grouping, totals and a chart. Save it. Export to Excel and PDF.
>   3. **Ready-made templates**: about ten useful reports, made with the builder.
>   4. **Sales forecast**: by product and by customer, with the stock forecast's method.
>   5. **"Alert me when"** a report's number goes above or below a limit (in the alert engine we have).
>   6. **Scheduled reports**: send a report every day, week or month by WhatsApp, Telegram, email or in the app.
> - **Not built now:** cash flow forecast and AI. They are written down in section 12 for later.
> - **Safety:** the browser never sends SQL. It sends a choice from our fixed list. The database checks that choice again and runs it
>   only for the person's own company, with their own rights.
> - **What I need from Ben:** "yes" to this plan, and answers to the open questions in section 11 (each has a suggested answer).

---

## 1. Goal

Today our reports are on many screens in many apps, and nobody can make a report of their own. This module puts every report in one
place, lets people build and save their own reports without help, forecasts sales, and tells people when a number they watch
goes too high or too low. It is for owners and managers first. Staff can use it too, but they see only the data they may already see.

## 2. Scope

**In (this version), by build step:**

| Step | What | Database change |
|---|---|---|
| 1 | Report library: links to the existing reports, by area (Sales, Buy, Stock, Money, Tax). Shows only the reports the person may open. | None |
| 2 | Report builder and saved reports. Excel and PDF export. A simple chart. | Yes (next free number, now `109`) |
| 3 | Ready-made templates, made with the builder. "Copy and change" makes your own version. | None (templates are code) |
| 4 | Sales forecast by product and by customer. | Yes (one function) |
| 5 | "Alert me when this number goes above or below X": a new alert kind. | Yes (alert rules) |
| 6 | Scheduled reports through the existing message queue. | Yes (one table, one job step) |

**Out (later):**
- Cash flow forecast (money in from invoices due, money out to bills due). Ben's decision: it comes after the sales forecast.
- AI on reports (section 12). Ben's decision: plan only.
- Weekly and seasonal patterns in the sales forecast. They need 12 months or more of history; most companies do not have it yet.
- Sending a report to an address outside the company (open question Q3).
- The new-UI version of these screens: track-c decides it. I add one line per screen to the new UI plan, section 2.4.

**Won't:**
- Free SQL, from a person or from an AI. Never.
- Reports that change data. Every part of this module only reads.
- Copies of the data in another database or app.

## 3. Data model

All new tables: `org_id` not null, row level security on, `revoke all` from `anon` and `authenticated`, then `grant select` only.
All writes go through database functions (ADR-0003). Every change writes to `audit_log` in the same transaction. Every table has an
index that starts with `org_id`, and an isolation test.

### 3.1 Saved reports (step 2): `rpt_reports`

| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | primary key |
| `org_id` | uuid | no | references `organizations` |
| `name` | text | no | 1 to 100 characters; unique among the company's live reports that the same person can see |
| `description` | text | yes | up to 500 characters |
| `definition` | jsonb | no | the builder settings (section 7.1). Checked by `rpt__check_definition` on every save. |
| `template_key` | text | yes | set when the report was copied from a ready-made template |
| `visibility` | text | no | `company` (everyone who may use its source) or `private` (only `owner_id`) |
| `owner_id` | uuid | no | the person who made it |
| `created_at`, `updated_at` | timestamptz | no | |
| `deleted_at` | timestamptz | yes | soft delete |

Read rule (RLS): your own company, and (`visibility = 'company'` or `owner_id` is you).

### 3.2 Alert on a report (step 5): changes to `alr_rules`

A new kind `report_value`, and new columns on `alr_rules`: `report_id uuid` (references `rpt_reports`), `report_column text`,
`compare text` (`above` or `below`). The existing `threshold` column holds the limit. The kind check and the "which kinds use which
columns" checks are replaced, as `sql/030` did for `forecast_stockout`. `alr_rules` has no column grants today (checked 24 Nov); if
one is added before step 5, the new columns get their grant in the same migration.

### 3.3 Schedules (step 6): `rpt_schedules`

| Column | Type | Null | Rules |
|---|---|---|---|
| `id`, `org_id` | uuid | no | as above |
| `report_id` | uuid | no | references `rpt_reports`; the report must be `company` visibility |
| `frequency` | text | no | `daily`, `weekly`, `monthly` |
| `weekday` | int | yes | 1 to 7, for weekly; uses the company work week (`sql/106`) for the default |
| `month_day` | int | yes | 1 to 28, for monthly |
| `send_hour` | int | no | 0 to 23, in the company's time zone (organization setting) |
| `period` | text | no | what the report covers: `yesterday`, `last_7_days`, `last_week`, `this_month`, `last_month` |
| `recipients` | jsonb | no | people, roles or alert teams (same shape as alert recipients, `sql/028`) |
| `enabled` | boolean | no | |
| `next_run_at`, `last_sent_at` | timestamptz | | `next_run_at` is computed by the database on every change and after every send |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | | | |

**Migration files:** `sql/109_rpt_reports.sql` (step 2), then the next free numbers for steps 4, 5 and 6, checked in `sql/README.md`
at build time. One SQL test for each migration (next free test now `106`).

## 4. Permissions

Members get every key that ends in `.read` plus the `memberGrants`. Owners and admins get all keys. The database checks the role again.

| Key | Default | Allows |
|---|---|---|
| `reports.library.read` | everyone | open Reports & Insights and its library |
| `reports.custom.read` | everyone | run the builder and the company's saved reports, **only on sources the person may use** (7.2) |
| `reports.custom.create` | members, admins, owners | save private reports (member grant) |
| `reports.custom.manage` | admins, owners | save, change and delete company reports |
| `reports.forecast.read` | everyone who may read sales invoices | the sales forecast |
| `reports.schedules.manage` | admins, owners | make and change scheduled reports |

"Alert me when" uses the existing `alerts.rules.manage` key (owners and admins). Viewers can read, never save.

## 5. API

All routes are under `/v1/reports`. Each route checks its permission first; the database function checks again. If the migration is
not applied yet, the route returns **503 `not_set_up`** (Ben often merges before "yes").

| Method | Path | Permission | Body / query | Returns |
|---|---|---|---|---|
| GET | `/sources` | `reports.custom.read` | — | the sources, columns, filters and totals this person may use |
| POST | `/run` | `reports.custom.read` | a definition (7.1) | `{ columns, rows, totals, truncated }` |
| GET | `/saved` | `reports.custom.read` | — | the saved reports this person can see |
| GET | `/saved/:id` | `reports.custom.read` | — | one saved report |
| POST | `/saved/:id/run` | `reports.custom.read` | optional date range | as `/run` |
| POST | `/saved` | `reports.custom.create` (private) or `.manage` (company) | name, description, definition, visibility | the new id |
| PATCH | `/saved/:id` | same as POST | changed fields | — |
| DELETE | `/saved/:id` | same as POST | — | soft delete |
| GET | `/forecast/sales` | `reports.forecast.read` | `by=item\|customer`, `horizon=30\|60\|90` | forecast rows (7.4) |
| GET, POST, PATCH, DELETE | `/schedules`, `/schedules/:id` | `reports.schedules.manage` | section 3.3 | the schedules |

"Alert me when" goes through the existing alerts routes, with the new kind.
Audit log: save, change, delete of a report or schedule (before and after), every alert rule change (as today), every scheduled send.
Running a report is not audited (it only reads), the same as opening any other report today.

## 6. Screens (current UI)

| Screen | Route | Permission | Notes |
|---|---|---|---|
| Library | `/reports` | `reports.library.read` | Areas: Sales, Buy, Stock, Money, Tax, then "My reports" and "Company reports". Each card opens the existing screen. Cards the person cannot open are not shown. |
| Builder | `/reports/new`, `/reports/:id` | `reports.custom.read` | Left: source, columns, filters, group by, totals, chart. Right: the result table and the chart. Buttons: Run, Save, Excel, PDF, Print, "Alert me when", "Send on a schedule". |
| Templates | inside the library | `reports.custom.read` | Each template opens in the builder; "Copy and change" saves your own version. |
| Sales forecast | `/reports/forecast` | `reports.forecast.read` | By product or by customer; next 30/60/90 days; trend and confidence; the method in plain words on the screen. |
| Schedules | `/reports/schedules` | `reports.schedules.manage` | List, add, pause, delete. |

Reports & Insights is the **last item in the menu**. All labels in Arabic and English through the translation files; logical CSS
properties only; the chart draws right to left in Arabic.
For each screen I add one short line to the new UI plan (`.temp/2026-11-23-new-ui-plan.md`, section 2.4). I do not build the new-UI version.

## 7. Business rules and calculations

### 7.1 A report definition

```json
{
  "source": "sales_lines",
  "columns": ["invoice_date", "customer", "item", "qty", "line_total"],
  "filters": [{ "column": "customer_group", "op": "eq", "value": "<uuid>" }],
  "period": { "column": "invoice_date", "from": "2026-11-01", "to": "2026-11-30" },
  "groupBy": ["customer"],
  "totals": [{ "column": "line_total", "fn": "sum" }],
  "sort": [{ "column": "line_total", "dir": "desc" }],
  "limit": 20,
  "chart": { "type": "bar", "x": "customer", "y": "line_total" }
}
```

Rules, checked in the API (shared Zod schema) **and again in the database** (`rpt__check_definition`):
- `source` and every column name must be in the fixed list (7.2). Anything else is refused with `INVALID_INPUT`.
- Filter operators: `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, `between`, `contains` (text only), `is_empty`. Each column allows only
  the operators that fit its type.
- Filter values are always passed as **parameters**, never put into the SQL text. Column and table names come only from our own list.
- Up to 20 columns, 10 filters, 2 group-by columns, 5 totals. A date range is required, at most 3 years.
- Total functions: `sum`, `count`, `avg`, `min`, `max`. Only `count` on text columns.
- Result: at most 5,000 rows (`truncated: true` above that, as `sql/070`). Each run stops after 10 seconds (`statement_timeout`).
- The chart only reads the result. Types: bar, line, pie. No new package: our own small SVG chart.

### 7.2 Data sources (the fixed list)

Each source is one fixed query inside the database. Each one has the permission it needs, the same as the screen that shows that data today.

| Source | Main columns | Needs |
|---|---|---|
| `sales_lines` | invoice date, number, customer, customer group, item, item group, quantity, unit price, line total, VAT, currency, branch | `sales.invoices.read` |
| `sales_orders` | date, number, status, customer, total, currency | `sales.orders.read` |
| `purchase_lines` | bill date, number, supplier, item, item group, quantity, unit cost, line total, VAT, currency | `purchasing.invoices.read` |
| `stock_on_hand` | item, item group, warehouse, on hand, reserved, available, reorder level | `inventory.items.read` |
| `stock_moves` | date, item, warehouse, kind, quantity | `inventory.items.read` |
| `receivables` | customer, invoice, due date, days overdue, age band (0–30, 31–60, 61–90, 90+), amount still owed | `finance.reports.view` |
| `expenses` | date, category, amount, currency, branch | `finance.reports.view` |
| `payments` | date, in or out, party, method, amount, currency | `finance.reports.view` |
| `ledger_lines` | date, account, account type, debit, credit, entry | `accounting.ledger.view` |

- **Each company sees only its own rows.** Every source query filters on the caller's company; the base tables also have row level
  security.
- **Costs stay hidden** from people who may not see them today (for example `purchasing.prices.view`): those columns are not offered,
  and the database refuses them.
- A source of a module that is switched off is not offered.
- Customer and supplier phone, email and address are **not** in any source in this version (not needed for numbers).

### 7.3 Money

Amounts are integer minor units plus a currency code. **Totals never add different currencies:** when the rows have more than one
currency, the totals are one line per currency. Example: 3 lines EGP 1,000.00 + EGP 250.50 + USD 40.00 give two totals:
EGP 1,250.50 (125050 minor) and USD 40.00 (4000 minor). Amounts are shown in the company's number format.

### 7.4 Sales forecast (step 4)

The same method as the stock forecast (`sql/029`), but on sales instead of stock issues:
- **History:** issued sales invoice lines in the last 90 days, by item or by customer. Approved credit notes are subtracted.
- **Rate per day** = weighted average: the latest 30 days count 50%, the 30 before 30%, the 30 before that 20%.
- **Forecast for the next N days** (30, 60 or 90) = rate per day × N, for quantity and for value (value per currency).
- **Trend:** "up" if the latest 30 days are more than 10% above the oldest 30, "down" if more than 10% below, else "flat".
- **Confidence:** `good` with at least 8 invoices over at least 60 days; `thin` with fewer (a guess); `none` with no sales in 90 days
  (no forecast shown). The screen says this in plain words.

Worked example (one item): sold 60 in the latest 30 days, 30 in the 30 before, 30 in the 30 before that.
Rate = (0.5 × 60 + 0.3 × 30 + 0.2 × 30) / 30 = 45 / 30 = 1.5 a day. Next 30 days: 45. Trend: 60 against 30 is up.

### 7.5 "Alert me when" (step 5)

- On a saved company report, an owner or admin picks one total, "above" or "below", and a limit. Example: "Tell the Management team
  when this week's sales are below EGP 50,000."
- The five-minute alert job (`alr_run`) runs the report for the company and compares the total. It uses the same "do not repeat"
  rules as the other alert kinds (`sql/028`).
- **The report runs with the rule maker's rights.** The database refuses a recipient who could not open that report's source,
  so a number never reaches someone who may not see it.
- Report totals per currency: the rule names its currency.

### 7.6 Scheduled reports (step 6)

- An owner or admin picks a saved company report, how often, the hour, the period it covers, and the people.
- The scheduled job finds the schedules that are due, runs each report for its company, and puts one message for each person in the
  **existing outbox** (retry, expiry and audit already exist). The message holds: the report name, the period, the totals, the first
  5 rows, and a link that opens the full report in the app (sign-in needed).
- Channels: what each person chose for messages (in-app, WhatsApp, Telegram, email), the same as alerts.
- The same recipient rule as alerts: people who may not see the source do not get it.
- A full Excel or PDF file inside the message waits for the server PDF converter (Gotenberg, noted in the invoice printing work).

### 7.7 Export

- **Excel (.xlsx):** written in the browser with our own small writer (an .xlsx file is a zip of XML; the browser has the parts we
  need). No new package (no `npm install` in the worktree). Numbers stay numbers; money is shown in major units with the currency in its
  own column.
- **PDF:** the same way as invoice PDFs (`apps/web/src/modules/sales/print/pdf.ts`: `html-to-image` and `jspdf`), so Arabic is correct.
- **Print:** the browser's print, as the statement screens do now.

## 8. Org settings this module adds

None new. It uses the existing settings: default currency, time zone, number format, work week (`sql/106`) and the message channels.
No customer names, currencies or rules are written into the code.

## 9. Tests

- **SQL tests** (one for each migration, next free number now `106`):
  - another company cannot read, run, change or delete this company's reports, alerts or schedules;
  - a private report is not visible to another person in the same company;
  - an unknown source, column, operator or function is refused; a column name with SQL in it is refused; a filter value with quotes is
    treated as a value;
  - a member cannot use a finance source or a cost column; a viewer cannot save;
  - totals are split by currency; more than 5,000 rows gives `truncated`;
  - every save, change and delete writes its audit row; direct inserts are refused;
  - the forecast worked example (7.4) gives 1.5 a day and "up";
  - an alert does not reach a recipient who may not see the source;
  - test 092 (column-grant guard) still passes.
- **API tests:** every new route has its permission (the existing `route_permissions.test.ts` checks this); 503 `not_set_up` when the
  function is missing; the Zod schema refuses bad definitions.
- **Web tests:** the Excel writer makes a file that our own .xlsx reader (`statementFiles.ts`) reads back the same; every new label has
  Arabic.
- Each step: `npm run typecheck`, `npm test`, the SQL tests (`node .temp/pglite-sql-tests.mjs <worktree>`) and biome.

## 10. Rollout (for each step with a migration)

1. Ben says "yes <number>".
2. Rolled-back dry run on live, then apply with the Supabase CLI; run the new SQL test and test 092 on live; add the row to
   `sql/README.md` and an entry to the worklog.
3. Deploy the API, then the web app (Ben merges; CI deploys).
4. The module is switched on with the other apps (Settings → Apps). It is in the default app list for new companies.
5. Manual check (Ben, in the browser): the steps and the URL come with each step's report.

## 11. Decisions (Ben, 24 Nov 2026, through erp-master: plan approved, all five suggested answers accepted)

| # | Question | Decision |
|---|---|---|
| Q1 | "Last item in the menu": after Alerts but before Guide and Settings, or after everything? | After every business app, before Guide and Settings. |
| Q2 | May members save their own private reports? | Yes (member grant `reports.custom.create`); only owners and admins save company reports. |
| Q3 | Scheduled reports to people outside the company (for example an accountant's email)? | Not now. Company members only. Later, with an owner-only switch. |
| Q4 | Should the old report screens move out of Finance and other apps into Reports & Insights? | No. They stay where they are; the library links to them. We can move them later. |
| Q5 | Is the sales forecast per branch needed now? | Not now. Company-wide first. |

**Switching the app on (found at build time, 24 Nov).** `reports` is an optional module, so it is off for every company until an
owner or admin switches it on in Settings → Apps. Step 1 has no migration, so after step 1 it is switched on by hand. Step 2's
migration (`sql/109`) adds `reports` to the default apps for new companies (`core_enable_all_modules`).

## 12. Later sections (not built now)

### 12.1 Cash flow forecast (the next forecast)
Money coming in: open customer invoices by due date (with each customer's usual delay, from their payment history). Money going out:
supplier bills by due date, plus the average of regular expenses. Result: a week-by-week balance for the next 13 weeks, starting from
the treasury balances. Plain statistics in our code. Its own plan section and migration when Ben says to start it.

### 12.2 AI on reports (plan only; Ben's rules are fixed)
- **The AI only chooses and explains. Our code computes every number. The AI never writes SQL and never changes data.**
- **Ask a question** in Arabic or English ("which products sold less this month?"). The AI gets our list of sources and templates and
  answers only with a report definition (7.1). That definition goes through the same checks (`rpt__check_definition`) and runs with the
  person's own rights. If the check fails, nothing runs.
- **"Explain this":** the AI gets only the report's result (the numbers already on the screen, no keys, no personal data) and writes
  2 or 3 sentences. The screen marks the text as written by AI.
- **Weekly summary** by WhatsApp: a scheduled report (7.6) plus an "Explain this" paragraph.
- **Key and cost:** the company's own AI key and provider, through the providers that scanning step 0 added (`aiService.ts`,
  `aiProviders.ts`). One short call per question. No AI is used unless the owner has accepted the AI notice and switched a provider on.
- It needs its own plan update and Ben's yes before any build.
