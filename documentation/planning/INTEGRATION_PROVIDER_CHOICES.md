# Integration provider choices (for Ben to fill in)

Tick one box per section (`[x]`), add a note if you like, and send it back. Each choice unblocks building that integration for real.
Facts come from the saved notes in `documentation/reference/` (6 Nov 2026; prices change, so check before paying). Nothing is
signed up for until you say so.

---

## 1. Email (approval links, reminders, invoices and statements by email)

- [x] **Resend** (recommended)
  - Pro: free for 3,000 emails a month; USD 20 a month for 50,000. Simple API. Built-in protection against sending the same email twice. Fast to set up.
  - Con: only 100 emails a day on the free plan. Younger company.
- [ ] **Postmark**
  - Pro: known for the best delivery to inboxes. A test mode that sends nothing.
  - Con: new accounts must be approved by Postmark before sending to anyone outside your own domain. Pricing page not checked.

- **Also needed:** a domain we control for sending (for example `mail.yourdomain.com`), so mail does not land in spam.
- Note: **********\_\_\_**********

## 2. WhatsApp (approvals and reminders on the phone)

- [x] **One shared number for the service first** (recommended to start)
  - Pro: one Meta business verification (ours); faster to a real test; companies need do nothing.
  - Con: messages come from our name, not the customer's company; one 24-hour limit shared by all companies (250 people a day until verified, then 2,000 and up).
- [ ] **Each company verifies its own number**
  - Pro: messages carry the company's own name; each company has its own limits.
  - Con: every company must complete Meta business verification and get templates approved; slower to onboard each customer.

- **Also needed:** a Meta developer account, a business portfolio (to be verified), a phone number, approved message templates. Since October 2026 service messages beyond 1,000 a month per number are charged.
- Note: **********\_\_\_**********

## 3. SMS (one-time codes and alerts; one-way only in Egypt)

- [ ] **Not now** (recommended: WhatsApp, Telegram and email cover it)
  - Pro: no sender-name registration, no cost.
  - Con: no fallback for people without a smartphone.
- [ ] **Cequens** (Egyptian provider)
  - Pro: local company; also offers WhatsApp and voice; Egyptian sender-name process known to them.
  - Con: send API and prices not public; must ask their sales.
- [ ] **Twilio**
  - Pro: well documented; worldwide.
  - Con: sender name must be registered per network (Twilio states about 3 weeks for Egypt); marketing curfew 21:00–09:00 and no marketing on Fridays, Saturdays or holidays.

- **Also needed (if SMS):** commercial register, tax card and a signed no-objection letter for the sender name.
- Note: **********\_\_\_**********

## 4. Telegram (free staff messages; built, simulated until a bot exists)

- [x] **Yes, create our bot now** (recommended)
  - Pro: free, no verification, built already; staff link with one tap.
  - Con: less used in Egypt than WhatsApp.
- [ ] **Not now**

- **Also needed:** a bot made with @BotFather (a few minutes); I set the server secrets and the webhook with you.
- Note: **********\_\_\_**********

## 5. First payment gateway in Egypt ("Pay now" on invoices)

Each company opens its own merchant account; we never hold their money.

- [x] **Paymob** (recommended)
  - Pro: largest in Egypt; cards, wallets, instalments, Fawry-style references; also in the UAE, Saudi Arabia and Oman, so one integration covers the Gulf later.
  - Con: developer site needs JavaScript (harder to read); fees on request.
- [x] **Fawry**
  - Pro: payment by reference number at Fawry outlets, which many Egyptian customers prefer to cards.
  - Con: Egypt only; older documentation; signatures use a less common scheme.
- [ ] **Kashier**
  - Pro: free test account; clear docs; ready plugins for WooCommerce and Shopify.
  - Con: smaller; Egypt only.

- Note: **********\_\_\_**********

## 6. Courier (shipments, labels, tracking, cash on delivery)

- [x] **Bosta** (recommended)
  - Pro: Egyptian; modern API with keys made in its dashboard; delivery status by webhook.
  - Con: webhooks are not signed (we protect them with our own secret header).
- [ ] **Aramex**
  - Pro: Egypt and the Gulf; well known.
  - Con: older SOAP/XML API; account through a representative.
- [ ] **Mylerz**
  - Pro: Egyptian, e-commerce focused.
  - Con: no public API documentation; must ask them.
- [ ] **Not now**

- Note: **********\_\_\_**********

## 7. First online store platform (orders in, stock out)

- [x] **Shopify** (recommended for Egypt)
  - Pro: modern API; signed webhooks; many Egyptian brands use it.
  - Con: a public app needs Shopify's review; per-store install.
- [ ] **WooCommerce**
  - Pro: very common in Egypt; free; simple keys per store.
  - Con: each store runs on its own server, so reliability varies per customer.
- [ ] **Salla** (Saudi Arabia)
  - Pro: 60,000+ Saudi stores; app store.
  - Con: only relevant once we sell in Saudi Arabia; app approval.
- [ ] **Zid** (Saudi Arabia)
  - Pro: popular in Saudi Arabia.
  - Con: same as Salla; two tokens per request.
- [ ] **Not now**

- Note: **********\_\_\_**********

## 8. AI provider (assistant, reading supplier invoices, voice notes)

- [x] **OpenAI** (recommended)
  - Pro: strong Arabic; cheap small models (from about USD 0.05 per million tokens); API data not used for training; a UAE data region on approval.
  - Con: data leaves Egypt unless the UAE region is approved; the old `whisper-1` voice model shuts down 26 Feb 2027 (newer one is cheaper).
- [ ] **Anthropic (Claude)**
  - Pro: strong reasoning and Arabic; enterprise data terms.
  - Con: not researched in the saved notes yet; I would add it before building.
- [ ] **Not now**

- **Monthly budget cap:** USD **\_\_\_** (a hard limit is set in the provider's account)
- **May company data be sent to a provider outside Egypt?** [ ] Yes [ ] Only with the customer's consent [ ] No
- Note: **********\_\_\_**********

## 9. Voice transcription (voice notes to drafts)

- [x] **OpenAI** (recommended if 8 is OpenAI)
  - Pro: one provider for AI and voice; about USD 0.0045 per minute.
  - Con: Egyptian-dialect quality unknown until tried.
- [x] **ElevenLabs**
  - Pro: Arabic rated "good"; speaker labels; realtime option.
  - Con: second provider and bill; data in the US unless Enterprise.
    add it as fallback
- [ ] **Not now**

- Note: **********\_\_\_**********

## 10. Voice calls (escalation calls for urgent approvals)

- [x] **Not now** (recommended)
  - Pro: no telephony costs or Egyptian caller-ID questions.
  - Con: no phone call when WhatsApp is ignored.
- [ ] **Twilio Voice**
  - Pro: well documented.
  - Con: Egyptian local numbers and caller-ID rules not found; unanswered calls are billed.
- [ ] **Cequens voice**
  - Pro: local provider.
  - Con: details on request.

- Note: **********\_\_\_**********

## 11. Egyptian e-invoicing (ETA): how invoices are signed

- [x] **Local signing agent with the company's USB token** (recommended to start)
  - Pro: works with the e-signature tokens companies already have; the key never leaves the company.
  - Con: a small program on a company computer that must be on when invoices are sent.
- [ ] **Cloud signing service from a certified Egyptian provider**
  - Pro: nothing to install; works unattended.
  - Con: a contract and fee per company; must confirm the ETA accepts it.
- [ ] **Hardware security module (HSM)**
  - Pro: strongest; unattended.
  - Con: expensive; overkill for small companies.

- **Also needed:** PreProd (test) access from the ETA for a registered company; a certificate provider's answer.
- Note: **********\_\_\_**********

## 12. Gulf e-invoicing

- [x] **Not now** (recommended until we have a Saudi or UAE customer)
- [ ] **Saudi ZATCA**: direct connection; per-company certificates.
- [ ] **UAE**: through an accredited service provider (required); deadlines from 2027.

- Note: **********\_\_\_**********

## 13. Bank feeds

- [x] **Statement file import (CSV/Excel) for every bank** (recommended)
  - Pro: works with every Egyptian bank today; no licence.
  - Con: someone downloads and uploads the file.
- [ ] **Open-finance provider (UAE,W Saudi Arabia)**
  - Pro: automatic.
  - Con: only in the Gulf; needs a licensed provider; Egypt has no official API yet.

- Note: **********\_\_\_**********

## 14. Exchange rate the books use

- [x] **Central Bank of Egypt rate, middle of buy and sell** (recommended; confirm with the accountant)
- [ ] **CBE buy rate**
- [ ] **CBE sell rate**

- Note: today the app saves Frankfurter's daily mid-market rates (which include the CBE); entering the CBE figure by hand would need a small screen.

## 15. Order of the waves (INTEGRATIONS_PLAN.md §3)

- [x] **Approve as written** (reach people → WhatsApp → payments, courier, store → e-invoicing → AI and voice → banks)
- [ ] **Change the order:** **********\_\_\_**********
