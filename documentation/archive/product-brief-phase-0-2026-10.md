# Archived product brief — phase-one strategy, 29 October 2026

This document preserves the original product thesis and phase-one plan that used to follow the current product brief. It is historical context, not current positioning or validated market evidence. Check the [current product brief](../../PRODUCT_BRIEF.md), [current status](../plans/checklist.md), and dated [worklog](../operations/WORKLOG.md) before reusing any claim or plan below.

## Original market hypotheses

- Approvals, audit logs and approval-gated AI exist at competitors, so they may be table stakes rather than a differentiator.
- The initial hypothesis was that warehouse staff and managers would value approving or assigning stock work over WhatsApp or voice. This was not validated by customer interviews.
- EGP pricing and included warehouse features were proposed as differentiators.
- The research was public-source only. Competitor trials and customer interviews were still open.

These were hypotheses from the initial market research, not established claims about the current market.

## Original first vertical slice

Add an item, have a staff member request stock to go out, have a manager approve, issue the stock, and write an audit entry.

The proposed rules were: reserve stock when requested; allow issuance only after an eligible approval; prevent self-approval; write each state change and audit event in one transaction; and route in-app, WhatsApp and voice decisions through the same database function.

The original brief noted that the clickable demo used sample data and imitated rules in the browser, while the real implementation lived in Postgres.

## Original module sequence

| Module | Original plan |
|---|---|
| Core | Organization, users, roles, settings and audit log |
| Inventory | Wave 1: items, warehouses, stock ledger, requests and approvals |
| Messaging | Interface in wave 1; WhatsApp depended on customer research; voice later |
| Tasks | Wave 2: assignable warehouse tasks over the same channels |
| Parties, purchasing and sales | Wave 2 |
| Invoicing, e-invoicing and accounting | Wave 3 |
| Billing | Before the first paying customer |

This sequence is superseded by the general-purpose product direction and the current [status checklist](../plans/checklist.md).

## Original scope notes

The first brief excluded CRM, time and attendance, HR, payroll, point of sale and manufacturing, and proposed a web-first product with no customer-specific code. It also initially excluded a full general ledger and statutory accounting; that decision was reversed in November 2026, when accounting, treasury and statements were built.

## Original open questions

The 29 October draft listed the product name, Egypt e-invoicing approach, WhatsApp provider, payment gateway, billing entity, order of waves 2 and 3, hosting region and pilot support model as open. These are retained only as a historical list; consult current plans and decisions for their status.
