Meeting Notes - 11/2
titles : for each tile it needs a title

Guide > show people how to navigate

ETA needed (when am i going to demo, finilize ) the project

AI Embedding > when is it going to be done ( model agonistic api )

General Openai / Chatgpt API

Scenarios > how is the erp gonna help the company  
how are competitor erps helping them, what are they missing    
where do we come in and the features we are making to make that happen

do

Listing deliverables for the meeting tasks, including the demo and guide
Here’s all of it, in the order of your notes.

1. ETA (demo and finalize)

“Working demo on sample data, rehearsed, by Wednesday end of day (Thursday at the latest). Pilot-ready with one real company in about 8-10 weeks, depending on the Meta account, management decisions and an Arabic reviewer.”

2. AI embedding, model-agnostic, OpenAI/ChatGPT API

Status: designed, not built. The plan has speech-to-text, the language model and text-to-speech as swappable adapters, and the demo uses browser speech with no keys. No OpenAI or embedding code exists yet.
Model-agnostic: one small interface in the API (“send this prompt, get text or a tool call”, “turn this text into a vector”). OpenAI is the first provider behind it, and the model name and key live in settings, so swapping providers is a config change. The key is a Worker secret, never in code.
First uses: the voice and chat assistant (a fixed list of approved actions: check stock, create a request, approve, create a task, with read-back), and embeddings for searching items and documents by meaning, in Arabic and English.
My estimate, once you decide the provider and budget and give me a key: the adapter plus a first embedding search in about 1-2 weeks, and the assistant with tool-calling about 3 weeks after that. Voice calls and WhatsApp voice come later.
Decision for management: sending company data to OpenAI. Say what goes out (item names and quantities, not customer personal data) and get a yes. 3. Scenarios: how the ERP helps, what competitors miss, where we come in

How it helps the (sample) cosmetics factory

The owner sees in ten seconds whether the month is profit or loss, what is owed, and which decisions are waiting.
Stock leaves only with a manager’s approval, and every move is recorded in a log nobody can edit.
Expiry and forecast alerts stop wasted batches and stock-outs. Overdue invoices are visible.
What competitors do, and miss (my research, public sources plus trials):

Odoo: no stock approval by default, and an Enterprise admin can add one through Studio. The Approvals app isn’t linked to stock. It has a WhatsApp app, but I found no reply-to-approve.
Zoho: a real approval gate for transfers and adjustments (docs), notified by email and in-app, and nothing chases slow approvers.
NetSuite: no native approval for inventory transfers or adjustments; expensive.
Daftra: manual stock-out is accepted directly; stock requests do have approval; WhatsApp goes to customers.
Wafeq: stock tracking only on the top plan. ERPNext: workflows are optional and off by default.
Common gap: none found sends WhatsApp or voice approvals to warehouse staff, chases slow approvers, or lets staff complete tasks by voice.
Where we come in: approval built into the stock transaction, an append-only audit log, owner-first dashboards, expiry and forecast, and next, approval and task assignment over WhatsApp and voice, with identity checks. Say clearly which of these are built and which are planned.

4. Tiles need titles, and a navigation guide (for Claude Code)

Two UI tasks, no commits, no new features:
(1) Every home-page tile/card (owner home, Profit overview, apps grid, Alerts) needs a visible title, a one-line plain-words subtitle, and a period/date where it shows a figure. List any tile without one, then add them. Verify with typecheck and the build; tell me which ones I must check in a browser.
(2) Add a "Guide" page, visible in every organization including the sample company (not only new ones). It should show how to navigate: where each app is, the five-step demo path (home, request, approve, audit log, forecast), and what is not ready yet. Reuse the Getting started tutorial component if possible.
Report in under 15 lines: done / not verified.
What’s still open: I’d rather not put the competitor wording in front of management until Zoho’s gate and Odoo’s restricted-user results are hands-on. Keep the “docs-based” label on those two lines.
--

New work stream, in a worktree, NOT deployed before the Wednesday demo and not touching the demo path. No commits. No secrets in code or docs. Existing tests must keep passing.

Goal: make the ERP able to issue Egyptian Tax Authority (ETA) e-invoices (B2B invoices, credit and debit notes; e-receipts are out of scope).

Step 1, plan only (documentation/plans/ETA_EINVOICING_PLAN.md, use MODULE_PLAN_TEMPLATE.md):

- Read the official SDK at sdk.invoicing.eta.gov.eg (API, Types, Codes, document structure, signature creation, FAQ, error codes). If you cannot reach it, say so and list the exact pages I should paste. Do not rely on third-party SDKs for the rules; label anything from them "unverified".
- Cover: required document fields; tax types and rates (VAT, table tax, withholding); taxpayer, branch and activity data; customer tax/national ID; item codes (GS1 and EGS) and unit codes; credit and debit notes referencing the original invoice UUID; OAuth login with per-company Client ID and secrets; submission, status polling, retries, cancel/reject; the signing step (CAdES-BES over the canonical document) and the options for a cloud app (signing service, HSM, local signing agent); per-company encrypted credential storage; test (preprod) vs production environments.
- Say what already fits our design (outbox, audit log, approvals) and what is new.
- Give a slice order with sizes, and what I must provide (ETA preprod access, signing choice, pilot company data).

Step 2, only after I approve the plan: slice A, prerequisites that do not need ETA access: tax rates and tax data on invoices, credit and debit notes (with approval policy and audit), item and unit code fields, customer tax IDs. Migrations rerun-safe with SQL tests, API and screens. Do not build the ETA submission yet.

Report in under 20 lines: done, tested, not verified, what I must do.
