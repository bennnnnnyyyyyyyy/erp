# Reply to the Claude chat: merge, deploy and slice report (2026-10-30)

Facts only. "not verified" = I did not run it myself.

## Slice report: security-audit merge + deploy
- **Built:** `worktree-security-audit-fixes` merged into `main` (staged by me without committing; only 3 documentation files conflicted: WORKLOG.md, sql/README.md, sql/tests/README.md, resolved by keeping both sides). `git status` now: working tree clean, no merge in progress, branch up to date with origin/main, audit commit `6fd2b3e` is in main (you committed the merge).
- **Tested (real output):** typecheck exit 0; `npm test` 4 shared + 27 API passed; SQL tests 001-023 (22 files in main) all PASS, audit test 021 PASS; CSP in `apps/web/public/_headers` read and covers `erp-api.meetings-dmedeskai.workers.dev`, `*.supabase.co`, inline styles, self-hosted fonts.
- **Deployed by wrangler from the merged tree:** Worker `erp-api` **f541974e-848e-4083-b549-5ca29e48a845** (previous: `1bea1ab5-d707-40b3-86ad-cdb6ff2e435c`, before that `4df4569e-37b3-4d06-a137-9ae80eaeeb64`). Pages `erp-live` deployment `db57c526` (https://db57c526.erp-live.pages.dev, serving https://erp-live.pages.dev). Pages previous deployment id: not verified.
- **Live API checks as owner in "Demo Cosmetics Factory (sample data)":** `/v1/finance/insights` 200, `/v1/inventory/expiry` 200, `/v1/messaging/identities` 200, `/v1/core/people` 200, `/v1/sales/invoices` 200. As a member (grant): `/v1/finance/insights` **403** (money is hidden). Live site sends the CSP header.
- **Numbers the home page will show (from the live API):** last full month 2026-09: revenue 1,588,772, cost 769,764, expenses 588,881, **net +230,127 EGP**; owed to me 2,462,680 (all of it overdue); stock value 2,957,537; 3 items low; 3 requests waiting.

## Not tested / not verified
- **The home page, Finance, Batches, Customer invoices and Connect WhatsApp screens were NOT opened in a browser** (no browser testing, per `agents.md`). Only their API routes were checked. How they look is not verified.
- `scripts/real-login-check.mjs` and `scripts/concurrency-check.mjs` not re-run after the merge. Invite paths of the audit fix (new email -> added with link; existing account -> invited and accepted from the picker; admin cannot touch an owner; last owner protected): not verified.
- WhatsApp end to end: never run against real WhatsApp (needs Meta app + 3 secrets).
- Possible double deploy: a push to main also triggers CI, which deploys the same code again; harmless. CI: the last two runs listed by `gh run list` show completed/success (commit 914f3a4 is the merge); whether they are the runs for 914f3a4 itself: not verified.

## What you must click (sign in at https://erp-live.pages.dev)
1. Sign in as `chris.johnson.wiz@gmail.com` (owner), switch to **Demo Cosmetics Factory (sample data)** in the organization picker. The **home page** should show the cards: Am I making or losing money, Money in and out, Waiting for your decision, Stock and expiry, Best sellers, Who you depend on. Try light/dark with the sun/moon button.
2. Inventory > **Batches and expiry**; Finance > Expenses and Payments; Sales > Customer invoices; Messaging > **Connect WhatsApp**.
3. Settings > Users: invite an existing account and accept it from the picker (audit fix M-2).
4. Sign in as `grant.holden.wiz@gmail.com` (member): the home page must show NO money cards.

## What I assumed
- "Merge and deploy" meant: stage the merge, you commit, I deploy with wrangler (not through CI).
- The demo history (11 of 12 months profitable, ~6% net) comes from the seed's rules, not real data; raw materials and packaging are issued to production in monthly lump sums because manufacturing does not exist yet.
- Overdue = unpaid more than 30 days after the invoice date (a fixed rule until it is an organization setting).
- Demo passwords were not rotated (you said not to).

## Incident to know about
My seed first queued ~1,300 bogus "needs your approval" messages; they were cancelled (not deleted) and the seed now disables that trigger while loading. Details in `documentation/operations/WORKLOG.md`.
