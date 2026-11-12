# VAT Plan (tax on sales and purchase lines, posting, VAT return)

**Status:** Draft, 12 Nov 2026. Waiting for Ben's approval. Not built.
**Roadmap:** [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md), phase 3 ("Taxes"), first part: VAT only. Withholding (خصم وإضافة),
table tax and stamp duty come later, after the accountant session (roadmap Q4).
**Decision record:** section 12 is the draft ADR-0005 (agents cannot write the ADR folder from this chat; Ben or a fresh chat copies it to
`documentation/architecture/decisions/ADR-0005-vat-on-documents.md` once approved).

## 1. Goal

A VAT-registered company in Egypt can issue sales invoices, record supplier bills and raise credit and debit notes **with VAT on each
line**, see totals before and after tax everywhere an amount is owed, have the tax posted to its own accounts, and print a **monthly VAT
summary** (output VAT − input VAT = VAT due) with the documents behind it. A company that is not registered sees no change.

## 2. What the rules say (research, 12 Nov 2026)

Marked **documented** (in the law or an ETA publication, or in several professional sources that agree) or **to confirm** (sources
disagree or are secondary only). Sources at the end of this section.

| Rule | Status |
|---|---|
| General VAT rate is 14% (Law 67/2016, unchanged by the 2025 amendments) | documented |
| Exports of goods and services are zero-rated, on conditions in the Executive Regulations | documented |
| A list of exempt goods and services (basic food, health, education, financial services, …) | documented; the item-by-item list to confirm |
| A 5% rate for machinery and equipment used in production | to confirm |
| Table tax (ضريبة الجدول) on listed goods, sometimes on top of VAT | documented that it exists; out of scope here |
| Input VAT on purchases for taxable activity is deducted from output VAT | documented |
| Since Decree 188/2023 only electronic (ETA) invoices support a deduction or refund | documented |
| A credit note reduces output VAT (and the buyer's input VAT) in the period it is issued | secondary sources agree; to confirm |
| The tax period is one calendar month | documented |
| Return deadline: end of the following month (PwC, ETA-based calendar) vs two months (2016 text) | **to confirm**; the app does not hard-code it |
| Registration threshold EGP 500,000 a year | secondary only; to confirm (the app only asks "registered: yes/no") |

Sources: [ETA, Law 67/2016 (English)](https://eta.gov.eg/sites/default/files/2024-02/Law-english-no.67-2016.pdf.pdf);
[ETA, VAT Executive Regulations (English, 2023)](https://www.eta.gov.eg/sites/default/files/2024-02/VAT-Executive-Regulations-English.pdf);
[PwC Worldwide Tax Summaries, Egypt](https://taxsummaries.pwc.com/egypt/corporate/other-taxes);
[Lookuptax, Egypt compliance calendar](https://lookuptax.com/compliance-calendar/egypt);
[KPMG, Oct 2016](https://assets.kpmg.com/content/dam/kpmg/xx/pdf/2016/10/tnf-egypt-october-13-2016.pdf);
[Mondaq, VAT refund](https://www.mondaq.com/sales-taxes-vat-gst/1550770/vat-refund-from-eta);
[Flick, credit notes](https://www.flick.network/en-eg/credit-note-in-egypt).

## 3. What exists today (code survey, 12 Nov)

- No document stores tax or a total. Each invoice and bill total is recomputed as Σ round(qty × price) in about 15 places: the API
  (sales, purchasing, finance open items), the web (invoice, bill, unpaid lists, `noteMath.ts`), SQL (overpayment check in
  `fin_record_payment`, `fin__invoice_outstanding` for payment links, owner insights, alert rules, report links), and the posting functions.
- Credit/debit notes store `total_minor` (immutable).
- Posting (`sql/046`): invoice Dr receivables / Cr sales; bill Dr GRNI (± price variance) / Cr payables; credit note Dr sales returns /
  Cr receivables. There is no tax account role.
- ETA data already exists (`sql/036`): `tax_rates` per company (type, sub-type, rate, one default per type), `inv_items.default_tax_rate_id`,
  the ETA sub-type codes (V001 export, V003 exempt, V009 general, …), and the ETA line maths in `packages/shared/src/modules/einvoicing/calc.ts`.
- Notes are netted only in the web; the SQL overpayment check, payment links and open items ignore them (a separate inconsistency, fixed
  along the way: see 7).

## 4. Scope

**In:**
- Company setting: **VAT registered** (off by default), and its default VAT rate (one of its `tax_rates`, normally 14%, sub-type V009).
- Each sales invoice line, supplier bill line and note line carries a **tax rate** (copied from the item's default, else the company
  default; it can be changed to another of the company's rates or to zero/exempt on the line) and its **tax amount**.
- Each sales invoice, supplier bill and note stores **net, tax and gross totals**, computed once by the database function that creates it.
- Posting: output VAT and input VAT to their own accounts.
- Screens: tax per line and the three totals on invoices, bills and notes; "Amount owed" everywhere uses the gross total net of approved
  notes.
- **VAT summary** report for a month (or any period): output VAT on sales, minus VAT on credit notes, plus VAT on debit notes; input VAT on
  bills; VAT due or to carry forward; by rate; each figure opens its documents. CSV and print.

**Out (later):**
- Prices that include VAT (entry is before tax, as on ETA documents; a "prices include VAT" switch can come later).
- VAT on expenses entered without a supplier bill (expenses have one amount; a later change).
- Withholding, table tax, stamp duty, ETA signing and submission, filing the return to the ETA.
- Changing invoices issued before this (they stay at zero tax; see 6).

## 5. Data model (`sql/086_tax_on_documents.sql`)

- `sal_invoice_lines`, `pur_supplier_invoice_lines`, `sal_note_lines`: `tax_rate_id uuid null` (FK `tax_rates`), `tax_rate numeric(8,5)
  not null default 0` (copied, so a later rate change never alters a document), `net_minor bigint`, `tax_minor bigint not null default 0`.
- `sal_invoices`, `pur_supplier_invoices`, `sal_notes`: `net_minor`, `tax_minor`, `gross_minor bigint` (stored once; immutable like the
  rest of the document).
- Existing rows are backfilled once in the migration: net = gross = Σ round(qty × price), tax = 0. Nothing posted changes.
- `organizations.settings.vat_registered` (boolean) and `settings.default_vat_rate_id`.
- New account roles `output_vat` and `input_vat`; seed accounts **2871 Output VAT payable** (liability, under 28) and **1811 Input VAT
  recoverable** (asset, under 18, created if missing); added to every company with accounting on, in the same migration, so switching on
  is never blocked. Statement lines: current liabilities and other current assets (defaults already cover 28 and 18).

All columns sit on tables that already have RLS, isolation tests and write-through functions; no new business table.

## 6. Rules and calculations

- Line: net = round(qty × unit price); tax = round(net × rate / 100); gross = net + tax. Rounding per line, half away from zero, in minor
  units (as ETA documents do; `calc.ts` already uses this).
- Document totals are the sums of its lines.
- Not VAT registered: every line has rate 0 and no tax rate id; nothing else changes.
- Credit/debit note lines take the invoice line's rate; the tax is recomputed on the note's quantity and price.
- Existing invoices and bills (before this migration): zero tax, as they were issued. A company that was already charging VAT outside the
  app corrects past periods with a manual journal (the accountant's choice); the app does not rewrite issued documents.
- Posting:
  - sales invoice: Dr receivables **gross** / Cr sales **net** / Cr output VAT **tax**;
  - credit note: Dr sales returns net / Dr output VAT tax / Cr receivables gross; debit note: the reverse;
  - supplier bill: Dr GRNI and price variance on **net** (as today) / Dr input VAT **tax** / Cr payables **gross**.
- Amount owed = gross − approved credit notes + approved debit notes − payments; used by the overpayment check, payment links, open items,
  ageing, owner insights and alerts (this also fixes notes being ignored in SQL today).
- VAT summary for a period: by document date, posted documents only (issued invoices, recorded bills, approved notes).

## 7. Permissions

No new keys. The VAT setting: `core.org.manage`. Rates: the existing e-invoicing rate screens. VAT summary: `accounting.ledger.view`
(same as the statements); without accounting switched on, `finance` readers see it from document totals.

## 8. API and screens

- Invoice, bill and note endpoints return `netMinor`, `taxMinor`, `grossMinor` and per-line `taxRate`, `taxMinor` (`totalMinor` kept as
  gross for older clients for one release).
- Creating a sales invoice, bill or note accepts an optional per-line `taxRateId` (or `"exempt"`).
- New `GET /v1/accounting/vat-summary?from=&to=` (+ CSV).
- Settings → Company: "VAT registered" and default rate. Invoice/bill/note screens: a tax column and the three totals. Accounting → VAT
  summary. Arabic for every string.

## 9. Tests

- SQL `sql/tests/082_vat_on_documents.sql`: line and total maths and rounding; rate copied, not linked; not-registered company has no
  tax; existing documents backfilled with zero tax; posting balances with output and input VAT; credit and debit notes carry the
  invoice line's rate; amount owed uses gross and notes everywhere it is computed; summary figures; isolation; audit rows.
- Shared: the line maths against `calc.ts`. API: permission and 503 `not_set_up`. Workflow (Batch 3 suite): an invoice with VAT shows
  the gross owed and its VAT on the summary.

## 10. Rollout

Three PRs, each usable on its own, each with its migration dry-run here and Ben applying it:
1. `sql/086`: columns, backfill, roles and accounts, the setting; sales invoices and notes with VAT and posting; amount owed from stored
   totals everywhere.
2. `sql/087`: supplier bills with input VAT.
3. VAT summary report (no migration expected).

## 11. Open questions

1. **Ben:** prices entered before VAT (recommended, ETA style), or a per-company "prices include VAT" choice now?
2. **Accountant:** account codes 2871 / 1811, or one "VAT settlement" account? The 5% machinery rate and the exempt list. The return
   deadline. How credit notes for invoices from a closed month are treated.
3. **Ben:** existing invoices stay at zero tax (recommended). Agree?

## 12. Draft ADR-0005: VAT is computed and stored on each document line, once

**Status:** Proposed (with this plan). **Deciders:** Ben.

**Context.** Totals are recomputed from quantity × price in about 15 places. Adding tax to each would multiply the places where a rounding
or a rule can differ, and a later rate change would silently change old documents.

**Decision.** The database function that creates an invoice, bill or note computes each line's net, tax rate (copied) and tax, and the
document's net, tax and gross, and stores them. Everything else (posting, amount owed, reports, screens, ETA) reads the stored figures.
Issued documents are never recomputed; corrections are notes or reversing entries.

**Consequences.** One place for the maths; past documents keep their tax when rates change; the ETA submission reads the same numbers the
ledger posted. A migration must backfill existing documents (zero tax) and switch every recomputation to the stored totals.
