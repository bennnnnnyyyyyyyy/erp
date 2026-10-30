# Weekly audit, 2026-10-30

**Scope:** repo health and direction ("is the repo healthy, are we on the right track"). Read-only: no code, database or settings were changed.
**Method:** git history, `WORKLOG.md`, `checklist.md`, the security audit report, `npm test`, `npm run typecheck`, and greps over `sql/`, `apps/api/` and `apps/web/`.
**Not done:** no browser check, no live Supabase advisors or `EXPLAIN`, `.github/workflows` not read, `/doctor` and `teach-impeccable` not run. Frontend scores come from code only.

## Verdict

Technically healthy. Strategically drifting: lots of modules built, no demand evidence yet.

## Verified healthy

- `npm test`: shared 4/4, api 27/27 (5 files). Web typecheck clean (shared/api typecheck output was truncated, not seen).
- 28 migrations, 25 SQL test files (isolation, append-only, concurrency, known-answer finance). No migration creates a table without RLS.
- 104 `requirePermission` calls for 108 route handlers (check the other 4 by hand; likely public or webhook routes).
- No secrets in tracked files. `.env`, `.dev.vars`, `temp/` are git-ignored; only `.example` files are tracked.
- ADR-0003 boundary test keeps the admin client out of request routes.
- Security audit findings M-1, M-2, L-2 to L-5 fixed in `sql/025`, applied and tested (test 021).
- No hard-coded colours in TSX; logical CSS properties; token CSS with light/dark.

## Direction: not on track

1. **P0 (strategy): demand validation has not moved.** Checklist section G (competitor trials, 8-10 SME interviews) and H (e-invoicing, WhatsApp provider, payment gateway) are all unchecked, yet about 13 modules were built in two days. Step 0 is the gate in `MANAGEMENT_PLAN.md`. Pause new modules until interviews and trials happen.
2. **P1: `checklist.md` is stale.** "Last updated 2026-10-28", "Live: none", only Phase 0 in progress. Rewrite it from the worklog.
3. **P1: unverified in a browser or live.** Owner home, Finance, Batches, customer invoices, the removed "issue without approval" button, Connect WhatsApp. WhatsApp never tested end to end. Real-login, concurrency and invite-path checks not re-run after the merge. Needs manual checks by Ben (no automated browser testing).
4. **P1: finance, item cost, customer invoices had no security review** (stated in the security audit report).
5. **P2: no CI confirmed, no backups/restore check, no staging/production split, no runbook** (checklist section I).

## Repo hygiene

| Sev | Issue | Fix |
|---|---|---|
| P1 | `.claude/worktrees/security-audit-fixes` is tracked as a gitlink (live, locked worktree, 335 MB, branch `worktree-security-audit-fixes` at `6fd2b3e`, already merged into main) | After other sessions finish: `git rm --cached .claude/worktrees/security-audit-fixes`; remove the worktree; delete local and remote branch if no longer needed |
| P1 | Personal/one-off files tracked: `Trial_capture_workbook_  v10.xlsx`, `security-audit-fixes.patch`, `test dump.md`, `email to grant.md` | Move out of the repo or ignore; check the xlsx for real customer data |
| P2 | Root clutter: `neworder.md`, `orders.md`, `reply.md`, `REPLY_TO_CLAUDE_CHAT.md`, `migration.md`, `test.ps1` (`gpreport.html` and `temp/` are already ignored) | Move to `documentation/` or delete; the boundaries rule allows only a few root docs |
| P2 | Commit messages often wrong ("add tasks and transactional notification outbox" on unrelated work; "S", "s", "d") | Describe the actual change |
| P2 | In-progress alerts work uncommitted at audit time: `modules/alerts/`, `outbox.ts`, `registry.ts`, `modules.ts`, `sql/028`, `sql/tests/024` (main has since gained commit `0c168bf` for alerts) | 028 was not in the worklog as run; do not count it as done until it is |
| P2 | Remote is a personal GitHub account | Decide on an organization before outside access (checklist A) |

## Frontend audit (code only)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | 38 ARIA/role uses vs about 87 clickables; focus, contrast and labels unchecked |
| 2 | Performance | 2 | No `lazy()`/code splitting (0 hits); one bundle, including demo code |
| 3 | Responsive | 2 | 3 `@media` rules, one breakpoint (720px); no tablet or touch-target handling |
| 4 | Theming | 3 | Tokens and dark mode; 2 literal colours in `styles.css` |
| 5 | Anti-patterns | 3 | Warm paper/ink palette, self-hosted Plex fonts; not generic AI look; not seen rendered |
| | **Total** | **12/20** | Acceptable, significant work needed |

- **P1: i18n.** 13 `t(` calls vs about 170 English literals in JSX. Arabic and English from the first screen is a non-negotiable rule (`apps/web/src/lib/i18n.tsx` is 56 lines). Suggested: `$harden`.
- **P1: demo code is bundled in real builds** (checklist D, unchecked). Registry only gates it by flag. Suggested: `$optimize`.
- **P2: lazy-load modules by route.** Suggested: `$optimize`.
- **P2: accessibility pass** on buttons without labels, focus rings, contrast in both themes. Suggested: `$harden`, then `$adapt` for breakpoints and 44px touch targets.

## Database and cloud

- No performance baseline exists. Before adding indexes: run Supabase advisors (read-only) and capture `EXPLAIN (ANALYZE, BUFFERS)` on the hot queries (stock balances, ledger, insights_home, audit chain).
- Seed `004` loads direct inserts without per-row audit entries (one summary row) and once flooded the outbox (fixed, documented). Keep the trigger-disable pattern for any future seed.
- Batch mirror trigger runs on every ledger insert for tracked items; watch write latency as the ledger grows.
- Hosting region and data-protection review still open (checklist H).

## Recommended order

1. Untrack the gitlink and personal files; commit 028 and the alerts work (Ben's commit, per `agents.md`).
2. Rewrite `checklist.md` from the worklog.
3. Manual browser pass over the unverified screens; record it in the worklog.
4. Run Supabase advisors; index only what is measured.
5. Pause new modules until step 0 (interviews, trials) is done.
6. i18n pass, then lazy-loading and demo split, then accessibility; finish with `$polish`.

Re-run this audit after fixes to compare scores.
