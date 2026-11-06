# Integrations Plan

**Module key:** several. Messaging channels extend `messaging`; payments extend `finance`; couriers and stores extend
`sales`; e-invoicing extends `einvoicing`; AI gets its own module `assistant`.
**Status:** `[📝 Draft, awaiting Ben's approval]`. Not in `checklist.md` as approved.
**Owner:** Ben · **Reviewers:** the pilot accountant (payments, banks, e-invoicing)
**Research:** [documentation/reference/INDEX.md](../reference/INDEX.md) (ignored by git: open it locally)
**Depends on modules:** core, messaging, finance, accounting, treasury, sales, einvoicing

---

## 1. Goal

Connect the ERP to the services companies in Egypt and the Gulf already use:
- email, chat and SMS for reminders and approvals;
- payment gateways and couriers for getting paid and delivering;
- online stores for orders;
- tax authorities for legal e-invoicing;
- banks for reconciliation;
- AI for an assistant and voice.

Every integration is optional and switched on per company. Nothing is required to use the core ERP.

## 2. Scope

**In:** the 16 integrations in the index, in waves (§3). Each wave builds on the previous one.

**Out for now:**
- SIP trunks;
- direct bank APIs in Egypt (none exist for third parties: statement file import instead);
- our own open-finance licence in the UAE or Saudi Arabia (use a licensed provider if needed).

**Won't:**
- a channel that approves or changes stock or money by itself;
- storing any company's credentials in code, logs or the browser;
- calling a paid service from tests (simulated mode always).

## 3. Waves (easiest and most useful first)

| Wave | Integrations | Why this wave |
|---|---|---|
| **1. Reach people** | Email (Resend or Postmark), Slack and Teams, Telegram, exchange rates | No business verification, little or no cost; uses the outbox and alert rules already built; rates are needed before foreign-currency accounting |
| **2. WhatsApp for real** | WhatsApp Cloud API (finish what is built), SMS (one-way, Egypt sender name) | The approval-on-the-phone idea is the product's core; needs Meta verification and templates, which take outside steps |
| **3. Get paid, ship, sell online** | One Egyptian payment gateway (Paymob, Fawry or Kashier), Bosta, Shopify or WooCommerce | Uses treasury (clearing accounts, transfers) and sales orders; each company brings its own account |
| **4. Legal e-invoicing** | ETA (finish: PreProd, signing), then ZATCA and a UAE accredited provider | Hardest; blocked on test access and the signing decision; Gulf only when we sell there |
| **5. AI and voice** | OpenAI (assistant, invoice reading), speech (OpenAI or ElevenLabs), voice calls | Needs a provider and budget decision, and careful data rules |
| **6. Banks** | Statement file import (all banks), then open-finance providers in the UAE and Saudi Arabia | Reconciliation comes after treasury is in use; Egypt has no bank APIs for third parties yet |

## 4. Each integration

How each fits our rules (all of them):
- **Channels never approve by themselves.** A reply, button, call or link only carries a single-use token or opens the app. The same
  database function decides, with the person's identity (sql/012–014).
- **Secrets only as Worker secrets or encrypted per company.** Ours (one email, AI or Telegram account for the service) are Worker
  secrets. A company's own (its payment gateway, store, courier, Slack URL) are stored encrypted per company. They are write-only in the
  UI, shown masked, and never logged.
- **Every action audited:** every send, callback, sync and import writes an audit row in the same transaction as its effect.
- **Per-company credentials and switches:** a company switches each integration on in Settings; nothing is shared between companies.
- **Incoming calls from providers are verified** (signature or secret header), checked against our own reference, and idempotent.

| Integration | ERP feature | What could go wrong |
|---|---|---|
| Email | Invitations, reminders, approval links, invoice and statement PDFs | Mail lands in spam until the domain is verified; bounces unnoticed (use the webhook) |
| Exchange rates | The rate on foreign-currency documents | Wrong rate type (buy or sell); the source is down (store daily, never fetch at document time) |
| Slack, Teams | Alerts to a channel | Teams flows stop when their owner leaves the company; leaked webhook URLs |
| Telegram | Staff messages with buttons | A person never started the bot (a bot cannot message first) |
| SMS | Codes and alerts | Unregistered sender names blocked by Egyptian operators; marketing curfew; cost |
| Google Sheets and Drive | Export, import, save PDFs | Google app verification; asking for a scope that triggers a paid security assessment |
| OpenAI | Assistant, drafting, invoice reading | Wrong answers presented as fact; private data sent abroad; cost spikes (spend limits) |
| Speech | Voice notes to drafts | Poor Egyptian-dialect accuracy; recordings are personal data |
| WhatsApp | Approvals and reminders | 24-hour window (templates needed), message cost since July 2025, a 250-person limit until verified |
| Payment gateways | "Pay now" on invoices | Trusting the browser redirect instead of the signed callback; duplicate callbacks; gateway fees |
| Couriers | Shipments and tracking | Bosta webhooks are unsigned (use our own secret header); returns changing stock without approval |
| Online stores | Orders in, stock out | Overselling when sync lags; duplicate orders; the app reviews of Shopify, Salla and Zid |
| Voice calls | Escalation calls | Cost of unanswered calls (billed anyway); Egyptian caller-ID rules unknown |
| ETA | Legal e-invoices | Signing key handling; PreProd behaving differently from Production |
| ZATCA, UAE | Gulf e-invoices | Certificates per VAT number (Saudi); provider contracts and dates (UAE) |
| Banks | Reconciliation | Different file formats per bank; never auto-post a match without a person |

## 5. The adapter design

There is one interface per kind of integration, with swappable providers and two modes. This is the same pattern as the channel
adapters (`apps/api/src/lib/channels`) and the ETA transport (`apps/api/src/lib/eta/transport.ts`).

- **Kinds:** `MessageChannel` (email, Slack, Teams, Telegram, SMS, WhatsApp, voice), `PaymentGateway`, `Courier`, `StoreConnector`,
  `EInvoiceTransport` (ETA, ZATCA, UAE provider), `AiProvider` and `SpeechProvider`, `RateSource`, `BankFeed`.
- **Modes per company:**
  - `simulated`: answers like the real service, sends nothing, labels everything SIMULATED. This is the default, and what tests use.
  - `live`: the real provider, refused until its credentials are set and checked.
- **Shared contract tests** run against the simulator always, and against the real sandbox only when test credentials are present.
  This is how the ETA work does it, so the simulator cannot drift from the real service.
- **Provider choice is data**, for example `org_integrations (org_id, kind, provider, mode, settings, secret_ref, enabled)`, never code.
  Switching providers never changes the ERP's own records.
- **Inbound** (webhooks and callbacks): one route per provider. It verifies the signature, checks our reference, stores the raw event
  once (idempotency key) and then calls the same database function the app uses.

## 6. Permissions (proposed)

| Key | Who | Allows |
|---|---|---|
| `core.integrations.manage` | owner, admin | Switch integrations on, enter and replace credentials |
| `core.integrations.view` | owner, admin | See status, last error, last delivery |

Feature use stays under each module's existing keys. The database re-checks every one.

## 7. Business rules

- A payment or courier callback creates records only through `fin_record_payment`, `sal_*` or `inv_*` functions, into the right
  treasury account. Usually that is a clearing account; the gateway or courier settlement is then a transfer to the bank, with fees
  recorded as an expense.
- Store orders become sales orders. Stock still leaves only through an approved request.
- An AI or voice result is always a draft for a person to confirm.
- Exchange rates are stored daily, and each document copies the rate it used.

## 8. Org settings this plan adds

- Per company: which integrations are on, their mode, provider, settings and encrypted credentials.
- The company's sending domain and sender name.
- The company's notification channels per alert rule.

## 9. Tests

Each integration ships with:
- unit tests for its signature checks;
- contract tests against its simulator;
- SQL tests for the records it creates (including isolation between companies);
- an API test that every route needs sign-in and a permission.

## 10. Rollout

One wave at a time. Each integration has its own small plan section, migration, dry run, apply, worklog entry and browser check.

## 11. Decisions Ben must make, and accounts to open

**Decisions**
1. Approve the waves and their order (§3).
2. Email provider: Resend (simpler, free tier, idempotency keys) or Postmark (strict deliverability, account approval)?
3. WhatsApp: one shared number for the service first, or each company verifies its own business and number from the start?
4. First payment gateway in Egypt: Paymob, Fawry or Kashier?
5. First online store platform: Shopify or WooCommerce (Egypt), Salla or Zid (Saudi)?
6. AI provider and monthly budget, and the data rule: is sending company data to a provider abroad acceptable, and in which region
   (OpenAI offers a UAE region on approval)?
7. ETA signing: local agent with the USB token, a cloud signing service, or an HSM (with the certificate provider and the ETA).
8. Which exchange rate the company books at (CBE buy, sell or mid), with the accountant.

**Accounts to open (only when the wave starts)**
- Email: a Resend or Postmark account, and a sending domain we control.
- Meta: a developer account, a business portfolio (to be verified), and a WhatsApp Business phone number.
- SMS: a Twilio or Cequens account, and a registered sender name.
- Telegram: a bot (free).
- Google Cloud: a project and an OAuth consent screen (verification).
- AI: an OpenAI account (and ElevenLabs if chosen), with a spend limit.
- Payments, couriers, stores: these are opened by each company, not by us. We may need a partner or app account on Shopify, Salla
  and Zid.
- ETA: PreProd access for a registered company, and a signing certificate.

## 12. Open questions

- Is SMS needed at all, given WhatsApp, Telegram and email? In Egypt it is one-way and needs sender registration.
- Does Mylerz offer an API to merchants? (No public docs.)
- Egyptian caller-ID rules for outbound voice calls (not found).
- Will the CBE publish an open-banking framework, and when? (Nothing official found.)
- Do any pilot customers sell to consumers at a counter? This decides whether ETA e-receipts are needed.
- Are any customers in Saudi Arabia or the UAE soon? The UAE deadlines are 2027.
