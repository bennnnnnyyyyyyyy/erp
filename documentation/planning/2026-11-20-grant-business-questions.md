# Bellvox ERP: business decisions we need

**For:** Grant
**From:** Ben
**Date:** 20 November 2026 (updated 23 November 2026: questions 11 and 12, a table of what each answer unblocks, facts for question 10,
and a guide for your own ERP research)

> **In short**
> - I make the technical decisions. These 12 questions are business decisions: money, pricing, legal, customers and people.
> - Each question gives the choices, what they mean, and my recommendation.
> - One letter for each answer is enough. Use the answer sheet at the end.
> - **Two answers are urgent: #3 (brand guide) and #12 (who we sell to first).** The new look and the demo companies wait for them.
> - You are researching ERPs yourself. The research guide near the end says what to look at, so that your notes help these answers.

---

## What each answer unblocks

| # | Question | What waits for the answer | Needed by |
|---|---|---|---|
| 3 | Brand guide, who approves the look | The new look (colours, fonts, logo) | **Now (urgent)** |
| 12 | Who we sell to first | Demo companies, the front page, which features come first | **Now (urgent)** |
| 1 | Who pays for AI | Scanning bills for customers without their own AI key | Before scanning ships |
| 11 | Cloud price | The website, the trial, the billing screens | Before the first sale |
| 6 | Who bills customers, payment gateway | Subscriptions and AI credits | Before the first sale |
| 4 | Product name | Logo, domain, printouts | Before the first sale |
| 9 | Support for the first customers | The support channel inside the ERP | Before the first customer |
| 10 | Keeping records | How long we keep files, storage limits | Before the first customer |
| 7 | Where we keep data | The database region | Before the first customer |
| 8 | WhatsApp and voice provider | Sending invoices and approvals by WhatsApp | Before WhatsApp sending ships |
| 2 | When to turn on ETA sending | Real e-invoice submission | When the first customer needs it |
| 5 | On-prem price and support | On-prem install packages | Before the first on-prem sale |

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

**Progress since 20 November:** quick fixes are done. Invoice printing (drafts, locked invoices, print and PDF, ETA layout, a customer
link) and the low stock pop-up are built and live for testing.

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

### 3. Bellvox brand (urgent)

**Why it matters:** the new look is the next big piece of work. Without a guide we guess from the website.

For now we take the colours and fonts from bellvox.ai.
- Is there a **brand guide**? That means: colour codes, fonts and their licences, logo files, and usage rules.
- Who approves the new look: Chris, you, or both?

**Please send:** the logo files (SVG or large PNG), the colour codes, and the font names. If there is no guide, say so and we use the
website.

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

The ERP keeps scanned bills, sent invoices and the accounting records.

**The facts:**
- Egypt's Unified Tax Procedures Law (Law 206 of 2020) requires a business to keep its books, records and documents for
  **at least 5 years**. The tax authority can review that period. (Please confirm the exact article with our accountant or lawyer.)
- The legal duty is the **customer's**. Our job is to make it easy and safe: the ERP never deletes accounting records, invoices or
  the audit trail. Records are only marked as cancelled.
- The cost is the **files** (scans and PDFs). The records themselves are small.

**The choices:**
- **a) Keep everything for at least 5 years, storage included up to a limit** in each plan (for example a number of GB). More storage
  costs extra.
- **b) Keep everything for as long as the customer pays,** with unlimited storage. Simple, but our cost has no limit.
- **c) Keep 5 years, then delete old files** after a warning. Cheapest, but risky: some customers need older files.

**My recommendation: a.** Keep at least 5 years, never delete while the customer is active, and include storage up to a limit. When a
customer leaves, they can download everything first.

### 11. Cloud price (new)

**Why it matters:** the website, the free trial and the billing screens need a price model. Buyers ask "how much?" in the first call.

- **a) Per company per month, with module tiers.** For example: a base tier (stock and sales), a middle tier (adds purchases and
  accounting), a full tier (adds VAT, ETA, AI and WhatsApp). A number of users is included; extra users cost more.
- **b) Per user per month.** Common abroad. Small Egyptian shops often find it expensive and share one login, which breaks the
  audit trail.
- **c) One price for everything.** Simple, but too much for small shops or too little for big ones.

**Also:**
- **Free trial:** 14 days, with a demo company already filled in.
- **Paid setup (optional):** we import the customer's items, customers and opening balances for a fixed fee.

**My recommendation: a**, with a 14-day trial and an optional paid setup. Your research (see the guide below) will tell us what the
competitors charge in Egypt.

### 12. Who do we sell to first? (new, urgent)

**Why it matters:** the demo companies, the front page and the order of the next features depend on this. One customer type done
well sells better than five done halfway.

- **a) Distributors and wholesalers.** They have stock, many customers, credit notes, approvals and VAT. This is exactly what the ERP
  already does best.
- **b) Small factories.** They need stock, purchases and VAT, plus manufacturing (bills of materials), which is planned but not built.
- **c) Shops and retail.** They need a fast point-of-sale screen, which we do not have yet.
- **d) Service companies.** They need little stock. The ERP's strongest parts help them less.

**My recommendation: a first, b second.** Distributors fit what is already built. Small factories come next, when manufacturing is
built. The demo companies would then be a distributor (for example cosmetics or groceries) and a small factory (for example chemicals).

---

## Research guide (for your own ERP research)

You are looking at ERPs yourself. These notes make your research answer our questions.

**Systems to look at:**
- **International:** Odoo, Zoho Books, ERPNext
- **Arabic and regional:** Daftra, Qoyod, Wafeq
- **Egyptian:** Miracle, Al-Ameen

**For each system, please note:**
1. **Price:** the price in Egypt (EGP or USD), per company or per user, and what each tier includes.
2. **Target customers:** who they sell to (shops, distributors, factories, services).
3. **ETA:** do they send e-invoices to the tax authority? Is it included or an extra cost?
4. **AI:** what AI features they have (reading bills, a chat assistant, voice).
5. **On-prem:** can a customer install it on their own server? At what price?
6. **The first 10 minutes:** sign up for the trial. What do you see? Is it easy or confusing? What did you like?
7. **Reviews:** what do users praise and complain about (Google reviews, Facebook groups, Capterra)?
8. **Arabic:** is the Arabic complete and good, or a weak translation? Does the screen read right to left properly?

**Where to put the notes:** send them to me, or put them in `documentation/research/<system name>/` (copy the `_TEMPLATE` folder). We
already have notes on Odoo and Miracle there.

**One rule:** write down what a system **does**, in your own words. Never copy their text, pictures or code. Some of them use
licences that could force our code to become public if we copy from them. Screenshots are fine for us to look at, but they stay
on your computer and do not go into our files.

---

## Answer sheet

| # | Question | Your answer |
|---|---|---|
| 1 | Who pays for AI: own key, credits, or both? | |
| 2 | When to turn on ETA? Whose tax number for the test sign-up? | |
| 3 | **(urgent)** Is there a brand guide? Who approves the look? | |
| 4 | Keep "Bellvox ERP"? | |
| 5 | On-prem: price, support, grace period | |
| 6 | Which company bills customers? Which payment gateway? | |
| 7 | Where to keep data | |
| 8 | WhatsApp and voice provider. Who pays for messages? | |
| 9 | Support: who, which channel, which hours | |
| 10 | Keeping records: a, b or c? Storage limit per plan? | |
| 11 | Cloud price: a, b or c? Trial and paid setup? | |
| 12 | **(urgent)** Who we sell to first: a, b, c or d? | |
