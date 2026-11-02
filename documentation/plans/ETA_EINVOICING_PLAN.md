# Egypt ETA E-Invoicing Plan (B2B invoices, credit notes, debit notes)

**Module key:** `einvoicing` (new; depends on `sales`, plus tax data added to `core` settings and `inventory` items)
**Status:** `[📝 Draft / RFC]`. **Plan only.** Nothing is built. Needs Ben's approval before slice A starts.
**Owner:** Ben Arthur · **Reviewers:** management, plus a person who knows Egyptian tax (VAT, table tax, withholding) to check section 7
**Research:** official Egyptian eInvoicing SDK, https://sdk.invoicing.eta.gov.eg, read on 2 Nov 2026 (see section 12 for exactly which pages). No third-party SDK was used for any rule.
**Depends on modules:** core, inventory, sales (customer invoices, `sql/022`), messaging (outbox, `sql/007`)
**Not touched by this plan:** the Wednesday demo path. This work stream is not to be deployed before the demo.

**How facts are labelled.** **Official** = stated on an SDK page I read. **Not found** = the pages I read are silent. **Unverified** = my inference or knowledge, to be checked with ETA or an accountant before code depends on it.

---

## 1. Goal

A company using the ERP can issue Egyptian Tax Authority (ETA) e-invoices straight from a customer invoice: the ERP builds the official document, signs it, submits it, tracks ETA's validation result, and handles cancel, reject, credit and debit notes, with every step in the audit log and credit notes under our approval rules. Scope: **B2B invoice (`i`), credit note (`c`), debit note (`d`), version 1.0.** E-receipts (POS) are out of scope. Export documents (`export-invoice` etc.) exist in the SDK and are a later slice, not v1.

## 2. Scope

**In (v1):** tax and registration data (company, branches, customers, items, units, tax rates); credit and debit notes in our own system first; document builder, canonical serializer and validator; signing through a swappable signer; ETA client (login, submit, status, cancel, reject); callbacks plus polling fallback; per-company encrypted credentials; PreProd and Production per company; status and error display on the invoice; audit trail.
**Out (later):** e-receipts, export documents, intermediary onboarding, bulk packages and archive downloads, late-submission requests, Arabic printouts beyond ETA's own PDF.
**Won't:** a way to send a document that skips our approval rules for credit and debit notes, or one that stores ETA secrets in code, logs or the browser.

## 3. What the official SDK says (and what it does not)

### 3.1 Environments and login (official)

| Item | PreProd (test) | Production |
|---|---|---|
| Registration portal | profile.preprod.eta.gov.eg | profile.eta.gov.eg |
| Invoicing portal | preprod.invoicing.eta.gov.eg | invoicing.eta.gov.eg |
| System API | api.preprod.invoicing.eta.gov.eg | api.invoicing.eta.gov.eg |
| Identity service | id.preprod.eta.gov.eg | id.eta.gov.eg |

- PreProd uses internally issued certificates: its Root CA must be trusted on test machines, and **must not** be installed in production.
- Login: `POST /connect/token` on the identity service, `Authorization: Basic` built from the company's **Client ID and Client Secret**, form field `grant_type=client_credentials`, optional `scope` (example `InvoicingAPI`). Response: `access_token` (a JWT), `token_type` Bearer, `expires_in` (example 3600). **Token lifetime 1 hour: cache it and refresh before expiry; do not log in per call** (calls with missing or placeholder client IDs are blocked automatically).
- Intermediary systems add an `onbehalfof` header holding the taxpayer's registration number; the taxpayer's granted permissions apply.
- To get credentials, the company registers a digital profile, receives an invitation to register the taxpayer administrator, registers one or more ERP systems, and receives API credentials; it also obtains an **eSeal X.509 certificate** for signing.

### 3.2 Documents and rules (official)

**Invoice v1.0 (`documentType` `i`)**, key rules. (In the page's field tables, optional fields are marked with an `Optional:` prefix in their description; **fields without it are required**. My first reading tool wrongly reported "required: not stated".)
- `dateTimeIssued` is UTC and cannot be in the future; `internalId` is our own document number; `taxpayerActivityCode` must be a valid activity code.
- Issuer: `type` is `B` (business in Egypt), `id` is the registration number, `address.branchId` is mandatory for `B`, `address.country` must be `EG`.
- Receiver: `type` is `B` (id = registration number), `P` (id = national ID) or `F` (id = foreign VAT ID). Receiver and issuer cannot be the same. For a **person buyer below a threshold** the receiver id, name and address are optional; the National ID Validator page says the minimum amount is a parameter **set by ETA**; the value is **not published on the pages read (Not found)**, so read it from ETA or the legal text.
- Lines: `description`, `itemType` (`GS1` or `EGS`), `itemCode`, `unitType`, `quantity` greater than 0, `unitValue` (`currencySold`, `amountEGP` up to 5 decimals; `amountSold` and `currencyExchangeRate` are mandatory when the currency is not EGP), `salesTotal`, `total`, `netTotal`, `itemsDiscount`, optional `discount` (rate 0 to 100 or amount), `taxableItems` (`taxType` unique per line, `subType`, `rate` 0 to 999, `amount`), `valueDifference` (can be negative), `totalTaxableFees`, optional `internalCode`.
- Totals: `totalSalesAmount`, `totalDiscountAmount`, `totalItemsDiscountAmount`, `netAmount` = total sales minus total discount, `taxTotals` per tax type, `extraDiscountAmount`, `totalAmount` = net plus taxes (5 decimals allowed). At least one line is required.
- `signatures`: at least the issuer signature, `type` `I` (issuer) or `S` (service provider), `value` a Base64 CAdES-BES structure. **One signature when the taxpayer submits; two when an intermediary submits** (Document validation page). The signature is checked with a component provided by ITIDA.
- Version **0.9** has the same structure with **signature validation disabled** (useful for early PreProd tests); version 1.0 validates signatures.

**Credit note v1.0 (`c`) and debit note v1.0 (`d`):**
- Same structure as the invoice plus `references` (array of the original invoices' **ETA UUIDs**), optional.
- Rules: issuer and receiver structure unchanged; activity code unchanged; all referenced invoices issued by the same taxpayer **to the same recipient** and dated before the note; the note's lines must be the same as the combined lines of the referenced invoices, **only quantities and amounts may change**; a credit note's total must be **less than or equal to** the referenced invoices' total.

**Tax codes (official):** `T1` VAT (subtypes `V001` export, `V002` export to free areas, `V003` exempt, `V004` non-taxable, `V005` diplomats, `V006` defence, `V007` agreements, `V008` special exemptions, `V009` general item sales, `V010` other rates); `T2` and `T3` table tax (percentage `Tbl01`, fixed amount `Tbl02`); `T4` withholding with `W001` to `W016`; `T5` to `T12` stamping, entertainment, resource development, service charges, municipality, medical insurance, other fees; `T13` to `T20` the non-taxable versions. A subtype may only be used with its own tax type; types without subtypes must not carry one. **Which rate applies to which product is not in the SDK: that is tax law, for the accountant (section 7).**

**Unit codes (official, examples):** `EA` each, `KGM` kilogram, `LTR` litre, `BOX` box, `BG` bag, `BO` bottle, `CT` carton, `CS` case, `MTQ` cubic metre, `MTK` square metre, `DZN` dozen, `PR` pair. A downloadable JSON lists all of them. The page I read lists the code `ST` twice (a duplicate to handle). It names no governing standard (Not found).

**Item codes (official, partly):** an **EGS** code is the company's own code registered with ETA: `POST /api/v1.0/codetypes/requests/codes`, `itemCode` format `EG-<TaxpayerID>-<InternalCode>`, a `parentCode` (a level-4 GPC code), English and Arabic names, `activeFrom`. **ETA employees approve each request, so a new code is not instant.** **GS1 codes are not described on the pages I read (Not found); how a GS1 code is validated is Unverified.**

### 3.3 Signing (official, partly)

1. Build the document **without** the signature element.
2. Build the canonical form (Document Serialization Approach): start at the document root (not the submission); convert every property **name** to invariant upper case; take every **value exactly as written** (`0.0` must stay `0.0`); wrap names and simple values in double quotes; arrays repeat the array name before the array and before each element (JSON and XML differ slightly); in XML, double quotes inside values are escaped.
3. SHA-256 over the UTF-8 bytes (32 bytes).
4. Sign with **CAdES-BES** (RSA) using an eSeal (or natural-person) certificate that is valid on the submission date.
5. Put the Base64 result in a new `signatures` entry (`type` `I`) and add the document to the `documents` array.
**Checked against the offline sample files (`one-doc.json`, `one-doc-serialized.json.txt`):** the serialized text follows the document's **own property order** (it starts `"ISSUER""ADDRESS""BRANCHID""1"...`), every value is the exact text from the JSON (so `189.40` must stay `189.40`, not `189.4`: **the number text we sign must be byte-identical to the number text we send, so the builder must emit numbers deterministically and sign the same string**), and the signature is the only element left out. **Casing differences to test on PreProd (Unverified):** the field table says `documentType` is `i` and the key is `internalId`, but the sample document uses `"documentType": "I"`, `"internalID"` and version `"0.9"`; because values are taken verbatim, the exact casing we sign must be what ETA expects. Still not found: signed attributes, key usage and certificate constraints (the sample `parsed-cades-bes.txt` shows one parsed CAdES-BES structure to compare against). The SDK publishes sample files (`one-doc.json` and the serialized output) and a Postman collection: **we should use them as test vectors for the serializer.** A document changed after signing, or reformatted, has an invalid signature.
**The SDK's Integration Toolkit (Docker, NuGet, CLI) is for e-receipts (POS); it does not sign invoices, so it is not a signing option for us.**

### 3.4 Submission, status, callbacks (official)

- **Submit:** `POST /api/v1.0/documentsubmissions/` with `{"documents": [ ... ]}`, JSON or XML (one format per submission). **202** means accepted for processing, not valid: the response gives `submissionUUID` (26 chars), `acceptedDocuments` (`uuid`, `longId` 42 chars, `internalId`) and `rejectedDocuments` (`internalId`, `error` with `code`, `message`, `target`, `details`). Errors: `BadStructure` 400, `MaximumSizeExceeded` 400 (**no numeric limit given**), `IncorrectSubmitter` 403, `Forbidden` 403 (profile tagged "B2B Deny ERP Submission"), `DuplicateSubmission` 422 (same payload hash from the same taxpayer in the last 10 minutes; `Retry-After` header).
- Synchronous checks are minimal (structure, issuer ownership, conformance to the document type version); full validation is asynchronous.
- **Status:** `GET /api/v1.0/documentsubmissions/{uuid}?pageNo&pageSize` returns `overallStatus` (`in progress`, `valid`, `partially valid`, `invalid`) and per-document `status` (`submitted`, `valid`, `invalid`, `rejected`, `cancelled`).
- **Callbacks (recommended over polling):** the ERP must expose `PUT /notifications/documents`, reachable from the Internet over HTTPS with a certificate from a globally trusted root, protected by a pre-shared `Authorization: ApiKey <key>`, **idempotent** (`deliveryId` is the dedupe key), returning **200**; ETA retries on 4xx and 5xx (interval and count are Not found). Message types: `document-validated`, `document-received`, `document-rejected`, `document-cancelled`. ETA checks reachability through a Ping call during registration.
- **Resubmission rule:** treat any 20x as accepted and do not resubmit (it is flagged as a duplicate and repeated duplicates lead to throttling); resubmit only when the API returned an error. Do **not** use document-retrieval calls to check submission status; prefer Search Documents over Get Recent Documents.
- **Rate limits (per ERP system):** Get Recent Documents 3 per second; Get Document 2 per second; Get Document Details 2 per second; Search Documents 2 per second; Get Document Printout 1 per 5 seconds; Search my EGS code usage 1 per 5 seconds; Search Published Codes 1 per 10 seconds. HTTP **429** means wait longer than `Retry-After`; **503** means retry after 1 to 3 seconds. No limits are given for submission volume, size or per-minute totals (Not found).

- **Headers and errors (official):** every call sends `Accept`, `Accept-Language` (`en` or `ar`) and `Content-Type: application/json`; authenticated calls add `Authorization: Bearer <token>`. Every response carries a `correlationId` (**log it with every call; it is what ETA support will ask for**) and `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset` headers (use them to pace calls). Errors are one JSON object `{ "error": { code, message, target, details[] } }`; common codes: 400 `BadRequest`/`BadArgument`, 401 `Unauthorized`, 403 `Forbidden`, 404 `NotFound`, 429 `TooManyRequests` (read `Retry-After`), 500, 501, 503.

### 3.5 Cancel and reject (official)

- **Cancel (issuer):** `PUT /api/v1.0/documents/state/{UUID}/state` with `{"status":"cancelled","reason":"..."}`. The window is **set per document type** and published as workflow parameters by `GET /api/v1.0/documenttypes/{id}` (the example parameter is "Rejection time limit in hours", value 72; the cancellation parameter's name and value are **Not found**). Errors: `OperationPeriodOver`, `IncorrectState`, `ActiveReferencingDocuments` (cancel the referencing credit note first), a frozen-document error. **After the window, the correction is a credit note.**
- **Reject (receiver):** same URL with `"status":"rejected"`, once per document, inside its time limit.
- Decline-cancellation and decline-rejection endpoints exist; I did not read their pages.

## 4. What already fits our design, and what is new

| Need | Already have | New |
|---|---|---|
| Audit trail for every step | Append-only, hash-chained `audit_log`, written in the same transaction | New action names (`einvoice.submitted`, `.validated`, `.rejected`, `.cancelled`) |
| Approval for credit and debit notes | The approval engine (requester cannot approve; policies by amount; channels) | A note approval policy, reusing `inv__required_approvals` style rules |
| Reliable delivery and retry | `msg_outbox` with `attempts`, `max_attempts`, `next_attempt_at`; a 5-minute cron (`jobs/outbox.ts`) | A submission queue table with the same retry shape and ETA-specific back-off (429, 503, 422) |
| A public webhook | The WhatsApp webhook pattern (signature check, fast 200) | `PUT /notifications/documents` with ApiKey check, per-company routing, idempotency by `deliveryId` |
| Multi-tenancy | `org_id`, RLS, select-only grants, mutations through database functions | Same rules for every new table; secrets are the new risk |
| Money | `bigint` minor units plus currency | **ETA works to 5 decimals and validates totals with its own equation.** We must decide one rounding rule so our totals reconcile with ETA's (section 7) |
| Dates | `timestamptz` in UTC | none |
| Invoice states | `issued`, `void` | e-invoice state (not sent, queued, submitted, valid, invalid, rejected, cancelled). **"Void" is not an ETA concept:** if the invoice was submitted, voiding must call Cancel inside the window, and after the window the only route is a credit note |
| **Missing today** | | company tax registration, branch(es), activity code; customer tax ID and type; item code (GS1 or EGS) and ETA unit code; tax rates and per-line taxes; credit and debit notes (only void exists today); signing; ETA client; per-company encrypted credentials; callback endpoint |

## 5. Data model (proposal; tables are module-prefixed, all with `org_id` and RLS)

| Table | Purpose and key columns |
|---|---|
| `core` settings additions | `tax_registration_number`, `tax_legal_name`, default `taxpayer_activity_code`, `eta_environment` (`preprod` or `production`); never customer-specific values in code |
| `tax_branches` | branch id as registered with ETA, address fields (governate, region/city, street, building number), country `EG` |
| `tax_rates` | per-company rate table: ETA `tax_type` and `sub_type`, a rate, a label, a default flag; seed data for T1 and common subtypes (the accountant confirms rates) |
| `inv_items` additions | `eta_item_type` (`GS1` or `EGS`), `eta_item_code`, `eta_unit_code`, default tax rate |
| `sal_customers` additions | `tax_id_type` (`B`, `P`, `F`), `tax_id`, structured address |
| invoice line taxes | per line: tax type, subtype, rate, amount (stored in 5 decimals or as exact integers with a stated scale) |
| `sal_notes`, `sal_note_lines`, `sal_note_approvals` | credit and debit notes: kind, original invoice(s), reason, status, approvals, lines that can only change quantity and amount |
| `eta_credentials` | per company: Client ID, Client Secret, callback API key, **stored encrypted** (see 6.2) |
| `eta_documents` | one row per submitted document: local document, ETA `uuid`, `longId`, `internalId`, document type and version, status, errors, signed payload hash, timestamps |
| `eta_submissions` | one row per submission: `submissionUUID`, payload hash, status, attempts, next attempt, last response |
| `eta_events` | every callback received, unique on `deliveryId`, kept for audit |
Migrations are numbered, rerun-safe, with SQL tests including **another company cannot read or change any of these rows, and cannot read another company's credentials.**

## 6. Design decisions

### 6.1 Where the work runs
Signing needs a private key that must not sit in the Cloudflare Worker. The Worker builds documents and talks to ETA; a **signer** produces the signature. The Worker never holds the key.

### 6.2 Per-company credentials (Client ID, secret, callback key)
Not found in our repo today: there is no encrypted per-company secret storage. Options, to be decided before slice B: **(a)** Supabase Vault or database-level encryption with a key held outside the database; **(b)** application-level encryption in the Worker with a master key as a Worker secret and a per-company data key. Either way: never in source, logs, plans, worklogs, API responses or the browser; shown once at entry; only database functions and the Worker's submission job can read them (Unverified which Supabase feature the project's plan includes).

### 6.3 Signing options for a cloud app
**The SDK pages I read say nothing about USB tokens, HSMs or signing services for ERPs (Not found); the options below are my analysis (Unverified) and must be confirmed with ETA and the certificate provider.**
| Option | How it works | Pros | Cons |
|---|---|---|---|
| A. Local signing agent | Small program on a company computer with the USB token; the cloud app sends the canonical hash, the agent returns the signature | Works with USB-token certificates, which is the common case; key never leaves the customer | Install and support on every customer; the computer must be on; signing is not unattended |
| B. Hosted signing service | A small service we or a partner run, holding the company's key in an HSM; our Worker calls it | Unattended, scalable | Needs a certificate type that permits remote or HSM keys (Unverified), legal and security burden, cost |
| C. Third-party signing provider | A provider signs on the company's behalf (the SDK has a `type S` service-provider signature, but its process is Not found) | Least work for us | Availability and rules in Egypt Unverified; a dependency and a fee |
| D. Browser signing | A browser extension signs with a token | No install of a service | Fragile, hard to support, not suited to background submission |
**Recommendation for the pilot:** option A, **with a signer interface** (`sign(canonicalBytes) -> CAdES-BES`) so B or C can replace it later without changing the rest. Version 0.9 documents (signature validation off) let us test everything else in PreProd before the signer exists. This is a decision for Ben and management (section 9).

### 6.4 Direct credentials vs intermediary
Each company registering our ERP system and giving us its Client ID and secret (direct) is simplest for a pilot. The SDK describes intermediaries (`onbehalfof` header); **how a SaaS vendor becomes an intermediary is Not found: ask ETA.**

### 6.5 Status: callbacks plus polling
Callbacks are recommended by ETA; polling `GET submissions/{uuid}` is the fallback, run by the existing cron, respecting the rate limits. Never resubmit a 20x. Back off on 429 (`Retry-After`) and 503 (1 to 3 seconds); on 422 `DuplicateSubmission` wait out the 10 minutes.

## 7. Business rules (needs an accountant's review)
- **ETA validates our arithmetic.** Official equations (offline copy: `document-validation-rules.md`), as written on the page: line `salesTotal = quantity * unit amount`; `discount amount = discount rate * salesTotal` (not applied when the rate is 0); `netTotal = salesTotal - discount amount`; each taxable fee T5 to T12 `amount = rate * netTotal`; table tax T2 `amount = (netTotal + total taxable fees + valueDifference + the T3 amount) * T2 rate`; T3 and T6 fixed-amount items must carry rate 0; VAT T1 `amount = (the T2 amount + netTotal + total taxable fees + valueDifference + other taxable amounts) * rate`; withholding T4 `amount = rate * (netTotal - itemsDiscount)`; line `total = netTotal + taxes and fees + non-taxable fees - itemsDiscount - all withholding amounts`. Invoice level: `totalSalesAmount = sum of salesTotal`; `netAmount = sum of netTotal`; `totalItemsDiscountAmount = sum of itemsDiscount`; `taxTotals` per tax type = sum of the line amounts (withholding summed across subtypes); `totalAmount = sum of line totals - extraDiscountAmount`. **The page repeats some terms in the VAT and line-total formulas, so these must be confirmed against the SDK sample documents before coding (they are in the offline copy's `files` folder if the download found them).** The same page lists the validators that run (structure, core fields, signature, national ID, taxpayer, reference document, code, simple fields); each can be switched on or off by ETA.
- **One rounding rule** from our integer minor units to ETA's 5-decimal amounts, tested against those equations with worked examples (the page gives amounts to 5 decimal places).
- **Which taxes apply** to each company's items (VAT rate and subtype, table tax, withholding): decided by the company's accountant per item or per customer; we only provide the fields and defaults. Nothing about rates is hardcoded.
- **Credit and debit notes** keep the original invoice lines and allow only quantity and amount changes, with the total limit above, enforced in the database, and require approval under the existing policy rules.
- **Cancel vs credit note:** the cancel window comes from ETA's workflow parameters (read it at runtime, never hardcode 72 hours).
- **Worked example to be written with the accountant** for: a VAT-14%-style line, an exempt line, a line with withholding, a foreign-currency line. Numbers to be confirmed, not invented here.

## 8. Screens and API (outline)
- Settings > Tax: company registration, branches, rates, environment. Settings > E-invoicing: credentials (write-only fields), callback URL and key, a connection test.
- Customer and item forms: tax ID and item/unit code fields, with a warning when a document would be incomplete.
- Customer invoice: e-invoice status, errors in plain words, Send, Cancel, "Issue credit note". Credit and debit note screens with approval.
- API: routes under `/v1/einvoicing/...`, each behind its own permission and one database function; the callback route outside `/v1` with ApiKey verification.

## 9. Slice order and sizes
Sizes are **development effort**, calibrated on this project's actual pace from the worklog and git history: on 30 Oct about 20 slices (each a migration, a SQL test, API routes and a screen, for example customer invoices, sales orders, purchasing, batches and expiry, alerts, forecast) were built in one day, so a typical slice here takes one to two hours; on 2 Nov the stock-transfers feature (migration, 30-step SQL test, API, three screens, demo data) took about half a day including one test correction. ETA work has more unknowns than those slices (signing, ETA's own validation rules, a spec I have read through a summarising tool), so the sizes below are roughly two to three times the usual pace. **Calendar time is dominated by things outside our control and cannot be estimated from here:** ETA registration and PreProd access, buying and receiving a certificate, ETA approval of EGS codes, the signing decision, and the pilot company's data.

| Slice | Contents | Needs ETA access? | Size |
|---|---|---|---|
| **A. Prerequisites** | Tax settings and branches, rates, tax fields on invoices, customer tax IDs, item and unit code fields, credit and debit notes with approval and audit; migrations, SQL tests, API, screens | No | about 1 day (four small slices) |
| B. Credentials and ETA client | Encrypted credential storage, login with token caching, PreProd connection test, document-type lookup | Yes (PreProd credentials) | about half a day |
| C. Document builder | Build Invoice, Credit, Debit v1.0 and v0.9 JSON; canonical serializer tested against the SDK sample files; validator for the rules in 3.2; signer interface | Partly (samples are public) | about 1 to 1.5 days |
| D. Submit and track | Submission queue on the outbox pattern, submit, callbacks, polling fallback, statuses and errors on the invoice | Yes | about 1 day |
| E. Cancel, reject, notes live | Cancel within the window, credit-note flow end to end, reading workflow parameters | Yes | about half a day |
| F. Signing for real | Signing agent (or chosen option), CAdES-BES, certificate handling, v1.0 submission | Yes plus a certificate | about 1 day after the option is chosen (plus the agent itself if option A) |
| G. Pilot hardening | Reconciliation job, alerts for failed or stuck documents, monitoring, rate-limit handling, a runbook | Yes | about half to 1 day |

## 10. What I need from you (and what I will not do without it)
1. **ETA PreProd access** for a test taxpayer: registration, an ERP system registration and its Client ID and secret, a test eSeal certificate if ETA provides one. **Do not paste secrets in chat or files; we will agree how to enter them.**
2. **The signing decision** (section 6.3) and which certificate type the pilot company has or will buy.
3. **A pilot company** and its data: registration number, branch, activity code, address, a few items with their codes, customers with tax IDs, and an accountant who confirms the tax rules.
4. **Direct vs intermediary** (6.4), and whether to ask ETA about intermediary status now.
5. **Approval of slice A**, which needs none of the above.

## 11. Tests (when built)
SQL: isolation for every table (including credentials), note rules (total limit, same recipient, quantity-and-amount-only), approval rules, append-only event log. API: permission and validation tests; a callback test (ApiKey, idempotency by `deliveryId`, 200). Unit: the serializer against the SDK sample files, the rounding rule against worked examples. Integration (PreProd only, manual at first): login, submit v0.9, callback, cancel. Existing tests must keep passing.

## 12. Sources and what I did not read
**Official pages read (2 Nov 2026):** [SDK home](https://sdk.invoicing.eta.gov.eg/), [Getting started](https://sdk.invoicing.eta.gov.eg/start/), [Common API index](https://sdk.invoicing.eta.gov.eg/api/), [Login as taxpayer system](https://sdk.invoicing.eta.gov.eg/api/01-login-as-taxpayer-system/), [EInvoicing API index](https://sdk.invoicing.eta.gov.eg/einvoicingapi/), [Submit Documents](https://sdk.invoicing.eta.gov.eg/einvoicingapi/01-submit-documents/), [Cancel Document](https://sdk.invoicing.eta.gov.eg/einvoicingapi/02-cancel-document/), [Reject Document](https://sdk.invoicing.eta.gov.eg/einvoicingapi/03-reject-document/), [Receive Document Notifications](https://sdk.invoicing.eta.gov.eg/einvoicingapi/14-receive-document-notifications/), [Get Submission](https://sdk.invoicing.eta.gov.eg/einvoicingapi/09-get-submission/), [Get Document Type](https://sdk.invoicing.eta.gov.eg/api/03-get-document-type/), [Create EGS Code Usage](https://sdk.invoicing.eta.gov.eg/api/09-create-egs-code-usage/), [Types](https://sdk.invoicing.eta.gov.eg/types/), [Invoice v1.0](https://sdk.invoicing.eta.gov.eg/documents/invoice-v1-0/), [Credit Note v1.0](https://sdk.invoicing.eta.gov.eg/documents/credit-note-v1-0/), [Debit Note v1.0](https://sdk.invoicing.eta.gov.eg/documents/debit-note-v1-0/), [Codes](https://sdk.invoicing.eta.gov.eg/codes/), [Tax types](https://sdk.invoicing.eta.gov.eg/codes/tax-types/), [Unit types](https://sdk.invoicing.eta.gov.eg/codes/unit-types/), [Signature creation](https://sdk.invoicing.eta.gov.eg/signature-creation/) (summary found through search and fetched), [Document serialization approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/), [API governance and rate limits](https://sdk.invoicing.eta.gov.eg/apigovernance/), [Integration practices](https://sdk.invoicing.eta.gov.eg/integrationpractices/), [FAQ](https://sdk.invoicing.eta.gov.eg/faq/), [Integration Toolkit](https://sdk.invoicing.eta.gov.eg/toolkit/home/), [Release notes](https://sdk.invoicing.eta.gov.eg/release-notes/).
**Offline copy (added the same day):** the whole SDK (203 pages as raw HTML and readable markdown, plus linked sample files where the site had any) is saved in `documentation/reference/eta-sdk/2026-11-02/` with a `MANIFEST.json` of sizes and hashes; **read it there instead of re-fetching, and re-check the plan's rules against it (the offline text is the exact page text, not a summary).** It also contained pages I had not found online, now read: `document-validation-rules`, `standard-header-parameters`, `standard-error-response`; the calculations page `main-calculations` turned out to be for e-receipts only.
**Pages in the older list below that are now available offline but not yet re-read for this plan:** the "standard headers" and "standard error response" pages; the "validation equation" page linked from Submit Documents; `/codes/activity-types/`, `/codes/branch/`, `/codes/payment-methods/`, `/codes/delivery-mode/`; `/einvoicingapi/04` to `13` (recent documents, packages, printout, document details, decline cancellation and rejection); `/documents/invoice-v0-9/`; the export document pages; the downloadable sample files and Postman collection; the legal threshold for person buyers.
**Note on the page text:** my reading tool summarises pages, so exact field names were quoted from its output; before any code is written, the document structure and signing pages must be re-read directly and compared with the SDK's sample files.

## 13. Open questions
1. What is the threshold below which a person buyer's details are optional (and is it current)?
2. Which signing option do the likely pilot companies' certificates allow?
3. Can a SaaS ERP register as an intermediary, and on what terms?
4. Is the SDK's list of submission size limits published anywhere, and what happens on `MaximumSizeExceeded`?
5. How is a GS1 item code verified at submission, and does the company need a GS1 Egypt membership?
6. Does ETA require a printed or QR representation for B2B invoices that we must produce, beyond the PDF printout API? (Not found on the pages read.)

