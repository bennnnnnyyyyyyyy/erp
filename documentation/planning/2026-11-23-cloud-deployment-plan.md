# Cloud deployment plan (23 Nov 2026)

**Status:** first draft, for Ben. Nothing bought or changed. **Asked by:** Ben, 23 Nov 2026 ("if it includes cloud, the plan must
include the Cloudflare plan"). **Sibling plan:** [On-premises deployment](2026-11-19-on-prem-deployment-plan.md).

> **In short**
> - We do not know yet if we sell cloud, on-prem or both. We prepare for both. This plan is the cloud side.
> - The cloud version runs on **Cloudflare** (web app and API) and **Supabase** (database and sign-in), as the test setup does today.
> - Before the first paying cloud customer, the Cloudflare account must move to the **Workers Paid plan (from $5 a month)**.
>   The free plan is for tests only.
> - Invoice PDFs in the cloud are made by **Cloudflare Browser Run** (Ben, 23 Nov: option A). It needs the paid plan for real use.

## 1. What runs where (cloud)

| Part | Today (tests) | Cloud product |
|---|---|---|
| Web app | Cloudflare Pages `erp-live` | Same, on our own domain |
| API | Cloudflare Worker `erp-api` | Same, on the **Workers Paid** plan |
| Invoice PDF | Made in the person's browser | **Browser Run** from the Worker (Ben, 23 Nov). The browser PDF stays as a backup. |
| Word templates to PDF (step 1e, later) | — | Gotenberg in Cloudflare Containers (same paid plan), or a small rented server |
| Database, sign-in | Supabase project `ggoerp` (test data only) | A separate production Supabase project; its plan is decided in the production-readiness chat |
| Email | Resend (per company) | Same |
| WhatsApp | Meta Cloud API | Same |

## 2. The Cloudflare plan (checked on Cloudflare's pages, 23 Nov 2026)

| | Free plan | Workers Paid plan |
|---|---|---|
| Price | $0 | **$5 a month minimum** for the account |
| API requests | 100,000 a day; after that requests fail (error 1027) until midnight UTC | 10 million a month included, then $0.30 per million |
| CPU time per request | 10 ms | 30 s by default (up to 5 min); 30 million CPU-ms a month included, then $0.02 per million |
| Browser Run (invoice PDFs) | 10 browser-minutes a day, 1 PDF every 10 s: tests only | 10 browser-hours a month included, then $0.09 an hour |
| Containers (Gotenberg, later) | Not available | Included use: 25 GB-hours memory, 375 vCPU-minutes a month, then by use |

**Why the paid plan is needed before customers:** with several companies, 100,000 requests a day and 10 ms of CPU per request are
too small (one busy screen makes several requests), and the free Browser Run allows only a few PDFs a minute.

**Decision needed from Ben:** when to move to the paid plan. Suggested: when the first cloud customer is signed, or when we test PDF
sending with more than one person. The move is a setting on the Cloudflare account; no code changes.

**Note:** today's Cloudflare account is the one set up for tests (WORKLOG 29 Oct). The cloud product should be on a company account
with two owners and the bill in the company's name. Moving the Pages project and Worker is part of this step.

## 3. Steps (in order)

1. **Company Cloudflare account** with two owners; move `erp-live` and `erp-api` (or create them again there) and update the CI secrets.
2. **Workers Paid plan** on that account (Ben's yes).
3. **Browser Run binding** on the Worker (`wrangler.toml`), and the API "PDF maker" setting set to Browser Run.
4. **Own domain** for the web app and the API; update `ALLOWED_ORIGINS` and the Supabase redirect addresses.
5. **Production Supabase project** (separate from the test one), migrations from `sql/001`, backups on.
6. **Cost alerts** on the Cloudflare account (for example at $20 a month), so a fault cannot run up a bill unseen.

## 4. Open questions

1. Cloud, on-prem or both? (Ben does not know yet; we prepare for both.)
2. When to buy the paid plan (section 2).
3. Who owns the company Cloudflare account, and which card pays?
4. Supabase production plan and region (production-readiness chat).
