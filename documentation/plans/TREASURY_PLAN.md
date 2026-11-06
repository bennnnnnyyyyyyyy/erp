# Treasury Plan (phase 2: treasury, branches, party codes and account statements)

**Module key:** `treasury` (new). Branches and party codes go into existing modules: `core` and `sales`/`purchasing`.
**Status:** `[✅ Approved to build — Ben, 6 Nov: "write the treasury plan, branches inside one company … start on 2"]`
**Owner:** Ben · **Reviewers:** the pilot accountant (cheques, the open questions in §11)
**Roadmap:** [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md) phase 2
**Builds on:** [ACCOUNTING_PLAN.md](ACCOUNTING_PLAN.md) (the general ledger, `sql/045`–`049`, live)
**Depends on modules:** core, finance, accounting

Egypt first (Ben, 5 Nov): Arabic terms follow Egyptian usage, for example خزينة (cash box), حساب بنكي (bank account), تحويل بين الخزائن (transfer between boxes), كشف حساب (statement of account), فرع (branch) and كود العميل (customer code).

---

## 1. Goal

Today a payment records only a method ("cash", "bank" and so on). That posts to one cash account and one bank account for the whole company.

After this phase:
- A company has several cash boxes and bank accounts, each in a branch.
- Every payment says which box or account the money went into or came out of.
- Money moves between boxes and accounts by recorded transfers.
- Each box shows its running balance.
- The company can print a statement of account (كشف حساب) for any customer, supplier, ledger account or item, for any period.
- Customers and suppliers get codes, typed or automatic, and can be searched by code.

The users are the owner, the accountant and the cashier. Cashiers come later (§2 Out); for now it is owner and admin, as in finance.

## 2. Scope

**In (this phase):**

- **B1. Branches inside one company** (Ben, 6 Nov, roadmap Q2 option a).
  - A branch is a code and a name in Arabic and English.
  - Warehouses and treasury accounts belong to a branch, optionally.
  - Every company gets one branch, "Main", when this phase is applied.
  - Branches are labels and filters in this phase. Per-branch permissions and per-branch financial statements come later (§2 Out).
- **T1. Treasury accounts.**
  - A treasury account is a cash box or a bank account, with a currency, an optional branch and, for banks, the bank name and account number.
  - Each has its own leaf account in the ledger, under group 19 (النقدية وما في حكمها).
  - Every company starts with "Main cash box" on account 191 and "Main bank account" on account 192, so nothing that is already posted moves.
- **T2. Payments go through a treasury account.**
  - A new payment by cash or bank names its treasury account, and the entry posts to that account's ledger account instead of the cash or bank role.
  - Card, cheque and "other" payments keep posting to their clearing accounts (P13–P15, unchanged).
  - Old payments keep their entries. They are shown as "Main cash box" or "Main bank account", because that is where they posted.
- **T3. Transfers between treasury accounts.**
  - A transfer is between two treasury accounts in the same currency.
  - It posts debit "to" and credit "from"; voiding it reverses that.
  - The same transfer also settles clearing accounts: a card settlement into the bank is a transfer from card clearing to the bank. For that, the clearing accounts are treasury accounts too, of kind `clearing`.
- **T4. Treasury balances.**
  - Each account shows its balance on any date and its lines with a running balance.
  - Both are read from the ledger (`acc_account_lines`, `sql/049`): one source of truth.
- **C1. Party codes.**
  - Customers and suppliers get a `code`: typed, or automatic (`C-00001`, `S-00001`).
  - Codes are unique per company among active records.
  - Existing customers and suppliers get automatic codes when this phase is applied.
  - Search by code or name on every customer and supplier list and picker.
- **S1. Statement of account (كشف حساب)** for:
  - **a customer or a supplier:** every ledger line carrying that party, for a period;
  - **a ledger account:** already built (`acc_account_lines`); the treasury screens reuse it;
  - **an item:** quantity in, out and on hand, with value at the moved cost and a running quantity and value, from the stock ledger.

  Each statement shows the opening balance, the lines (date, document, debit, credit, running balance) and the closing balance. Each is printable (a print stylesheet) and exportable (CSV).

**Out (later):**

- **Cheques** (received and issued, due date, under collection, cleared, bounced): wait for the pilot accountant (roadmap; Ben, 6 Nov). Until then a cheque payment posts to cheque clearing, and settling it is a transfer (T3).
- **Per-branch permissions** (a cashier who sees only their branch) and **per-branch reports.** The tables carry `branch_id` from day one, so this needs no data change later.
- **A cashier role** and opening and closing a cash box per shift.
- **Bank reconciliation** (matching bank statement lines).
- **Treasury accounts in other currencies than the company's.** These are allowed, but posting stays one currency per entry. A transfer between currencies is refused until conversion accounting exists (ADR-0004 draft).
- **One-step cash sale** (invoice and payment together): phase 5.

**Won't:** use a shared "cash" balance computed outside the ledger. Balances come from posted entries only.

## 3. Data model

### 3.1 Branches (`sql/050`)

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| `core_branches` | `id`, `org_id` | uuid | no | `unique (org_id, id)` |
| | `code` | text | no | `^[A-Za-z0-9-]{1,20}$`, unique per org among active |
| | `name`, `name_ar` | text | name no | 1–120 characters |
| | `tax_branch_id` | uuid | yes | link to the ETA issuer branch (`tax_branches`, `sql/036`), same org; used by phase 3 |
| | `active` | boolean | no | default true |
| | `created_at`, `updated_at`, `deleted_at` | timestamptz | | soft delete |
| `inv_warehouses` | `branch_id` | uuid | yes | new column; FK `(org_id, branch_id)` |

Every existing company gets a branch `MAIN` / "Main" / "الفرع الرئيسي", and its warehouses are put in it. New companies get the same branch at sign-up (`core__seed_branch`, called by `bootstrap_organization`).

### 3.2 Treasury (`sql/051`)

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| `trs_accounts` | `id`, `org_id` | uuid | no | |
| | `code` | text | no | unique per org among active, for example `CASH-1` |
| | `name`, `name_ar` | text | name no | |
| | `kind` | text | no | `cash`, `bank`, `clearing` |
| | `currency` | char(3) | no | default: the company currency |
| | `branch_id` | uuid | yes | FK `core_branches` |
| | `ledger_account_id` | uuid | no | a leaf, active asset account of the same org; **one treasury account per ledger account** (unique) |
| | `bank_name`, `bank_account_no` | text | yes | banks only; `bank_account_no` holds an IBAN or a local number, at most 40 characters |
| | `active` | boolean | no | an account with a balance cannot be deactivated |
| | timestamps | | | soft delete |
| `fin_payments` | `treasury_account_id` | uuid | yes | new column. **Required** for a new cash or bank payment once `treasury` is on; must match the method (cash ⇒ `cash`, bank ⇒ `bank`) and the payment's currency; null on old rows |
| `trs_transfers` | `id`, `org_id`, `number` | | no | `TR-000001` from the company counter |
| | `from_account_id`, `to_account_id` | uuid | no | different, same org, same currency |
| | `amount_minor` | bigint | no | > 0 |
| | `currency` | char(3) | no | equals both accounts' currency |
| | `transfer_date` | date | no | after the lock date |
| | `note` | text | yes | |
| | `status` | text | no | `recorded`, `void` |
| | `created_by`, `voided_by`, `voided_at` | | | |

**Creating a treasury account** also creates its ledger account, when the caller asks for one: the next free code under group 19 (`193`, `194`, … then `1901`…), kind asset, named like the treasury account. Alternatively the caller picks an existing leaf asset account. Chart rules (`sql/045`) apply.

**Seeding when the module is first switched on (`trs_prepare`):**
- "Main cash box" → the account the `cash` role points at;
- "Main bank account" → the `bank` role's account;
- three `clearing` accounts → `card_clearing`, `cheque_in_clearing`, `cheque_out_clearing`;
- all in the Main branch.

The `treasury` module **depends on `accounting`**: balances come from the ledger, so accounting must be on.

### 3.3 Party codes (`sql/050`)

| Table | Column | Type | Rules |
|---|---|---|---|
| `sal_customers`, `pur_suppliers` | `code` | text, not null after backfill | `^[A-Za-z0-9-]{1,30}$`, unique per org among active rows (case-insensitive); automatic `C-00001` / `S-00001` from the company counter when left empty |

Existing rows get automatic codes in creation order.

### 3.4 Statements (`sql/052`)

These are read-only functions; no tables.

- **`acc_party_statement(p_party_type, p_party_id, p_from, p_to, p_currency)`:**
  - returns an opening row, the lines with a running balance, then the closing balance;
  - only lines whose `party_type` and `party_id` match;
  - only the receivables or payables accounts: the control accounts of the `receivables`, `payables` and `expense_payables` roles. A party's revenue lines are not part of what they owe.
- **`inv_item_statement(p_item_id, p_from, p_to, p_warehouse_id)`:**
  - opening quantity and value, then each stock move (date, kind, reference, quantity in or out, unit cost, value), with running quantity and value;
  - works with accounting off too: it reads the stock ledger.

## 4. Permissions

| Key | Granted to by default | Allows |
|---|---|---|
| `core.branches.manage` | owner, admin | Add, rename and deactivate branches; put a warehouse in a branch |
| `treasury.accounts.view` | owner, admin | See treasury accounts, balances, lines and transfers |
| `treasury.accounts.manage` | owner, admin | Add and edit treasury accounts (the database narrows this to the owner and the head accountant, like the chart) |
| `treasury.transfers.create` | owner, admin | Record and void transfers |
| `finance.statements.view` | owner, admin | Customer, supplier and item statements |

No key ends in `.read`, so members and viewers get none of these (as in finance and accounting).

Party codes use the existing customer and supplier keys (`sales.customers.manage`, `purchasing.suppliers.manage`). The database re-checks every key.

## 5. API

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | `/v1/core/branches` | `core.org.read` / `core.branches.manage` | |
| PATCH | `/v1/core/branches/:id` | `core.branches.manage` | Name, Arabic name, active |
| PUT | `/v1/inventory/warehouses/:id/branch` | `core.branches.manage` | |
| GET | `/v1/treasury/accounts` | `treasury.accounts.view` | Each with its balance today (ledger) |
| POST/PATCH | `/v1/treasury/accounts[/:id]` | `treasury.accounts.manage` | `createLedgerAccount: true` or `ledgerAccountId` |
| GET | `/v1/treasury/accounts/:id/lines` | `treasury.accounts.view` | `from`, `to`; running balance |
| GET/POST | `/v1/treasury/transfers` | view / `treasury.transfers.create` | |
| POST | `/v1/treasury/transfers/:id/void` | `treasury.transfers.create` | |
| POST | `/v1/treasury/setup/prepare` | `treasury.accounts.manage` | Seeds the default accounts; safe to repeat |
| POST | `/v1/finance/payments` | existing | New optional `treasuryAccountId` (required by the database when treasury is on and the method is cash or bank) |
| GET | `/v1/finance/statements/party` | `finance.statements.view` | `type`, `id`, `from`, `to`, `currency`, `format=csv` |
| GET | `/v1/finance/statements/item` | `finance.statements.view` | `itemId`, `from`, `to`, `warehouseId`, `format=csv` |
| POST/PUT | customers and suppliers | existing | New optional `code` |

New error codes:
- `TREASURY_ACCOUNT_REQUIRED`;
- `TREASURY_MISMATCH` (wrong kind or currency for the payment);
- `SAME_ACCOUNT`;
- `CURRENCY_MISMATCH`;
- `HAS_BALANCE` (deactivating a treasury account that still holds money).

Every change writes its audit row in the same transaction.

## 6. Screens

| Screen | Route | Notes |
|---|---|---|
| Branches | `/settings/branches` | List, add, rename, deactivate; warehouses per branch |
| Treasury | `/treasury` | Cards per account (branch, kind, balance), grouped by branch; total per currency |
| Treasury account | `/treasury/accounts/:id` | Lines with running balance for a period; print; CSV |
| Transfers | `/treasury/transfers` | List and "New transfer" (from, to, amount, date, note) |
| Treasury setup | `/treasury/setup` | Add the default accounts; add a cash box or a bank account |
| Statement of account | `/finance/statements` | Pick customer, supplier or item, and a period; print; CSV |
| Payments (changed) | `/finance/payments` | "Paid into / paid from" picker for cash and bank, filtered by method and currency, defaulting to the person's last choice |
| Customers and suppliers (changed) | existing | Code column and field; search by code |

## 7. Posting rules (additions to ACCOUNTING_PLAN §7)

- **P13′ (payment by cash or bank with a treasury account):** as P13, but the money line uses the treasury account's ledger account instead of the `cash` or `bank` role.
- **P18 (treasury transfer):** Dr the "to" account's ledger account, Cr the "from" account's, for the amount. Event `transferred`; source `treasury_transfer`.
- **P18v (void):** the reversal of P18, dated the void date (local), after the lock date.

**Worked example (EGP).** Branch Main has "Cash box 1" (ledger 191) and "CIB current" (ledger 192). Branch Alex has "Cash box Alex" (ledger 193).

1. Customer pays 1,000.00 into Cash box Alex: Dr 193 1,000.00 / Cr 171 (customer) 1,000.00.
2. Transfer 800.00 from Cash box Alex to CIB current: Dr 192 800.00 / Cr 193 800.00.
3. Balances: Cash box Alex 200.00, CIB current +800.00. The trial balance still balances, and group 19 rose by 1,000.00.

## 8. Org settings this module adds

- Branches.
- The automatic code prefixes for customers and suppliers: `C-` and `S-` by default (`organizations.settings.party_code_prefix`).
- Nothing else is hardcoded: treasury account names, codes and banks are the company's own.

## 9. Tests

SQL tests, always rolled back, dry-run on live before applying:

- **`045_branches_codes.sql`:**
  - Main branch seeded;
  - branch codes unique;
  - owner and admin only;
  - automatic and typed party codes;
  - uniqueness among active rows;
  - backfill order;
  - isolation;
  - audit.
- **`046_treasury.sql`:**
  - seeding;
  - ledger account created under 19;
  - a cash payment needs a cash account of the same currency;
  - it posts to that account;
  - old payments untouched;
  - transfer posts and voids;
  - same account and currency mismatch refused;
  - lock date;
  - cannot deactivate with a balance;
  - balance equals the ledger;
  - members see nothing;
  - isolation.
- **`047_statements.sql`:**
  - party statement opening, lines and closing tie to the customer and supplier control balances;
  - revenue lines excluded;
  - item statement quantity ties to the stock balance and value to moves;
  - isolation.

API tests (the same pattern as `apps/api/test/accounting.test.ts`):
- every route needs sign-in and an explicit permission;
- no direct writes;
- the module gate.

## 10. Rollout (slices, each its own dry run, apply and worklog entry)

1. **`sql/050_core_branches_party_codes.sql`** and test 045: branches, warehouse branch, party codes.
2. **`sql/051_treasury.sql`** and test 046: treasury accounts, payment treasury account (P13′), transfers (P18).
3. **`sql/052_statements.sql`** and test 047: party and item statements.
4. Permission keys, API routes, screens, Arabic. Run `npx biome ci`, typecheck, tests and the build.
5. Deploy. Test in the browser: a test company with accounting on, treasury prepared, a payment into a box, a transfer, a statement.

## 11. Open questions

These are for the pilot accountant; defaults are assumed until they answer.

- **Q1.** Cheques: the full life cycle (received and issued, under collection, cleared, bounced, endorsed to a supplier). Out of this phase.
- **Q2.** Should a cash box be allowed to go below zero? **Default: allowed, with a warning on screen.** The ledger cannot stop it without blocking postings from the past.
- **Q3.** Statement of account for a customer: show only their receivable lines (default), or also their sales lines?
- **Q4.** Do they want a printed receipt (سند قبض / سند صرف) per payment? This is a likely next small slice.
