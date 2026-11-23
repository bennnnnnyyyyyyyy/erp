# Invoice sending from the company's own WhatsApp and email ("queue" mode): plan

**Module:** `sales` (send) and `core` (message queue). **Part of:** [INVOICE_PRINTING_PLAN.md](INVOICE_PRINTING_PLAN.md), step 1c, "Not built yet" item 1.
**Status:** Draft, 23 Nov 2026. **Waiting for Ben's approval.** Nothing is built.

> **In short**
> - Today "Send" opens WhatsApp or email **on the person's own device**. The company setting "send from the company" exists, but it does nothing yet.
> - This plan makes "send from the company" work: the invoice goes into our message queue, and the queue sends it from the
>   company's connected WhatsApp number or email account.
> - **Two things block it:** customers have no email address in the ERP, and WhatsApp needs a **Meta-approved message template** to
>   start a chat with a customer.
> - It needs one migration (next free number 107) and one SQL test (next free 104).

## 1. What is there today

| Part | State |
|---|---|
| Message queue `msg_outbox` (sql/007) | Sends only to **members** of the company (`recipient_id` = a user). Retries, backoff, expiry are in the database. |
| WhatsApp channel | Sends **free text** to a member's verified number. Meta allows free text only within 24 hours of the customer's last message. To start a chat, a business must use an **approved template**. |
| Email channel (Resend, sql/053) | Sends to a member's address, from the company's connected Resend account. |
| Customers (`sal_customers`) | Have a phone. **No email.** |
| Send records `core_doc_sends` (sql/103) | Already have `mode` = `device` or `queue`. |
| Customer link `/i/<token>` | Works. The message carries this link. No PDF file is attached (the PDF is made in the browser). |

## 2. What we build

1. **Customer email.** Add `email` to `sal_customers` (with its column grant, same migration). Show it on the customer form.
2. **Outside recipients in the queue.** `msg_outbox` gets `to_address` (a phone number or an email) and a new kind `document`.
   Rule (database check): a `document` message has `to_address` and no `recipient_id`; every other kind stays as it is.
3. **One database function** `sal_queue_doc_send(doc_type, doc_id, channel, to, layout, language)`. It checks, in one transaction:
   - the person has `sales.invoices.send`;
   - the document is an issued invoice or an approved note (never a draft or a void invoice);
   - the company chose "send from the company" and the channel is connected;
   - it makes (or reuses) the customer link, writes the `core_doc_sends` row (`mode = 'queue'`), the outbox row, and the audit row.
   The same document to the same address is queued once per minute at most (idempotency key), so a double click sends once.
4. **WhatsApp template sending.** The WhatsApp channel sends a `document` message as a **template message**: template name, language
   (`ar` or `en`), and the values (company name, invoice number, amount, link). The template name is a company setting, because each
   company's WhatsApp account has its own approved templates.
5. **Email.** The email channel sends to `to_address` with the subject and text we already make for the device send (`sendText.ts`).
6. **Screen.** When the company chose "send from the company", the WhatsApp and email buttons send through the queue. The page shows
   "Queued", then "Sent" or "Failed: <reason>" from the outbox. If a channel is not connected, the button says so and offers the
   device send instead.
7. **Rules that do not change:** a channel only delivers; it never changes the invoice. The secret-key client stays in `jobs/outbox.ts`
   and the channel files (already allowed). No new route exception.

## 3. Tests

- SQL test 104: another company cannot queue or read our sends; a draft, a void invoice and a note that is not approved cannot be queued;
  a member without `sales.invoices.send` cannot queue; each queued send has its `core_doc_sends` row and audit row; a double send queues once.
- API and channel unit tests: the WhatsApp template body; email to an outside address; "not connected" answers 409 `not_connected`;
  a missing function answers 503 `not_set_up` (merge before migration).

## 4. Questions for Ben

1. **Meta template.** Who makes and submits the invoice template in Meta Business Manager, and in which languages (Arabic, English, both)?
   Suggested text: "{{1}} sent you invoice {{2}} for {{3}}. View it here: {{4}}". Until it is approved, WhatsApp "send from the company"
   stays off and the device send stays.
2. **Customer email.** Add one email per customer (suggested), or several contacts per customer (bigger, later)?
3. **Attach the PDF?** Not in this plan: the PDF is made in the browser, so the server has no file. The message carries the link.
   Attaching a PDF needs the server converter (Gotenberg), which you put off. Is the link enough for now?

## 5. Not in this plan

- Attaching the PDF file (needs Gotenberg).
- Sending automatically when an invoice is issued.
- Reminders for unpaid invoices.
