Here is my review as the senior accountant. The core design is sound: VAT is stored once per line, the rate is copied onto the document, issued documents are never rewritten, and “amount owed” is based on the gross total. It keeps exempt and zero-rated apart. Prices before VAT and zero tax on old invoices are the right calls. I checked the shaky “to confirm” rows against recent sources. I’m not a licensed adviser, so your accountant still signs off on the rate and exemption rows.

**What I’d change before building further**

1. **Expenses with VAT must come in part 2, not “later”.** In Egypt much of a company’s input VAT sits on rent, utilities, telecom, fuel and professional fees, which are often entered as expenses with no supplier bill. If expenses stay out, the VAT summary understates input VAT and the company overpays. At minimum, an expense needs net, VAT, gross and the supplier’s tax number.
2. **Input VAT needs a “deductible” flag on bills and expenses.** Your plan already notes that only e-invoices support a deduction. Store the supplier’s e-invoice number and tax registration number on the bill. Input VAT on purchases used for exempt or schedule-tax supplies is neither recoverable nor refundable, so that VAT has to go to cost, not to account 1811. [pwc](https://taxsummaries.pwc.com/egypt/corporate/other-taxes)
3. **Settlement and carry-forward are missing.** The plan has a report but no period-end entry. Add:
   - an opening credit balance, for a company already filing;
   - a “close the period” journal: Dr output VAT, Cr input VAT, Cr or Dr a VAT settlement account;
   - the payment to the tax authority.

   The refund rule also changed in July 2026. The wait for refunding an excess credit was cut from more than six consecutive tax periods to more than four. Small enterprises under Law 6/2025, with turnover up to EGP 20 million, qualify after more than three months. The summary should count consecutive credit periods. [pwc](https://www.pwc.com/m1/en/tax/documents/2026/egypt-second-tax-facilitation-package.pdf)[lookuptax](https://lookuptax.com/tax-changes/egypt/law-149-credit-balance-refund-window-2026)

4. **Add a “VAT effective from” date.** Old invoices are zero tax, so any earlier period on the summary would be wrong. Warn or block those periods.
5. **Mirror the return layout.** “By rate” isn’t enough. Sales should split into 14%, 5%, zero-rated exports and exempt. Purchases should split into local goods and services, capital assets and imports. Your accountant should give the exact Form 10 sections.
6. **Prices that include VAT need to come before online store orders are invoiced.** Retail and Shopify prices are VAT-inclusive. Net is then gross ÷ (1 + rate), and the rounding rule differs from the one in the plan.
7. **Check that 1811 lands under other current assets on the balance sheet.** Your note says group 18 is “Current financial investments” in the unified chart. Input VAT must not appear as an investment.
8. **Ask Claude Code whether invoices have discounts.** The plan is silent. VAT must be on the net after discount.

**My answers to your open questions**

- **Account codes:** keep 2871 and 1811, and add one settlement account.
- **Return deadline:** don’t hard-code it. Recent guidance puts the return and payment at the end of the month after the tax period, and one source says the old two-month deadline was replaced. Your accountant should confirm, and the app can show an editable reminder. [vatupdate](https://www.vatupdate.com/?p=357047)[vatupdate](https://www.vatupdate.com/?p=110574)
- **Registration threshold:** The ETA’s own FAQ gives EGP 500,000, with no threshold for table-tax suppliers, distribution agents, importers and exporters. A “registered: yes/no” setting is fine, but an importer or exporter must register whatever its turnover. [lookuptax](https://lookuptax.com/docs/country/egypt-vat-guidelines-indirect-tax)
- **5% rate:** A 2026 amendment expanded 5% to industrial machinery and medical equipment, and added a VAT-suspension regime on capital equipment. That suspension matters when manufacturing is built, and it carries a five-year clawback if the equipment is disposed of for a non-qualifying purpose. [ecovis](https://global.ecovis.com/?p=19666)

**Add to the accountant’s question list**

- Does VAT arise on a customer advance paid before the invoice?
- How is a credit note treated when it falls in an already-filed month?

I can turn the eight changes into a ranked work order for Claude Code if you want.

Sources: [ETA FAQ via Lookuptax](https://lookuptax.com/docs/country/egypt-vat-guidelines-indirect-tax); [PwC, Second Tax Facilitation Package](https://www.pwc.com/m1/en/tax/documents/2026/egypt-second-tax-facilitation-package.pdf); [Ecovis, 2026 amendments](https://global.ecovis.com/?p=19666); [PwC Tax Summaries, Egypt](https://taxsummaries.pwc.com/egypt/corporate/other-taxes); [Lookuptax, Law 149 refund window](https://lookuptax.com/tax-changes/egypt/law-149-credit-balance-refund-window-2026); [VATupdate, Egypt VAT filing](https://www.vatupdate.com/?p=357047)
