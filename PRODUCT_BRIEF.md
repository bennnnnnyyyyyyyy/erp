# {{PRODUCT_NAME}} — product brief

**Status:** Current positioning, 9 November 2026. Customer demand is not yet confirmed. The first draft and phase-one strategy are preserved in the [archive](documentation/archive/product-brief-phase-0-2026-10.md).

## Product

A general-purpose ERP for small and mid-size businesses, Egypt first. The first warehouse, stock and accounting capabilities are built. The product will broaden inventory workflows and add other business tracks as separate modules, each with an approved plan. The GCC and other markets can follow through company settings rather than customer-specific code.

It is a multi-company product: each company's data is isolated, and each company turns on the modules it uses. EGP is the default currency, not a hard-coded rule.

## Product principles

- Outgoing stock requiring approval cannot move until the database records an eligible manager's decision.
- Stock quantities come from an append-only movement ledger.
- Each stock movement and approval is recorded in the append-only audit log in the same transaction.
- In-app, WhatsApp and voice approvals use the same decision path; a channel cannot change stock by itself.
- New business tracks are separate modules with organization-level permissions and settings.
- Competitor research informs behavior and requirements; competitor code, assets and copy are never reused.

The full implementation rules are in [`agents.md`](agents.md). The current shipped, in-progress and unproven status is in the [checklist](documentation/plans/checklist.md); dated evidence is in the [worklog](documentation/operations/WORKLOG.md).

## Validation still needed

- Customer demand and product-market fit are unconfirmed; customer interviews and hands-on competitor trials remain to be done.
- WhatsApp and voice approvals have not been proven on a real phone.
- Integrations have not been proven through real provider transactions.
- Arabic wording is a machine draft and needs native-speaker review.
- A real customer pilot has not happened.

## Scope decisions

CRM, HR, payroll and similar tracks are not planned yet. Each requires its own approved module plan before implementation. The product is web-first; a native phone app is not in the current release plan.

## Open item

The product name is still `{{PRODUCT_NAME}}`. Other operational choices belong in the relevant plan or decision record so this brief stays focused on the product.
