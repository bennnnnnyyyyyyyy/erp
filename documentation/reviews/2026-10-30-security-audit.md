# Security audit, 2026-10-30

**Status:** fixes written on branch `worktree-security-audit-fixes`; migration `sql/025_security_audit_fixes.sql` **not yet run**, so nothing below is fixed in production until it is applied, tested (`sql/tests/021_security_audit_fixes.sql`) and deployed.
**Source:** reconstructed from the hand-off note `documentation/planning/HANDOFF_SECURITY_AUDIT.md` and the header of `sql/025`, written by the session that ran the audit. The original audit working notes were not available, so likelihood and severity wording below is mine and **not independently verified**. No L-1 exists in the code.

| ID | Risk (what could go wrong) | Fix | Where |
|---|---|---|---|
| M-1 | The API changed members and wrote their audit rows with the **secret (admin) key**, so a bug or stolen API process could change who has access without the database's own checks. | Member list, invite, role change, disable and enable are database functions called with the caller's own login; rules and the audit row are written in one transaction. Secret key no longer used for these. | `sql/025`, `apps/api/src/modules/core/memberRoutes.ts`; removed `lib/audit.ts`, `modules/core/members.ts` |
| M-2 | Adding an email that already had an account made them a member of the organization instantly, **without their consent**. | An invitation row the person must accept (from the organization picker); pending invitations show in Settings, Users. | `sql/025` (`core_invitations`), `OrgPicker.tsx`, `UsersSettings.tsx` |
| L-2 | A signed-in user could label their own approval decision as coming from `whatsapp`, which would make the audit log lie about how it was decided. | A channel other than `app` is accepted only when the messaging webhook function vouches for it. | `sql/025` |
| L-3 | A WhatsApp number verified in several organizations worked only in one, because lookups were per organization. | Lookup works across all organizations the number is verified in. | `sql/025` |
| L-4 | The "process now" button delivered messages for **every** organization. | `msg_claim_due_for_org`: delivers only the caller's organization; the all-organization audit check runs only in the scheduled pass. | `sql/025`, `apps/api/src/jobs/outbox.ts` |
| L-5 | A sign-in link could be generated for an account that belongs to another organization. | New link only for an account that belongs to no other organization. | `sql/025` |
| extra | Webhook verify token compared in non-constant time; production CORS origins mixed with local ones; no security headers; Auth admin calls spread around. | Timing-safe comparison; `wrangler.toml` holds production values only (local values go in `.env`: `APP_ENV=development`, `ALLOWED_ORIGINS=http://localhost:5173`); CSP and security headers in `apps/web/public/_headers`; Auth admin calls isolated in `lib/authAdmin.ts`. | `lib/whatsapp.ts`, `index.ts`, `wrangler.toml`, `apps/web/public/_headers`, `lib/authAdmin.ts` |

## Verified so far
- After the branch was synced with main: `npm run typecheck` clean; `npm test` 30/30 (per the hand-off note).
- Not run: `sql/025`, `sql/tests/021`, real-login and invite-path checks, any deploy.

## Still to do before this counts as done
1. Ben commits the branch and says "run 025"; apply it, run test 021, rerun tests 001-020.
2. Real-login check (owner, manager, requester); invite paths over the API: new email gets `added` with a link; an existing account gets `invited` and accepts from the picker; an admin cannot touch an owner; the last owner is protected.
3. Check the CSP `connect-src` in `apps/web/public/_headers` covers every origin the app uses (API URL, `*.supabase.co`) before deploying.
4. Browser click-through by Ben (invite, accept, see the pending list).

## Out of scope / not audited
Anything added after the audit: item cost, finance (expenses and payments), customer invoices. Those were written with row level security, owner/admin-only money data, audit entries and SQL tests, but have had **no separate security review**.
