# Replies to Ian (10 November 2026)

Two messages: **A** is the 8:30 PM update; **B** is the full end-of-day report answering every question in `ianemaill.md`.

Assumptions in B, still to be confirmed by Ben (they change dates, not facts):

- The first clients start without Egyptian e-invoicing, and work in EGP only.
- The supplier delivery note number and the two small fixes are built tonight or tomorrow morning.

---

## A. 8:30 PM update

**Subject:** Re: Hourly Progress Update Request

Hello all,

Update from the last two hours:

- **Bank statement import, part 2: done and in the app.** Bank lines with nothing to match in the books can now be recorded
  straight from the statement (an expense, a supplier or customer payment, or a transfer) and matched in one step. Rules turn
  recurring lines like bank fees into one-click entries. A "Bank charges" account is created automatically. The owner chooses who may
  reconcile. The database update is live.
- **Statement reader tested on 54 public sample statements** from foreign banks (no Egyptian bank publishes samples). It found seven
  ways real banks differ from the standard format; all are handled now, and the reader reads twice as many of the samples correctly.
  We still need one real statement exported from one of our Egyptian accounts.

Next: the supplier's delivery note number on goods receipts, two small fixes, then a click-through of the whole app as owner and as
staff. Full answers to Ian's questions follow at the end of the day.

Ben

---

## B. Full report (end of day)

**Subject:** Re: your questions

Hello Ian,

Answers to everything from the past four days, in your order.

### 1. When can the first client use it, and what could block it?

A first pilot client could start on **Monday 16 November**. That assumes three things:

- We start without Egyptian e-invoicing (ETA) and work in EGP only.
- A full click-through of the live app as owner and as staff, planned for Wednesday 11 November, finds nothing serious.
- The pilot is a trading or distribution company, not a factory.

What could block it:

- **The client needs e-invoicing from day one.** Real e-invoicing needs the client's own signing token and ETA portal access, so it
  can't be dated until a client has those.
- **The client manufactures.** Production isn't built. It is only needed for a client that makes its own products, so we will not
  build it for the first pilot. The plan is written and kept ready; it takes about a week to build once a factory client is coming.
- **The click-through finds problems.** All automated tests were re-run today and pass: 64 database tests, including a full business
  day whose books come out exact, and about 500 other tests. The screen-by-screen click-through follows a written checklist (see 2).

### 2. Did you test the full flow as owner and staff?

Partly. An automated test runs a full business day with two different people: buying, receiving, billing, paying, selling with
approval by a second person, invoicing, collecting, a credit note, a transfer, an expense and a stock count. It checks that every
number in the books comes out exactly right, and it runs on every change. Nobody has clicked through the screens on the live app as
owner and as staff yet. That is Wednesday's job, and there is now a written checklist for it: about 80 checks covering every
screen, as owner and as staff, plus a second company (to prove it cannot see the first one's data), Arabic, and a phone.

### 3. Which integrations are live and which are test mode?

All of them are in test mode: email, WhatsApp, Telegram, Paymob, Fawry, Bosta, Shopify, AI and voice. Each one is built and works in
simulation. Going live needs the accounts listed in answer 11.

### 4. Do you need anything from us?

- The provider accounts in answer 11.
- One real exported statement from an Egyptian bank account (NBE, Banque Misr, CIB or QNB Egypt). CSV or Excel is best; PDF is fine.
  Amounts can be blanked as long as the layout stays.
- A pilot client, so we know whether they need e-invoicing.

### 5. Is the bank statement import added and tested with real statements from those banks?

It is in the app (both parts are done). It has been tested with automated tests and with 54 public sample statements from foreign
banks (Citi, ING, Rabobank, ABN AMRO, mBank, Sberbank, Raiffeisen and others). Those samples found seven ways real banks bend the
standard format, and all are fixed. It has **not** been tested with an Egyptian bank's statement, as none were found online, so we
need one of ours. I'll also check it in the browser on Wednesday.

### 6. What file formats can clients upload?

CSV, Excel (.xlsx), Word (.docx) and MT940, the standard bank statement format. PDF is not read yet; that comes with the text
recognition (OCR) step once we have Egyptian samples. Old .xls and .doc files have to be re-saved as .xlsx, .docx or .csv.

### 7. Is the Central Bank exchange rate added and checked, or still test mode and display only?

It is **not real yet**. The Central Bank screen in Settings shows simulated numbers: an international reference rate plus or minus
0.25%, labelled SIMULATED in the app. They are never saved and no invoice or report uses them. There is no real Central Bank rate in
the app today. For the first clients we work in EGP only, so nothing depends on it.

Making it real takes two steps:

1. **A real Central Bank rate.** The Central Bank publishes its buy and sell rates on its website but offers no official data feed.
   Options: read the Central Bank's page once a day (free, but it breaks if they change the page); a paid or free-tier service that
   republishes the Central Bank's rates as data (cheap, but we depend on them); or someone types the day's rate in (always works, a
   good fallback). Recommended: a republishing service plus the typed-in fallback. About half a day once chosen. Agreed earlier: the
   books use the middle of the buy and sell rates, to be confirmed by the accountant.
2. **Use the rate on documents.** Foreign-currency invoices and bills, with the day's rate copied onto each one. About one day.

### 8. Is the last part of the inventory redesign added and checked, including the mobile buttons and blind counting?

All three parts are added and in the app:

- the item page;
- the overview and the grouped menu;
- the stock list (one row per item and warehouse), the big phone buttons (Request, Receive, Count), and counting without seeing the
  expected stock as a company setting.

They passed the automated checks. They have not yet been checked in the browser or on a phone; that is part of Wednesday's
click-through.

### 9. Is the one-owner approval done for everything, including debit notes?

Yes. A company with a single owner can approve its own:

- stock requests, adjustments, transfers and counts;
- credit and debit notes.

Each self-approval is flagged in the audit log. Manual journal entries never needed a second person, because the owner can post them
directly. Purchase orders have no approval step yet (gap 3 below); that is being built now.

### 10. What decision do you need for Google Sheets, and when can it be ready?

No decision is needed; it was decided on 10 November:

- **Upload Excel or CSV files** to load items with opening stock, customers and suppliers: being built now.
- **Private read-only links that Google Sheets refreshes by itself**, for stock on hand, open invoices and sales by month: being
  built now, right after the imports.

Google does have an API for Sheets, so a live connection where the app writes reports straight into a company's sheet is possible.
The simplest way: the company shares a sheet with our app's Google account, and the app keeps it updated. That needs no Google
sign-in screen and no Google review; it needs a Google Cloud project from us (free). About a day of work, after the two items above.

### 11. Which provider accounts are still missing?

All of them; none are set up yet:

| Provider           | What is needed                                                                             | Needed for                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Resend (email)     | An account, plus our sending domain verified with it                                       | Invoices, statements and reminders by email                              |
| Telegram           | A bot (about 5 minutes to create)                                                          | Free staff alerts and approvals                                          |
| WhatsApp (Meta)    | Business account, business verification, a phone number, approved message templates        | Approvals and reminders on WhatsApp. **The slowest; worth starting now** |
| Paymob, Fawry      | A test or merchant account each (each client uses its own later; we need one to test with) | "Pay now" links on invoices                                              |
| Bosta              | Test keys                                                                                  | Shipments and cash on delivery                                           |
| Shopify            | A free development store                                                                   | Online orders in                                                         |
| OpenAI, ElevenLabs | API keys                                                                                   | AI assistant, reading invoices, voice notes                              |
| Google Cloud       | A sign-in client                                                                           | Sign in with Google                                                      |
| ETA e-invoicing    | Per client: its signing token and ETA portal access                                        | Real e-invoicing                                                         |

### 12. The 6 gaps from the Microsoft Dynamics review: what are they, and do any stop clients using the app?

| #   | Gap                                                                                               | Stops clients?                                                                                 | Status                                    | Expected                                                   |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| 1   | The supplier's delivery note number on goods receipts (what an accountant matches a bill against) | No                                                                                             | Not started                               | 10–11 Nov                                                  |
| 2   | Landed cost: freight, customs and clearing added into the item's cost                             | No, but importers' stock cost is understated until then (it can be adjusted by hand meanwhile) | Not started                               | 18–19 Nov                                                  |
| 3   | Approval for purchase orders above an amount                                                      | No                                                                                             | Being built now                           | 11 Nov                                                     |
| 4   | Supplier confirmation and promised delivery date, with a late-delivery alert                      | No                                                                                             | Not started                               | 13 Nov                                                     |
| 5   | Minimum order quantity and pack size per supplier, so suggested orders are realistic              | No                                                                                             | Not started                               | 13–16 Nov                                                  |
| 6   | Manufacturing: bills of materials and production orders                                           | **Yes, for factories only**                                                                    | Plan written; not built until a factory client is coming | About 1 week once needed                  |

### 13. Status and expected finish date for each

Planned on how fast similar work actually went this week (for example, both parts of the bank import were built in one day).

| Date        | Work                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| 10–11 Nov   | Purchase order approval (gap 3); Excel/CSV imports; Google Sheets links; splitting large files |
| 11 Nov      | Click-through of the live app as owner and as staff, and fixes; gap 1; two small fixes         |
| 12 Nov      | Google sign-in (if the Google client is ready); Google Chat alerts; live Google Sheets          |
| 13 Nov      | Gap 4; gap 5                                                                                   |
| 16 Nov      | **First pilot client can start**                                                               |
| 17–18 Nov   | Gap 2 (landed cost)                                                                            |
| When needed | Manufacturing: about a week once a factory client is coming                                    |
| When chosen | E-invoicing setup screens: one day. Real e-invoicing: once a client has its signing token      |

### 14. Are Google sign-in and Chat alerts needed before clients can use it?

No. Clients can sign in with email today, and alerts already go by email, Slack, Teams and Telegram (once its accounts above are set
up). We do what blocks clients first, the click-through and the imports. Google sign-in and Chat follow.

### 15. Is the code built so updates can be rolled back and changed cheaply later?

Yes:

- Each feature is its own module and its own change, so it can be reverted alone.
- Database changes are numbered steps that are tested before they go live, and every step is recorded in a log. A live database
  change isn't undone by deleting it; it is corrected with a new step, which is the safe practice with real data.
- About 500 automated tests run on every change, so later edits are safe.
- Written plans and a work log mean future work doesn't start from zero, which keeps later changes cheap.

One thing to improve: a few screens are each written as one very long file (the bank statement screens, for example, are about 700
lines in one file). That works, but every later change to that screen means reading the whole file, which costs more time
and computing. The fix is to split each one into smaller parts (the list, the form, the settings) the next time we work on that
screen. It changes nothing for users. Being done now, starting with the largest files.

Ben
