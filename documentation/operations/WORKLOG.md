# {{PRODUCT_NAME}} Worklog

Newest first. Every significant fix, schema change, migration run, deployment or data operation
gets an entry with these four headings:

- **Objective.** Why the work was done.
- **Actions Completed.** What changed, with file paths.
- **Database / System Result.** What happened in Supabase / Cloudflare / hosting, or "None".
- **Safety Status.** Tests run, what was not verified, and manual steps still needed.

Entry heading format: `## YYYY-MM-DD — Short title`. If it is not in this file, it has not been
run or deployed.

---

## 2026-10-28 — ADR-0003: user-scoped database access, audit hash chain, first RPC functions

**Objective.** Make the audit log and tenant checks hold in the database instead of depending on every API route, as required before any stock or approval feature (ADR-0003, `TECHNICAL_PLAN.md` section 3.4).

**Actions Completed.**
- `documentation/architecture/decisions/ADR-0003-mutations-via-rpc.md` (Proposed); active organization is the `X-Org-Id` header checked against membership in the database, not a JWT claim.
- `sql/003_audit_chain_and_core_rpc.sql` (new, **not run**): `audit_log` gains `seq`, `prev_hash`, `hash`, `channel`, `request_id`; per-organization hash-chain trigger with an advisory lock; `audit_verify`; service-role-only `audit_append_admin`; `current_org_id()`, `require_org_role()`; `core_set_module()` and `core_update_org()` which change data and write the audit row in one transaction.
- API: `lib/db.ts` replaced by `lib/db.user.ts` (publishable key plus the caller's JWT) and `lib/db.admin.ts` (secret key); new `lib/rpc.ts` mapping reason codes to HTTP errors; `lib/audit.ts` reduced to an admin-path helper that calls `audit_append_admin`. `tenant.ts`, org settings, module enable/disable and the audit read now run as the user; `memberRoutes.ts` stays on the admin client for Supabase Auth admin calls. New `SUPABASE_PUBLISHABLE_KEY` binding.
- `apps/api/test/boundaries.test.ts`: fails if a file outside an allow-list imports the admin client, or inserts into `audit_log` directly. Added `@types/node` for it.

**Database / System Result.** None. `sql/003` has not been run anywhere, so the `X-Org-Id` header check, the hash chain and the two RPC functions are untested against a real database.

**Safety Status.** `npm run typecheck` clean; `npm test` 17/17 (shared 4, api 13). Not browser-tested. Not done: SQL tests (state machine, isolation, audit verification); a second-organization isolation test; ADR-0003 is still Proposed. Manual: run `sql/001`, `002`, `003` in order on a staging Supabase project, run the verification queries, then record the run here.

## 2026-10-28 — Migration: generic foundation copied from the previous internal ERP

**Objective.** Start the new product ({{PRODUCT_NAME}}, warehouse-first ERP for Egypt and the GCC) by reusing the generic parts of the previous internal ERP, without carrying over CRM, time tracking or customer-specific content. The old repository was only read, never modified.

**Actions Completed.**
- Documentation system: `agents.md` (rewritten for this product, logging rules kept, stock/approval/audit and competitor-licensing rules added), `CLAUDE.md`, `PLANS.md`, `documentation/` structure with reset worklog, checklist, plan template, ADR format and research/teardown template, competitor index (Edara, Daftra, Odoo, Wafeq, Zoho, ERPNext, Business Central).
- Code foundation: monorepo tooling; `apps/api` (auth, tenant resolution, permission/module guards, response helpers, core org/members/modules/audit routes); `apps/web` (module-driven shell, sign-in, org picker, core settings screens, list view); `packages/shared` (API types, permissions, module manifest, money); `sql/001`, `sql/002`.
- Changed on the way: package scope `@ggo/*` to `@erp/*`; default currency `USD` to `EGP` in `sql/001`; CRM manifest replaced by an empty `inventory` placeholder module (API routes file, empty web and shared folders); CRM wiring removed from the API and web registries, Home and Shell.
- Left behind: CRM and activities/timeline/my-tasks code and SQL, the generic record-page/field components built for CRM, GGO plans, discovery notes, old worklog and checklist content.
- `apps/api/src/lib/db.ts` and `audit.ts` copied as-is and marked `TODO(ADR-0003)`: they use the secret key and a separate-call audit insert, which must be reworked before the stock and approval features (see `TECHNICAL_PLAN.md`).

**Database / System Result.** None. `sql/001` and `sql/002` have not been run against any Supabase project.

**Safety Status.** `npm install` ok (0 vulnerabilities); `npm run typecheck` clean in shared, api and web; `npm test` passing (shared 4, api 11). Not browser-tested. No `.env` files, secrets, node_modules or git history copied. Open: product name and deciders placeholders, README, PRODUCT_BRIEF, ADR-0003, the db/audit rework.
