# Current project status

**Updated:** 11 November 2026 (migrations 001–078 and 081–083 applied on live; 079 and 080 unused). This page is the current summary, not a running task log. For dated implementation history, use the [worklog](../operations/WORKLOG.md). Older plan-by-plan snapshots are preserved in the [checklist history](../archive/checklist-detail-2026-11-09.md). Migration status is in [sql/README.md](../../sql/README.md).

## Status

| State | Current summary |
|---|---|
| Built and deployed | Core settings, sign-up and onboarding; inventory, purchasing, sales, finance, accounting and treasury; owner home and alerts; messaging and tasks; language choice and guide; integration stages A–E (test mode removed 11 Nov, `sql/082`: on means the real provider, with a "Check connection" button). See the worklog for what was deployed and checked. |
| Built; real-world check still needed | WhatsApp and voice approvals on a real phone; integrations with real provider transactions; Arabic reviewed by a native speaker; a customer pilot. |
| Written but not applied | None as of 11 November: 069–078 and 081–083 are applied (see `sql/README.md`). Existing AI consent is v1, so AI remains off until an owner accepts v2. |
| Draft or in progress | Financial statements (income statement, balance sheet): [plan](FINANCIAL_STATEMENTS_PLAN.md) approved and built 12 November; `sql/085` waits to be applied to live. Manufacturing: [plan](MANUFACTURING_PLAN.md) written 10 November, waiting for Ben's approval (not built). ETA e-invoicing screens and real signing; accounting roadmap phases 2–9; technical and management plans; ADRs 0001–0004. See the linked plans and worklog before treating any phase as active. Bank statement import: [plan](BANK_STATEMENT_IMPORT_PLAN.md) waiting for Ben's approval; its file reader and match suggestions are built (shared, tested, not used by a screen yet). Central Bank of Egypt rates: simulated only, shown in Settings → Integrations → Exchange rates. Google Sheets: [options](../planning/2026-11-09-google-sheets-options.md) for Ben to decide. |
| Backlog | Live Central Bank of Egypt rates (needs the source and the buy/sell/mid decision), stage G (provider setup guide), CSV import, barcode scanning, PDF printing, and cheques pending accountant input. |

## Where to go next

- **What is live or was checked:** [worklog](../operations/WORKLOG.md).
- **What each migration does and whether it is live:** [SQL migration register](../../sql/README.md).
- **What a module is meant to do:** the approved [module plans](README.md).
- **Architecture decisions and current system shape:** [architecture](../architecture/ARCHITECTURE.md) and [ADRs](../architecture/decisions/).
- **Older task snapshots:** [checklist history](../archive/checklist-detail-2026-11-09.md). Treat it as historical; this page and the worklog carry current status.
