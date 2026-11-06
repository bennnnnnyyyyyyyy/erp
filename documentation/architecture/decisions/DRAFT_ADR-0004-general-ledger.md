# ADR-0004: The general ledger: posting in the same transaction, corrections by reversal

> **Draft.** Agents cannot write to `documentation/architecture/`. Ben: move this file to
> `documentation/architecture/decisions/ADR-0004-general-ledger.md` when you approve it, and change
> the two relative links below from `../plans/` to `../../plans/`.

**Status:** Proposed (waiting for Ben's review)
**Date:** 2026-11-05
**Deciders:** Ben
**Plan:** [`ACCOUNTING_PLAN.md`](../plans/ACCOUNTING_PLAN.md) (phase 1 of
[`ROADMAP_ACCOUNTING_SUITE.md`](../plans/ROADMAP_ACCOUNTING_SUITE.md))

## Context

The product records stock, purchases, sales, expenses and payments, but **no accounting entries**.
An Egyptian accountant must be able to run the books in it (roadmap §1). Three things make this
hard to change later, so they are decided here before any code:
1. how a document gets its entry;
2. what happens when something is wrong;
3. what happens to the data companies already have.

Constraints already in force:
- ADR-0003: writes go through database functions, with the audit row in the same transaction.
- The stock ledger is append-only, and the audit log is append-only and hash-chained.
- `sql/040` lock date: nothing dated on or before it can be created or voided.
- Money is integer minor units plus an ISO currency (`agents.md`).

## Decision

### 1. Posting happens in the database, in the same transaction as the document

- Every document with an accounting effect gets its journal entry from a database trigger on the
  document's own table, in the same transaction:
  - customer and supplier invoices;
  - stock moves and purchase cost-log rows;
  - expenses and payments;
  - credit and debit notes.
- Where a document's lines are inserted after its header (invoices, notes), the trigger is a
  **deferred constraint trigger**, so it runs at commit, when all lines exist.
- If posting fails (for example an account is not set), **the whole finalisation transaction
  fails**. A draft with no stock or financial effect may be saved without an entry; posting,
  approval, receipt, issue, invoicing, payment and every other finalising action may not. A draft
  is never a way to bypass posting.
- Triggers cover every function that writes those tables, today's and future ones, without
  rewriting them. `sql/040` uses the same pattern for the lock date.
- Rejected:
  - calling a posting function from each document function (easy to forget in a new function);
  - posting from a background job (breaks "same transaction"; entries could be missing).

### 2. Entries are append-only; corrections are reversals

- `acc_entries` and `acc_entry_lines` accept no update or delete from anyone, owner included. This
  is enforced by revoked grants and by a trigger that raises `APPEND_ONLY`, as `inv_cost_log` does.
- Voiding a document posts a **reversing entry** (debits and credits swapped), linked to the
  original. A wrong manual entry is corrected by reversing it and posting a new one.
- An entry may not be dated on or before the lock date. Entries from documents take the document's
  date, which has already passed the lock check; entries from stock moves take the move's date.
- Each document event can be posted once. A unique key on `(org_id, source_type, source_id, event)`
  makes posting idempotent and prevents doubles. Every postable source has a defined linked
  reversing event for a void, cancellation-after-posting, return or correction; a source with no
  such event must refuse that correction.

### 3. Every entry balances, enforced by the database

- Each line is either a debit or a credit: a non-negative amount, one side only.
- A deferred trigger checks at commit that each entry's debits equal its credits. An unbalanced
  entry cannot be committed.
- Lines post only to **leaf** accounts (accounts with no children).

### 4. Money and rounding

- Amounts are `bigint` minor units, as everywhere else.
- A line amount is computed once: `round(qty × unit price)`, half away from zero (Postgres
  `round(numeric)`), to minor units. The entry is built from those rounded amounts, so it balances
  exactly and matches the document's own total to the piastre.
- Cost of goods sold uses the unit cost the stock move already carries (`sql/023` stamps the
  average cost on every issue and adjustment). It is not recomputed later.
- **One currency per entry:** the document's currency. Phase 1 does not convert currencies:
  reports and balances are per currency, and a payment may settle only a source in the same
  currency. Cross-currency settlement is refused until exchange-rate accounting exists. Exchange
  rates come later, if a customer needs them.

### 5. Posting rules are settings, not code

- The code knows *which kind* of account each event touches. Each company decides *which account*
  that is, through **account roles**: receivables, sales revenue, inventory, goods received not
  invoiced, payables, cost of goods sold, cash, bank, stock adjustments, sales returns, and so on.
- Expense categories and payment methods each point to an account.
- New companies get the roles filled from their seeded chart. Changing a role affects future
  entries only.

### 6. Existing data: one verified historical backfill or a controlled opening-balance cutover

- Switching the `accounting` module on for a company (owner only) normally does three things in
  one transaction:
  1. seeds the chart (if empty) and the account roles;
  2. posts entries for **every existing document**, oldest first, marked as backfill;
  3. turns on posting for new documents.
- Backfill replays the source history, including voids, returns and corrections, in event order;
  it does not blindly post the current rows. It is allowed before the lock date, and the switch-on
  is audited with counts and totals.
- If that history is incomplete, uncosted, or cannot be reconciled, switch-on is refused until an
  owner chooses a documented, accountant-approved cutover: verified opening balances at a stated
  date and no historical document backfill. The database records the mode and cutover date and
  refuses any mixture that could double count history.
- Until a company switches accounting on, nothing posts and nothing changes for it.
- Rejected: silently starting at go-live with only opening balances. A controlled, explicitly
  disclosed cutover is necessary for legacy or incomplete history, but is not the default for
  documents already held by this ERP.

### 7. Manual entries need a second person, except the head accountant and the owner

- This is Ben's decision (roadmap Q5).
- A manual entry is a draft until someone other than its author approves it, and approving posts
  it. The check is in the database function and in a check constraint, as for credit notes
  (`sql/037`).
- The owner, and an **owner or admin** membership marked head accountant, post directly. The flag
  is cleared or refused if that membership is disabled or changed to member/viewer.
- "Head accountant" is a flag on the membership, set by the owner, not a new role. The four built-in
  roles appear in many policies, and a flag changes none of them.

## Consequences

- **Every write path gains a new way to fail:** a missing account role blocks the document. The
  switch-on refuses until every role is set, and the error names the missing role.
- **Stock moves dated today can't post while the lock date is today.** The lock date cannot be in
  the future, so this only happens if an owner locks the current day; the error is
  `PERIOD_LOCKED`, as for documents.
- A company that switches accounting on gets one large backfill transaction. Time it in the dry run
  on today's largest sample company (a year of demo data).
- Tax on lines (phase 3) and treasury (phase 2) only add account roles and events; they do not
  change this ADR.

## Status of related decisions

- Q3 (Egypt-first chart) and Q5 (approvals) are decided in the roadmap.
- This ADR becomes **Accepted** when Ben approves it with the plan.
