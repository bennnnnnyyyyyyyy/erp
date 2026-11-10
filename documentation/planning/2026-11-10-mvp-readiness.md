# MVP readiness check (night of 9–10 November 2026)

**For Ben, in the morning.** What was checked overnight, what was fixed, and the decisions waiting for you. Each decision has a
recommendation; tick a box or write your answer on the `Your answer:` line.

Branches (committed, **not pushed**: pushing is blocked for Claude in this session; see "What you need to do" at the end):
- `plans/bank-import-cbe-sheets`: bank import plan and file reader, simulated Central Bank of Egypt rates, Google Sheets options.
- `mvp/overnight-checks` (built on top of the branch above): everything below.

## 1. What was checked, and the result

| Check | How | Result |
|---|---|---|
| Every screen calls a real API route, with the right method | Script over all 234 calls in the web app | ✅ No broken call |
| Every API database call matches a real database function and its parameter names | Script over 193 calls and 311 functions | ✅ No mismatch |
| Every table and column the API reads exists | Script over 112 queries | ✅ None missing (this is the kind of error that broke purchase orders on 9 Nov) |
| All 65 migrations and all 60 database tests | Ran locally (a Postgres that runs inside Node, with stand-ins for Supabase's sign-in and vault) | ✅ 60 of 60 pass, same as CI |
| **One full business day with accounting and treasury on** (new test `061`) | Buy (part delivery, then the rest), bill, pay the supplier; sell with approval by another person, issue, invoice, get paid; credit note; transfer to cash; expense paid in cash; stock count loss | ✅ The books agree with what happened: debits = credits; inventory account = stock at average cost; receivables, payables, goods received not invoiced, bank, cash, revenue, returns, cost of sales and the count loss are all exactly right; stock quantities right; audit chain intact; another company sees nothing |
| Payments name a cash box or bank account once treasury is on (otherwise they fail) | Read every payment form | ✅ Both payment forms send it |
| Built in the database but unreachable from the app | Script: user functions nobody calls, API routes the app never calls | ⚠️ See §2 and §3 |

## 2. Fixed or built tonight (no decision needed)

- **Stock counts had no screen.** The database rules (count a whole warehouse, approve, differences become stock moves) and the API
  existed since sql/042, but nothing in the app opened them: only one-item adjustments were possible. Built: Inventory → Stock counts
  (start a count per warehouse, enter counted quantities, submit, approve or reject, cancel, history). Real app only (the sample-data
  demo has no counts). Arabic texts are machine drafts.
- **New database test `061_mvp_business_cycle`**: the full business day above. It runs in CI on every pull request from now on, so a
  change that breaks the books is caught before it is merged.

## 3. Found, needs you (decisions)

### M1. E-invoicing (ETA) for the MVP
The API has the e-invoicing set-up (company tax profile, customer tax IDs, item codes), but **there are no screens for them**, and
documents are only sent in simulated mode. In Egypt, e-invoicing is required for VAT-registered companies.
- [ ] **A.** MVP without e-invoicing: sell first to customers who are not yet required to e-invoice, or who use another tool for it. (Recommended for the first pilot: real signing needs a certificate and ETA access.)
- [ ] **B.** Build the set-up screens now (profile, customer tax IDs, item codes), still sending in simulated mode.
- [ ] **C.** Full e-invoicing (real signing) before any customer.

Your answer:

### M2. Exchange rates are shown but not used
Rates are saved daily and shown in Settings, but **no invoice, bill or report uses them**: every document is in one currency, and
foreign-currency documents are not converted.
- [ ] **A.** MVP is single-currency (EGP); foreign-currency documents later. (Recommended.)
- [ ] **B.** Foreign-currency invoices and bills with the day's rate copied onto the document, now.

Your answer:

### M3. Stock counts: should the counter see the expected quantity?
Today the count screen shows what the books expect next to the counted box. Many warehouses prefer a "blind" count, where the counter
does not see it (they count what is there, not what they expect).
- [ ] **A.** Keep it visible (simple; good for small shops).
- [ ] **B.** Hide it from members while counting; managers see it when approving. (Recommended.)
- [ ] **C.** A company setting.

Your answer: **C**, a company setting (Ben, 10 Nov). Needs a small database change (a company setting the count functions read); built with the inventory redesign.

### M4. Small gaps (say yes and they are done)
- [ ] Alert rule recipients can be set only when a rule is created; add "change recipients" to the alert rules list.
- [ ] The company-wide "show the guided tour to new staff" switch has an API but no screen; add it to General settings.

Your answer:

## 4. Not checked, and why

- **The screens in a browser.** Not done: the rule is to ask before driving the live app, and the machine ran out of memory. The
  screens were checked by their wiring (§1) and by the automatic tests; a person still has to click through them.
- **Integrations against the real services** (email, WhatsApp, Paymob, Fawry, Bosta, Shopify, AI): all run simulated; none has been
  tried with a real account.
- **Typecheck and unit tests after the stock count screens**: the machine ran out of memory (Chrome and other apps were using it);
  see §6 for the result once it could run.

## 5. What you need to do in the morning

1. Push both branches from `C:\Users\ben.arthur\Desktop\ERP`:
   ```
   git push -u origin plans/bank-import-cbe-sheets
   git push -u origin mvp/overnight-checks
   ```
   Then tell Claude, who opens the pull requests and watches CI. Neither has a migration.
2. Apply 065 if not done yet (`git pull`, then `npx supabase db query --linked -f sql/065_sole_approver_more.sql`).
3. Answer M1–M4 above, the bank import questions (Q1–Q5 in `documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md`), and the Google
   Sheets choice (`documentation/planning/2026-11-09-google-sheets-options.md`).

## 6. Log (latest last)

- Wiring, column and orphan scripts: clean apart from stock counts (built).
- Local database test runner: 60/60, then 61/61 with the business-day test.
- Morning of 10 Nov (memory free again): typecheck and lint clean; unit tests pass (shared 60 + 1 skipped, API 290 + 7 skipped,
  web 85); documentation links OK; all 65 migrations and all 61 database tests pass locally.
