# Invoice printing, PDF and templates plan

**Module:** `sales` (we add to it). Templates are a `core` setting, so other documents can use them later.
**Status:** Approved by Ben 23 Nov 2026 (Bellvox roadmap, Track B). Step 1c built on branch `feat/invoice-printing` (`sql/103`, not applied). Step 1e (Word templates) not built.
**Owner:** Ben
**Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md), steps 1c and 1e
**Related plans:** [Customer invoices](CUSTOMER_INVOICES_PLAN.md) · [ETA e-invoicing](ETA_EINVOICING_PLAN.md)

> **In short**
> - A company prints its invoice in **Arabic**, with its **own logo or letterhead**. It downloads a PDF or sends it by WhatsApp or email.
> - It can also print the **ETA layout** now. The layout says "Not yet submitted to ETA".
> - Later, a company can upload its **own Word template**.
> - To make PDFs with correct Arabic, we need a small converter service called **Gotenberg** (free, MIT licence).
> - Section 11 explains **how to test ETA without its portal.**

---

## 1. Goal

A company gives its customer an invoice the way it does today. The invoice is in Arabic, on the company's own paper design.
It can be a PDF, a WhatsApp message, an email or a printed page.

The ETA layout works now. Later we turn on sending to ETA. Then the only change is the real ETA number and QR code.

## 2. What we build

### Step 1c (first)

1. **Print view** for customer invoices, credit notes and debit notes.
   - Arabic is the default.
   - A template can also be in two languages, for companies with foreign customers.
2. **Draft and issued**
   - A **draft** can change. Its printout has a large "DRAFT" mark.
   - An **issued** invoice is **locked forever**.
   - To fix a mistake, make a credit note or a debit note. This is the ETA rule. It is also our audit rule.
   - To check: how many days ETA allows to cancel an invoice after we send it.
3. **Company branding**
   - Logo, name, tax number, address, footer text, bank details and payment terms.
   - **Letterhead image:** PNG, JPG or a one-page PDF. It is the page background.
   - The company sets top and bottom margins, so the table fits inside the letterhead.
4. **Built-in layouts**
   - **Simple.**
   - **Detailed,** with VAT on each line.
   - **ETA layout.** It has all the ETA fields: the tax data of both companies, activity code, item codes, tax types and totals.
     It says **"Not yet submitted to ETA"**. The QR area stays empty until we send the invoice to ETA.
5. **Ways to send**
   - Download as PDF.
   - Print (the browser print window).
   - Send by **WhatsApp**.
   - Send by **email**.
   - WhatsApp and email use the message queue that already exists.
6. **Audit**
   - Each send writes an audit row: who sent it, to whom, by which channel, and which PDF.

### Step 1e (after 1c): Word templates

1. A company uploads a `.docx` file with **placeholders**, for example `{customer_name}`.
2. The ERP fills in the placeholders and makes a PDF.
3. Placeholders: a **fixed list we publish**, plus **every custom field** of the company (custom fields come later, in roadmap step 3a).
4. A company can set a template as the default for each document type.
5. **Template check on upload:**
   - It lists placeholders that the ERP does not know.
   - It shows a preview with the latest invoice.

### Not now
- AI that copies the layout of an old invoice. It uses the company's own AI key. It comes after scanning.
- Templates for quotations, delivery notes and receipts. They use the same tools. We add them one by one.
- A drag-and-drop template designer. Not planned.

### Never
- Changing an issued invoice.

## 3. How it works

### 3.1 Making the print and the PDF
- We make each built-in layout as an HTML page. It is our own code, right-to-left, for Arabic.
- **Print:** the browser prints the page. This needs no server and no new package.
- **PDF file:** for download, WhatsApp and email. A converter turns the HTML into a PDF.
  - We use **Gotenberg**. It is free (MIT licence; checked on GitHub, 20 Nov).
  - It runs Chromium inside. Chromium shows Arabic correctly.
  - Simple PDF libraries (for example pdf-lib) do not join Arabic letters correctly. So we do not use them.

**Where Gotenberg runs**
- **On-prem:** one more container in the customer's Docker setup (`scripts/onprem/`).
- **Cloud:** one small container that we host. We must decide where (see section 12).
- Our API calls it over HTTPS with a secret.
- It only converts files. It never reads the database. It keeps no files.

### 3.2 Invoice numbers
- Invoices keep their numbers as they are today.
- The new format (`INV-2026-00001`, new sequence each year) comes with the customisation tools (roadmap step 3a).
- The printout shows the number the invoice has.

### 3.3 The ETA layout
- It uses the ETA data that is already in the database (`sql/036`): tax profiles, branches, ETA units and tax types.
- It uses the same document builder as ETA sending. So the printout and the later ETA submission have **the same numbers**.
- Totals follow ETA's own maths rules. So a printed invoice never disagrees with ETA.
- If data is missing, the ETA layout does not print. It lists what is missing, for example:
  - the company tax number
  - the activity code
  - the customer tax ID (for business customers)
  - item codes

### 3.4 Word templates
- **Placeholders** look like this:
  - `{customer_name}`, `{invoice_number}`, `{total}`
  - `{#lines}` … `{/lines}` for the table of lines
  - `{cf.truck_number}` for a custom field
- **Filling in the template.** Two choices:
  - **docxtemplater.** Its licence did not show on GitHub. Before we use it, check that we use the MIT version, not GPL and not a paid part.
  - **Our own code.** A `.docx` file is a zip of XML files. The browser and the Worker can unzip it with no new package.
- **A known problem:** Word sometimes splits a typed placeholder into pieces inside the file. The template check finds this.
- **Converting to PDF:** Gotenberg can also convert Word to PDF (it uses LibreOffice). Same service as 3.1.
- **Storage:** templates go in Supabase Storage, in one folder for each company. Only that company can read its folder.

## 4. Database changes

**Migration number:** the next free number when we build. (The HR app work uses 102 and test 099.)

**New table: `core_doc_templates`** (the templates of a company)

| Column | Meaning |
|---|---|
| `org_id` | The company. |
| `doc_type` | For example sales invoice or credit note. |
| `kind` | Built-in, letterhead or Word file. |
| `layout` | Simple, detailed or ETA. |
| `language` | Arabic, English or both. |
| `file_path` | Where the uploaded file is. |
| `margins` | Top and bottom margins for a letterhead. |
| `is_default` | Only one default for each document type. |
| `deleted_at` | Soft delete. |

**New table: `core_doc_sends`** (a record of each send; rows are never changed)

| Column | Meaning |
|---|---|
| `org_id`, `doc_type`, `doc_id` | Which document. |
| `channel` | WhatsApp, email, download or print. |
| `recipient` | To whom. |
| `template_id` | Which template. |
| `pdf_sha256` | A fingerprint of the PDF. It proves which file we sent. |
| `sent_by`, `sent_at` | Who and when. |

**Company settings:** logo, footer text, bank details and payment terms.
This is the **customer's** branding on its own documents. The app itself always looks like Bellvox.

**File storage:** a bucket called `doc-files`. The path is `org/<company id>/…`. Each company can only reach its own folder.

**Standard rules for each new table:** `org_id`, row level security, isolation tests, read access only, writes through database
functions, audit rows.

## 5. Permissions

| Permission | Who has it | What it allows |
|---|---|---|
| Existing "read invoices" | as today | View, print and download. |
| **New:** `sales.invoices.send` | sales staff and higher | Send by WhatsApp or email. |
| **New:** `core.templates.manage` | owner (the owner can give it to others) | Upload and choose templates. Set branding. |

## 6. API

| Method | Path | What it does |
|---|---|---|
| GET | `/v1/sales/invoices/:id/print` | Gives the print page. |
| GET | `/v1/sales/invoices/:id/pdf` | Gives the PDF (made by Gotenberg). |
| POST | `/v1/sales/invoices/:id/send` | Puts a WhatsApp or email message in the queue. |
| GET, POST, DELETE | `/v1/core/templates` | Upload, check and choose templates. |

If Gotenberg is not set up, the PDF and send routes answer **503 `not_set_up`**. The print page still works.

## 7. Screens

| Screen | Where | What it has |
|---|---|---|
| Invoice page | `/sales/invoices/:id` | Buttons: Print, Download PDF, Send (WhatsApp or email). A template choice if there is more than one. |
| Print view | `/sales/invoices/:id/print` | A4 page, right-to-left. "DRAFT" mark on drafts. |
| Templates and branding | `/settings/documents` | Logo. Letterhead upload with a margin preview. Layouts. Word upload with the placeholder check and the list of placeholders. |

**Sending**
- **WhatsApp:** Meta's API can send a PDF as a document. Our message queue already sends WhatsApp messages.
- **Email:** the email channel attaches the PDF.
- **Backup method:** if a file cannot be attached, we send a secure link. The link stops working after 7 days. The company can change this.

## 8. Rules

- The ERP stores amounts as whole numbers of the smallest unit (piastres). The printout shows them with the invoice's currency.
- Digits: Western digits (1, 2, 3) are the default. ETA uses them. Arabic-Indic digits are a possible company setting (section 12).
- The PDF always comes from the **issued** invoice. The same invoice always gives the same PDF. Its fingerprint is in `core_doc_sends`.

## 9. Tests

- Another company cannot read our templates, sends or files.
- A saved picture of each built-in layout, in Arabic and English, draft and issued. A test compares new prints with it.
- ETA layout totals match the ETA builder for ETA's sample documents.
- Word templates: filling in, finding split placeholders, finding unknown placeholders.
- Without Gotenberg, the PDF route answers 503 `not_set_up`.

## 10. Rollout

1. Apply the migration. Run its checks and SQL test on live. Write a worklog entry.
2. Set up Gotenberg: on-prem in Docker Compose; in the cloud after the decision in section 12.
3. Deploy the API and the web app.
4. Check on the live test site: print, PDF, WhatsApp to a test number, email.

## 11. How to test ETA without the portal

Ben asked this on 20 Nov. There are four levels. Each level needs more from ETA.

| Level | Do we need ETA? | What it proves |
|---|---|---|
| **1. Offline** (works today) | No | Our invoice data has the correct ETA format. We test it against ETA's sample files. Totals follow ETA's maths rules. The ETA print layout is correct. |
| **2. A fake ETA server** (we build it) | No | A small fake copy of ETA's API inside our tests. It gives ETA's documented answers: valid, invalid with errors, "too many requests", "try again". The full flow runs: issue → send → check status → valid or invalid → print with QR. |
| **3. ETA test system (PreProd)** | Yes: **one sign-up** on ETA's test portal (`profile.preprod.eta.gov.eg`) | Real checks by ETA. ETA's older invoice format (version 0.9) skips the signature check. So we can test **before** we buy the eSeal certificate. |
| **4. Live ETA** | Live sign-up, eSeal certificate, signing setup | Real submission. |

**Important:** we cannot get real answers from ETA without the portal. ETA gives login details only through the portal.
After one sign-up, everything works through the API. Levels 1 and 2 need nothing from ETA. They are part of this plan.

## 12. Open questions

1. Where does Gotenberg run in the cloud: Cloudflare Containers or a small server? This affects cost and data location.
2. Digits on printouts: Western only, or a company choice of Arabic-Indic?
3. How long does a WhatsApp or email link work: 7 days?
4. Who signs up on the ETA test portal, and with which company's tax number? (A business question for Grant.)

## 13. Decisions and what was built (23 Nov 2026)

**Ben's decisions (23 Nov):**
- The PDF is made in the person's browser for now. It is a picture-style PDF, so Arabic is correct. No server converter yet.
  Gotenberg comes later, only for automatic sends and Word templates. (Replaces section 3.1 "PDF file" for now.)
- Digits: the company chooses. Western digits are the default.
- Invoice links: they work until the invoice is voided. Someone can switch a link off. No end date. (Replaces "7 days" in section 7.)
- "Send": the company chooses. From the person's own device, or from the company's connected WhatsApp or email.
- Logo and letterhead are kept in the database (logo up to about 300 KB, letterhead up to about 1.5 MB). PNG, JPEG or WebP. Not SVG.
- The public link page has no sign-in. It is `/i/<token>`, outside `/v1`, next to the report links `/r/<token>`. It reads with the
  publishable key only (no secret key).
- Numbers per type and year now (`INV-2026-00001`), not with step 3a. Old numbers stay. (Replaces section 3.2.)
- Arabic by default. DRAFT mark until issued. Issued means locked forever.

**What was built (step 1c, branch `feat/invoice-printing`):**
- `sql/103`: drafts, yearly numbers, the issued-invoice lock, document settings, links, send records, one print builder. Test `sql/tests/100`.
- Drafts are in their own tables. So reports, VAT, statements and payments never see a draft.
- API: `/v1/sales/invoice-drafts`, `/v1/sales/print/:type/:id`, `/v1/sales/documents/:type/:id/link` and `/sends`,
  `/v1/core/doc-settings`, and the public `GET /i/:token`.
- Web: print and send page (three layouts, three languages, Print, Download PDF, WhatsApp, email, copy link, new link, switch off),
  draft invoices on the invoices page, Settings → Invoices and documents with a live preview, the public invoice page.
- Permissions: `sales.invoices.send` (members too), `core.templates.manage` (owners and admins; the plan said owner only, but admins
  get every key today, and the database allows owners and admins).

**Not built yet (next parts of this step):**
- Sending from the company's connected WhatsApp or email (the "server" choice). WhatsApp needs an approved Meta message template
  before a business can start a chat. Until then the screen says so and sends from the device. Plan: [INVOICE_SEND_QUEUE_PLAN.md](INVOICE_SEND_QUEUE_PLAN.md) (draft, waiting for Ben).
- A letterhead as a one-page PDF (needs one more library, `pdfjs-dist`). Only pictures for now.
- The PDF fingerprint in `core_doc_sends` (needs the server converter).
- ~~Saved pictures of each layout for comparison tests (section 9).~~ Done 23 Nov (track-b2): `apps/web/e2e/print.e2e.ts`, Windows pictures only; CI (Linux) skips them until a Linux set is added.
