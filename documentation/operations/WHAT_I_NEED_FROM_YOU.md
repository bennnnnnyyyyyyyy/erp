# What Claude Code needs from you (written 2 Nov 2026 evening; rechecked after the cosmetics browser check at 22:10)

Everything I am waiting on, grouped by what it blocks. Tick items as you go. "Blocks" says what stays stuck until you do it. Nothing here asks you to paste a secret into chat or a file (see section 7).

## 1. Before the Wednesday demo (4 Nov)

- [ ] **Reproduce "failed to fetch" and tell me the exact screen, the click and the time.** I could NOT reproduce it. As an admin in the cosmetics org I loaded 20 screens (home, profit, forecast, ledger, requests, both invoice lists, purchase orders, expenses, audit log, alerts, batches, transfers, guide and more) and created, tried to self-approve, and cancelled a request: every call returned 200 (or the expected 403 self-approval refusal) in under a second, and the Worker log for the whole session (1,264 events) had 0 exceptions and no server errors. So it is probably something specific: a different user (try as Grant, the member), a particular button, a preview address (`...erp-live.pages.dev` with a prefix instead of exactly `https://erp-live.pages.dev`), an expired sign-in, a network or extension blocking `workers.dev` or `supabase.co`, or a very slow connection. Tell me which and I will restart the log tail. *Blocks:* finding the cause.
- [x] **Owner-home cards in the cosmetics org: checked by Claude (22:00).** They render with real numbers and a title, subtitle and period on every card. What you will see: **"Lost EGP 52,081" for October 2026** (sales 1.13M, cost of goods 592K, expenses 586K), **EGP 3.52M owed, of which EGP 2.46M is more than 30 days late (about 70 percent)**, 2 requests waiting (the oldest 75 hours), 1 expired batch (EGP 2,860), 1 batch expiring within 30 days, best seller sunscreen (EGP 1.05M), and Delta Plastics at 31.5 percent of purchases. **Still yours to look at:** how the cards wrap on your screen and projector.
- [ ] **Decide how to talk about October and the overdue money.** October reads as a loss (about 52K EGP, after profits in July to September) and about 70 percent of what customers owe is overdue; the home page marks four cards "Needs action". It is a strong story ("the owner sees it the day it happens") but it is not the polished picture you may expect. Keep it, or tell me to change the October pattern or the payment pattern in the seed. Also: **the "month is losing money" alert fired at 21:10** after the data top-up, so the owners got an in-app message; that is expected.
- [ ] **Say whether you want the walkthrough as an in-app guided tour** or whether the written walkthrough (`COSMETICS_WALKTHROUGH.md`) is enough for the demo. _Blocks:_ whether I build a tour. (in app totiral with percentages whenevr i discover asomething new)
- [ ] **Rehearse once** with the checklist at the bottom of `COSMETICS_WALKTHROUGH.md` (sign in as Chris, Joseph and Grant; use small quantities). **Two things I saw while testing that the walkthrough should mention:** on New request the warehouse dropdown defaults to "Cold room" (alphabetical), so **choose "Finished goods"**; and the Stock ledger and request lists show only the latest 500 and 200 rows (the ledger says "500 of 500", which reads as if that is everything). I can fix both on request (a default of Finished goods, and a "latest 500" label); they are small.
- [ ] **Commit and push** the uncommitted work so the live app matches (see section 6 for the list). The three small code fixes are not deployed yet.

## 2. ETA e-invoicing (plan is a draft: `documentation/plans/ETA_EINVOICING_PLAN.md`)

- [ ] **Approve or change slice A** (tax settings, branches, rates, tax fields on invoices, customer tax IDs, item and unit code fields, credit and debit notes with approval and audit). It needs no ETA access. _Blocks:_ all ETA code.
- [ ] **Decide the signing option** (plan section 6.3): local signing agent (my recommendation to start with), hosted signing service, third-party provider, or browser signing. Depends on what certificate the pilot company has or will buy. _Blocks:_ real signing (slice F).
- [ ] **Get ETA PreProd access for a test taxpayer:** a registered profile, your ERP system registered with ETA, and its **Client ID and Client Secret**. Also a test eSeal certificate if ETA provides one. _Blocks:_ login, submission, callbacks, cancel and reject tests (slices B, D, E).
- [ ] **Pick a pilot company and get its data:** tax registration number, branch ID, activity code, address, a few items with their codes (EGS or GS1), customers with tax IDs and types (business, person, foreign). _Blocks:_ a real end-to-end test.
- [ ] **Find an accountant** who confirms which tax types and rates apply (VAT subtype and rate, table tax, withholding) and the rule for person buyers below the ETA threshold. The SDK does not say which rate goes with which product. _Blocks:_ defaults in the tax tables.
- [ ] **Decide direct vs intermediary** (plan 6.4) and whether to ask ETA now how a software vendor becomes an intermediary. Direct credentials per company is simplest for a pilot.
- [ ] **Decide whether the offline ETA folder may be committed.** `documentation/reference/eta-sdk/2026-11-02/` (5.4 MB). I found no licence terms; until you decide, keep it uncommitted or private.

## 3. Management decisions (from the 2 Nov meeting)

- [ ] **WhatsApp:** a Meta developer account and a WhatsApp Business account for the company, a test number, up to 5 staff phones. _Blocks:_ testing approvals by WhatsApp on a real phone (the star feature; never tested yet).
- [ ] **Egypt e-invoicing:** build it ourselves, connect through a third-party service, or leave it out for now (the ETA plan assumes we build it). (build it ourselved, make that plan)
- [ ] **Manufacturing:** include bill of materials and production orders? Without it, a factory customer's profit stays approximate. (yes, and they asked me how do we do those caluclations, is it a set thing or is it customaziable)
- [ ] **Voice AI and the model API:** providers accepted, a budget, and a yes on sending item names and quantities (not customer personal data) to OpenAI. The plan keeps the provider swappable. _Blocks:_ any AI or voice code; nothing exists yet.
- [ ] **Who reviews the Arabic text** before more screens are translated. _Blocks:_ Arabic on every screen. (A person can already choose their language in Settings; only the menus are Arabic.)

## 4. Odoo benchmark (trial ends about 16 Nov)

- [ ] **Find the real Egypt price:** the trial's "Buy a subscription" screen. Sources disagree (about US$9 to 16 per user per month on Odoo's page, higher elsewhere) and none was confirmed for Egypt. (skip this for now )
- [ ] **Say whether to finish the three blank workbook rows** (putaway rules, vendor portal, mobile layout) and the restricted-user check, and whether to install the WhatsApp app in the trial to see it. The competitor wording (Odoo restricted user, Zoho gate) stays marked "docs-based" until hands-on.

## 5. Next features (need a plan and your approval before any code)

- [ ] **CSV import with a preview and test step:** a plan first, then your approval. You liked Odoo's flow; customers need it to load their items. (implement\_)
- [ ] **Returns and credit notes, categories and units:** after import (credit notes overlap ETA slice A, so agree the order). (make sure it fits the eta invoicng))
- [ ] **Answers to the transfers plan's open questions** if you want anything other than my recommendations (full receive only; separate dispatch and receive steps; `TR-` numbering; quarantine transfers also need approval). Built as recommended.

## 5b. From the colleague audit (2 Nov)
- [ ] **Watch the first run of the new SQL-tests workflow on GitHub** (`.github/workflows/sql-tests.yml`, runs on pushes and pull requests that touch `sql/`, or run it by hand from the Actions tab). It was written without being able to run it; tell me what fails and I will fix it. It does not block deployment.
- [ ] **Decide the batch-receipt rule:** should receiving a batch of a conditioned item into a warehouse with no storage condition also be refused (as transfers now are)? Consistent, but changes day-to-day receiving.
- [ ] **A second Supabase project for staging?** `agents.md` says to rehearse migrations on staging first; there is only one project today. (Migration 034 was rehearsed in a rolled-back transaction instead.)
- [ ] **`/v1/core/people` shows the part of an email before the `@` when a member has no name set.** Keep, or require names?

## 6. Housekeeping only you can do

- [ ] **Commit and push.** I never commit. Uncommitted right now: the three code fixes (`GeneralSettings.tsx`, `Guide.tsx`, `Messaging.tsx`), `sql/seed/006_cosmetics_topup.sql`, the ETA plan, the ETA offline folder (see the licence note), the cosmetics walkthrough, the audit report, this file, the worklog, and your own edits to `agents.md` and `sss.md`.
- [ ] **Decide whether to add a line to `agents.md`** saying the "no automated browser testing" rule is for Antigravity and Codex, and that Claude may use the browser after asking. I saved this as a memory but have not edited the file., yes do that
- [x] **Worker log tail: stopped** (it had captured the whole session; I can restart it when you are ready to reproduce the error).
- [ ] **Know that `ben@prime-ad.com` is now an admin of the cosmetics organization** (added on 2 Nov, shortly before 22:00, by Claude Code, at your request, directly in the database, with a `member.added` audit entry). To undo it, disable that membership in Settings > Users as Chris, or tell me. Also: my browser test left one cancelled request, OUT-0372 ("Browser check by Claude"), in the sample data; it moved no stock.
- [ ] **Tell me the day you want the top-up seed rerun.** It adds only the months that are missing; run it again later and it will add the new month (it is rerun-safe).

## 7. How to give me secrets (never in chat, source, logs, plans or worklogs)

- ETA Client ID and Secret, a callback API key, certificates and private keys, Meta tokens, and model API keys are **yours to enter**. I will never ask you to paste them.
- For the Cloudflare Worker, set them yourself with `wrangler secret put <NAME>` (or the Cloudflare dashboard). For local work, put them in `.dev.vars`, which is not committed. I will name the variables I expect; you set the values.
- Per-company ETA credentials (each customer has their own) need encrypted storage that does not exist yet; the plan (section 6.2) proposes the options. Until it is built, use PreProd test credentials only, one company, and never production.
- If a secret is ever pasted into chat by accident, treat it as leaked: rotate it.

## 8. Things I will not do without you

Run schema changes or data changes on your Supabase project without your yes (I ask each time; the sample-data top-up was approved), commit or push, use a worktree or the browser without asking, install anything from the ETA folder, or give estimates you did not ask for.
