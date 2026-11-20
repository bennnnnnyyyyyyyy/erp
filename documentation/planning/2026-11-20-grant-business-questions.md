# Bellvox ERP: business decisions needed

**For:** Grant · **From:** Ben · **Date:** 20 November 2026
**Why you're getting this:** I make the technical calls. The questions below are business calls: pricing, money, legal and who
does what. Each one has the options, what each means, and my recommendation. A one-letter answer per question is enough.

---

## Context: what came out of the meeting with Chris

Chris looked at the ERP the way a buyer would and didn't like what he saw. In short: **the engine is strong, the packaging isn't
ready to sell.**

- **First impression:** too many menu items, crowded screens, a plain look. It doesn't look like a Bellvox product.
- **What buyers ask for first is missing or hidden:** invoices printed on the customer's own letterhead, scanning bills instead of typing,
  low-stock alerts, top-selling products on the front page, demo companies that look like a real shop.
- **"Can it fit us?":** every business is different, so the ERP should be as customisable as possible: menus, tiles, fields, numbering,
  reports, automations.
- **AI:** buyers will ask "can I talk to it? Can it plug into our chatbot?"
- **Some buyers won't use the cloud:** factories and government suppliers want the ERP on their own server (on-prem).

What's already strong and not in question: approvals that really block in the database, the stock ledger, VAT, financial statements and
the audit trail.

**What we're doing about it** (technical plan approved by me, in this order):
1. Quick fixes, then a full UX overhaul in Bellvox colours and font, named **"Bellvox ERP"** for now.
2. Invoices: Arabic, printed and PDF, on the customer's letterhead or Word template, sent by WhatsApp or email; ETA-style layout now.
3. Scanning: photograph a supplier bill and the AI fills it in; phone-camera barcodes; attachments.
4. Low-stock pop-ups with one-click purchase orders.
5. Then: customisable home tiles and date ranges, expiry and stock value, grocery and chemicals demo companies, customisation tools,
   an open API for chatbots, a report builder, a workflow builder, on-prem packages.

None of the decisions below block step 1. Several block steps 2 to 5.

---

## Decisions

### 1. AI: who pays for it? (blocks scanning for customers without their own AI account)
Every AI feature (bill reading, the assistant, voice notes) runs through each company's own ERP account. Somebody pays the AI provider.

- **a) Customers bring their own AI key** (OpenAI, Google Gemini, Anthropic Claude, xAI Grok, OpenRouter or their own server). We pay
  nothing, but setup is harder for small shops.
- **b) We sell AI credits**: we pay the provider and resell with a margin. Easy for customers, extra revenue, but we carry the bill and
  need a payment gateway (decision 6).
- **c) Both**: credits by default, own key for big customers.

**Recommendation: c**, starting with **a** until billing exists (that's how it's built now).

### 2. ETA e-invoicing: when do we switch on sending to the tax authority?
Today the ERP prints in ETA's layout marked "Not yet submitted". Real sending needs, per customer: ETA registration, API credentials and
an **eSeal certificate** for signing (bought from an Egyptian certificate provider). We can test against ETA's test environment after
one registration on its test portal.

- **a) Now**: register our test account this month; first real customer on ETA as soon as one asks.
- **b) When the first paying customer needs it.**
- **c) Through a partner** who already submits to ETA (less work, a fee per invoice).

Also: **whose tax number do we use to register on ETA's test portal?** (A Bellvox company, or a friendly pilot customer.)
**Recommendation: a** for the test registration (it's free and removes the risk), **b** for production.

### 3. Bellvox brand
We're taking colours and fonts from bellvox.ai for now. **Is there a brand guide** (colour codes, fonts and their licences, logo files,
usage rules)? Who approves the new look: Chris, you, or both?

### 4. Product name
"Bellvox ERP" for now. **Keep it, or give the ERP its own name "by Bellvox"?** A name change later costs a little (logo, domain,
printouts), not a rebuild.

### 5. On-prem customers: price and support
The ERP can run on a customer's own server (still online; only AI and outside services leave it). One install per company. Updates arrive
as packages the customer's admin approves; the database is backed up before each update.

- How do we **price** on-prem? (Yearly licence, setup fee, support contract?)
- Who **installs and supports** it: us, a partner, or the customer's IT?
- The licence checks our server now and then, with a grace period if the internet drops. **How long a grace period?** (Suggested: 14 days.)

### 6. Payments: which company bills customers, through which gateway?
Needed for subscriptions and AI credits. Paymob is our working assumption.
- **Which legal entity** issues our invoices to customers?
- **Gateway:** Paymob, Fawry, or another?

### 7. Where cloud customers' data lives
Cloud hosting region for the database (and the PDF service). Egyptian buyers may ask for data in Egypt or the region.
- **a) EU region** (current; reliable, cheap)
- **b) Middle East region** when available
- **c) Ask the first customers first**

### 8. WhatsApp and voice: does Bellvox provide them?
The ERP sends invoices, alerts and approvals by WhatsApp and takes voice approvals.
- **a) Bellvox's own WhatsApp and voice platform** (our edge)
- **b) Meta's WhatsApp API directly**
- **c) A local WhatsApp provider**

Who pays per-message fees: us or the customer?

### 9. Support for the first 10 customers
Who answers when a customer is stuck: us, a Bellvox team, a partner? Through which channel (WhatsApp, email, phone), and in which hours?

### 10. Record keeping
Scanned bills and sent invoices are kept as files. **How long must we keep them** (Egyptian tax and commercial record rules), and does
the customer or Bellvox pay for the storage?

---

## Answer sheet

| # | Question | Answer |
|---|---|---|
| 1 | AI: own key / credits / both | |
| 2 | ETA timing; whose tax number for the test portal | |
| 3 | Brand guide; who approves the look | |
| 4 | Keep "Bellvox ERP"? | |
| 5 | On-prem price, support, grace period | |
| 6 | Billing entity; gateway | |
| 7 | Data region | |
| 8 | WhatsApp and voice provider; message fees | |
| 9 | Support model | |
| 10 | Record keeping period; storage cost | |
