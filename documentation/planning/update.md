# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Last updated: 2026-10-29.

## Last done
- Built the **Purchasing and Sales demo apps** on sample data and redeployed. Live: https://erp-demo-bas.pages.dev
  - Purchasing: suppliers, purchase orders, "Receive goods" adds stock to the ledger.
  - Sales: customers, sales orders, "Request stock" raises a stock request that still needs a manager's approval; the order becomes Delivered once that request is issued.
  - Links both ways: request page shows its sales order, ledger shows its purchase order.
- Typecheck clean, 17 tests pass, live URL answers 200 on the new build. **Not clicked through in a browser by me.**
- Worklog and checklist updated. Not yet committed (you commit).
- Earlier today: SQL `003` verification query 2 looked as expected (anon/authenticated blocked from admin functions).

## Doing now
- Nothing running. The local dev server stays stopped (it was stopped for low memory); start it only if you want it: `npm run dev:demo -w apps/web`.

## Next (my suggestion)
1. Your quick click-through of the live demo, then tell me what looks wrong.
2. Real foundation: SQL tests in `sql/tests/`, root `README.md`, `PRODUCT_BRIEF.md`, move the plans into `documentation/`.
3. Later: `INVENTORY_PLAN.md` after the trials and interviews. Purchasing and Sales are demo-only until then.

## Needs your input
- **Cloudflare naming fix:** still unclear which one you meant: (a) `-bas` in `erp-demo-bas.pages.dev` (new project = new link), (b) the account name `Meetings.dmedeskai@gmail.com's Account` (dashboard rename, I can't), (c) the email spelling in my notes. Nothing changed yet.
- SQL `003` verification queries 1, 3 and 4 (3 and 4 should be empty).
- Management: go-ahead for trials and interviews, e-invoicing now or later, WhatsApp provider, payment gateway.
- Product name stays a placeholder; demo stays public (both your decisions).

## Where to look
`documentation/operations/WORKLOG.md`, `documentation/plans/checklist.md`, `TECHNICAL_PLAN.md`, `apps/web/src/lib/demoTrade.ts`, `apps/web/src/modules/sales/SalesDemo.tsx`.
