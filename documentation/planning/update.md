# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Last updated: 2026-10-29.

## Last done
- **`sql/003` verified on your database.** Hash chain works: seq 1 (prev null, hash 4fc1aa5dae), seq 2 (prev 4fc1aa5dae, hash 8ccaa9eeec), `audit_verify` found 0 bad rows. Editing the audit log is refused ("audit_log is append-only (UPDATE refused)"). Admin functions are not callable by anon or signed-in users.
- **Found a real gap:** signed-in users still hold TRUNCATE, REFERENCES and TRIGGER on the four core tables (`sql/001` only removed INSERT/UPDATE/DELETE). Not reachable through the Supabase API, but it would let a direct database connection empty the audit log.
- Wrote **`sql/004_revoke_extra_privileges.sql`** to fix it (revokes those rights, blocks TRUNCATE on `audit_log`, and stops future tables getting them). **Not run yet.** Added a rule to `agents.md` so new tables start locked down.
- Worklog, checklist and `sql/README.md` updated. Purchasing and Sales demo is live at https://erp-demo-bas.pages.dev (earlier today).

## Doing now
- Nothing running. Local dev server stays stopped.

## Next
1. **You:** run `sql/004` in the Supabase SQL Editor (whole file, nothing selected), then its two verification queries one at a time and paste the results.
2. Real foundation: SQL tests in `sql/tests/`, root `README.md`, `PRODUCT_BRIEF.md`, move the plans into `documentation/`.
3. API test with a real login for the `X-Org-Id` path and cross-organization refusal (needs a second org and user).
4. Later: `INVENTORY_PLAN.md` after trials and interviews.

## Needs your input
- Run `sql/004` and send me the two result grids (query 1 should be "no rows", query 2 should list `audit_log_append_only`, `audit_log_chain`, `audit_log_no_truncate`).
- **Cloudflare naming fix:** still unclear which one you meant: (a) `-bas` in `erp-demo-bas.pages.dev`, (b) the account name `Meetings.dmedeskai@gmail.com's Account`, (c) email spelling in my notes. Nothing changed.
- Management: go-ahead for trials and interviews, e-invoicing now or later, WhatsApp provider, payment gateway.
- Product name stays a placeholder; demo stays public (your decisions).

## Where to look
`documentation/operations/WORKLOG.md`, `sql/004_revoke_extra_privileges.sql`, `sql/003_audit_chain_and_core_rpc.sql`, `documentation/plans/checklist.md`, `TECHNICAL_PLAN.md`.
