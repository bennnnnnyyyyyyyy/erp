# Bellvox ERP readiness roadmap

**Status:** `[📝 Draft, awaiting Ben's approval]`
**Owner:** Ben · **Source:** Bellvox meeting with Chris, 20 Nov 2026, and the discussion that followed
([discussion notes](../planning/2026-11-20-bellvox-meeting-discussion.md)) · **Business questions:** [for Grant](../planning/2026-11-20-grant-business-questions.md)

---

## 1. Why

Chris looked at the ERP as a buyer and found it hard to sell: the UX is messy, it doesn't look like a Bellvox product, and the
things buyers ask for first (invoices on their own letterhead, scanning, alerts, AI, "can it fit us?") are missing or hidden. The
engine (approvals enforced in the database, stock ledger, VAT, statements) is not in question. This roadmap covers the
**packaging**: how the product looks, how well it demos, and what it does first.

Product name: **"Bellvox ERP"** for now (replaces "TBD" in [TECHNICAL_PLAN](TECHNICAL_PLAN.md) §10.6). App look: Bellvox colours
and font for every customer; each company adds its own logo and name.

## 2. Order

Ben's rule: **UX and Bellvox look, invoices, scanning and low stock first, ASAP**; then everything else **by ease and speed of
building**. Inside each phase, the quickest items come first.

| Phase | Work | Plan | Why here |
|---|---|---|---|
| **0. Quick fixes** | Wrong tile links (Top products and Receivables both open `/sales/invoices`); bell notifications for low stock and overdue invoices that open nothing | [UX_BRAND_PLAN](UX_BRAND_PLAN.md) §7 | Hours of work, visible in every demo |
| **1a. Low stock** | Sign-in summary and live pop-up; snooze or mute per item, per person; "Create purchase order"; suggested reorder points | [LOW_STOCK_AND_EXPIRY_PLAN](LOW_STOCK_AND_EXPIRY_PLAN.md) part A | Most of the data exists (reorder levels, forecast, alerts, bell) |
| **1b. UX audit + Bellvox look** | Screen-by-screen audit on live; Bellvox design tokens (light and dark); about 6 top-level sections; mockups in a worktree with preview links; approval; rollout | [UX_BRAND_PLAN](UX_BRAND_PLAN.md) | Every later screen is then built in the new look |
| **1c. Invoice printing** | Arabic print and PDF; draft watermark; company logo, letterhead image, footer; ETA-style layout marked "Not yet submitted"; numbering per type and year; WhatsApp, email and direct print | [INVOICE_PRINTING_PLAN](INVOICE_PRINTING_PLAN.md) | "Show me an invoice" is the first demo question |
| **1d. Scanning** | Multi-provider AI with the company's own key; supplier bill reading; camera barcodes; scan and attach; QR lookup | [SCANNING_PLAN](SCANNING_PLAN.md) | Needs the company AI key work, which the open API and chatbots reuse later |
| **1e. Word templates** | Company uploads a .docx with placeholders (fixed list plus custom fields); filled and converted to PDF | [INVOICE_PRINTING_PLAN](INVOICE_PRINTING_PLAN.md) §3.4 | Needs a document conversion service (see that plan), so it follows the simpler letterhead path |
| **2a. Period pickers** | Presets, All time, custom from–to on every screen with a period | Roadmap §3.1 (plan to write) | Small and shared by all of 2b |
| **2b. Customisable home tiles** | Tile library, company default plus personal, per-tile settings, the same tile twice, chosen during setup, detail view with chart | Roadmap §3.2 (plan to write) | Builds on 2a |
| **2c. Expiry and stock value** | Warning days per item group, setup-wizard step, optional discount suggestion; value-loss bracket table (screen only) | [LOW_STOCK_AND_EXPIRY_PLAN](LOW_STOCK_AND_EXPIRY_PLAN.md) parts B and C | Batches and FEFO already exist (`sql/026`) |
| **2d. Demo companies** | Grocery (fruit and veg) and chemicals, beside Demo Cosmetics Factory; load-demo button | Roadmap §3.3 (plan to write) | Uses 2b and 2c to look real |
| **3a. Customisation layers** | Renamed labels, custom fields (all kinds, can be required), document numbering formats, columns and saved views, approval rules | Roadmap §3.4 (plan to write) | Bigger; custom fields also feed Word placeholders |
| **3b. Open API and chatbots** | Company API keys (admins only, permissions per key); read and draft only; stronger built-in assistant; MCP connector after the API | Roadmap §3.5 (plan to write; fold in or replace the draft [INTEGRATIONS_PLAN](INTEGRATIONS_PLAN.md)) | Reuses the AI provider layer from 1d |
| **3c. Simple report builder** | Pick a list, filters, columns, group and total, chart, save as report or tile; export Excel, PDF, scheduled email or WhatsApp | Roadmap §3.6 (plan to write) | Deeper version (formulas, joins) only after customer feedback |
| **3d. Workflow builder** | n8n-style canvas: messages, tasks, drafts, field changes. **Never posts or approves** | Roadmap §3.7 (plan to write) | Largest item |
| **3e. On-prem, steps 2+** | Run the Docker package on a Linux server, update packages with backup and rollback, licence check with grace period | [on-prem plan](../planning/2026-11-19-on-prem-deployment-plan.md) | Step 1 done 19 Nov; waiting on a test server |
| **Later** | Fixed-asset depreciation module; deeper report builder; barcode label printing, USB scanners, weighing-scale barcodes | Own plans later | Agreed on 20 Nov to plan later |

## 3. Areas not yet given their own plan (decisions already taken)

### 3.1 Period pickers
Every screen or tile with a period offers: **presets** (today, 7, 30, 90 and 180 days, 12 months, this month, this quarter, this year,
last year), **All time**, and **custom from–to**. No "compare to previous". Fixed windows in today's code to replace: Top products
(90 days), Profit and loss and Main suppliers (12 months), Forecast (90 days of usage), Batches (30/60/90 days). Expiry windows become
settings (part B of the low-stock plan), not pickers.

### 3.2 Home tiles
- **Company default** set by an owner (or whoever the owner gives the "customise" permission), **plus each person's own changes**,
  with "reset to default". Stored in `user_preferences` (personal) and a new company-level setting (default).
- A person can **show, hide and reorder** tiles, **change each tile's settings** (period, how many, ranking, warehouse, chart or
  list), and **add the same tile twice** with different settings. No resizing.
- **Chosen during setup** (onboarding wizard step), changeable later.
- **Clicking a tile** opens a detail view with a chart first, then the full list.
- Starting library: sales, top and bottom products (by **sales value with % share, quantity, profit and margin**), cash and bank,
  receivables and payables, low stock, expiry and stock value, pending approvals, main suppliers and customers, profit and loss,
  VAT due, tasks.

### 3.3 Demo companies
Grocery (fruit and veg: short expiry, sold by weight, fast turnover) and chemicals (long expiry, hazard notes, drums and litres),
built **the same way as Demo Cosmetics Factory**: separate companies, 12 months of history, switched between like any company.
"Load demo company" is open to any company.

### 3.4 Customisation layers
All are settings; nothing is written as code for one customer. The **owner gives permissions** (a new customise permission).
1. Navigation and tiles (hide, reorder, pin; company default plus personal).
2. Rename labels (menu, fields, document names), English and Arabic.
3. Custom fields on items, customers, suppliers and invoices: text, number, date, yes/no, dropdown, link to a person or customer,
   photo or file. **The owner can make a field required.** Shown on screens, filters and printouts; usable as Word placeholders.
4. Document numbering: per type **and year, restarting each year** (`INV-2026-00001`), prefix editable, optional branch code later.
5. Approval rules: amounts and multi-step, expanding today's approval policies. The database rule (requester ≠ approver, D1/D1b/D1c
   exceptions only) is unchanged.
6. Columns and saved views per person.

### 3.5 Open API, AI providers and chatbots
- **Company API keys**, created by **admins only**, with permissions chosen per key. Bots **read and create drafts**; a person
  approves or posts through the same database functions. Every call is audited under the key ("via API key <name>").
- **AI providers:** the company chooses and brings its own key: **OpenAI, Gemini, Claude, Grok, OpenRouter, online Ollama**.
  Whether we also sell credits is a business question for Grant. Today only OpenAI, Ollama and ElevenLabs (speech) are wired in.
- **Built-in assistant:** answers across all modules, Arabic voice.
- **MCP connector** (Claude, ChatGPT and others plug in directly), **after** the API: each person signs in with their own account
  (OAuth), no approve or post tools, audited "via AI connector", rate limited, owner can switch it off. Main risk is prompt injection
  from document text; drafts-only keeps the damage small.

### 3.6 Report builder
Simple version first (list, filters, columns, group and total, chart, save as report or tile). Exports: Excel, PDF, scheduled email or
WhatsApp. Formulas and joins across modules only after feedback on the simple version.

### 3.7 Workflow builder
Visual "when X happens, do Y" canvas. Actions: send WhatsApp, email or in-app message; create a task; create a draft; change a field.
**Never posts or approves** (Ben, 20 Nov: the exception was considered and dropped). Licence check (20 Nov):

| Project | Licence | Usable in a product we sell? |
|---|---|---|
| n8n | "Sustainable Use" (general knowledge; GitHub didn't respond) | No |
| Windmill, Automatisch | AGPL (general knowledge; GitHub shows "other") | No (our licensing rule) |
| Activepieces | MIT, except its `ee` folders (read from its LICENSE) | MIT parts yes, but it's a whole separate platform |
| xyflow / React Flow | MIT | Yes: the canvas |
| Node-RED, Trigger.dev, Kestra | Apache-2.0 | Yes, but separate servers |

Recommendation: React Flow canvas, run on our existing outbox and jobs, study Activepieces' behaviour only. Adding React Flow is a new
dependency: Ben installs it in the main checkout (never `npm install` in a worktree).

### 3.8 On-prem
One install = one company. The customer's own server runs our web and API with a local Supabase. **Online**: only AI and outside
integrations (WhatsApp, payments, couriers, ETA) leave the server. Updates follow common practice: versioned packages; the admin
approves; database backup first, then numbered migrations, with rollback. Licence checks our server now and then, with a grace period.

## 4. Rules that stay

- Every new business table: `org_id`, row level security, isolation tests, `revoke all` then `grant select`, writes through
  database functions, audit rows in the same transaction.
- Nothing customer-specific in code. Bellvox is the product's own look, not a customer's.
- Arabic and English for every new string; logical CSS properties.
- Approvals, including anything made by an API key, bot, scanner or workflow: drafts only, and a person approves.

## 5. Open questions

Business questions are in the [Grant document](../planning/2026-11-20-grant-business-questions.md). Technical questions are listed
in each plan.
