# Scanning plan: bills, barcodes, attachments, QR

**Module keys:** `purchasing` (bill reading), `sales` and `inventory` (barcodes), `core` (attachments, AI providers)
**Status:** `[📝 Draft, awaiting Ben's approval]`
**Owner:** Ben · **Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md) phase 1d
**Depends on modules:** core, purchasing, sales, inventory

---

## 1. Goal

Less typing. A person photographs a supplier bill and gets a filled-in draft to check; scans a product with the phone camera to add it
to an invoice; attaches a photo of any paper to the record it belongs to; and scans an invoice's QR code to open it.

## 2. Scope (in build order, Ben's 20 Nov choice: all four, Claude orders them)

**S0. AI providers with the company's own key (foundation).**
Today the AI layer (`apps/api/src/lib/aiService.ts`, `aiProviders.ts`) supports OpenAI and Ollama for chat, OpenAI and ElevenLabs
for speech, and reads no images. Add a provider interface with **vision** (image and PDF input) and **structured output**, and
providers **OpenAI, Gemini, Claude, Grok, OpenRouter, online Ollama** (Ben, 20 Nov). **Bill reading uses only the company's own key
for now** (no shared key) until the business decides on credits (Grant document). Keys stay where they are today (service-role only,
never returned, never logged); consent to the AI notice still applies.

**S1. Supplier bill reading (first: biggest time saver, best demo).**
- Upload a photo (camera on the phone) or a PDF.
- The company's AI provider extracts supplier name and tax number, bill number, date, lines (description, quantity, unit price, VAT),
  totals.
- **Matching (ours, not AI):** supplier by tax number then name; open **received purchase orders** of that supplier (a supplier bill
  must belong to a received order, `sql/018`); lines matched to order lines by item code, party item code (`sql/099`) or name.
- The result is a **draft for a person to check**: mismatches highlighted (price, quantity, VAT, total ≠ sum of lines). Nothing is saved
  until the person confirms; saving uses the existing `pur_record_supplier_invoice`, so all current rules apply.
- The original image is attached to the bill (S3).

**S2. Camera barcodes onto invoices and orders.**
- **Phone or laptop camera only for now** (Ben, 20 Nov). Scan → item found by barcode → line added (or quantity +1).
- Items need a **barcode field** (none exists today): `inv_items.barcode` (several per item later, for packs), unique per company.
- Camera decoding: the browser's built-in `BarcodeDetector` where available (Chrome on Android and macOS, from general knowledge;
  **not** on Windows desktop Chrome), and **ZXing for JS** (Apache-2.0, checked 20 Nov) as the fallback. ZXing is a new dependency:
  Ben installs it in the main checkout.
- Later (not now): USB or Bluetooth scanners, printing barcode labels, weighing-scale barcodes (grocery).

**S3. Scan and attach.**
- Any record (bill, invoice, order, receipt, expense, item, customer, supplier) gets **Attachments**: camera photo, image or PDF upload.
  Multi-page "scan" = several photos combined into one PDF (later: via Gotenberg, see the invoice printing plan).
- Storage: Supabase Storage bucket `doc-files`, path `org/<org_id>/…`, each company limited to its own folder.

**S4. QR lookup (last: useful once invoices carry QR codes).**
- Our printed invoices carry a QR with an **internal link** (`/sales/invoices/:id`, for signed-in staff of that company only).
  ETA's own QR is added when ETA sending is on.
- Scanning it with the in-app camera opens the invoice. Another company's QR opens nothing (row level security).

**Out (later):** USB scanners, label printing, scale barcodes; AI-assisted matching of scanned bills to new suppliers (creating
suppliers automatically: never without a person).
**Won't:** saving or posting a scanned bill without a person.

## 3. Data model

| Table | Column | Type | Null | Rules |
|---|---|---|---|---|
| `inv_items` (new column) | `barcode` | text | yes | unique per (org, barcode) where not deleted; **column grant in the same migration** |
| `core_attachments` | `org_id`, `entity_type`, `entity_id`, `file_path`, `mime`, `bytes`, `sha256`, `uploaded_by`, `deleted_at` | | | RLS: readable if the person can read the entity's module; soft delete; audited |
| `core_ai_extractions` | `org_id`, `attachment_id`, `kind` (`supplier_bill`), `provider`, `model`, `result` jsonb, `status` (`done`, `failed`), `cost_micro`, `created_by` | | | keeps what the AI read, for review and support; no key, no prompt secrets |
| `core_integrations` (existing) | new provider kinds | | | Gemini, Claude, Grok, OpenRouter keys stored like today's |

Business-table rules: `org_id`, RLS, isolation tests, `revoke all` then `grant select`, writes through functions, audit rows.

## 4. Permissions

| Key | Default | Allows |
|---|---|---|
| `purchasing.bills.scan` (new) | purchasing staff and up | upload a bill for AI reading (still needs the existing record-bill permission to save) |
| `core.attachments.add` (new) | anyone who can edit the record | attach files |
| existing integrations permission | owner, admin | add AI provider keys |

## 5. API

| Method | Path | Permission | Returns |
|---|---|---|---|
| POST | `/v1/core/attachments` | `core.attachments.add` + entity read | stored attachment |
| POST | `/v1/purchasing/bills/scan` | `purchasing.bills.scan` | `{ extractionId, draft, matches, warnings }`; **503 `not_set_up`** if the company has no AI key with vision |
| GET | `/v1/inventory/items/by-barcode/:code` | inventory read | item or 404 |

AI calls go through `aiService.ts` (on the master-key list: it reads the company's key; the company is always `c.var.tenant.orgId`).

## 6. Screens

| Screen | Notes |
|---|---|
| Supplier bills → "Scan a bill" | camera or upload → reading spinner → side-by-side image and draft with highlighted mismatches → Save |
| Invoice and order line editors | "Scan" button opens the camera; beeps and adds lines |
| Attachments panel | on every record page; camera, upload, preview |
| Settings → AI providers | add a key per provider, choose the default, "Check connection" |

## 7. Rules and worked example

Bill photo: supplier "Nile Chemicals", 3 lines, VAT 14%, total 11,400 EGP. Matched to received PO-0042; line 2 price 520 on the bill
vs 500 on the order → highlighted "Price differs from the order (+20 per unit)". The person corrects or accepts and saves.
Sum check: if lines + VAT ≠ printed total, a warning, never a silent fix.

## 8. Org settings

Default AI provider and model for reading; barcode beep on or off; whether a scanned bill must have its image attached (default yes).

## 9. Tests

Isolation for attachments, extractions, barcode uniqueness per company; AI provider adapters with recorded fake responses (no real
calls in tests); matching rules; 503 without a key; camera decoding tested with sample barcode images.

## 10. Rollout

Migration and SQL test on live; deploy; browser check on live with a real phone camera (Ben). Ben installs ZXing in the main checkout
before S2.

## 11. Open questions

1. Barcode: one per item now, several (packs and cartons) later. OK?
2. A scanned bill for goods **not yet received** (no received order): refuse with "receive the goods first", or offer to start the
   receipt? (Today's rule: bills belong to received orders.)
3. Keep the original image of every scanned bill for how long? (Storage cost; legal record-keeping in Egypt is a business question.)
