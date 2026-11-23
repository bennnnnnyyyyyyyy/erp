# Scanning plan: bills, barcodes, attachments and QR codes

**Modules:** `purchasing` (bills), `sales` and `inventory` (barcodes), `core` (attachments and AI)
**Status:** Draft. Ben must approve it.
**Owner:** Ben
**Roadmap:** [Bellvox readiness](BELLVOX_READINESS_ROADMAP.md), step 1d

> **In short**
> - **Less typing.** We build four kinds of scanning, in this order:
>   1. Take a photo of a supplier bill. The AI fills in a draft. A person checks it and saves it.
>   2. Scan a barcode with the phone camera. The item goes onto the invoice.
>   3. Attach a photo or PDF to any record.
>   4. Scan the QR code on our invoice. The invoice opens.
> - First, we must let each company use **its own AI key**, with more AI providers.
> - The AI **never saves anything by itself.**

---

## 1. Goal

People type less. They scan paper and products instead.

## 2. What we build

### Step 0: AI providers with the company's own key (we need this first)

**What exists today**
- The AI code is in `apps/api/src/lib/aiService.ts` and `aiProviders.ts`.
- Chat works with OpenAI and Ollama.
- Speech-to-text works with OpenAI and ElevenLabs.
- **The AI cannot read images today.**

**What we add**
- One common connection for all providers. It can read **images and PDFs**. It can return data in a fixed structure.
- Providers: **OpenAI, Gemini, Claude, Grok, OpenRouter, online Ollama** (Ben's choice, 20 Nov).
- For now, bill reading works **only with the company's own key**. We do not give a shared key.
  Grant decides later if we sell AI credits.
- Keys stay safe, as today:
  - only the server can read them
  - the API never sends them back
  - the logs never show them
- The owner must still accept the AI notice first.

### Step 1: read supplier bills (first, because it saves the most time and demos well)

1. The person takes a photo with the phone, or uploads a PDF.
2. The company's AI reads the bill. It finds:
   - supplier name and tax number
   - bill number and date
   - lines: description, quantity, unit price, VAT
   - totals
3. **Our own code (not the AI) does the matching:**
   - It finds the supplier by tax number, then by name.
   - It finds the open **received** purchase orders of that supplier.
     Today a supplier bill must belong to a received order (`sql/018`).
   - It matches each line to an order line. It uses the item code, the supplier's item code (`sql/099`), or the name.
4. The result is a **draft**. It shows differences in colour, for example:
   - price is not the same as the order
   - quantity is not the same
   - VAT is not the same
   - total is not the sum of the lines
5. **Nothing is saved until the person clicks Save.** Save uses the existing function `pur_record_supplier_invoice`.
   So all current rules apply.
6. The ERP attaches the photo to the bill (see step 3).

### Step 2: barcodes with the camera

1. **Phone or laptop camera only, for now** (Ben, 20 Nov).
2. The person scans. The ERP finds the item by barcode. It adds a line, or it adds 1 to the quantity.
3. **Items have no barcode field today.** We add `inv_items.barcode`.
   - One barcode for each item for now.
   - A barcode is unique in each company.
4. Reading the barcode from the camera:
   - Some browsers have a built-in barcode reader (`BarcodeDetector`). From general knowledge: Chrome on Android and Mac have it.
     **Chrome on Windows does not.**
   - So we also use **ZXing for JavaScript** as a backup. Licence: Apache-2.0 (checked 20 Nov). We can use it.
   - ZXing is a new package. **Ben must install it in the main folder.** Never run `npm install` in a worktree.

**Later, not now:** USB or Bluetooth scanners, printing barcode labels, barcodes from weighing scales (for groceries).

### Step 3: scan and attach

1. Any record can have **attachments**: bills, invoices, orders, receipts, expenses, items, customers and suppliers.
2. The person takes a photo, or uploads an image or a PDF.
3. More than one page: the person takes several photos. Later, Gotenberg joins them into one PDF (see the invoice printing plan).
4. Storage: Supabase Storage, bucket `doc-files`, folder `org/<company id>/…`. Each company can only reach its own folder.

### Step 4: QR codes (last, because it is useful only when invoices have QR codes)

1. Our printed invoices get a QR code with an **internal link** to the invoice.
2. Only signed-in staff of that company can open it.
3. When ETA sending is on, the invoice also gets ETA's own QR code.
4. The scanner in the app opens the invoice.
5. A QR code from another company opens nothing. Row level security blocks it.

### Never
- Saving or posting a scanned bill without a person.
- Making a new supplier from a scan without a person.

## 3. Database changes

**Migration number:** the next free number when we build. (The HR app work uses 102 and test 099.)

**New column**

| Table | Column | Meaning |
|---|---|---|
| `inv_items` | `barcode` | The item's barcode. Unique in each company. **Add its column grant in the same migration.** |

**New table: `core_attachments`**

| Column | Meaning |
|---|---|
| `org_id` | The company. |
| `entity_type`, `entity_id` | The record that the file belongs to. |
| `file_path`, `mime`, `bytes`, `sha256` | The file, its type, its size and its fingerprint. |
| `uploaded_by` | Who uploaded it. |
| `deleted_at` | Soft delete. |

A person can see an attachment only if they can see its record.

**New table: `core_ai_extractions`** (what the AI read, kept for checks and support)

| Column | Meaning |
|---|---|
| `org_id` | The company. |
| `attachment_id` | The photo or PDF. |
| `kind` | For now only `supplier_bill`. |
| `provider`, `model` | Which AI read it. |
| `result` | What the AI read. |
| `status` | Done or failed. |
| `cost_micro` | The estimated cost. |
| `created_by` | Who started it. |

It never stores a key.

**Existing table `core_integrations`:** add the new provider types (Gemini, Claude, Grok, OpenRouter). Store their keys the same way as today.

**Standard rules for each new table:** `org_id`, row level security, isolation tests, read access only, writes through database
functions, audit rows.

## 4. Permissions

| Permission | Who has it | What it allows |
|---|---|---|
| **New:** `purchasing.bills.scan` | purchasing staff and higher | Upload a bill for the AI to read. To save it, the person also needs the existing "record bill" permission. |
| **New:** `core.attachments.add` | anyone who can edit the record | Attach files. |
| Existing integrations permission | owner, admin | Add AI keys. |

## 5. API

| Method | Path | What it does |
|---|---|---|
| POST | `/v1/core/attachments` | Stores a file on a record. |
| POST | `/v1/purchasing/bills/scan` | Reads a bill. Gives back the draft, the matches and the warnings. If the company has no AI key that reads images, it answers **503 `not_set_up`**. |
| GET | `/v1/inventory/items/by-barcode/:code` | Finds an item by barcode. |

AI calls go through `aiService.ts`. This file is on the approved list of files that can read the secret key. It always uses the
signed-in company only.

## 6. Screens

| Screen | What it does |
|---|---|
| Supplier bills → "Scan a bill" | Camera or upload → "Reading…" → the photo and the draft side by side, with differences in colour → Save. |
| Invoice and order line editors | A "Scan" button opens the camera. It beeps and adds lines. |
| Attachments panel | On every record page: camera, upload, preview. |
| Settings → AI providers | Add a key for each provider. Choose the default. "Check connection". |

## 7. Example

1. A person takes a photo of a bill from "Nile Chemicals". It has 3 lines, VAT 14%, total 11,400 EGP.
2. The ERP matches it to received order PO-0042.
3. Line 2 says 520 on the bill. The order says 500.
4. The screen shows: "Price is not the same as the order (+20 for each unit)."
5. The person corrects it or accepts it. Then the person saves.

If the lines plus VAT do not equal the printed total, the screen shows a warning. The ERP never changes numbers without telling the person.

## 8. Company settings

- The default AI provider and model for reading bills.
- Barcode beep: on or off.
- Must a scanned bill keep its photo? Default: yes.

## 9. Tests

- Another company cannot see our attachments or AI results. Barcodes are unique only inside one company.
- The AI connections use recorded fake answers. Tests never call a real AI.
- Matching rules.
- 503 `not_set_up` when the company has no AI key.
- Camera reading with sample barcode images.

## 10. Rollout

1. Apply the migration and its SQL test on live.
2. Deploy.
3. Ben checks with a real phone camera on the live test site.
4. Ben installs ZXing in the main folder before step 2.

## 11. Open questions

1. One barcode for each item now, and more (packs, cartons) later. Is this OK?
2. Someone scans a bill, but the goods have not arrived yet (no received order). Two choices:
   - refuse it: "Receive the goods first", or
   - offer to start the receipt.
3. How long do we keep the photo of each scanned bill? This affects storage cost. Egyptian record-keeping rules are a question for Grant.
