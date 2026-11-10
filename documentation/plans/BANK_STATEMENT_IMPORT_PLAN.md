# Bank Statement Import and Reconciliation Plan

**Status:** approved by Ben with his answers to Q1–Q5 (10 November 2026; §11). Built so far: the CSV/Excel reader, match
suggestions and the MT940 reader (`packages/shared`). Next: the migration, API and screens; real bank samples still needed to pre-fill
each bank's columns and to choose the PDF service.

**Context:** [INTEGRATIONS_PLAN.md](INTEGRATIONS_PLAN.md) wave 6 ("statement file import, all banks"; "never auto-post a match without
a person") and [TREASURY_PLAN.md](TREASURY_PLAN.md) §2 Out ("bank reconciliation"). Egypt has no bank APIs open to third parties, so a
file the company downloads from its online banking is the way in.

## 1. Goal

A company downloads its bank statement, uploads it, and sees each bank line next to what the books say. Lines that match are
confirmed in a few clicks. Lines that do not match are explained: a payment that was never recorded, a bank fee, a transfer between the
company's own accounts. At the end the statement's closing balance equals the bank account's balance in the ledger, and the period is
marked reconciled.

What it gives an owner: they know that every pound the bank says moved is in the books, and nothing in the books is missing from the
bank. What it gives an accountant: the month-end bank reconciliation (تسوية بنكية) done in the app, with a printable report.

## 2. Scope

**In (first version)**
- Upload a statement file for one bank account (a treasury account of kind `bank`, sql/051).
- Formats: **CSV** and **Excel (.xlsx)**, from any bank, with a column mapping that is saved per bank account so the second upload is
  one click. Ready-made mappings for the banks we get sample files for (see §11, what we need from Ben).
- Duplicate protection: the same file, or an overlapping period, never creates the same line twice.
- Suggested matches against the books, which a person confirms (one by one, or "confirm all exact matches").
- For lines with no match: record what it was, through the functions that already exist (payment, expense, transfer), or mark it
  "ignored" with a reason.
- Simple rules: "description contains X → suggest bank charges account Y" (for monthly fees and similar).
- Reconciliation report per period: opening balance, lines, matched, explained, still open, closing balance, difference to the
  ledger. Print and CSV, like the statements of account.
- Arabic and English; bank descriptions in Arabic are searched the same way as the rest of the app (SearchSelect normalisation).

**Out (later)**
- PDF statements (layouts vary by bank and change without notice; reading them reliably needs per-bank work, or AI with a person
  checking each line). Possible later with the AI draft pattern: the AI reads the PDF into lines, a person checks, then the normal
  import runs.
- MT940 and CAMT.053 files (corporate online banking at some banks offers them; unconfirmed for Egyptian banks until we see a file).
- Direct bank feeds (open-finance providers in the UAE and Saudi Arabia, INTEGRATIONS_PLAN wave 6; none in Egypt).
- Card and payment-gateway settlement files (Paymob, Fawry) — same engine later, different file.
- Automatic posting of anything without a person.

## 3. Data model (one migration, the next free number when built, expected `sql/067_bank_statements.sql`; module key `treasury`)

All tables: `org_id` + RLS + isolation tests; `revoke all` then `grant select` only; writes through functions; audited.

- **`trs_statement_formats`**: a saved column mapping per bank account: which column is the date, description, reference, money in,
  money out (or one signed amount column), balance; date format (`dd/mm/yyyy` and so on); decimal and thousands separators; rows to
  skip at the top. One per treasury account, changeable.
- **`trs_statement_imports`**: one per uploaded file: treasury account, file name, file fingerprint (SHA-256 of the content, refused if
  already imported), period from–to (from the lines), opening and closing balance as the bank states them (when the file has a balance
  column), line count, who imported it and when, status `open` / `reconciled`.
- **`trs_statement_lines`**: one per bank line: import, line number, booking date, value date (if given), description, reference,
  amount in minor units (positive = money in, negative = money out), currency (the account's), running balance (if given), a line
  fingerprint (account + date + amount + reference + description + its position among identical lines that day) used to skip lines
  already imported from an overlapping file, and status:
  - `open`: nothing decided yet;
  - `matched`: tied to one or more ledger lines (below);
  - `explained`: a new record was made for it (payment, expense or transfer) and that record's ledger line is matched;
  - `ignored`: a person decided it needs nothing (with a required reason), for example a line the bank shows twice.
- **`trs_statement_matches`**: which ledger line(s) (`acc_entry_lines` on the treasury account's own ledger account) a statement line
  is matched to, with the amount. Many-to-one and one-to-many both allowed (one bank deposit for three customer payments; one payment
  the bank split in two), as long as the amounts add up exactly. A ledger line can be matched only once, ever.
- **`trs_match_rules`**: description contains / starts with text → suggested kind (bank charge, interest, transfer) and ledger account.
- **`trs_reconciliations`**: a closed period per treasury account: to-date, the bank's closing balance, the ledger balance on that
  date, who closed it and when. A period can be closed only when no line in it is `open` and the two balances agree.

Nothing in the ledger changes because of a match. Matching only records "this bank line is that ledger line". Money moves only when a
person records a payment, expense or transfer through the functions that already exist.

## 4. Permissions

| Key | Who | Allows |
|---|---|---|
| `treasury.statements.view` | owner, admin, head accountant | See imports, lines, matches, the report |
| `treasury.statements.import` | owner, admin, head accountant | Upload a file, save a column mapping |
| `treasury.statements.reconcile` | owner, head accountant | Confirm matches, explain or ignore lines, edit rules, close a period |
| (existing keys) | (as today) | Recording a payment, expense or transfer from an unmatched line uses that action's own permission and approval |

"Who approves": confirming a match is itself the approval, and it is limited to the owner and the head accountant (the same people who
manage the chart of accounts and treasury accounts). Proposed: no second approver for matches, because a match moves no money. Closing
a period: owner or head accountant. Reopening a closed period: owner only, with a reason, audited (see §11 Q4).

## 5. API (`/v1/treasury/statements/...`)

| Method | Path | What |
|---|---|---|
| GET | `/accounts/:id/format` | The saved column mapping |
| PUT | `/accounts/:id/format` | Save it |
| POST | `/accounts/:id/imports` | Upload lines (the browser reads the file and sends rows plus the file fingerprint; see §7) |
| GET | `/imports`, `/imports/:id` | Imports and their lines, with suggested matches |
| POST | `/lines/:id/match` | Confirm a match: `{ entryLineIds: [...] }` |
| POST | `/imports/:id/confirm-exact` | Confirm every exact suggestion in the import at once |
| POST | `/lines/:id/unmatch` | Undo a match (while the period is open) |
| POST | `/lines/:id/ignore` | `{ reason }` |
| POST | `/lines/:id/explain` | Record the missing payment, expense or transfer and match it, in one transaction |
| GET/PUT/DELETE | `/rules` | Match rules |
| POST | `/accounts/:id/reconcile` | Close the period to a date |
| GET | `/accounts/:id/report?to=` | The reconciliation report (also `format=csv`) |

## 6. Screens

- **Treasury → Bank statements:** list of imports per bank account, with counts (matched, explained, ignored, open) and status.
- **Upload:** choose the bank account and the file. The first time, a mapping screen shows the first rows of the file and asks
  which column is what (with the ready-made mapping pre-filled when the bank is known). A preview shows the lines that will be added,
  the lines skipped as already imported, and any row that could not be read (with the reason), before anything is saved.
- **Reconcile (one import):** two columns. Left: bank lines. Right: for the selected line, the suggested ledger lines with why they
  match ("same amount, 2 days apart, reference INV-0042"). Buttons: confirm, choose another, explain, ignore. Above: "Confirm all
  N exact matches". A running total: bank balance, ledger balance, difference.
- **Explain a line:** a small form that opens the existing form with the line's date, amount and description already filled in:
  receive a customer payment (pick the invoice), pay a supplier (pick the bill), record an expense (bank charges, pre-chosen when a
  rule matched), transfer between own accounts.
- **Reconciliation report:** print and CSV.

## 7. Business rules and how a line is matched

**Reading the file.** The browser reads CSV and .xlsx (so the file itself is never stored, and the Worker stays small), turns rows into
lines with the saved mapping, and shows the preview. The server re-checks every line (dates, amounts, currency, account) before saving.
Amounts are read with the same rules as typed amounts (`lib/numbers.ts`: "1,500.75", Arabic digits, minus signs, amounts in brackets
as negative). A line with an unreadable date or amount is shown in the preview and not imported.

**Matching (suggestions only; a person confirms).** For each open bank line, candidates are the not-yet-matched ledger lines on the
bank account's ledger account, same direction (money in = debit to the bank account; money out = credit):

1. **Exact:** same amount, and the bank line's description or reference contains our document number (payment `PAY-…`, invoice
   `INV-…`, transfer number, supplier bill number) or the customer's or supplier's code. Date within 7 days.
2. **Strong:** same amount, date within 3 days, and only one candidate.
3. **Possible:** same amount, date within 10 days, several candidates: the person chooses.
4. **Group:** several ledger lines on one day add up exactly to the bank line (deposits of several cheques or cash collections),
   up to 5 lines. Suggested, never confirmed in bulk.

Only "exact" is included in "confirm all exact matches". Nothing is ever confirmed without a person pressing a button.

**Lines that do not match.** They stay `open` and are listed first. For each, the person:
- records the missing record ("explain"): customer payment, supplier payment, expense (bank charges, interest), or transfer between
  the company's own accounts, through the existing functions with their existing checks and approvals, then the new ledger line is
  matched in the same transaction;
- or marks it `ignored` with a reason;
- or leaves it open. Open lines stay on the list, appear in the report, and block closing the period.

The other side is shown too: ledger lines on the bank account that no bank line matches by the statement's end date ("in the books,
not yet at the bank": cheques not yet cleared, for example). They do not block closing; the report lists them as reconciling items.

**Closing a period** needs: no `open` bank lines up to that date, and bank closing balance = ledger balance − items in the books not
yet at the bank + items at the bank not yet in the books (all of which must be zero apart from the listed reconciling items). After
closing, matches in the period cannot be undone, and the lock date of the books is not changed by this (it stays the accountant's
separate decision).

**Money is integer minor units** (as everywhere). The statement's currency must equal the bank account's currency; a mismatch refuses
the import.

## 8. Org settings this module adds

- Per bank account: the saved column mapping.
- Per company: match rules.
- No company-wide switch: it is part of the treasury module.

## 9. Tests

- SQL (next free test number, expected `sql/tests/062_bank_statements.sql`): the same file twice is refused; an overlapping file adds only new lines; a match only to
  the account's own ledger lines, same direction, exact amounts; a ledger line matched only once; "explain" creates the record and the
  match in one transaction, and rolls back both on failure; ignore needs a reason; closing refuses open lines or a balance difference;
  a closed period refuses unmatch; roles (member and viewer refused; admin may import but not reconcile); another company sees and
  changes nothing; every action writes an audit row; no direct writes.
- Web: the file reader (CSV with Arabic text and Arabic digits, semicolons, quoted fields; .xlsx dates stored as numbers; amounts in
  brackets) and the matching suggestions as unit tests with sample files.
- A smoke test in the sample-data demo: upload a sample statement, confirm the exact matches, explain a bank fee.

## 10. Rollout

1. Ben approves this plan (and answers §11).
2. Branch from `main`. The migration and its test. CI runs it; rolled-back dry run on live; Ben applies; read-only check; worklog.
3. API and screens on the same branch; merged only **after** the migration is live (the API reads its tables).
4. Arabic: every new text gets an Arabic draft, listed in the Arabic review sheet as a **machine draft** for a native-speaker review
   (accounting terms: تسوية بنكية, كشف حساب بنكي, مطابقة, بنود معلقة).
5. Ben tries it with a real statement from his own bank account (on a test company), in the browser.

## 11. Open questions and what we need from Ben

**What we need**
- **Sample statement files** (any real month, amounts can be blanked out): CSV or Excel exports from the banks your customers use
  first, for example National Bank of Egypt, Banque Misr, CIB, QNB. Without samples the mapping screen still works, but no bank is
  pre-filled. Whether each bank offers CSV, Excel, MT940 or only PDF is **unconfirmed** until we see the files.
  Put them in `documentation/research/bank-samples/` (git-ignored: they stay on the machine).

**What the banks offer (web search, 10 Nov 2026; no public sample files exist)**

| Bank | Statement download | Source |
|---|---|---|
| National Bank of Egypt (Al Ahly Net) | An "e-statement" download; file type not stated | Third-party articles; *claimed* |
| Banque Misr | The e-statement is a **PDF** | The bank's own E-Statement page; *documented* |
| CIB (corporate report portal) | **MT940** (SWIFT) | Egyptian banking news; *claimed* |
| QNB Egypt (TradeNet, corporate) | **Excel and PDF**, possibly CSV | Third-party pages; *claimed* |

So: CSV/Excel alone will not cover every bank (Banque Misr customers may only have PDF), and **MT940 moves into the first
version**: it is a published standard, so it can be built and tested without samples (built 10 Nov in
`packages/shared/src/mt940.ts`). PDF stays a decision (Q1).

**Decisions**
- **Q1.** First version formats: CSV and Excel only (recommended), or also PDF through the AI reader (later, slower to build, every
  line checked by a person)?
- **Q2.** Who confirms matches: owner and head accountant only (recommended), or also admins?
- **Q3.** "Confirm all exact matches" in one click: allowed (recommended, it is still a person's click), or one by one only?
- **Q4.** After a period is closed: owner may reopen it with a reason (recommended), or closed for good (corrections only through new
  entries)?
- **Q5.** Bank charges: always an expense under a "Bank charges" category (simple, recommended), or straight to a chosen ledger
  account (accountant-style)?

**Ben's answers (10 Nov 2026), and how they will be built**

| | Ben said | Built as |
|---|---|---|
| Q1 | CSV and Excel now, DOCX now; PDF through a cheap OCR API | First version reads CSV, Excel (.xlsx) and Word (.docx) statements (the table inside the document). PDF through an OCR service (options below); a company switches it on, like the AI features, because the statement leaves our system. |
| Q2 | The roles can be edited per company; default owner and head accountant | A company setting: which roles may confirm matches and close periods. Default: owner and head accountant. The database checks the setting. |
| Q3 | "idk" | Claude's call (reversible): "Confirm all exact matches" is allowed. It shows how many and which before confirming; each match is audited. |
| Q4 | Standard accounting and ERP practice | As common ERPs do: an authorised person (owner by default, same setting as Q2) may undo a closed reconciliation with a reason, audited; never for a date on or before the books' lock date. Corrections after that are new entries. |
| Q5 | Standard accounting | Bank charges post to a "Bank charges" expense account. A "Bank charges" expense category is seeded and pointed at that ledger account, so a person can pick the category (simple) and the accountant sees the right account. |

**First real sample (10 Nov): a QNB Qatar PDF** (2016, Qatari riyal, a personal current account; kept in the git-ignored
`bank-samples/qnb/`, not QNB Egypt). What its layout means for the PDF reader (structure only, no data copied):
- Every column header is bilingual (Date/التاريخ, Description/الوصف, Debit/مدين, Credit/ائتمان, Balance/الرصيد); money out and in are
  separate columns, with a running balance after every line; "(DR)" marks a debit (overdrawn) balance.
- Lines run **newest first**; dates are `dd-mm-yyyy`; amounts have thousands commas and two decimals.
- The account header (IBAN, type, currency, statement date, "Page n of N") and the footer disclaimers repeat on every page: skip them.
- **Each transaction's description spans 4–6 text lines** (type, card number, merchant, reference, date): the reader must join them into
  one line; the first date and the amounts on the row anchor the transaction.
- The currency is a name ("QATARI RIYAL"), not an ISO code: map names to codes. Card spending abroad shows the original currency as an
  ISO numeric code and amount inside the description ("978 18.20" = 18.20 EUR).
- Check: each line's balance = the next (older) line's balance minus debit plus credit, which catches a misread amount.
Egyptian banks' samples are still needed (NBE, Banque Misr, CIB, QNB Egypt).

**PDF reading (OCR) options** (prices from 2026 comparison articles, not official pages; check before signing up). A monthly
statement is a few pages, so any of them costs cents per company per month; the deciding factor is how well it reads **Arabic tables**,
which no published benchmark covers, so the two best candidates should be tried on real statements from `bank-samples/`.

| Service | Price per 1,000 pages (claimed) | Notes |
|---|---|---|
| Mistral OCR | about $2 (batch) to $4 | Returns structured text and tables; claims 170 languages |
| Google Document AI | $1.50 plain OCR; about $10 layout parser | Layout parser needed for tables |
| Azure Document Intelligence | $1.50 read; about $10 prebuilt; 500 pages a month free | |
| AWS Textract | $1.50 text; $15 with tables | Tables make it the most expensive here |
| The AI provider already in the app (OpenAI, sql/056) | per use, small | Reads the page into lines; already needs the owner's consent; a person checks every line anyway |

Recommendation: try Mistral OCR and the AI provider already in the app on the same real statements; keep whichever reads Arabic tables
correctly, with every line shown to a person before import.
