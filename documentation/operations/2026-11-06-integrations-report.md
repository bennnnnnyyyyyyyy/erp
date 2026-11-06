# Integrations report (6 Nov 2026)

What was done from the start of the integrations plan to the end of 6 November 2026. Details and checks for each step are in
[WORKLOG.md](WORKLOG.md); the plan is [INTEGRATIONS_PLAN.md](../plans/INTEGRATIONS_PLAN.md) and the provider choices are
[INTEGRATION_PROVIDER_CHOICES.md](../planning/INTEGRATION_PROVIDER_CHOICES.md).

## In short
- Every integration chosen from the provider list is built, except bank statement import (F) and the setup guide (G), which are not
  started.
- **Nothing is sent to any provider yet.** Each one runs in a safe "simulated" test mode until real keys are added.
- All database changes for this work (`sql/053` to `sql/060`) are on the live database. On top of their own tests, each change was first
  tried on live in a way that was fully undone, and a deliberately broken version of each was confirmed to fail its test.

## 1. Research and planning
- **Research:** 16 kinds of service studied (email, exchange rates, Slack/Teams, Telegram, SMS, Google Sheets, OpenAI, speech, WhatsApp,
  payment gateways, couriers, online stores, voice calls, Egyptian and Gulf e-invoicing, bank feeds). Notes are in
  `documentation/reference/` (kept out of git).
- **Plan:** written in [INTEGRATIONS_PLAN.md](../plans/INTEGRATIONS_PLAN.md).
- **Provider checklist:** written with pros and cons, and filled in by Ben:
  - Resend for email.
  - Paymob and Fawry for payments.
  - Bosta for delivery.
  - Shopify for the online store.
  - OpenAI, ElevenLabs and Ollama for AI.
  - The central bank (CBE) rate for exchange rates.
  - Statement-file import for bank feeds.
  - SMS and voice calls: not now.
- **AI rules (Ben):** USD 100 a month, the customer's consent first, and Ollama offered as the "your own AI" option.
- **Build checks:** the automatic checks on GitHub were fixed; they were wrongly reporting failures.

## 2. What was built

| # | Integration | What it does | Database | Code |
|---|---|---|---|---|
| 1 | Email (Resend) | Sends copies of alerts and approval requests by email | `sql/053`, applied | Merged |
| 2 | Slack and Teams | Posts the chosen alerts to a channel | `sql/053`, applied | Merged |
| 3 | Telegram | Alerts to people who link their Telegram | `sql/054`, applied | Merged |
| 4 | Exchange rates | Saves daily rates | `sql/053`, applied | Merged |
| 5 | Provider settings | One place to enter each provider's keys | `sql/056`, applied | Merged |
| 6 | Paymob and Fawry | "Pay now" link on sales invoices | `sql/057`, applied | Merged |
| 7 | Bosta | Create a delivery from a sales order and follow its status | `sql/058`, applied | On `main` |
| 8 | Shopify | Store orders arrive as sales orders | `sql/059`, applied | On `main` |
| 9 | AI assistant and speech to text | Ask about stock in plain words; turn a recording into text | `sql/060`, applied | On `main` |

Details for some rows:
- **Provider settings (row 5):** secret keys are stored encrypted and can never be shown again. Each company starts in test mode.
- **Paymob and Fawry (row 6):** the payment is recorded only when the provider sends its signed confirmation. A wrong amount or currency
  is held for a person to check.
- **Bosta (row 7):** a delivery update never changes stock or money.
- **Shopify (row 8):** orders are matched by product code (SKU). If anything doesn't match, the order is held for a person, and stock still
  needs the normal approval.
- **AI (row 9):**
  - The assistant only answers; it cannot change anything.
  - The owner must accept a notice before company data is sent to OpenAI or ElevenLabs.
  - Calls on our key are capped at USD 100 a month in total and USD 25 per company.
  - Ollama sends the question and matching stock data to the https address the company enters, over the internet; since `sql/061` it needs the AI notice too (repo audit N10; corrected 6 Nov night).

## 3. Other work in the same period
- **Accounting and treasury check:** checked on the demo company in the browser. The books balance and transfers work.
- **Stock value check and revaluation (`sql/055`, applied):** the demo company's books and stock count differ by EGP 582,100.59. The
  check and a one-click correction are built, and the demo sample data is fixed. The correction itself is waiting for Ben's click.

## 4. Checks
- Automatic checks pass on the latest code:
  - formatting
  - code types
  - 369 tests
  - a browser smoke test in English and Arabic
- Every database change has its own test (`sql/tests/048` to `055`), and each passes on the live database.

## 5. Not done yet
- **F:** bank statement file import with match suggestions, and manual entry of the CBE rate.
- **G:** a step-by-step guide for getting and entering each provider key.
- **Voice approvals:** approving by phone call or WhatsApp voice note.
- **Store sync out:** sending our stock levels and products back to Shopify.
- **Google Sheets and Drive:** row 6 of `ERP_integrations_table.pdf`; no decision made yet.

## 6. What's needed
1. ~~Merge `integrations-all` into `main` so the new screens go live.~~ Done: the code is on `main` (checked 6 Nov night).
2. **Keys:** each integration stays in test mode until its keys are entered:
   - Resend (plus a verified email domain)
   - Telegram bot
   - Paymob
   - Fawry
   - Bosta
   - Shopify
   - OpenAI and ElevenLabs, or a company's own Ollama
   - Meta account for WhatsApp
3. **One test transaction per provider** once keys exist. A few technical details are confirmed only that way:
   - where Paymob returns our reference
   - Fawry's signature format
   - Bosta's request fields
   - Shopify's order fields
4. **Review:** the Arabic wording on the new screens (machine-drafted).
5. **Decisions:** Google Sheets and Drive, and the demo stock correction click.
