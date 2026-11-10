# Google Sheets: what it would be for, and the options

**Status:** decided by Ben (10 November 2026, see the end). Nothing is built yet. Context: [INTEGRATIONS_PLAN.md](../plans/INTEGRATIONS_PLAN.md)
("Google Sheets and Drive: export, import, save PDFs; risk: Google app verification, and a scope that triggers a paid security
assessment").

## What people would use it for

1. **Getting data in at the start.** Most small Egyptian companies keep their item list, customers, suppliers and opening stock in a
   spreadsheet. Importing it saves hours of typing during setup. *This is the use that matters most.*
2. **Reports in a sheet.** Owners and accountants like to play with numbers: stock on hand, sales by customer, open invoices, the
   statement of account. A sheet that refreshes itself is more convenient than downloading a CSV each time.
3. **Backups and sharing** with an outside accountant who does not have an account in the app.

## The options

| | **A. Files only (no Google connection)** | **B. Live Google Sheets connection** | **C. A link Google Sheets reads** |
|---|---|---|---|
| How | Download CSV/Excel from any list (most screens already have CSV); upload a CSV/Excel to import items, customers, suppliers, opening stock | The company signs in with Google once; the app writes chosen reports into a sheet in their Drive and keeps them updated; imports read a sheet directly | The app gives a private, revocable link per report; in Google Sheets the person types `=IMPORTDATA("link")` and the sheet refreshes itself |
| Works with | Google Sheets, Excel, LibreOffice: anything | Google only | Google Sheets (and Excel's "from web") |
| What Google asks of us | Nothing | A Google Cloud project, an OAuth consent screen and **Google's app verification**. Writing only to files the app creates (`drive.file` scope) avoids the paid security assessment, but verification still takes weeks | Nothing |
| Risks | People import messy files: needs a good preview and error list | Verification delays; tokens to store per company; a person leaving the company breaks the connection | The link is a key: anyone who has it can read that report until it is revoked. Must be per report, expiring or revocable, read-only, and audited |
| Effort | Small to medium (the import screens are the work) | Large | Small |

## Recommendation

**A now, C next, B only if customers ask for it.**

- **A** covers use 1, the one that matters: CSV/Excel import of items, customers, suppliers and opening stock, with a preview, the
  same column-mapping screen as the bank statement import, and every row checked by the database functions that already exist (so the
  usual rules apply: SKUs unique, opening stock with a cost when accounting is on, and so on). "CSV import" is already in the backlog.
- **C** covers use 2 cheaply and without Google's review. It needs care: owner or admin creates the link, it is read-only, it can be
  revoked, it shows when it was last read, and creating or revoking it is audited.
- **B** is the most comfortable for the person using it, but it is the most work and depends on Google's review. Worth it only if
  several customers ask.

## What Ben decides

1. Which options, in which order (recommended: A, then C).
2. For A: which lists first (recommended: items with opening stock, then customers, then suppliers).
3. For C: which reports may be shared by link (recommended: stock on hand, open invoices, sales by month; never the audit log or
   anything with personal data such as phone numbers).

## Other Google services (added 10 November, Ben: "what about other Google stuff")

What each would do in the ERP, and what Google asks of us. Google sorts the permissions an app asks for into non-sensitive, sensitive
(Google reviews the app before strangers can use it) and restricted (review plus a paid security assessment). The sensitivity column
below is from memory of Google's rules and is **to be checked** on Google's pages before we start any of them.

| Service | What it would do in the ERP | What Google asks of us | Effort | Recommendation |
|---|---|---|---|---|
| **Sign in with Google** | Staff sign in with their Google account instead of a password; nothing else is read | Non-sensitive (name and email only); Supabase supports it already | Small | **Yes, soon**: fewer forgotten passwords, nothing to review |
| **Google Chat** | Alerts and approval requests in a company's Google Chat space, like Slack and Teams today | No Google review: an incoming webhook per space | Small (same as the Slack channel) | **Yes**, for companies that use Google Workspace |
| **Gmail** | Send invoices, statements and reminders from the company's own Gmail address instead of ours | Sending only is sensitive (review); reading mail is restricted (avoid) | Medium | Later. Our own sending (Resend) works without it; add when a customer wants mail from their own address |
| **Google Drive** | Save invoice and statement PDFs and backups into the company's Drive | Only files the app creates: non-sensitive. Whole Drive: restricted (avoid) | Medium | With option B above, if ever; otherwise downloads are enough |
| **Google Calendar** | Due dates, deliveries and tasks in people's calendars | Sensitive (review). Alternative without review: a calendar link (iCal feed) per person that Google Calendar subscribes to | Small (feed) / Medium (API) | **The feed**, when tasks and due dates need it |
| **Google Contacts** | Import customers and suppliers from contacts | Reading contacts is sensitive (review) | Medium | No: a CSV import (option A) covers it |
| **Google Maps** | Customer addresses on a map, delivery areas | An API key with billing; no app review | Small to medium | Later, with shipping |
| **Google Document AI** | Reading PDF bank statements (OCR) | A Google Cloud account and billing | Small | One of the candidates in the bank statement plan |

## What Ben decides (other Google services)

4. Which of these to do, in which order. Recommended: Sign in with Google, then Google Chat alerts; the rest when a customer asks.

## Ben's decision (10 November 2026): the recommendations approved

1. **A now, then C**; B only if customers ask.
2. A, in this order: items with opening stock, then customers, then suppliers.
3. C: read-only links only for stock on hand, open invoices and sales by month; never the audit log or personal data.
4. Other Google services: **Sign in with Google**, then **Google Chat** alerts; Gmail, Drive, Calendar (as a feed) and Maps when a
   customer asks; not Google Contacts.

Build order (after the bank statement import, Ben's earlier priority): Sign in with Google (needs a Google Cloud OAuth client from Ben,
entered in Supabase), Google Chat alerts, then option A imports, then option C links.
