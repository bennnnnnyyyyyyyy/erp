# Invoice printing, PDF and templates plan

**Module key:** `sales` (extends it; templates are a `core` setting shared by every document type later)
**Status:** `[📝 Draft, awaiting Ben's approval]`
**Owner:** Ben · **Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md) phases 1c and 1e
**Related:** [Customer invoices](CUSTOMER_INVOICES_PLAN.md) (assumed "no printable invoice" in its first slice), [ETA e-invoicing](ETA_EINVOICING_PLAN.md)
**Depends on modules:** core, sales; einvoicing data (`sql/036`) for the ETA layout

---

## 1. Goal

A company can issue an invoice and hand it to its customer the way it already does: **Arabic, on its own letterhead or its own
Word template**, as a PDF, by WhatsApp, by email or straight to a printer. It can also print the **ETA layout** today, marked "Not yet
submitted to ETA", so switching ETA sending on later changes nothing for the customer except the real ETA number and QR.

## 2. Scope

**In, phase 1c (first):**
- P1. **Print view** of a customer invoice (also credit and debit notes): Arabic by default; bilingual layout optional per template.
- P2. **Draft watermark** on drafts. An issued invoice is **locked forever**; mistakes are fixed by credit or debit note (ETA rule,
  matches our audit rule). (To check in our ETA reference: ETA's cancellation window after submission.)
- P3. **Company branding:** logo, name, tax number, address, footer text, bank details and terms, from company settings.
  **Letterhead image** (PNG, JPG or one-page PDF) as the page background, with adjustable top and bottom margins so the table
  fits inside it.
- P4. **Built-in layouts:** simple; detailed with VAT per line; **ETA layout** (ETA's fields: issuer and receiver tax data,
  activity code, item codes, tax types and subtypes, totals per ETA's equations), stamped **"Not yet submitted to ETA"**, internal
  UUID shown, QR area empty until submission.
- P5. **Delivery:** download PDF, **direct print** (browser print dialog), **send by WhatsApp** and **send by email** through the
  existing outbox (a PDF attachment, or a signed link that expires; see §7).
- P6. Every send is written to the audit log (who, to whom, which channel, which version of the PDF).

**In, phase 1e (after 1c):**
- P7. **Word templates:** the company uploads a `.docx` with placeholders; we fill it and convert it to PDF. Placeholders: a
  **published fixed list** plus **every custom field** (when custom fields exist, roadmap 3a). A template can be set as default per
  document type.
- P8. A **template check** on upload: lists unknown placeholders, previews with the latest invoice.

**Out (later):** AI "copy my old invoice's layout" (uses the company's own AI key; after scanning phase 1d); quotation, delivery note
and receipt templates (same machinery, added per document type); drag-and-drop designer (not planned).
**Won't:** editing an issued invoice.

## 3. How it works

### 3.1 Rendering
One HTML template engine for the built-in layouts (our own code, Arabic RTL, logical CSS). Two outputs:
- **Browser:** the print view and "Print" use the browser itself. No server work, no new dependency.
- **PDF file** (for download, WhatsApp, email): HTML → PDF by **Gotenberg** (MIT, a Docker service with Chromium and LibreOffice;
  licence checked on GitHub 20 Nov). Chromium shapes Arabic correctly; PDF libraries that draw text themselves (pdf-lib and similar)
  don't shape Arabic, so they are ruled out.

**Where Gotenberg runs:** on-prem, as one more container in `scripts/onprem/` Docker Compose. In the cloud, one small container we host
(Cloudflare Containers or a small VM; decision §12). The Worker calls it over HTTPS with a shared secret. It is a converter only: it
never reads the database and keeps no files.

### 3.2 Numbering
Invoices keep their current numbers until the numbering-format work (roadmap 3a: per type and year, `INV-2026-00001`). The print
layout shows whatever number the invoice has.

### 3.3 ETA layout
Built from the ETA data already in the schema (`sql/036`: tax profiles, branches, ETA unit types, tax subtypes) and the document builder
in the einvoicing module, so the printed ETA layout and the later ETA submission use **the same numbers**. Totals follow ETA's
published equations (see ETA plan §3.2) so a printed invoice never disagrees with what ETA will accept.

### 3.4 Word templates
- Placeholders written like `{customer_name}`, `{invoice_number}`, `{#lines}…{/lines}` for the lines table, `{total}`,
  `{cf.truck_number}` for custom fields.
- Filling: either **docxtemplater** (its licence couldn't be read automatically on 20 Nov; check before use: it must be MIT, not the
  GPL option or a paid module) or our own filler over the `.docx` XML using the platform's `DecompressionStream` (no new
  dependency). Common difficulty: Word splits a typed placeholder across text runs; the template check (P8) catches it.
- Conversion `.docx` → PDF: **Gotenberg's LibreOffice route**, the same service as §3.1.
- Templates stored in Supabase Storage, one folder per company, readable only by that company (storage policies plus a
  `core_doc_templates` row).

## 4. Data model

Migration: next free number at build time. SQL test: next free.

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| `core_doc_templates` | `org_id`, `doc_type` (`sales_invoice`, `sales_credit_note`, …), `kind` (`builtin`, `letterhead`, `docx`), `layout` (`simple`, `detailed`, `eta`), `language` (`ar`, `en`, `ar_en`), `file_path`, `margins`, `is_default`, `deleted_at` | | | one default per (org, doc_type); RLS; writes through functions; audited |
| `core_doc_sends` | `org_id`, `doc_type`, `doc_id`, `channel` (`whatsapp`, `email`, `download`, `print`), `recipient`, `template_id`, `pdf_sha256`, `sent_by`, `sent_at` | | | append-only; also an audit row |
| `organizations` settings | logo path, footer text, bank details, terms | | | Bellvox is the app look; this is the **customer's** branding on its own documents |

Storage bucket `doc-files`, path `org/<org_id>/…`; policies limit each company to its own folder. Business-table rules apply to both tables.

## 5. Permissions

| Key | Default | Allows |
|---|---|---|
| existing `sales.invoices.read` | as today | view, print and download |
| `sales.invoices.send` (new) | sales staff and up | send by WhatsApp or email |
| `core.templates.manage` (new) | owner (owner can give it) | upload and choose templates, branding |

## 6. API

| Method | Path | Permission | Returns |
|---|---|---|---|
| GET | `/v1/sales/invoices/:id/print?template=` | `sales.invoices.read` | HTML for the print view |
| GET | `/v1/sales/invoices/:id/pdf?template=` | `sales.invoices.read` | PDF (via Gotenberg) |
| POST | `/v1/sales/invoices/:id/send` | `sales.invoices.send` | `{ channel, recipient }` → queued in the outbox |
| GET/POST/DELETE | `/v1/core/templates` | `core.templates.manage` | upload, check, set default |

If Gotenberg is not configured, the PDF and send routes return **503 `not_set_up`** (house rule), and the print view still works.

## 7. Screens

| Screen | Route | Notes |
|---|---|---|
| Invoice page | `/sales/invoices/:id` | Print, Download PDF, Send ▾ (WhatsApp, email); template picker if more than one |
| Print view | `/sales/invoices/:id/print` | A4, RTL, watermark on drafts |
| Templates and branding | `/settings/documents` | logo, letterhead upload with margin preview, layouts, Word upload with placeholder check, list of placeholders |

**WhatsApp:** Meta's API sends a PDF as a document message; the outbox already sends WhatsApp messages. Email uses the existing email
channel with the PDF attached. A signed, expiring link (7 days, configurable) is the fallback where attachments aren't possible.

## 8. Business rules

- Amounts printed from minor units with the invoice's currency; Arabic-Indic or Western digits per company setting (default Western,
  ETA uses Western); question §12.
- The ETA layout refuses to print (with a list of what's missing) if required ETA data is missing: company tax number, activity code,
  customer tax ID for B2B, item codes.
- A PDF is generated from the **issued** invoice data; the same invoice always prints the same (hash stored in `core_doc_sends`).

## 9. Tests

- Isolation: another company can't read templates, sends or storage files.
- Print snapshot tests for each built-in layout, Arabic and English, draft and issued.
- ETA layout totals match the einvoicing builder for the SDK sample documents.
- Word: placeholder filling, split-run detection, unknown placeholders.
- 503 `not_set_up` without Gotenberg.

## 10. Rollout

1. Migration, verification, SQL test on live; worklog.
2. Gotenberg: on-prem compose service; cloud container (after §12 decision).
3. Deploy API and web; browser check on live (print, PDF, WhatsApp to a test number, email).

## 11. ETA testing without the portal (Ben asked, 20 Nov)

Three levels, each needing more from ETA:

| Level | Needs ETA? | What it proves |
|---|---|---|
| **1. Offline** (now) | No | Our document JSON, the canonical serializer (tested against ETA's SDK sample files), ETA's arithmetic rules in our validator, and the ETA print layout |
| **2. Mock ETA server** (to build) | No | A small fake of ETA's documented API (login, submit, status, printout, cancel) in our test suite, replaying documented responses (valid, invalid with errors, 429 rate limit, 503). The whole flow runs end to end: issue → submit → poll → valid/invalid → print with QR |
| **3. ETA PreProd** | Yes, **one registration on the PreProd portal** (`profile.preprod.eta.gov.eg`) to get a test Client ID and Secret | Real ETA validation. Version 0.9 documents skip signature checks, so it can be tested **before** buying the eSeal certificate |
| 4. Production | Production registration, eSeal certificate, signing set-up | Real submission |

There's no way to get real ETA answers without the portal: credentials only come from registering there. After that one-time
registration, everything runs through the API. Levels 1 and 2 need nothing from ETA and are part of this plan.

## 12. Open questions

1. Where does Gotenberg run in the cloud: Cloudflare Containers, or a small VM? (Cost and region; affects the Grant document.)
2. Digits on printouts: Western (ETA uses them) or Arabic-Indic, per company?
3. Signed link lifetime for WhatsApp and email: 7 days?
4. Who registers on ETA PreProd, and with which company's tax number? (Business question.)
