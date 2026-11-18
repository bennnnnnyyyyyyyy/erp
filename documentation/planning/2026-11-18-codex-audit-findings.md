> Moved from the repository root (PR #75) on 18 Nov 2026 by the master chat; links rewritten for this folder. Written by Codex.


# ERP Deep Audit Findings

**Review date:** 18 November 2026  
**Scope:** Read-only review of the main checkout and local .claude/worktrees/ui-warm Design Lab worktree: API/auth/tenancy, migration 097 and its test, web account and invitation flows, Design Lab, CI/deploy workflows, and current project records.  
**Changes:** This report is the only file changed. No application source was edited. No tests, browser sessions, production checks, or automated scanners were run.

## Executive summary

The review found two database correctness issues in the new supplier-price recorder, two user-facing invitation/authentication issues, a migration/release readiness gap, an API route-permission policy gap, and Design Lab and CI hardening issues. I found no confirmed cross-tenant data exposure in the API and SQL paths reviewed.

The team count is one engineer, as Ben clarified. The four Git author labels are aliases used by Ben.

The CI guard changes are now merged into main (PR #73, commit 74558f3). The migration-number check and column-grant test are present. The docs-only browser-test skip is partial: another required workflow still runs the screen smoke test on documentation-only pull requests.

## Findings and suggested fixes

### P2 — Concurrent supplier order and bill writes can let an order replace the actual bill cost

The migration intends a purchase order to suggest a cost only until a supplier bill records the actual cost. The recorder first selects the current row FOR UPDATE, then performs an unconditional upsert. If no row exists, concurrent transactions can both see no row. A bill can insert first, then the order transaction can win the unique-key conflict and overwrite the bill source and cost.

The SQL test covers order then bill sequentially, not this race.

**Suggested fix:** Serialize record creation by the supplier/item/currency key before reading, or make the conflict update preserve an existing bill when the incoming source is an order. Add a concurrent regression test that races the two trigger paths and asserts the final source is the bill.

Evidence: [097_sal_prices.sql, recorder and upsert](../../sql/097_sal_prices.sql#L130-L145) · [093_sal_prices.sql, sequential precedence test](../../sql/tests/093_sal_prices.sql#L37-L57)

### P2 — Supplier-price provenance can change without an audit event

The upsert can change source kind, source ID, source number, and recorded time. The audit condition only checks whether the row exists and whether the cost amount changed. A bill can replace an order as the source at the same cost, updating persisted provenance without an audit row.

**Suggested fix:** Compare every persisted field that can change and write an audit event whenever any value changes. Include before/after source number and source ID in the audit payload; test the same-cost, different-source case.

Evidence: [097_sal_prices.sql, upsert fields](../../sql/097_sal_prices.sql#L141-L145) · [097_sal_prices.sql, audit condition](../../sql/097_sal_prices.sql#L146-L152)

### P2 — Prices UI can be present before its database migration is applied

Migration 097 is marked **Not applied** in the migration register and worklog. The Sales → Prices page and API routes are already in main. The API deliberately returns 503 not_set_up until the migration exists, preventing undefined SQL behavior, but anyone reaching the page before the manual migration will see an unavailable feature. The production workflow deploys app code on pushes to main and does not wait for manual SQL migration status.

**Suggested fix:** Treat the SQL apply as a release prerequisite for exposing the UI. Apply and verify 097 before enabling/deploying the price page, or gate the menu/page behind an explicit readiness flag until the migration is applied. Keep the 503 guard as a last line of defense.

Evidence: [WORKLOG.md, 097 marked not applied](../../documentation/operations/WORKLOG.md#L14) · [sql/README.md, 097 marked not applied](../../sql/README.md#L109) · [prices.ts, missing-schema behavior](../../apps/api/src/modules/sales/prices.ts#L10-L13) · [registry.tsx, Prices route](../../apps/web/src/modules/registry.tsx#L201-L210) · [ci-deploy.yml, deploy follows main push](../../.github/workflows/ci-deploy.yml#L76-L80)

### P2 — Invitation lookup failure is treated as “no invitations”

When the invitation RPC fails, OrgPicker replaces the error with an empty invitation list. For an account with no current memberships, the component then opens the create-company flow. A person whose invitation lookup failed can be led to create a duplicate company instead of seeing or accepting the invitation.

The membership-query failure is handled separately; this finding concerns the invitation-query failure path.

**Suggested fix:** Keep organizations available, but represent invitation status as loading, loaded, or failed. On failure, show a localized retry message and do not infer that no invitation exists or auto-open company creation until the lookup succeeds.

Evidence: [OrgPicker.tsx, error becomes empty list](../../apps/web/src/components/OrgPicker.tsx#L22-L40) · [OrgPicker.tsx, create-company decision](../../apps/web/src/components/OrgPicker.tsx#L57-L63)

### P2 — Supabase authentication errors bypass the app’s Arabic error mapping

Errors from the app API pass through translateServerError, but sign-in, sign-up, password reset, password update, and organization-picker RPC failures render Supabase’s raw error.message. These messages can be English or provider-specific, even when the rest of the screen is Arabic.

**Suggested fix:** Map stable Supabase error codes to app-owned localized messages. Use a localized generic message for unknown codes, and log only a sanitized code if diagnostics are needed. Avoid translating arbitrary provider message text.

Evidence: [SignIn.tsx](../../apps/web/src/components/SignIn.tsx#L26-L57) · [SetPassword.tsx](../../apps/web/src/components/SetPassword.tsx#L21-L24) · [OrgPicker.tsx](../../apps/web/src/components/OrgPicker.tsx#L27-L30) · [API error localization](../../apps/web/src/lib/api.ts#L79-L95)

### P2 — Core API permission exceptions are implicit, and read-route coverage is missing

The core /session, /me/language, and /people routes do not declare requirePermission, despite the repository rule requiring every API route to check a permission. The handlers appear intentionally limited to session bootstrap, the caller’s own language, and organization member names; I found no confirmed cross-tenant exposure. However, the automated permission inventory focuses on write routes and would not catch a new unguarded read route.

**Suggested fix:** Preserve bootstrap and self-service behavior with explicit, documented exceptions. Add a route-inventory test that requires every route to either use a permission or be on an allowlist with a reason and test. Add read-route checks for organization scoping and viewer/member role boundaries.

Evidence: [core/routes.ts](../../apps/api/src/modules/core/routes.ts#L54-L94) · [agents.md, route rule](../../agents.md#L33-L39) · [new_routes_auth.test.ts](../../apps/api/test/new_routes_auth.test.ts)

### P2 — Workflow action tags are mutable in the deployment path

The production workflow uses major-version action tags such as actions/checkout@v4, actions/setup-node@v4, and cloudflare/wrangler-action@v3. The Cloudflare action runs in the job that receives the production API token. If a referenced tag moves to compromised code, it could access deployment credentials.

**Suggested fix:** Pin third-party actions to reviewed full commit SHAs, with version comments, and configure automated update PRs for those pins. Keep least-privilege job permissions and production environment protections.

Evidence: [ci-deploy.yml action references](../../.github/workflows/ci-deploy.yml#L27-L37) · [production deploy action and token](../../.github/workflows/ci-deploy.yml#L108-L121)

### P2 — Design Lab option buttons do not announce which option is selected

The Lab marks selected options and filters with a CSS class, but does not expose selection state through aria-pressed or radio-group semantics. Screen-reader users can activate options without being told which value is active.

**Suggested fix:** Use radio-group semantics for mutually exclusive choices and aria-pressed for independent toggles. Give search/import/preset fields explicit labels, then check the Lab with keyboard and screen-reader navigation.

Evidence: [DesignLab.tsx, option controls](../../apps/web/src/components/DesignLab.tsx#L107-L122) · [DesignLab.tsx, filters and text fields](../../apps/web/src/components/DesignLab.tsx#L279-L292)

### P2 — The Design Lab contrast panel overstates its coverage

The panel is titled “Contrast check (WCAG)” but computes five selected token pairs, not all color pairs and states used by the application. Status indicators, chips, selected controls, gradients, and other combinations can remain unchecked while the panel appears to certify contrast.

**Suggested fix:** Expand the checks to actual component foreground/background pairs and interaction states, including both themes, or rename the panel to say it reports a limited token sample. Do not present a partial check as a WCAG pass.

Evidence: [DesignLab.tsx, panel label and output](../../apps/web/src/components/DesignLab.tsx#L351-L355) · [designLab.ts, contrast calculation](../../apps/web/src/lib/designLab.ts#L330-L358)

### P2 — The Design Lab launcher can obscure phone content and panel placement reverses in RTL

The floating launcher sits 16px from the viewport edge and has no safe-area offset; the rollout notes also report phone overlap. Separately, the panel’s “start” and “end” positions use physical left and right, so they do not follow the document’s RTL direction.

**Suggested fix:** Add safe-area-aware offsets and test against the app’s fixed mobile actions. Use logical inset-inline-start/end for panel placement and margin-inline-end for the color dots. Keep the Lab internal, but make its preview behavior reliable in both directions.

Evidence: [DesignLab.tsx, panel positioning](../../apps/web/src/components/DesignLab.tsx#L21-L24) · [DesignLab.tsx, physical margin](../../apps/web/src/components/DesignLab.tsx#L55) · rollout plan, phone overlap (`documentation/planning/2026-11-12-new-look-rollout-plan.md`, not in the repository)

### P3 — Documentation-only pull requests still run the other browser smoke test

The workflow-tests job skips its full real-app workflow tests on docs-only pull requests. However, ci-deploy.yml still installs Chromium and runs the sample-build screen smoke test unconditionally for every pull request. Documentation-only changes therefore do not skip all browser work as described in the CI handoff.

**Suggested fix:** Add a docs-only change detector to the smoke-test steps in ci-deploy.yml, while keeping those tests enabled on pushes to main and manual runs. Ensure required-check status remains green when steps are intentionally skipped.

Evidence: [ci-deploy.yml, smoke test runs unconditionally](../../.github/workflows/ci-deploy.yml#L57-L68) · [workflow-tests.yml, docs-only skip](../../.github/workflows/workflow-tests.yml#L37-L51)

### P3 — Root README status is stale; checklist content is newer than its date

The README still identifies status as 11 November and lists migration range 001–078 and 081–083. The checklist body records work through 097, including 097 as built but not applied, but its header still says it was updated on 11 November. The worklog itself is current through 18 November, so the earlier report’s claim that the worklog was stale was wrong.

**Suggested fix:** Refresh the README status date and migration summary, and update the checklist date. Preserve the checklist’s distinction between built and applied.

Evidence: [README.md, stale status line](../../README.md#L5) · [checklist.md, stale header and current 097 status](../../documentation/plans/checklist.md#L3-L12) · [WORKLOG.md, current 097 entry](../../documentation/operations/WORKLOG.md#L14-L42)

## Checked and not reported as findings

- The 18 November CI guard PR is merged into main. The migration-number check verifies unique numbers within migration and test directories and that migrations are recorded in sql/README.md; the column-grant guard is present as SQL test 092.
- The previous missing read grant for inv_items.group_id was fixed in migration 096; it is not still open.
- A focused review of auth, tenant/module middleware, caller-JWT data access, service-role allowlists, signed webhook paths, and migrations 094–096 found no confirmed authorization bypass or cross-tenant data exposure. The database findings above are from 097.
- I suspected company language could carry from one organization to another, then withdrew that concern after tracing tenant middleware: it normalizes the language value to English or Arabic before the web shell receives it.

## Review limits and next verification

This is a source and documentation review, not a runtime certification. I did not run tests or inspect GitHub run results, branch-protection settings, production data, or the live app. The Design Lab worktree is clean but diverged from its remote by 3 local commits and 7 remote commits; its findings apply to the local snapshot reviewed.

For the next pass, verify the two SQL fixes with concurrency and audit regression cases, run the existing SQL/API/web checks, confirm required-check settings, and inspect the deployed workflow result and 097 migration status before treating the Prices page as live.
