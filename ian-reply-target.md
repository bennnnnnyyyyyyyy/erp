# Reply to Ian: TARGET draft

**Do not send this as it is.** It describes the finished state. Part 2 (bottom) lists every sentence that is not true yet, and what
closes it. Send only when Part 2 is empty, or cut the sentences that are still open.

---

## Part 1: the email

**Subject:** Re: your questions

Hello Ian,

Answers to everything from the past few days, in your order.

**1. When can the first client use it?** It is ready for a first client now. The full flow has been tested end to end as owner and as staff.

**2. Did you test the full flow as owner and staff?** Yes. We went through every screen: setting up a company, stock, buying,
selling, payments, bank statements, accounting reports, messages, settings, a second company that cannot see the first one's data,
Arabic, and a phone. An automated test also runs a full business day on every change and checks that the books come out exact.

**3. Which integrations are live?** Email, WhatsApp, Telegram, Paymob, Fawry, Bosta, Shopify, AI and voice are connected to their
real services. Alerts can also go to Slack, Microsoft Teams and Google Chat.

**4. Do you need anything from us?** No.

**5. Bank statement import:** in the app and tested with real statements from our Egyptian bank accounts.

**6. File formats:** CSV, Excel, Word, MT940 and PDF.

**7. Central Bank exchange rate:** live. The app uses the Central Bank of Egypt's daily rate, and invoices and bills can be in foreign
currency with that rate.

**8. Inventory redesign:** finished and checked, including the phone buttons and blind counting. Inventory is now organised around
what people want to do: receive goods, send goods out, move between warehouses, count stock, correct a quantity.

**9. One-owner approval:** done for everything, including debit notes. A company can also let owners approve their own requests;
each one is marked in the audit log.

**10. Google Sheets:** done. Items, customers and suppliers can be imported from Excel or CSV. Private links let a Google Sheet show
stock on hand, open invoices and sales by month and refresh by itself. A live two-way connection to Google Sheets is also available.

**11. Provider accounts:** all set up.

**12. The 6 gaps from the Microsoft Dynamics review:** all closed:
- supplier delivery note numbers on receipts;
- landed cost (freight and customs in item cost);
- purchase order approval;
- supplier confirmation with promised dates and late alerts;
- minimum order quantity and pack sizes;
- manufacturing (recipes and production orders).

**13. Status and dates:** everything above is live.

**14. Google sign-in and Chat:** both live.

**15. Code that is easy to change and roll back:**
- each feature is its own module and its own change, so it can be reverted alone;
- database changes are numbered, tested steps, recorded in a log;
- about 550 automated tests run on every change;
- the largest files have been split, so later changes are quicker and cheaper.

Also done since my last email: credit notes from the sales invoice, a guided setup when switching on accounting, the setup and
settings screens reworked after our own walkthrough, and Egyptian e-invoicing (ETA).

Ben

---

## Part 2: what is NOT true yet, and what closes it (fastest first)

| # | Sentence in the email | True now? | What closes it | Who |
|---|---|---|---|---|
| 1 | Everything "in the app" / "live" | **No.** Tonight's work is on branch `feat/po-approval`, not live | Push the branch; apply database changes 069–077 in order; merge; it deploys | Ben (about 15 minutes), then Claude opens the PR and checks |
| 2 | "Tested end to end as owner and staff… every screen… phone… Arabic" | **Partly.** Walkthrough part 1 done; the rest open; tonight's features never opened in a browser | Finish `walkthrough-full.md` after step 1 goes live; Claude checks tonight's screens in Chrome | Ben and Claude |
| 3 | "Credit notes from the sales invoice" | **No.** There is no credit-note screen; it exists behind the scenes only | Build the screen (the database part exists) | Claude |
| 4 | Guided tour (part of "tested", and the tour switch) | **No.** The tour never starts by itself, so the switch does nothing | Fix the tour start | Claude |
| 5 | "Inventory organised around what people want to do" (Q8) | **No.** Approved (R1), not built | Build the task-first Inventory | Claude (agents) |
| 6 | "Guided setup when switching on accounting" | **No.** Approved (R2), not built; tutorial order and no-skip too | Build it | Claude (agents) |
| 7 | Dynamics gaps 2 and 5: landed cost; minimum order and pack sizes (Q12) | **No.** Not built (1, 3, 4 are built) | Build them; gap 5 needs the forecast reworked per supplier | Claude |
| 8 | Dynamics gap 6: manufacturing (Q12) | **No.** Plan written and parked by you | Approve the plan and build it (about a week) | Ben decides, then Claude |
| 9 | "Integrations connected to real services" / "provider accounts all set up" / "nothing needed" (Q3, Q4, Q11) | **No.** Everything is in test mode; no accounts exist | Open the accounts: Resend and domain, Telegram bot, Meta WhatsApp (slowest), Paymob and Fawry test accounts, Bosta keys, Shopify dev store, OpenAI and ElevenLabs keys; then Claude switches each to live and tests it | Ben opens accounts; Claude connects them |
| 10 | "Google sign-in live"; "live two-way Google Sheets connection" (Q10, Q14) | **No.** | A Google Cloud project with a sign-in client (sign-in) and a service account (Sheets); then about half a day each | Ben creates the project; Claude builds |
| 11 | "Tested with real statements from our Egyptian bank accounts" (Q5) | **No.** Tested with 54 public foreign samples | One real export from one of our Egyptian accounts | Ben (or Ian's team) |
| 12 | "PDF" among the formats (Q6) | **No.** PDF not read | Choose an OCR service and test it on a real Egyptian PDF (after #11) | Ben chooses; Claude builds |
| 13 | "Central Bank rate live; foreign-currency invoices" (Q7) | **No.** The CBE rate is simulated; documents are EGP only | Choose the rate source (recommended: a republishing service plus a typed-in fallback), half a day; foreign-currency documents, about a day | Ben chooses; Claude builds |
| 14 | "Egyptian e-invoicing (ETA)" | **No.** Setup data exists behind the scenes; no screens; sending is simulated | Setup screens (about a day); real signing needs a pilot client's signing token and ETA access | Claude; the client |
| 15 | "Ready for a first client now" (Q1) | **No** until #1–#6 are done; also depends on the client (e-invoicing, factory) | Close #1–#6; find a pilot client | Ben and Claude |
| 16 | "About 550 automated tests" (Q15) | **Yes**, once tonight's branch is merged (73 database + 74 + 353 + 113 code tests) | — | — |
| 17 | Q9 one-owner approval, owners approving their own; Q10 imports and links; Q12 gaps 1, 3, 4; Q14 Google Chat; Q15 file split; setup and settings rework | **Yes, built and tested**; true in the app once #1 is done | — | — |
| 18 | Arabic everywhere | **Partly.** All new texts have machine-draft Arabic | Your Arabic review of the drafts | Ben |

**Fastest path to an email you can send tonight:**
1. Do #1 (push, apply, merge).
2. Send Part 1 with only the sentences marked "Yes" (#16, #17), plus honest one-line statuses for the rest.

Everything else above is the work list.
