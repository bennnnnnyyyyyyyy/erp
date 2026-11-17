# VAT Plan (tax on sales and purchase lines, posting, VAT return)

**Status:** Approved by Ben 16 Nov 2026 (prices typed before VAT; invoices issued before VAT keep zero tax). Part 1 built and live
(`sql/086`, 16 Nov). Part 2 built and live 16 Nov (`sql/087`); its review fixes and Ben's decisions of 16 Nov in `sql/088` (section 14, not applied). Part 3 (VAT summary, `sql/089`) built 16 Nov, not applied. Parts 4-5 not built: 3 VAT summary in the return's layout,
4 settlement, 5 prices that include VAT.
**Roadmap:** [ROADMAP_ACCOUNTING_SUITE.md](ROADMAP_ACCOUNTING_SUITE.md), phase 3 ("Taxes"), first part: VAT only. Withholding (خصم وإضافة),
table tax and stamp duty come later, after the accountant session (roadmap Q4).
**Decision record:** [ADR-0005](../architecture/decisions/ADR-0005-vat-on-documents.md) (from section 12, accepted 16 Nov).

**Part 1 as built (16 Nov), where it differs from or adds to the text below:**
- Switching VAT on without naming a rate uses the company's default VAT (T1) rate; when it has none, the standard rate (14%, V009) is
  added as an ordinary company rate in the same audited step. Reason: the app has no tax rate screen yet (rates exist only in the
  e-invoicing API), so a company could not otherwise switch on.
- `GET /v1/core/org/vat` (any member: the setting and the VAT rates) and `PUT /v1/core/org/vat` (owner or admin) instead of a field on
  the company form. The invoice form offers a VAT choice per line (item or company default, a rate, or exempt) when registered.
- Account codes as planned: 2871 under 28 and 1811 under 18. Note for the accountant (open question 2): in our unified chart reference
  group 18 is "Current financial investments"; where 18 is missing it is created as "Current financial investments and other debit
  balances". Both accounts and roles can be changed in Accounting setup.
- Bills keep their current columns and maths until part 2; "amount owed" on the sales side uses stored totals and notes everywhere.
- Revenue figures (owner insights months, best sellers, the monthly sales report link, the loss alert) stay on net amounts.

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

### 2.1 What decides a supply's VAT treatment, and the 2022-2026 amendments (research, 16 Nov 2026)

From secondary sources only (the ETA PDF of the law could not be read in that session); every row is **to confirm** against the
Official Gazette text or with the accountant.

| Rule | Source |
|---|---|
| The treatment comes from the law's own lists, not from a company's item categories: general rate 14% for everything not listed; the exempt list (Article 23 and its annex, about 56-58 items at enactment); schedule ("Table") goods with special or fixed amounts, sometimes on top of VAT | Andersen, KPMG |
| It can depend on the **buyer's use**: 5% for machinery and equipment used to produce goods or provide services; since July 2026 also medical devices used that way (buses and passenger cars excluded) | RegFollower (Law 149/2026) |
| It can depend on the **buyer or destination**: exports zero-rated (input VAT still recoverable); free zones and special economic zones have their own treatment; diplomats, agreements and defence exempt (ETA sub-types V001, V002, V005-V007) | ETA sub-type table, Andersen |
| Law 3/2022 reworded and widened the exempt list | PwC |
| Law 157/2025 (in force 18 Jul 2025): news agencies now 14%; advertising exempt only for charitable/medical fundraising; crude oil 10% schedule tax; supply-and-install contracting moved from 5% schedule tax to 14% VAT (with input VAT recovery); fixed per-unit amounts for cigarettes and alcohol, rising yearly | EY |
| Law 149/2026 (issued 28 Jul 2026): sale and rental of land and residential property exempt (commercial and administrative buildings generally not); some financial services exempt; butane and raw quarry materials exempt; natural gas a schedule tax of EGP 20 per 1,000 cubic feet; serial numbers 8 and 10 of Table "First" repealed | RegFollower |

**What it means for the design.**
- The treatment belongs on the **item**: a rate plus an ETA sub-type (V009 general, V003 exempt, …). This is what `inv_items.default_tax_rate_id` holds. A default on the item category would only save typing; the law does not use categories.
- A **customer treatment** is also needed: export, free zone, diplomatic, or production use (for 5%). Today the line's rate has to be changed by hand on each invoice. Candidate for part 2 or 3, once the accountant answers below.
- **Exempt vs zero-rated** must stay distinct (different ETA sub-types; different input VAT recovery; different lines on the return). A plain "exempt" with no rate code, as part 1 allows, is not enough for the VAT summary: use 0% rates with V001 / V003 instead.
- The lists change about once a year: rates and lists stay **company data the accountant edits**, never code. Copying the rate onto each line (part 1) keeps issued documents right after a change. The 14% rate that switching VAT on adds when a company has none is a convenience that conflicts with "nothing about rates is hardcoded" (ETA plan section 7); revisit it once there is a tax rate screen.

**Question for the accountant** (Arabic below for the session):
1. For each product or service [pilot company] sells: is it 14%, 5% (machinery for production use), exempt under Article 23 (which annex item number), or a schedule (Table) good?
2. Does it sell to exporters, free-zone or economic-zone companies, embassies, or buyers who use machines for production? For each such customer, is the treatment the same on every invoice (then we store it on the customer) or does it vary (then it is chosen per line)?
3. For 5% and exempt sales, what proof does the ETA expect on the e-invoice (buyer certificate, registration, ETA sub-type)?
4. Did the July 2025 and July 2026 amendments change anything this company sells?

> ١. لكل منتج أو خدمة تبيعها الشركة: هل هو ١٤٪، أم ٥٪ (آلة لاستخدام إنتاجي)، أم معفى وفق المادة ٢٣ (ما رقم البند في الملحق)، أم سلعة جدول؟
> ٢. هل تبيع لمصدّرين أو شركات منطقة حرة أو منطقة اقتصادية أو سفارات أو مشترين يستخدمون الآلات في الإنتاج؟ لكل عميل من هؤلاء: هل المعاملة واحدة في كل فواتيره (فنحفظها على العميل) أم تختلف (فتُختار لكل بند)؟
> ٣. للمبيعات بنسبة ٥٪ والمعفاة: ما المستند الذي تطلبه مصلحة الضرائب على الفاتورة الإلكترونية (شهادة المشتري، التسجيل، الكود الفرعي)؟
> ٤. هل غيّرت تعديلات يوليو ٢٠٢٥ ويوليو ٢٠٢٦ شيئًا مما تبيعه الشركة؟

Sources: [EY, Law 157/2025](https://www.ey.com/en_gl/technical/tax-alerts/egypt-introduces-significant-vat-updates-on-certain-goods-and-services);
[RegFollower, Law 149/2026](https://regfollower.com/egypt-amends-vat-law-with-changes-for-medical-equipment-real-estate-and-financial-services/);
[Andersen, VAT in Egypt](https://eg.andersen.com/vat-in-egypt/); [Andersen, latest amendments](https://eg.andersen.com/latest-amendments-to-egyptian-vat-law/);
[PwC, Law 3/2022](https://pwc.com/m1/en/services/tax/me-tax-legal-news/2022/egypt-issuance-of-law-number-three-to-update-vat-and-stamp-tax-laws.html).

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
- Prices that include VAT (entry is before tax, as on ETA documents). Needed before online store (Shopify) orders are invoiced: its own
  part, see section 10 item 5.
- ~~VAT on expenses entered without a supplier bill~~: moved **in**, to part 2 (accountant review, 16 Nov; section 13).
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

PRs, each usable on its own, each with its migration dry-run here and Ben applying it (revised 16 Nov after the accountant review,
section 13):
1. `sql/086`: columns, backfill, roles and accounts, the setting; sales invoices and notes with VAT and posting; amount owed from stored
   totals everywhere. **Built and live 16 Nov.**
2. `sql/087`: input VAT on **supplier bills and on expenses** (net, VAT, gross, the supplier's tax registration number; on bills also
   the supplier's e-invoice number); a **deductible** flag per bill or expense: deductible VAT posts to input VAT (1811), non-deductible
   VAT (no e-invoice, or purchases used for exempt or schedule-tax supplies) is added to the cost (expense, or GRNI / price
   difference); the company's **"VAT from" date**, saved when VAT is switched on.
3. VAT summary in the **return's layout**: sales split into 14%, 5%, zero-rated exports and exempt; purchases split into local goods
   and services, capital assets and imports (exact Form 10 sections from the accountant); periods before the "VAT from" date flagged.
   Needs proper 0% rates with ETA sub-types (V001 export, V003 exempt) instead of a bare "exempt" line.
4. **Settlement:** a VAT settlement account (role `vat_settlement`); an opening credit balance for a company already filing; a
   "close the period" journal (Dr output VAT, Cr input VAT, balance to the settlement account) with approval; the payment to the tax
   authority from treasury; a count of consecutive credit periods for the refund rule (since July 2026: more than four periods; small
   enterprises under Law 6/2025, turnover up to EGP 20 million: more than three months; to confirm); an editable return-deadline
   reminder (never hard-coded).
5. **Prices that include VAT** (per company, or per price list): net = gross ÷ (1 + rate) with its own rounding rule, before online store
   orders are invoiced.

**Part 2 as built (16 Nov, `sql/087`), with the second accountant review (VAT as printed, capital assets, imports):**
- A bill's VAT is taken **as printed** on the supplier's invoice (`tax_minor`); the VAT worked out from the line rates is kept beside it
  (`line_tax_minor`). The printed figure may differ by at most 1 minor unit per line, at least 5 (`VAT_MISMATCH` beyond that; the
  tolerance is ours, to confirm). Left empty, the computed VAT is used. Expenses: the total paid and the VAT as printed; an optional
  rate checks the VAT within 5 minor units.
- **Kind of purchase** (`vat_class`) on bills and expenses: `local` goods and services, `capital` asset, `import`. Part 3 splits
  purchases by it.
- **Imports**: recorded as an expense of kind `import`, with the customs declaration number as the reference and the customs
  authority's tax number typed in. No separate customs document.
- **Deductible** (`vat_deductible`): needs the company VAT registered, VAT above zero and a reference (`VAT_NOT_DEDUCTIBLE`
  otherwise); defaults to that, and can be switched off. Non-deductible VAT is cost: on a bill it goes to purchase price differences
  (334), on an expense to the expense account.
- `settings.vat_from`: set the first time VAT is switched on (companies already registered: the day of that audit row).
- What is owed on a bill is its gross (payment check, owner insights, open items). Amounts and VAT of bills and expenses cannot be edited.
- Not yet: the deductible share for companies with both taxable and exempt sales (partial deduction); a credit note from a supplier.

## 11. Open questions

1. ~~**Ben:** prices entered before VAT?~~ Answered 16 Nov: before VAT. "Include VAT" is part 5.
2. **Accountant:** ~~account codes 2871 / 1811~~ reviewer: keep both and add one settlement account (part 4); the real accountant to
   confirm. Still open: the 5% rate and the exempt list (section 2.1); the return deadline (reviewer: end of the following month, not
   hard-coded; to confirm); how a credit note is treated when it falls in a month already filed.
3. ~~**Ben:** existing invoices stay at zero tax?~~ Answered 16 Nov: yes.
4. **Accountant (new):** does VAT arise on a customer advance paid before the invoice?
5. **Accountant (new):** the exact sections of the return (Form 10) for part 3, and the proof the ETA expects for 5% and exempt sales.
6. **Accountant (new):** must the pilot company register regardless of turnover? Importers, exporters, distribution agents and
   table-tax suppliers have no threshold (ETA FAQ via Lookuptax); the app keeps a plain "registered: yes/no".

## 13. Accountant review (16 Nov 2026)

Source: [claudetheaccountantreplytoVATPLAN_MD.md](claudetheaccountantreplytoVATPLAN_MD.md) (an AI review written as a senior
accountant; not a licensed adviser: the real accountant signs off the rate and exemption rows). It found the core design sound
(VAT stored once per line, rates copied, documents never rewritten, owed amount on the gross).

| # | Point | Outcome |
|---|---|---|
| 1 | Expenses carry much of the input VAT (rent, utilities, telecom, fuel, fees) | Moved into part 2 |
| 2 | Deductible flag; supplier's e-invoice number and tax number; non-deductible VAT to cost | Part 2 |
| 3 | Settlement, carry-forward, payment, refund-period count | New part 4 |
| 4 | "VAT from" date so earlier periods are not shown as zero VAT | Date in part 2, warning in part 3 |
| 5 | Summary in the return's layout | Part 3 |
| 6 | Prices that include VAT before online store orders are invoiced | New part 5 |
| 7 | 1811 must not show as an investment | Checked: `sql/085` puts codes starting 18 on "other current assets" |
| 8 | VAT after discount | Checked: no document has a discount today; when discounts come, VAT is on the net after discount |

Further facts the review adds (to confirm): the July 2026 amendment widened 5% to industrial machinery and medical equipment and added a
VAT-suspension regime on capital equipment with a five-year clawback (matters for manufacturing); refund after more than four
consecutive credit periods (three months for small enterprises). Sources:
[PwC, second tax facilitation package](https://www.pwc.com/m1/en/tax/documents/2026/egypt-second-tax-facilitation-package.pdf);
[Lookuptax, Law 149 refund window](https://lookuptax.com/tax-changes/egypt/law-149-credit-balance-refund-window-2026);
[Ecovis, 2026 amendments](https://global.ecovis.com/?p=19666); [VATupdate, filing](https://www.vatupdate.com/?p=357047);
[Lookuptax, ETA FAQ](https://lookuptax.com/docs/country/egypt-vat-guidelines-indirect-tax).

## 12. Draft ADR-0005: VAT is computed and stored on each document line, once

**Status:** Accepted 16 Nov; the record is now [ADR-0005](../architecture/decisions/ADR-0005-vat-on-documents.md). **Deciders:** Ben.

**Context.** Totals are recomputed from quantity × price in about 15 places. Adding tax to each would multiply the places where a rounding
or a rule can differ, and a later rate change would silently change old documents.

**Decision.** The database function that creates an invoice, bill or note computes each line's net, tax rate (copied) and tax, and the
document's net, tax and gross, and stores them. Everything else (posting, amount owed, reports, screens, ETA) reads the stored figures.
Issued documents are never recomputed; corrections are notes or reversing entries.

**Consequences.** One place for the maths; past documents keep their tax when rates change; the ETA submission reads the same numbers the
ledger posted. A migration must backfill existing documents (zero tax) and switch every recomputation to the stored totals.

## 14. Decisions of 16 Nov and the review of part 2 (`sql/088`)

**Ben's decisions:**
1. **No rate is added automatically.** Switching VAT on uses the company's default VAT rate, or is refused until one exists
   (`VAT_RATE_MISSING`). Rates are added in Settings → General → VAT (`core_save_vat_rate` / `core_remove_vat_rate`; no e-invoicing
   module needed; any ETA VAT code, so 0% export (V001) and exempt (V003) rates are proper rates).
2. Build order: the rate screen (done here), then part 3.
3. Bill tolerance kept. Exact rule: the printed VAT may differ from the computed VAT by **the larger of 1 minor unit per line and 5
   minor units per bill**.
4. **Only an owner** switches VAT on or off, picks the default rate and the start date.
5. **Shopify and VAT are not used together** until part 5: VAT cannot be switched on while Shopify is on, and while VAT is on an invoice
   for a Shopify order is refused (`VAT_SHOPIFY_NOT_SUPPORTED`).

**Review of part 2 (accountant, 16 Nov):**
6. **Non-deductible VAT on goods is part of their cost.** On a bill it is shared over the lines (by computed VAT; rounding to the
   largest line), added to each item's average cost over what is on hand (cost log `purchase_vat`) and posted to stock for that item;
   when none is on hand, to cost of goods sold. No longer to purchase price differences. Bills posted before keep their entries.
   **On an expense it stays on the expense account**, including expenses of kind "capital asset": there is no fixed-asset register
   yet, so a machine recorded as an expense is expensed with its VAT. When fixed assets are built, capital expenses (and their
   non-deductible VAT) go to the asset instead.
7. **"VAT from"** defaults to the first day of the current month and the owner can choose another date (warned when it is not the
   1st: the month's return would be split). Companies already registered moved to the first of their month (audited). Part 4's
   opening credit balance uses the same date.
8. **Kind of purchase per bill line** (a bill can mix goods and a machine); the bill shows one kind or "mixed". Expenses keep one kind:
   record a mixed receipt as two expenses.
9. **Tax numbers:** a deduction needs the supplier's 9-digit Egyptian tax registration number (dashes and spaces ignored, stored as
   digits), typed or from the supplier. Not checked on the supplier record itself: foreign suppliers (imports) have other numbers.
   This is stricter than part 2 (a deduction needed only the e-invoice number).

**Part 3 must include (from the review):**
- A **warning on the summary** when the company has both taxable and exempt sales in the period: partial deduction is not built, so
  input VAT would be over-claimed.
- The summary is labelled **"excludes supplier credit notes"** until those are built; part 3 is not "complete" without them.
- Rollout for every part from now: dry run on live, apply, CI green, then merge.

**Known trade-off (review, 16 Nov).** Companies registered before `sql/088` had their start moved to the 1st of their month; invoices
from before the day they switched on are zero VAT but fall inside the VAT range, so the summary shows them as zero VAT. No real company
is affected yet. **Rule for the first real company: switch VAT on with the start date on the 1st of a month** (the default).

**Part 3 as built (16 Nov, `sql/089`).** Finance → VAT summary (owners and admins): sales by rate, zero-rated exports (ETA V001/V002)
and exempt, each with invoices and approved credit/debit notes (by approval day); purchases by kind (local, capital, import) with
deductible and non-deductible VAT (bill lines carry their share of the VAT as printed); output VAT, deductible input VAT, VAT due or credit.
Warnings: not registered, period before "VAT from", partial deduction (taxable and exempt sales together), other currencies left out,
and always "excludes supplier credit notes". Each line opens its documents; CSV and print. Section names are ours until the accountant gives
the Form 10 headings. Voided invoices are left out whatever month they were voided in (a void in a later, already-filed month would
need a correction: to confirm with the accountant).

## 15. Part 4 design: settlement and carry-forward (draft, 16 Nov; not built, waiting for Ben and the accountant)

**Goal.** At the end of each tax month the company closes its VAT: output VAT and deductible input VAT are set against each other in the
books, what is due is recorded as owed to the tax authority (or a credit is carried forward), the payment is recorded, and the app shows
the deadline and when a refund can be asked for. Needs accounting switched on (without it, the summary of part 3 is all there is).

**Design (proposed):**
1. **Settlement account.** New role `vat_settlement`, seeded as **2872 VAT settlement (due to or from the tax authority)**, a liability
   under 28, added to every chart like 2871/1811 were (the reviewer: keep 2871 and 1811, add one settlement account).
2. **Close a month** (Finance → VAT summary, a whole calendar month, owner or head accountant): the app reads the **ledger** balances
   of 2871 and 1811 for the month (the books are the truth, including manual corrections) and shows them next to the part 3 summary;
   a difference is shown, never hidden. It then creates a **manual journal draft** with the existing approval (`acc_save_journal`,
   someone else approves, or the owner posts directly): Dr output VAT, Cr input VAT, and the difference to 2872 (Cr when VAT is due,
   Dr when it is a credit). One close per month, kept in a new table `acc_vat_periods` (month, journal, output, input, due, status);
   a month can be reopened only by reversing its journal. Suggest setting the lock date to the month's end after the return is filed.
3. **Pay.** "Record the payment" on a closed month that is due: a manual journal Dr 2872 / Cr the bank or cash account chosen (the
   treasury account's ledger account), same approval.
4. **Opening balance.** For a company that already files: one opening journal at the "VAT from" date, Dr 2872 for a credit brought
   forward (or Cr for VAT still owed), against the opening-balance account.
5. **Carry-forward and refunds.** A credit month leaves a debit on 2872, netted at the next close. The screen counts consecutive credit
   months and says when a refund can be asked for: more than 4 consecutive periods; more than 3 months for a small enterprise under Law
   6/2025 (turnover up to EGP 20 million). "Small enterprise" becomes a company setting (owner). Rules to confirm.
6. **Deadline.** A company setting "return due N days after the month ends" (default: end of the following month, editable, never
   hard-coded); the summary shows "return for October due by 30 November" and an optional alert rule reminds the owner.

**Data and tests (proposed):** `sql/091` (role and account, `acc_vat_periods`, close/pay functions built on manual journals,
settings), `sql/tests/086`. API on `/v1/finance/vat-periods`. No new posting path: every entry is a manual journal with its approval.

**Questions before building:**
- **Ben:** build part 4 now on these assumptions, or wait for the accountant?
- **Accountant:** account 2872 (or another code / two accounts, due and refundable)? Close on ledger balances (proposed) or on the
  document summary? The refund rule (4 periods / 3 months for small enterprises) and what proof is needed. The return deadline. How a
  late credit note or void in an already-filed month is corrected (next month's return, or an amended return).
