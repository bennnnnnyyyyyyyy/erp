# Bellvox ERP: business decisions we need

**For:** Grant
**From:** Ben
**Date:** 20 November 2026

> **In short**
> - I make the technical decisions. These 10 questions are business decisions: money, pricing, legal and people.
> - Each question gives the choices, what they mean, and my recommendation.
> - One letter for each answer is enough. Use the answer sheet at the end.
> - None of these stop the first work, the new look. Some of them stop later work.

---

## Background: what Chris said

Chris looked at the ERP as a buyer would. His message: **the engine is strong, but the product is not ready to sell yet.**

**What he saw**
- **First impression:** too many menu items, crowded screens and a plain look. It does not look like a Bellvox product.
- **Missing things that buyers ask for first:**
  - invoices printed on the customer's own letterhead
  - scanning bills instead of typing them
  - low stock alerts
  - top-selling products on the front page
  - demo companies that look like a real shop
- **"Can it fit our business?"** Every business is different. The ERP must be easy to change: menus, front-page tiles, fields,
  numbering, reports and automations.
- **AI:** buyers will ask "Can I talk to it? Can it connect to our chatbot?"
- **Some buyers do not want the cloud.** Factories and government suppliers want the ERP on their own server. We call this "on-prem".

**What is already strong**
- Approvals that really block in the database.
- The stock ledger.
- VAT and financial statements.
- The audit trail (a record of every change).

**What we will do, in this order**
1. Quick fixes. Then a new look in Bellvox colours and font, with the name **"Bellvox ERP"** for now.
2. Invoices: in Arabic, printed and as PDF, on the customer's letterhead or Word template, sent by WhatsApp or email.
   Also the tax authority (ETA) layout.
3. Scanning: take a photo of a supplier bill and the AI fills it in. Barcodes with the phone camera. Attach photos.
4. Low stock pop-ups, with a one-click purchase order.
5. After that:
   - front-page tiles and date ranges that each customer can change
   - expiry warnings and stock value
   - grocery and chemicals demo companies
   - tools to change the ERP without code
   - a connection for chatbots
   - a report builder and a workflow builder
   - on-prem install packages

---

## The questions

### 1. Who pays for AI?

**Why it matters:** scanning cannot work for a customer who has no AI account until we decide this.

All AI features run through each company's own ERP account. Examples: reading bills, the assistant, voice notes.
Someone must pay the AI company.

- **a) The customer brings their own AI key.** Examples: OpenAI, Google Gemini, Anthropic Claude, xAI Grok, OpenRouter, or their own
  server. We pay nothing. But setup is harder for small shops.
- **b) We sell AI credits.** We pay the AI company and sell credits with a margin. This is easy for customers and gives us extra income.
  But we carry the bill, and we need a payment system (question 6).
- **c) Both.** Credits by default. Big customers can use their own key.

**My recommendation: c.** Start with **a**, because that is how it works today. Add credits when billing is ready.

### 2. When do we turn on sending invoices to the tax authority (ETA)?

Today the ERP prints the ETA layout with the words "Not yet submitted".

Real sending needs these things for each customer:
- registration with ETA
- login details for the ETA system
- an **eSeal certificate** to sign invoices. An Egyptian certificate company sells it.

We can test against ETA's test system after one free sign-up on its test portal.

- **a) Now.** Sign up for the test system this month. Connect the first real customer when one asks.
- **b) When the first paying customer needs it.**
- **c) Through a partner** who already sends to ETA. Less work for us, but a fee for each invoice.

**Also:** whose tax number do we use for the test sign-up? A Bellvox company, or a friendly pilot customer?

**My recommendation:** **a** for the test sign-up. It is free and it removes the risk. **b** for real sending.

### 3. Bellvox brand

For now we take the colours and fonts from bellvox.ai.
- Is there a **brand guide**? That means: colour codes, fonts and their licences, logo files, and usage rules.
- Who approves the new look: Chris, you, or both?

### 4. Product name

The name is "Bellvox ERP" for now.
- **a)** Keep "Bellvox ERP".
- **b)** Give the ERP its own name, "by Bellvox".

A name change later costs a little (logo, domain, printouts). It does not mean rebuilding the product.

### 5. On-prem customers: price and support

How on-prem works:
- The ERP runs on the customer's own server.
- It is still online. Only AI and outside services use the internet.
- One install for each company.
- Updates come as packages. The customer's admin approves each update. The database is backed up before each update.

Questions:
- How do we **price** on-prem? A yearly licence? A setup fee? A support contract?
- Who **installs and supports** it: us, a partner, or the customer's IT team?
- The licence checks our server from time to time. If the internet stops, the ERP keeps working for a while.
  **How long?** My suggestion: 14 days.

### 6. Payments: which company sends our bills, and how do customers pay?

We need this for subscriptions and AI credits. Today we assume Paymob.
- Which **company** sends our invoices to customers?
- Which **payment gateway**: Paymob, Fawry, or another?

### 7. Where do we keep cloud customers' data?

This is about the database location, and the location of the PDF service. Egyptian buyers may ask for data in Egypt or the region.
- **a) EU region.** This is what we use now. It is reliable and cheap.
- **b) Middle East region**, when it is available.
- **c) Ask the first customers first.**

### 8. WhatsApp and voice: does Bellvox provide them?

The ERP sends invoices, alerts and approval requests by WhatsApp. It also takes approvals by voice.
- **a) Bellvox's own WhatsApp and voice platform.** This is our advantage.
- **b) Meta's WhatsApp service directly.**
- **c) A local WhatsApp provider.**

**Also:** who pays the cost of each message, us or the customer?

### 9. Support for the first 10 customers

When a customer has a problem:
- Who answers: us, a Bellvox team, or a partner?
- By which channel: WhatsApp, email or phone?
- At which hours?

### 10. Keeping records

The ERP keeps scanned bills and sent invoices as files.
- **How long** must we keep them? Egyptian tax and commercial rules apply.
- Who pays for the storage: the customer or Bellvox?

---

## Answer sheet

| # | Question | Your answer |
|---|---|---|
| 1 | Who pays for AI: own key, credits, or both? | |
| 2 | When to turn on ETA? Whose tax number for the test sign-up? | |
| 3 | Is there a brand guide? Who approves the look? | |
| 4 | Keep "Bellvox ERP"? | |
| 5 | On-prem: price, support, grace period | |
| 6 | Which company bills customers? Which payment gateway? | |
| 7 | Where to keep data | |
| 8 | WhatsApp and voice provider. Who pays for messages? | |
| 9 | Support: who, which channel, which hours | |
| 10 | How long to keep files. Who pays for storage? | |
