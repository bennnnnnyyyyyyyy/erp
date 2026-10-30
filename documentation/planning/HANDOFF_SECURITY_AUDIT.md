# Handoff: security audit branch (from Opus, 2026-10-30)

For the next agent. Ben commits and pushes; never commit. Read `agents.md` first.

## Where the work is

- Branch `worktree-security-audit-fixes`, worktree `.claude/worktrees/security-audit-fixes`.
- Synced with main (`68c6c31` "S"): audit changes stashed, fast-forwarded, reapplied. Conflicts were only in
  `sql/README.md` and `sql/tests/README.md` (resolved: main's text plus the 025 / 021 rows).
- Checks after the sync: `npm run typecheck` clean, `npm test` 30/30 (shared 4, api 26).
- Nothing merged, nothing run on any database, nothing deployed. All changes are uncommitted in the worktree.
- Worklog entry: top of `documentation/operations/WORKLOG.md` **in the worktree**. Status: top of `documentation/planning/update.md` on main.

## What the audit fixed (all on the branch)

| ID | Fix | Where |
|---|---|---|
| M-1 | Member list / invite / role / disable / enable are database functions run with the caller's login; rules and audit in one transaction; API no longer writes these with the secret key | `sql/025`, `apps/api/src/modules/core/memberRoutes.ts`; removed `lib/audit.ts`, `modules/core/members.ts` |
| M-2 | An existing account gets a `core_invitations` row it must accept, not an instant membership | `sql/025`, `OrgPicker.tsx`, `UsersSettings.tsx`, `packages/shared/src/core.ts` (`InviteResult` is now `added` / `invited`) |
| L-2 | Decision channel other than `app` only when the webhook function vouches for it | `sql/025` |
| L-3 | A WhatsApp number verified in several orgs works in all | `sql/025` |
| L-4 | "Process now" delivers only the caller's org (`msg_claim_due_for_org`); all-org audit check only in the scheduled pass | `sql/025`, `apps/api/src/jobs/outbox.ts` |
| L-5 | New sign-in link only for an account in no other org | `sql/025` |
| extra | Timing-safe webhook verify token; `wrangler.toml` production values only; security headers + CSP; Auth admin calls isolated in `lib/authAdmin.ts` | `lib/whatsapp.ts`, `index.ts`, `wrangler.toml`, `apps/web/public/_headers`, `lib/authAdmin.ts` |

There is no L-1 in the code; do not invent one.

## What you should take care of

1. **Wait for Ben to commit the branch** (or ask him). Do not merge or commit yourself.
2. **Run `sql/025_security_audit_fixes.sql` only when Ben says so**, staging first, then `sql/tests/021_security_audit_fixes.sql`; also rerun tests 001–020 to confirm nothing regressed. Record each run in the worklog and `sql/README.md`.
3. **Real-login check** after 025: `scripts/real-login-check.mjs` (owner, manager, requester). Then the invite paths by API: new email → `added` with link; existing account → `invited`, accepted from the org picker; admin cannot touch an owner; last owner protected.
4. **Local development:** the root `.env` needs `APP_ENV=development` and `ALLOWED_ORIGINS=http://localhost:5173` now that `wrangler.toml` holds production values. Tell Ben; do not edit `.env` yourself.
5. **CSP check before deploy:** `apps/web/public/_headers` allows only `erp-api.meetings-dmedeskai.workers.dev` and `*.supabase.co`. If the API URL or any other origin (fonts, analytics, WhatsApp media) is used, the deployed app will break. Deploy only when Ben says "deploy"; record version ids and rollback in the worklog.
6. **Missing report:** `sql/025` cites `documentation/reviews/2026-10-30-security-audit.md`, which does not exist. Ask Ben whether to write it (findings above, with the risk each fix removes).
7. **Browser click-through is Ben's** (no automated browser testing): invite an existing account, accept from the org picker, see pending invitations in Settings → Users.
8. Keep `documentation/planning/update.md` current at the end of every turn (Last done / Doing now / Next / Needs input).
