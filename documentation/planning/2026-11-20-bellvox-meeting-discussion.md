# Bellvox meeting, 20 Nov 2026: discussion notes

**Status:** discussion finished 20 Nov; plans written (awaiting Ben's approval): [roadmap](../plans/BELLVOX_READINESS_ROADMAP.md),
[UX and brand](../plans/UX_BRAND_PLAN.md), [invoice printing](../plans/INVOICE_PRINTING_PLAN.md), [scanning](../plans/SCANNING_PLAN.md), [low stock and expiry](../plans/LOW_STOCK_AND_EXPIRY_PLAN.md); business questions: [for Grant](2026-11-20-grant-business-questions.md).
(Moved into the repo on 20 Nov; the Desktop copy is the original draft.)

---

## 1. What the meeting said, in plain words (for a seller, not an engineer)

Chris looked at the ERP as a **buyer**, not a builder. He wasn't asking "does it work?" but "would someone pay for this after a
ten-minute demo?" Read through that lens, every note says the same thing: **it doesn't yet look or feel like something you can sell.**

| What was said | What he's really seeing | Why it matters for selling |
|---|---|---|
| "The UX is a mess" | First impression: too many menu items, crowded pages, plain look. It looks like a tool developers made for themselves. | Buyers decide in minutes. Messy looks unfinished, and unfinished looks risky with their money and their books. |
| Bellvox colours and font | It doesn't look like *our* product. No brand means no trust and no premium feel. | A branded product sells at a higher price and sits naturally next to Bellvox's voice and messaging. |
| Invoices: create, print, PDF, ETA layout, the company's own templates | Invoices are what an Egyptian SME **shows the outside world**. No own letterhead means they won't switch. | First thing an owner asks in a demo: "show me an invoice." |
| Scanning | Typing is the enemy. Photograph a bill or scan a barcode and be done. | A "wow" moment in a demo and an easy time-saving story. |
| Stock losing value, expiry tile, grocery or chemicals sample data | He wants to see **a real-looking business**, not empty screens. "Your tomatoes lost 20% of their value this week" is felt. | Demo data turns "imagine if…" into "that's my shop." It also shows the ERP fits different trades. |
| Top products, % and value | Owners care what makes money, at a glance, on the front page. | The headline number of any owner demo. |
| Customisable menu and tiles; "as customisable as possible" | Every business is different. Things they don't use make it feel like the wrong product. | "It adapts to you" beats rigid competitors and answers "but we do it differently". |
| Low-stock pop-up with "remind me / never show again" | The ERP should **tell you** what needs attention without nagging. | Shows it's proactive, not just a record book. |
| Ready for AI chatbots | Every buyer asks about AI now. | Without an AI story we lose to anyone who has one. Bellvox's voice and AI background is our edge. |
| On-prem readiness (Ben's note) | Some customers (factories, chemicals, government suppliers) won't put their books in the cloud. | Without it, a whole segment says no. |

**What to notice:** almost nothing raised is about missing accounting power. The engine (approvals that really block, stock ledger,
VAT, statements) is strong. The reaction is to **packaging**:
1. **First impression:** looks, brand, clutter.
2. **Demo-ability:** realistic sample data, eye-catching tiles, scanning.
3. **What buyers ask for first:** invoices on their letterhead, AI, "can I change it to fit us?"

The engine is built; Chris is saying it needs a body before you can sell the car.

---

## 2. Decisions so far (Ben, 20 Nov 2026)

### Product and brand
- Product name: **"Bellvox ERP"** for now.
- App look: **Bellvox colours and font for every customer**. Each company adds its own logo and name (header and printouts). No
  customer colour themes, no white-label for now.
- Brand source: **bellvox.ai** website for now (no brand guide yet).

### UX overhaul
- Chris's complaints: **too many menu items, crowded screens, dated or plain look**, and nothing more specific, so we audit everything.
- Approach: **audit every screen, then mockups of the key screens in the Bellvox style for Ben and Chris to approve, then roll
  out screen by screen.** Ben is researching reference apps to copy patterns from (later).
- Note: the task-first Inventory menu ("What do you want to do?") was built on 11 Nov. The clutter is in the other modules and the
  overall sidebar.

### Invoices
- A general sales invoice (no ETA sending yet), printable and downloadable as PDF.
- **ETA-style printout now**: ETA's layout with all fields, marked "Not yet submitted to ETA". The real ETA ID and QR come when
  sending is switched on.
- **Templates:** each company uploads its **own template: a Word file with placeholders and/or a letterhead image** that we
  print the invoice on. Plus logo, colours and footer settings.
- "Upload an old invoice and AI copies its layout": allowed later, **using the company's own AI account** (see AI below).

### Scanning (all four kinds wanted)
1. Read supplier bills from a photo or PDF into a draft bill (AI reads it, a person checks it).
2. Barcode scanning onto invoices.
3. Scan an invoice's QR code to open it.
4. Scan a paper document and attach it to a record.

### Periods and home tiles
- Every period picker: **presets** (today, 7/30/90/180 days, 12 months, this month, quarter, year, last year), **All time**, and
  **custom from–to**. No "compare to previous".
- Home tiles: **company default (set by owner or admin) plus each person's own changes**, with "reset to default".
- A person can **show, hide and reorder tiles, change each tile's settings** (period, how many, ranking, warehouse, chart or list),
  and **add the same tile twice** with different settings. No resizing.
- **Top products** can rank by **sales value (with % share), quantity sold, profit and margin**.

### Stock value loss and expiry
- Research summary (from general knowledge; not checked against vendor documentation this session): no serious ERP simply wears
  stock down by time. The accounting rule (IAS 2 / Egyptian Accounting Standard 2) is **cost or what it can still sell for,
  whichever is lower**. SAP writes down slow stock by % brackets. Odoo revalues by hand and tracks four expiry dates per batch. Others
  keep a reserve for old stock.
- Decision: a **bracket table** the company can edit (by age, time since last sold, or days until expiry), with a default we ship and
  overrides per item group. **Screen only**: shows "current worth" on tiles and reports and never changes the accounts.

  | Example default: age or time since last sold | Write-down |
  |---|---|
  | 0–6 months | 0% |
  | 6–12 months | 25% |
  | 12–24 months | 50% |
  | 24+ months | 100% |

- Expiry, **already built** (`sql/026`): stock goes out soonest-expiring batch first, expired and quarantined batches are skipped,
  and expired goods can't be received. **To add:** warning days per item or item group (now fixed at 30/60/90), a setup-wizard step for
  it, and an optional near-expiry discount suggestion.
- **Fixed-asset depreciation** (vans, laptops, machines): its own module **on the roadmap, planned later**. Needed for full year-end
  accounts and Egyptian tax depreciation.

### Sample data
- New demo companies: **grocery (fruit and veg)** and **chemicals**, next to the existing Demo Cosmetics Factory.
- A **load-demo button** any company can use.

### Low stock
- **Summary pop-up at sign-in plus live pop-ups** when an item drops below its reorder level.
- Shown **only to people who can reorder**.
- "Remind me later" (1 hour / tomorrow / next week) and "Don't show again" work **per item, per person**. A muted item comes back
  if it hits zero.

### Customisation ("as customisable as possible")
All of these, as settings, never code per customer:
1. Navigation and tiles (hide, reorder, pin; company default plus personal)
2. Rename labels (menu, fields, document names) in English and Arabic
3. Custom fields on items, customers, suppliers and invoices (on screens, filters and printouts)
4. Document numbering formats
5. Approval rules (amounts, multi-step), expanding today's approval policies
6. Table columns and saved views per person
7. Report builder (make your own reports and tiles)
8. Automations ("when X happens, do Y")

### AI and chatbots
- **Every AI feature goes through the company's own ERP account.** Whether we **sell AI credits** or the company **brings its own
  API key** is a business decision, for the business question document.
- Chatbots: a **stronger built-in assistant** plus an **open API with company API keys** so any bot platform can plug in.
- Bots **read and create drafts. A person still approves or posts**, under the same database approval rules. Every bot action is
  audited under the key or person that made it.

### On-prem readiness
- The customer runs **our web server and API server on their own machine, with a local Supabase as the database**, the same way
  Ben runs it on his PC.
- Only **AI and outside integrations** (WhatsApp, payments, couriers, ETA) reach the internet.

### Priorities
- **First, ASAP:** UX and Bellvox look; **invoices**; **scanning**; **low stock**.
- **Then (order to be proposed):** tiles and period pickers, stock value loss and expiry, demo companies, customisation layers, API
  and chatbots, on-prem.

---

### Round 8 answers (Ben, 20 Nov)
- **Invoice language:** Arabic by default (Egypt). Templates may be bilingual for companies with foreign clients.
- **Delivery:** all four: download PDF, WhatsApp, email, print directly.
- **Word placeholders:** a published fixed list **plus the company's custom fields as placeholders**.
- **Changing invoices (ETA rule):** draft = edit freely, prints with a "DRAFT" watermark. **Issued = locked forever.** Fix mistakes by
  credit or debit note. (To check in our ETA reference: ETA's cancellation window after submission.)
- **Scanning:** all four needed. Order: (1) reading supplier bills, (2) barcodes, (3) scan and attach, (4) QR lookup.
  **Phone or laptop camera only for now** (no scanner hardware, labels or scale barcodes yet).
- **Reorder levels (industry standard):** reorder point = average daily use × supplier lead time + safety stock, suggested from
  the existing forecast, accepted or overridden by a person. Reorder quantity tops up to a maximum level. Lead time stored on
  the supplier or item.
- **Low-stock pop-up main button:** "Create purchase order", prefilled with item, supplier and suggested quantity. Needs heavy
  testing.
- **On-prem updates (industry standard):** versioned packages (Docker images). The admin sees "Update available" and approves it. The
  update backs up the database first, runs the new numbered migrations, and can roll back.
- **On-prem = online:** on-prem doesn't mean offline. One install = **one company**. The licence checks with our server now and then,
  with a grace period if the internet drops.

### Round 9 answers (Ben, 20 Nov)
- **UX audit:** Claude may drive a browser against the **live test site** (test data only).
- **Mockups:** built in a **separate worktree with separate preview links**, the same way as the earlier new UI.
- **Menu clutter:** both: **about 6 top-level sections** (Home, Sell, Buy, Stock, Money, Settings), **and** only switched-on modules
  shown, with role-based hiding.
- **Dark mode:** yes, Bellvox light and dark.
- **Tiles:** the company picks its tiles **during setup (onboarding wizard)** and can change them later.
- **Clicking a tile:** opens a **detail view with a chart first**, then the full list.
- **Bug found:** some tiles open the wrong page. In `OwnerHome.tsx` both "Top products" and "Receivables and payables" link to
  `/sales/invoices`. Part of the UX fix list.
- **Demo companies:** the same way as Demo Cosmetics Factory (separate company, same language handling, 12 months of history). The person
  switches between companies.
- **Bill reading AI:** **only with the company's own AI key for now** (no shared key) until the business decides on credits.
- **AI providers:** the company chooses. The ERP must support **OpenAI, Gemini, Claude, Grok, OpenRouter and online Ollama**. Today
  only OpenAI, Ollama and ElevenLabs (speech) are wired in.
- **Who customises:** the **owner gives permissions**. A "customise" permission the owner can grant to anyone.
- **Document numbering (Claude's recommendation, Ben had no preference):** per document type **and year, restarting each year**
  (`INV-2026-00001`). Prefix editable by the owner. An optional branch code can be switched on later.

### Round 10 answers (Ben, 20 Nov)
- **API keys:** belong to the **company**, with permissions chosen per key. **Only admins can create keys.**
- **MCP connector (Claude or ChatGPT plugging in directly): is it secure?** Claude's answer: **yes, if built this way**, otherwise no.
  - Each person signs in with **their own account** (OAuth). No shared company key inside the chat app. The bot sees exactly what that
    person may see; the database checks it again (row level security, as today).
  - It is a thin layer over the same open API. **No approve or post tools.** Bots read and create drafts only (round 6 decision).
  - Every call is audited under the person and marked "via AI connector". Rate limits apply. The owner can switch the connector off.
  - The real risk is **prompt injection**: text inside a document (for example a supplier's PDF) tells the AI to do something. Because
    the connector can only make drafts that a person still approves, the damage stays limited.
  - **Verdict:** offer it after the open API, built on the API, drafts only.
- **Custom fields** (Ben asked what this means): the company adds its **own boxes** to screens without us writing code. Examples:
  "Truck number" on a delivery, "Sales rep" on an invoice, "Hazard class" on a chemical item, "Customer's commercial register number".
  Still to decide: which **kinds** of box (text, number, date, dropdown, link to a person, photo) and whether a box can be **required**.
- **Automations:** all four actions (messages, tasks, drafts, change a field), as an **n8n-style visual workflow builder**.
  Licence check (20 Nov, GitHub):

  | Project | Licence | Can we use it in a product we sell? |
  |---|---|---|
  | n8n | "Sustainable Use" (fair-code, from general knowledge; GitHub didn't respond) | **No**: forbids embedding in a commercial product |
  | Windmill, Automatisch | AGPL (from general knowledge; GitHub shows "other") | **No**: our rules forbid GPL/AGPL code |
  | **Activepieces** | **MIT**, except its `ee` folders (commercial) | Yes for the MIT parts, but it's a whole separate platform (heavy, and doubles on-prem setup) |
  | **xyflow / React Flow** | **MIT** | Yes: the drag-and-drop canvas used by most workflow builders |
  | Node-RED, Trigger.dev, Kestra | Apache-2.0 | Yes, but they're separate servers, not a builder inside our app |

  **Claude's recommendation:** build the canvas with **React Flow (MIT)**, run workflows on our existing outbox and jobs (we already
  have WhatsApp, email and tasks), and study Activepieces' *behaviour* for ideas (copy nothing from its `ee` folders). Clone a repo to the
  Desktop only when building starts, if needed.
- **Automations may post or approve if the owner allows it.** ⚠ This changes a **non-negotiable rule** in `agents.md` (approvals:
  requester ≠ approver). It needs a written exception like D1c: off by default, owner-only switch, the automation acts **as the owner who
  switched it on**, each decision flagged and audited, and never approving something that same owner requested.
- **Report builder:** **simple version first** (pick a list, filters, columns, group and total, chart, save as report or tile). A deeper
  version (formulas, data joined across modules) planned **after customer feedback**.
- **Report export:** Excel, PDF, and scheduled email or WhatsApp.
- **Plan split:** ordered by **ease and speed of building**.
- **Business question document:** for **Grant** (most probably).

### Round 11 answers (Ben, 20 Nov)
- **Custom fields:** all kinds: text, number, date, yes/no, dropdown, link to a person or customer, photo or file. **The owner can make a field
  required.**
- **Automations: drafts and messages only.** No posting or approving. The approval exception above is **dropped**, so the agents.md
  rule stays as it is.
- **Grant document:** English, detailed (with the "what Chris is seeing" context).
- **Next:** write the plans in a git worktree.

## 3. Open decisions found in the repo that touch this meeting

| # | Open item | Where | Note |
|---|---|---|---|
| 1 | Product name and branding (was "TBD") | `plans/TECHNICAL_PLAN.md` §10.6 | Now "Bellvox ERP" for now; update the plan when this becomes a plan. |
| 2 | Integrations plan: a draft, never approved | `plans/INTEGRATIONS_PLAN.md` | Open API and chatbots would live here or in a new plan. Ben hasn't read it yet. |
| 3 | When ETA sending goes live | `plans/TECHNICAL_PLAN.md` §12 / ADR-0005 | ETA layout now; going live is a business decision. |
| 4 | Hosting region and where data lives | `plans/TECHNICAL_PLAN.md` §10.7 | Tied to on-prem. |
| 5 | Owner insights plan still marked "Draft" although the cards are built | `plans/OWNER_INSIGHTS_PLAN.md` | Replaced by the new customisable tiles plan. |
| 6 | WhatsApp provider; voice vendor | `plans/TECHNICAL_PLAN.md` §10.3, §10.5 | Bellvox may be the answer. |
| 7 | Payment gateway and which company bills | `plans/TECHNICAL_PLAN.md` §10.4 | Needed if we sell AI credits. |
| 8 | Support model for the first 10 customers | `plans/TECHNICAL_PLAN.md` §10.8 | Sales question. |

Smaller loose ends:
- Customer `tax_number` vs e-invoicing `tax_id` (WORKLOG, 11 Nov).
- Arabic machine drafts still need a native speaker's review.
- Bell notifications for low stock and overdue invoices have no link (fits the low-stock work).

---

## 4. Business question document (to prepare)

Earlier Ben asked for a separate document of questions he will send to the business side (Ben has technical authority; these are
business decisions). Questions collected so far:
- Sell AI credits, or each company brings its own AI key (or both)?
- When does ETA sending go live?
- Bellvox brand guide (colours, fonts, logo files).
- Hosting region and pricing for on-prem customers.
- WhatsApp and voice: does Bellvox provide them?
- Which company bills customers, and through which payment gateway?
- Support model for the first customers.

---

## 5. Still to discuss
Done. The open questions left are listed at the end of each plan and in the Grant document.
