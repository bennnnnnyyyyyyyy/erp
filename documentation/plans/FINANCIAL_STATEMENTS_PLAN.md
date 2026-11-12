# Financial Statements Plan (income statement and balance sheet)

**Status:** Draft, 12 Nov 2026. Waiting for Ben's approval. Not built.
**Roadmap:** [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md), phase 6 ("Financial statements"). Builds on the ledger of
[ACCOUNTING_PLAN.md](ACCOUNTING_PLAN.md) (phase 1, live since 6 Nov).

## 1. Goal

An owner or accountant can open a **statement of income** (قائمة الدخل) for any period and a **statement of financial position**
(قائمة المركز المالي, balance sheet) at any date, in Arabic or English, laid out the way Egyptian Accounting Standards (EAS 1) present
them, with an optional comparison column. Every figure comes from posted ledger entries and opens the accounts and entries behind it.

Today the app has a trial balance and account drill-down (`sql/049`) and a 12-month management "profit overview"
(`finance/ProfitOverview.tsx`), which says it is not statutory. There is no income statement or balance sheet built from the ledger.

## 2. Scope

**In:**
- Income statement for a date range, with an optional comparison range (the same length a year earlier, or a range the person picks).
- Balance sheet at a date, with an optional comparison date. The year's profit so far appears under equity until the year is closed.
- Each line opens its accounts; each account opens its entries (the existing `acc_account_lines`).
- Print (browser) and CSV export, both in the chosen language.
- A "statement line" for each account, filled in automatically from the Egyptian chart codes, which an owner, admin or head
  accountant can change.
- A check shown on the balance sheet: assets equal equity plus liabilities. If not, the page says so and names the difference.

**Out (later phases):**
- Cash flow statement. It needs a cash/non-cash split of every entry; planned after this, as a separate plan.
- Statement notes (الإيضاحات), consolidation across companies, other currencies than the company's own.
- Year-end closing (phase 7). Until then, earlier years' profit is shown as one "profit of earlier years not yet closed" line.
- Branch or cost-centre statements (cost centres are not built).

## 3. Data model

One change, `sql/085_acc_statement_lines.sql`:

- `acc_accounts.statement_line text null`, with a check on the allowed keys below. Null means "use the parent's line"; the top of the tree
  falls back to a default from the account kind.
- Allowed keys:
  - Income statement: `revenue`, `cost_of_sales`, `other_income`, `operating_expenses`, `finance_costs`, `income_tax`.
  - Balance sheet: `non_current_assets`, `inventory`, `receivables`, `cash`, `other_current_assets`, `equity`,
    `non_current_liabilities`, `current_liabilities`.
- Defaults set for every company's existing chart (and in `acc__seed_chart` for new ones), by code prefix of the Egyptian chart:

  | Codes | Line |
  |---|---|
  | 11, 12 | non-current assets |
  | 16 | inventory |
  | 17 | receivables |
  | 18 | other current assets |
  | 19 | cash |
  | 21–27 | equity |
  | 25, 26 | non-current liabilities (loans) — *to confirm with the accountant* |
  | 28 | current liabilities |
  | 34 | cost of sales |
  | 31–33, 35–39 | operating expenses (37 finance costs, 38 income tax — *to confirm*) |
  | 41 | revenue (412 returns are revenue with a debit balance, so they reduce it) |
  | 42 | other income |

No new business table, so no new isolation test table; the column sits on `acc_accounts`, which already has RLS, isolation tests and
the write-through-functions rule. A new function `acc_set_statement_line(p_account_id, p_line)` (owner, admin or head accountant)
writes the audit log in the same transaction.

Two read functions (security invoker, so RLS applies):
- `acc_income_statement(p_from date, p_to date)` → rows of `line, account_id, code, name, name_ar, amount_minor`.
- `acc_balance_sheet(p_at date)` → the same shape, plus the year-to-date profit row.

Both read only posted entries, in the company's currency (integer minor units), and reuse the trial-balance query in `sql/049`.

## 4. Permissions

- Read: `accounting.ledger.view` (existing; the same people who see the trial balance today).
- Change an account's statement line: `accounting.chart.manage` (existing).
- No new permission keys.

## 5. API

- `GET /v1/accounting/statements/income?from=&to=&compareFrom=&compareTo=`
- `GET /v1/accounting/statements/balance?at=&compareAt=`
- `PUT /v1/accounting/accounts/:id/statement-line` `{ line }`
- Answers 503 `not_set_up` while `sql/085` is not applied (Ben often merges before applying).

## 6. Screens

- **Accounting → Statements**: two tabs, *Income statement* and *Balance sheet*.
  - Period or date pickers, the comparison toggle, language follows the person's choice.
  - Sections with subtotals: revenue, cost of sales, **gross profit**, other income, operating expenses, **operating profit**, finance
    costs, income tax, **net profit**. Balance sheet: assets (non-current, current), equity, liabilities (non-current, current), totals.
  - Clicking a line lists its accounts; clicking an account opens the existing account lines page for that range.
  - Print and CSV buttons.
- **Accounting → Chart of accounts**: a "Statement line" column with a select, for those who may manage accounts.
- Every string through `tr()`, logical CSS (RTL-safe), Arabic machine draft added to the review sheet.

## 7. Business rules and calculations

- Amounts: revenue and income as credit minus debit; costs and expenses as debit minus credit; assets as debit minus credit; equity and
  liabilities as credit minus debit. All in integer minor units; rounding only in display.
- Net profit = revenue − cost of sales + other income − operating expenses − finance costs − income tax.
- Balance sheet equity includes: the year's profit to date (from the start of the fiscal year containing the date) and, until closing
  exists, profit of earlier unclosed years as one line.
- The check: total assets − (equity + liabilities) must be 0; any difference is shown, never hidden.
- Accounts with no movement in either column are hidden unless "show zero lines" is ticked.

## 8. Org settings this module adds

None. The statement line is per account.

## 9. Tests

- SQL (`sql/tests/081_financial_statements.sql`): a small set of posted entries gives the expected income statement and balance sheet;
  the balance sheet balances, including year-to-date profit; unposted entries are ignored; a second company sees none of the first's
  figures (isolation); `acc_set_statement_line` refuses a member and a viewer and writes the audit log.
- API: permission and 503 `not_set_up` (covered for the routes by the every-write-route test).
- Web: the statement maths in a shared function, unit-tested; a workflow browser test (from Batch 3) that posts an invoice and checks it
  appears in the income statement.

## 10. Rollout

1. Ben approves this plan; it gets a line in [checklist.md](checklist.md).
2. One PR: `sql/085`, the SQL test, the API routes, the screens, the worklog entry. Migration dry-run here (local copy, rolled back).
3. Ben applies `sql/085` on live; the routes answer 503 until then.
4. The accountant (Q4 of the roadmap) checks the default line for chart groups 25, 26, 37 and 38 and the layout; changes are data, not code.

## 11. Open questions

1. **For the accountant:** are groups 25 and 26 long-term loans (non-current), and 37 and 38 finance costs and income tax? The plan
   assumes yes; the default can be changed per account.
2. **For Ben:** comparison default: same period last year (recommended), or the previous period of the same length?
3. **For Ben:** the statements follow the trial balance's rule (`accounting.ledger.view`). Should anyone else see them?
