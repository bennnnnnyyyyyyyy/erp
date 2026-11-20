# Bellvox meeting, 20 Nov 2026: what was said and what we decided

**Status:** The discussion is finished. The plans are written. Ben must approve them.
**Plans:** [roadmap](../plans/BELLVOX_READINESS_ROADMAP.md) · [new look and UX](../plans/UX_BRAND_PLAN.md) ·
[invoice printing](../plans/INVOICE_PRINTING_PLAN.md) · [scanning](../plans/SCANNING_PLAN.md) ·
[low stock and expiry](../plans/LOW_STOCK_AND_EXPIRY_PLAN.md)
**Business questions:** [for Grant](2026-11-20-grant-business-questions.md)

> **In short**
> - Chris says the ERP **works well but does not sell well yet.** The look and the first impression are the problem.
> - Ben answered 11 rounds of questions. This page lists every answer.
> - First: **new look, invoices, scanning, low stock.**

---

## 1. What Chris said, in plain words

Chris looked at the ERP as a **buyer**, not as a builder. His question: "Would someone pay for this after a 10-minute demo?"
His answer: **not yet.**

| What Chris said | What he really sees | Why it matters for sales |
|---|---|---|
| "The UX is a mess." | Too many menu items. Crowded pages. A plain look. It looks like a tool for developers. | Buyers decide in minutes. Messy looks unfinished. Unfinished looks risky. |
| Use Bellvox colours and font. | It does not look like **our** product. | A branded product sells at a higher price. It also fits next to Bellvox voice and messaging. |
| Invoices: create, print, PDF, ETA layout, the company's own templates. | Invoices are what a company **shows its customers**. | "Show me an invoice" is the first question in a demo. |
| Scanning. | People hate typing. | A "wow" moment in a demo. It saves time. |
| Stock that loses value. An expiry tile. Grocery or chemicals sample data. | He wants to see **a real business**, not empty screens. | "Your tomatoes lost 20% of their value this week" is something an owner feels. |
| Top products, with % and value. | Owners want to know what makes money. | The main number in an owner demo. |
| A menu you can change. "As customisable as possible." | Every business is different. | "It fits you" wins against rigid competitors. |
| A low stock pop-up with "Remind me" and "Don't show again". | The ERP must **tell you** what needs attention. | It shows the ERP is active, not only a record book. |
| Ready for AI chatbots. | Every buyer asks about AI now. | Without AI, we lose. Bellvox's AI and voice background is our advantage. |
| On-prem (Ben's note). | Some customers do not want the cloud. | Without on-prem, these customers say no. |

**What to notice:** Chris did not complain about missing accounting features. The engine is strong. He reacted to three things:
1. **First impression:** the look, the brand and the clutter.
2. **Demo:** real-looking sample data, good tiles, scanning.
3. **What buyers ask first:** invoices on their letterhead, AI, and "Can I change it to fit us?"

---

## 2. Every decision

### Name and look
- The name is **"Bellvox ERP"** for now.
- The app always has the **Bellvox colours and font**. Each customer adds its own logo and name.
- No customer colour themes. No white-label.
- Colours and fonts come from **bellvox.ai** for now. There is no brand guide yet.
- **Dark mode:** yes.

### New look and UX
- Chris's problems: too many menu items, crowded screens, a plain look. Nothing more specific, so we check every screen.
- The method:
  1. Check every screen.
  2. Make mockups in a separate worktree with preview links.
  3. Ben and Chris approve.
  4. Change the screens one by one.
- Claude can use a browser on the **live test site** for the check.
- **Menu:** about 6 sections (Home, Sell, Buy, Stock, Money, Settings). Show only modules that are on. Hide what a person cannot use.
- Ben looks at reference apps himself. We add their ideas later.
- **Bug found:** two home tiles ("Top products" and "Receivables and payables") open the sales invoices page.
- **Already done before this meeting:** the stock menu asks "What do you want to do?" (built 11 Nov).

### Invoices
- A normal sales invoice. No sending to ETA yet.
- **Arabic** by default. A template can have two languages.
- Print it, download a PDF, send it by WhatsApp, send it by email.
- **ETA layout now,** with the words "Not yet submitted to ETA".
- **Draft:** can change. **Issued:** locked forever. Fix mistakes with a credit or debit note. This is the ETA rule.
- **Templates:** the company uploads its own letterhead image or Word file. Logo, colour and footer are settings.
- **Word placeholders:** a fixed list, plus the company's custom fields.
- Later: the AI copies an old invoice's layout. It uses the company's own AI key.

### Scanning
- All four kinds, in this order:
  1. read supplier bills
  2. barcodes
  3. attach photos and files
  4. QR codes
- **Phone or laptop camera only, for now.**

### Date ranges and front-page tiles
- Every date range has: presets, **All time**, and **from–to**. No "compare to previous".
- **Tiles:**
  - the owner sets a default
  - each person can change it for themselves
  - show, hide and reorder tiles
  - change each tile's settings
  - add the same tile two times
  - no resizing
- The company picks tiles in the **setup wizard**.
- A click on a tile opens a **detail view with a chart**, then the list.
- **Top products** ranks by sales value (with %), quantity, or profit and margin.

### Stock value and expiry
- How other ERPs do it (from general knowledge, not checked in their documents):
  - The accounting rule (IAS 2, Egyptian Accounting Standard 2): stock is worth its cost **or** what it can still sell for,
    whichever is lower.
  - SAP lowers the value of slow stock by % brackets.
  - Odoo changes value by hand. It keeps four expiry dates for each batch.
- **Decision:** a **bracket table** that the company can change. **Screen only.** It never changes the accounts.
- **Expiry:** expired stock is already blocked, and the first batch to expire goes out first. We add warning days for each item
  group, a setup wizard step, and an optional discount suggestion.
- **Fixed-asset depreciation** (vans, laptops): a separate module. We plan it later.

### Demo companies
- **Grocery (fruit and vegetables)** and **chemicals.** Built the same way as Demo Cosmetics Factory, as separate companies.
- A **"Load demo company"** button for any company.

### Low stock
- A pop-up **at sign-in**, and a pop-up **when an item becomes low**.
- Only people who can reorder see it.
- "Remind me" (1 hour, tomorrow, next week) and "Don't show again" work for **one item and one person**.
- The main button is **"Create purchase order"**. It needs a lot of testing.
- Reorder points use the **industry method**: daily use × lead time + safety stock.

### Customisation
All of these, as settings. The **owner gives the permission.**
1. Menu and tiles.
2. Rename labels.
3. Custom fields: all kinds (text, number, date, yes/no, dropdown, link, photo or file). The owner can make a field required.
4. Document numbers: one sequence for each type and year, for example `INV-2026-00001` (Claude's recommendation; Ben had no preference).
5. Approval rules.
6. Columns and saved views.
7. Report builder: a simple version first. A deeper version after customer feedback. Export to Excel, PDF and scheduled messages.
8. Workflow builder (like n8n): send messages, make tasks, make drafts, change fields.
   **It never posts and never approves.** Ben first said "yes, if the owner allows", then decided "drafts only".

### AI and chatbots
- Every AI feature runs through **the company's own ERP account**.
- Sell credits or use the customer's own key? **Grant decides.**
- For now, bill reading works **only with the company's own key**.
- The ERP must support **OpenAI, Gemini, Claude, Grok, OpenRouter and online Ollama**.
- Chatbots: a **better built-in assistant** and an **open API** for any chatbot.
- API keys: **only admins** make them. Each key has its own permissions.
- Bots **read and make drafts.** A person approves.
- **MCP connector** (Claude or ChatGPT connects directly): it is safe if each person signs in with their own account and it can only
  make drafts. We build it after the API.

### On-prem
- The customer's server runs our web app, our API and a local Supabase database. Like Ben's own computer.
- **On-prem does not mean offline.** Only AI and outside services use the internet.
- One install for **one company**.
- Updates and the licence follow the industry method: the admin approves updates, a backup runs first, and a grace period applies
  if the internet stops.
- Step 1 was already done on 19 Nov.

### Order of work
- **First, as soon as possible:** new look, invoices, scanning, low stock.
- **Then:** the rest, in order of speed and ease.

---

## 3. Old open decisions in the repo that connect to this meeting

| # | Open item | Where | Note |
|---|---|---|---|
| 1 | Product name was "TBD" | `plans/TECHNICAL_PLAN.md` §10.6 | Now "Bellvox ERP" for now. |
| 2 | The integrations plan was never approved | `plans/INTEGRATIONS_PLAN.md` | The API and chatbot work can go here, or in a new plan. Ben has not read it yet. |
| 3 | When to turn on ETA | `plans/TECHNICAL_PLAN.md` §12 | A question for Grant. |
| 4 | Where to keep data | `plans/TECHNICAL_PLAN.md` §10.7 | A question for Grant. Connected to on-prem. |
| 5 | The owner insights plan still says "Draft", but the tiles exist | `plans/OWNER_INSIGHTS_PLAN.md` | The new tiles work replaces it. |
| 6 | WhatsApp and voice provider | `plans/TECHNICAL_PLAN.md` §10.3 and §10.5 | Bellvox may be the answer. |
| 7 | Payment gateway and billing company | `plans/TECHNICAL_PLAN.md` §10.4 | Needed if we sell AI credits. |
| 8 | Support for the first 10 customers | `plans/TECHNICAL_PLAN.md` §10.8 | A question for Grant. |

**Small open items**
- Customer `tax_number` and e-invoicing `tax_id`: which one do we keep? (Worklog, 11 Nov.)
- A native speaker must check the Arabic machine drafts.
- Bell notifications for low stock and overdue invoices have no link. The low stock plan fixes this.
