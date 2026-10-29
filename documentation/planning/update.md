# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Newest state first. Last updated: 2026-10-29.

## Last done
- Read your Supabase check: query 2 of `sql/003` shows anon and authenticated cannot call the admin/internal functions, service_role can. That is the expected result. (`require_role` also true for service_role is harmless: it bypasses privileges anyway.) Queries 1, 3 and 4 not seen yet.
- Purchasing and Sales **demo logic** written and typechecked: `apps/web/src/lib/demoTrade.ts`, plus changes to `demoInventory.ts` (stock requests can come from a sales order, ledger receipts carry a reference) and `demo.ts` (new `/v1/purchasing` and `/v1/sales` routes, two demo-only modules in Settings → Apps).
- Live demo is up: https://erp-demo-bas.pages.dev (older build, without purchasing/sales).
- Everything before this is committed by you; the demo logic above is not yet committed.

## Doing now
- Writing the Purchasing and Sales **screens** (suppliers, purchase orders with "receive goods", customers, sales orders with "request stock"). The first attempt to write the shared file `modules/trade/common.tsx` was interrupted, so **nothing from the screens exists yet**. Right now Settings → Apps lists Purchasing and Sales with no pages behind them.

## Next
1. Finish the Purchasing and Sales screens, register them in `modules/registry.tsx`, show the sales order link on the request page, typecheck.
2. Add a worklog entry for the trade demo; update the checklist.
3. Redeploy the demo (`npm run build:demo`, then `npx wrangler pages deploy apps/web/dist --project-name erp-demo --branch main`).
4. Then the real foundation: SQL tests in `sql/tests/`, root `README.md`, `PRODUCT_BRIEF.md`, move the two plans into `documentation/`.
5. Later: `INVENTORY_PLAN.md` after the trials and interviews.

## Needs your input
- **Cloudflare naming:** you asked me to "fix the mistake of cloudflare naming". Which one?
  (a) the `-bas` in the web address `erp-demo-bas.pages.dev` (Cloudflare added it because `erp-demo` was taken; fixing means a new project with a different name),
  (b) the account name `Meetings.dmedeskai@gmail.com's Account` (rename it in the Cloudflare dashboard; I can't), or
  (c) the email spelling in my notes (`Meeting` vs `meetings`).
  I have changed nothing yet.
- Paste the output of verification queries 1, 3 and 4 from `sql/003` (query 3 and 4 should return zero rows).
- Product name: skipped for now (placeholder `{{PRODUCT_NAME}}` stays). Demo access: public is fine (decided).
- Still open with management: go-ahead for trials and interviews, e-invoicing now or later, WhatsApp provider, payment gateway.

## Where to look
`documentation/operations/WORKLOG.md`, `documentation/plans/checklist.md`, `TECHNICAL_PLAN.md`, `sql/003_audit_chain_and_core_rpc.sql`, `apps/web/src/lib/demoTrade.ts`.
