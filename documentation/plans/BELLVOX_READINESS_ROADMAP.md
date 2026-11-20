# Bellvox ERP readiness roadmap

**Status:** Draft. Ben must approve it.
**Owner:** Ben
**Source:** the meeting with Chris (Bellvox) on 20 Nov 2026, and the discussion after it.
**Read also:** [discussion notes](../planning/2026-11-20-bellvox-meeting-discussion.md) ·
[questions for Grant](../planning/2026-11-20-grant-business-questions.md)

> **In short**
> - Chris says the ERP is not ready to sell. The engine is good. The look and the first impression are not.
> - We do four things first: **low stock alerts, a new Bellvox look, invoice printing, and scanning.**
> - After that, we do the other work in order of how fast it is to build.
> - The product name is **"Bellvox ERP"** for now.

---

## 1. Why we do this

Chris looked at the ERP as a buyer. He saw these problems:

- The screens look messy. The menu has too many items.
- The app does not look like a Bellvox product.
- Buyers ask for some things first. Many of these are missing:
  - invoices on their own letterhead
  - scanning
  - alerts
  - AI
  - a way to change the ERP to fit their business

The core of the ERP is strong. Approvals, the stock ledger, VAT and statements all work. This roadmap is about the **packaging**.

## 2. The order of work

**Ben's rule:** do the four urgent items first. Then do the rest in order of speed and ease.

### Phase 0: quick fixes (hours)
- Two home tiles open the wrong page. "Top products" and "Receivables and payables" both open the sales invoices page.
- Some bell notifications open nothing. Low stock and overdue invoice notifications have no link.
- Plan: [UX and brand plan](UX_BRAND_PLAN.md), part "Quick fixes".

### Phase 1: the urgent four

| Step | What | Plan |
|---|---|---|
| 1a | **Low stock alerts.** A pop-up shows low items. One click makes a draft purchase order. | [Low stock and expiry plan](LOW_STOCK_AND_EXPIRY_PLAN.md), part A |
| 1b | **New Bellvox look.** Check every screen. Make mockups. Get approval. Then change the screens. | [UX and brand plan](UX_BRAND_PLAN.md) |
| 1c | **Invoice printing.** Arabic print and PDF. Company logo and letterhead. ETA layout. Send by WhatsApp or email. | [Invoice printing plan](INVOICE_PRINTING_PLAN.md) |
| 1d | **Scanning.** Read supplier bills with AI. Scan barcodes with the phone camera. Attach photos. Scan QR codes. | [Scanning plan](SCANNING_PLAN.md) |
| 1e | **Word templates.** A company uploads its own Word invoice. The ERP fills it in. | [Invoice printing plan](INVOICE_PRINTING_PLAN.md), part "Word templates" |

Why low stock is first: most parts already exist. The ERP already has reorder levels, a forecast, alert rules and a bell.

Why the new look is early: we then build every new screen in the new look. We do not build screens twice.

### Phase 2: medium work

| Step | What | Plan |
|---|---|---|
| 2a | **Date range pickers.** Every period gets presets, "All time", and "from–to". | Section 3.1 below |
| 2b | **Home tiles you can change.** | Section 3.2 below |
| 2c | **Expiry warnings and stock value.** | [Low stock and expiry plan](LOW_STOCK_AND_EXPIRY_PLAN.md), parts B and C |
| 2d | **Demo companies.** A grocery and a chemicals company. | Section 3.3 below |

### Phase 3: large work

| Step | What | Plan |
|---|---|---|
| 3a | **Customisation tools.** Rename labels, add fields, set numbering, save views, set approval rules. | Section 3.4 below |
| 3b | **Open API and chatbots.** | Section 3.5 below |
| 3c | **Report builder** (simple version). | Section 3.6 below |
| 3d | **Workflow builder** ("when X happens, do Y"). | Section 3.7 below |
| 3e | **On-prem, step 2 and later.** | [On-prem plan](../planning/2026-11-19-on-prem-deployment-plan.md) |

### Later (plan these after the work above)
- Fixed-asset depreciation (vans, laptops, machines). This is a new module.
- A deeper report builder.
- USB barcode scanners, barcode labels, and barcodes from weighing scales.

## 3. Decisions for areas that do not have their own plan yet

### 3.1 Date range pickers
Each screen or tile with a time period gets the same picker. It has three kinds of choice:

1. **Presets:** today, 7 days, 30 days, 90 days, 180 days, 12 months, this month, this quarter, this year, last year.
2. **All time.**
3. **From–to:** the person picks two dates.

There is no "compare to the previous period".

These screens have a fixed period today. We change them:
- Top products: 90 days.
- Profit and loss: 12 months.
- Main suppliers: 12 months.
- Forecast: 90 days of use.

Expiry windows (30, 60 and 90 days) become a setting, not a picker. See the low stock plan, part B.

### 3.2 Home tiles
- The **owner sets a default home page** for the company.
- **Each person can change it** for themselves. A button resets it to the company default.
- A person can:
  - show or hide tiles
  - put tiles in a different order
  - change the settings of each tile, for example the period, how many rows, how to rank, the warehouse, and chart or list
  - add the same tile two times with different settings
- A person **cannot** change the size of a tile.
- The company picks its tiles **during the setup wizard**. It can change them later.
- A click on a tile opens a **detail view with a chart**. From there, the person can open the full list.

The first set of tiles:
- sales
- top or bottom products
- cash and bank
- money owed to us and money we owe
- low stock
- expiry and stock value
- approvals that wait
- main suppliers and customers
- profit and loss
- VAT due
- tasks

**Top products** can rank by sales value (with % of total), by quantity, or by profit and margin.

### 3.3 Demo companies
- We add two demo companies:
  - **Grocery (fruit and vegetables):** short expiry, sold by weight, fast sales.
  - **Chemicals:** long expiry, hazard notes, drums and litres, slower sales.
- We build them the same way as "Demo Cosmetics Factory". Each one is a separate company with 12 months of history.
- Any company can use a **"Load demo company"** button.

### 3.4 Customisation tools
These are settings. We never write code for one customer.
The **owner gives the permission** to change them.

1. **Menu and tiles:** hide, reorder and pin items.
2. **Labels:** rename menu items, fields and document names, in English and Arabic.
3. **Custom fields:** the company adds its own fields to items, customers, suppliers and invoices.
   - Kinds: text, number, date, yes/no, dropdown, link to a person or customer, photo or file.
   - The owner can make a field **required**.
   - The fields show on screens, filters and printouts. They also work in Word templates.
4. **Document numbers:** one sequence for each document type and year. It starts again each year, for example `INV-2026-00001`.
   The owner can change the prefix. A branch code can come later.
5. **Approval rules:** amounts and approvals in more than one step. The database rule stays the same: a person cannot approve
   their own request. The only exceptions are the ones that already exist (D1, D1b, D1c).
6. **Columns and saved views:** each person picks the columns and filters on a list and saves them.

### 3.5 Open API, AI and chatbots
- **API keys** belong to the company. Only **admins** can make them. Each key has its own permissions.
- A bot can **read data and make drafts**. A person must still approve or post.
- The audit log records every action of a key.
- **AI providers:** the company picks one and gives its own key. Supported: OpenAI, Gemini, Claude, Grok, OpenRouter and online Ollama.
  Today only OpenAI, Ollama and ElevenLabs work.
- Will we also sell AI credits? Grant decides. See the questions for Grant.
- **Built-in assistant:** it answers questions about all modules. It also understands Arabic voice.
- **MCP connector:** with it, Claude or ChatGPT connects directly to the ERP. We build it **after** the API.
  - Each person signs in with their own account.
  - It cannot approve or post.
  - It is audited and rate limited.
  - The owner can turn it off.
  - The main risk: text inside a document can try to trick the AI. Because the AI can only make drafts, the damage stays small.

### 3.6 Report builder
- **First version:** pick a list. Add filters and columns. Group and total. Add a chart. Save it as a report or as a tile.
- **Export:** Excel, PDF, and email or WhatsApp on a schedule.
- **Later**, after customers give feedback: formulas, and data from more than one module.

### 3.7 Workflow builder
- A drag-and-drop canvas: "when X happens, do Y".
- Actions:
  - send a WhatsApp, email or in-app message
  - make a task
  - make a draft
  - change a field
- **It never posts and never approves.** Ben decided this on 20 Nov.

**Which code can we use?** We checked the licences on GitHub on 20 Nov:

| Project | Can we use it? | Why |
|---|---|---|
| n8n | No | Its licence does not allow it inside a product we sell. |
| Windmill, Automatisch | No | AGPL. Our rules do not allow GPL or AGPL code. |
| Activepieces | Partly | MIT, except its `ee` folders. But it is a full separate platform. |
| React Flow | **Yes** | MIT. It gives us the drag-and-drop canvas. |
| Node-RED, Trigger.dev, Kestra | Yes, but | Apache-2.0. Each is a separate server, not a part of our app. |

**Recommendation:** use React Flow for the canvas. Run the workflows on our existing message queue and jobs.
Look at Activepieces only for ideas. Do not copy its code.
Ben must install React Flow in the main folder. Never run `npm install` in a worktree.

### 3.8 On-prem
- One install is for one company.
- The customer's server runs our web app, our API, and a local Supabase database.
- The server **is online.** Only AI and outside services use the internet. Outside services are WhatsApp, payments, couriers and ETA.
- **Updates:**
  1. We publish a new version.
  2. The customer's admin sees "Update available" and approves it.
  3. The update makes a database backup first.
  4. Then it runs the new database changes.
  5. If something fails, it goes back to the old version.
- The licence checks our server from time to time. If the internet stops, the ERP works for a grace period.
- Step 1 is done (19 Nov). We need a Linux test server for step 2.

## 4. Rules that do not change

- Every new business table has `org_id` and row level security. It has tests that show one company cannot see another company's data.
- Writes go through database functions. Each change writes an audit row in the same step.
- We put nothing customer-specific in code. Bellvox is our product's look. It is not a customer's look.
- Every new text has English and Arabic.
- Bots, scanners, API keys and workflows only make drafts. A person approves.

## 5. Open questions

- Business questions: see the [questions for Grant](../planning/2026-11-20-grant-business-questions.md).
- Technical questions: see the end of each plan.
