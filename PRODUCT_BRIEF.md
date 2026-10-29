# {{PRODUCT_NAME}}: product brief

**Status:** draft, 2026-10-29. Demand is untested; scope below changes if the trials and customer interviews say so.
**Longer plans:** [`TECHNICAL_PLAN.md`](documentation/plans/TECHNICAL_PLAN.md) (engineering), [`MANAGEMENT_PLAN.md`](documentation/planning/MANAGEMENT_PLAN.md) (management).

## What it is

A warehouse-first ERP for SMEs in Egypt and the GCC (Saudi Arabia and the UAE first) that hold stock. Many companies share one system, each fully isolated, and each switches on only the modules it uses. Egyptian-pound pricing is the default, and every warehouse feature is included in the price.

It is **not** an internal tool for any one company: no CRM, time tracking, HR or payroll.

## Why it might win (from the market research)

- Approvals, audit logs and approval-gated AI exist at several competitors, so they are table stakes, not the edge.
- No ERP reviewed lets warehouse staff and managers approve or assign stock work by WhatsApp or voice. This is the main hypothesis.
- Almost no vendor prices in Egyptian pounds; warehouse features are often held back in higher plans or add-ons.
- Not an open gap: being cheap (local price floor is about USD 35-70 a month for a small team), Egypt e-invoicing breadth, or having approvals and audit at all.

Evidence level: public sources only. Hands-on trials of six competitors and 8-10 customer interviews are still to do.

## The first vertical slice

> Add an item, a staff member requests stock to go out, the manager approves, the stock is issued, and an audit entry is written.

Rules the slice must prove:
- The request reserves the stock when submitted, so it cannot be promised twice.
- Only an approved request can be issued, enforced in the database. A direct write that skips approval is refused.
- The requester cannot approve their own request.
- Every step writes to the append-only audit log in the same transaction.
- The approval channel is abstracted: the first version approves in the web app; WhatsApp and voice plug into the same decision function later, without redoing the flow.

A clickable demo of this slice on sample data exists (see the README). It imitates the rules in the browser; the real implementation lives in Postgres.

## Modules

| Module | Purpose | When |
|---|---|---|
| Core | Organization, users, roles, settings, audit log | Built (foundation) |
| Inventory | Items, warehouses, stock ledger, requests, approvals | Wave 1, needs an approved plan |
| Messaging | Channel adapters, outbox, identity binding, WhatsApp, later voice | Interface in wave 1, WhatsApp only if interviews say yes |
| Tasks | Assignable warehouse tasks over the same channels | Wave 2 |
| Parties, Purchasing, Sales | Customers, suppliers, purchase orders, sales orders and delivery | Wave 2 (demo sample exists, not committed) |
| Invoicing, E-invoicing, Accounting export | Invoices, Egypt/Saudi e-invoicing, export to the customer's accounting tool | Wave 3 |
| Billing | Our own plans and EGP billing | Before the first paying customer |

## Out of scope

- CRM, time and attendance, HR, payroll.
- A full general ledger and statutory accounting (we export to the customer's accounting tool instead).
- A native phone app at first: the product is a web app now, with a phone app later on the same back end.
- Point of sale and manufacturing, unless customers ask.
- Per-customer custom code. Variation lives in settings, custom fields and approval policies.

## Decisions still open

- Product name (placeholder `{{PRODUCT_NAME}}`).
- Egypt e-invoicing: needed from day one, later, or through a provider.
- WhatsApp provider, payment gateway and billing entity.
- Order of waves 2 and 3, pending interview results.
- Hosting region for the first customers and support model for the pilot.

## Non-negotiable rules

Every business table has `org_id`, row level security and isolation tests. Money is integer minor units plus a currency code. Stock is an append-only ledger. Approvals and audit are enforced in the database. Arabic and right-to-left from the first screen. Competitors are studied for behaviour only; their code is never copied. Full list: [`agents.md`](agents.md).
