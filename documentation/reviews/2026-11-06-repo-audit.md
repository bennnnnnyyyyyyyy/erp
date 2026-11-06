# Repository audit report

> Moved from the repository root (`REPO_AUDIT_REPORT.md`) on 6 Nov 2026, night (finding N8).

**Audit date:** 6 November 2026  
**Scope:** Product and architecture docs, current API/web/shared code paths, migrations and CI configuration. Static review only.  
**Outcome:** No code, database, or deployment changes. This report is the only file created.

## Executive summary

The repository contains a substantial early ERP implementation with a strong database-first foundation. It has organization-scoped access, permission and module checks, SQL-backed business mutations, append-only audit design, inventory approvals, accounting, finance, and integration work. The primary risk found in this pass is operational: the project’s documentation and CI do not consistently tell contributors which schema and features are current or what must pass before a deployment.

There are also several integration readiness gaps: the public WhatsApp webhook buffers oversized requests before rejecting them; outbound messaging can duplicate after recovery; AI consent does not compare notice versions; and the Ollama URL validator accepts addresses that contradict the UI’s HTTPS requirement. Provider routes and the migration are present in source, but the latest worklog says migration 056 was not applied and the provider settings UI and live adapters are not built.

No P0 issue was found in this static pass. The scores below are provisional and reflect source inspection plus the recorded UI audits; they are not fresh browser measurements.

## Application map

- **Web:** React and Vite in apps/web. The module registry builds the app menu and lazy-loads screen components. Demo mode uses in-browser sample data.
- **API:** Hono on Cloudflare Workers in apps/api. For /v1 requests, middleware verifies a Supabase JWT, resolves the organization from X-Org-Id, checks membership/module access, and route handlers check permissions.
- **Data:** Supabase Postgres migrations in sql/. User-scoped API clients forward the caller’s JWT so RLS and database functions enforce tenant and role rules. The service-role client is used for scheduled work, webhooks, and limited Auth provisioning.
- **Product:** Warehouse-first multi-tenant ERP for SMEs in Egypt and the GCC. Inventory, purchasing, sales, finance, accounting and treasury code exists. The README and worklog still describe the product as early-stage and not production-ready; that status is consistent with open deployment, review, and integration work.

Key entry points: [API index](../../apps/api/src/index.ts), [tenant middleware](../../apps/api/src/middleware/tenant.ts), [database client](../../apps/api/src/lib/db.user.ts), [module registry](../../packages/shared/src/modules.ts), and [web shell](../../apps/web/src/components/Shell.tsx).

## Findings

### P1 — Release and data-operation risks

#### 1. SQL changes are not a required CI gate

The production deployment workflow waits on the TypeScript checks, tests, and web build, but not on the separate SQL test workflow ([ci-deploy.yml:67](../../.github/workflows/ci-deploy.yml:67), [sql-tests.yml:5](../../.github/workflows/sql-tests.yml:5)). The SQL workflow itself says it is separate from deployment. As a result, a migration can reach the main deployment path without the SQL integration suite passing or even starting. This weakens the project’s main safety boundary: business rules are enforced in SQL, not only in API code.

**Recommendation:** Make successful SQL tests a required check for migration changes before deployment, or explicitly prevent a deploy when those checks did not run. Keep infrastructure-start failures distinguishable from test failures.

#### 2. Migration 056 has conflicting run instructions and status

The latest worklog says migration 056 was dry-run only and must not be applied without Ben’s explicit yes ([WORKLOG.md:37](../../documentation/operations/WORKLOG.md:37)). The migration table in [sql/README.md:67](../../sql/README.md:67) ends at 055, but its next line instructs readers to apply migrations 001–056 ([sql/README.md:70](../../sql/README.md:70)). The README also tells users that the real app needs migrations only through 035 ([README.md:46](../../README.md:46)). These instructions can lead to incorrect setup or applying an unapproved migration.

**Recommendation:** State the exact live-applied migration boundary, list 056 as written/dry-run/not applied, and make the generic run instruction explicitly staging-only until approval.

### P2 — Documentation and product-state drift

#### 3. Canonical product docs describe an older product

The root README is dated 2 Nov and predates accounting, treasury, and provider connection work ([README.md:5](../../README.md:5)). The product brief still says inventory needs an approved plan and puts a general ledger out of scope ([PRODUCT_BRIEF.md:39](../../PRODUCT_BRIEF.md:39), [PRODUCT_BRIEF.md:49](../../PRODUCT_BRIEF.md:49)). Later checklist and worklog entries describe accounting/treasury implementation through 6 Nov. The README’s broad Arabic/English claim also lacks the qualification in the latest UI audit that Arabic strings are machine drafts awaiting review ([2026-11-06-ui-audit.md:32](2026-11-06-ui-audit.md:32)).

**Impact:** Contributors and prospective users can mistake planned, partially built, or not-yet-deployed features for the current shipped product.

#### 4. Checklist sections contradict their own dates and status

The checklist says “Last updated: 2026-11-02” while including 6 Nov updates ([checklist.md:3](../../documentation/plans/checklist.md:3)). Its overview says translations do not exist, but recent UI work added Arabic drafts ([checklist.md:11](../../documentation/plans/checklist.md:11)). Its accounting overview and later accounting detail do not agree on whether the work is still awaiting approval or has been built and applied ([checklist.md:13](../../documentation/plans/checklist.md:13), [checklist.md:29](../../documentation/plans/checklist.md:29)). The document labels its old detail/task blocks as stale, but they remain interleaved with active status and can still mislead.

**Recommendation:** Keep one current status table and move dated historical checklists into an archive or clearly separated section.

#### 5. The architecture page and plan index are stale placeholders

The docs index points contributors to ARCHITECTURE.md as the live system description ([documentation/README.md:28](../../documentation/README.md:28)), but that file says it is unwritten ([ARCHITECTURE.md:9](../../documentation/architecture/ARCHITECTURE.md:9)). The plans index says module plans will be added later even though many are present ([plans/README.md:19](../../documentation/plans/README.md:19)).

**Recommendation:** Write a current system map or stop presenting the placeholder as authoritative; refresh the plan index from the actual directory.

#### 6. Internal document links are broken

A relative-link scan of first-party Markdown found eight non-template links that point to incorrect locations or missing files. Examples include the ADR-0004 draft linked from [ACCOUNTING_PLAN.md:10](../../documentation/plans/ACCOUNTING_PLAN.md:10) and the ERPNext/Dolibarr teardown links in [SUPERFIX_WORKFLOW_PLAN.md](../../documentation/plans/SUPERFIX_WORKFLOW_PLAN.md). The actual ADR draft is under architecture/decisions, while several links target planning/ or architecture/plans.

**Impact:** The docs hierarchy is already difficult to reconcile; broken links make it harder to find the authority for decisions and research.

#### 7. Root-level scratch and handoff files conflict with the docs rules

The docs index says project documentation belongs under documentation/ and gives a limited root allowlist ([documentation/README.md:39](../../documentation/README.md:39)). The root contains extra notes and handoffs such as colluege audit.md, s.md, sss.md, neworder.md, reply.md, 22.md, and REPLY_TO_CLAUDE_CHAT.md. The product-name placeholder {{PRODUCT_NAME}} also remains in canonical docs, including README, PRODUCT_BRIEF, documentation index, and worklog.

**Impact:** The project has multiple apparent starting points and old AI handoffs that can be mistaken for current direction. The placeholder makes the product look unfinished in public-facing entry points.

**Recommendation:** Move durable notes into the right documentation folder, archive obsolete scratch material, and replace or deliberately retain the product-name placeholder consistently.

### P2 — API, database, and integration correctness

#### 8. WhatsApp’s request-size cap is checked after buffering

The unauthenticated WhatsApp webhook reads the complete body before enforcing the 100 KB limit and checking the HMAC signature ([index.ts:54](../../apps/api/src/index.ts:54)). A large request is therefore fully buffered before the 413 response. The IP rate limit reduces repetition but does not make the size guard effective against a single very large body.

**Recommendation:** Enforce a byte limit while reading the stream, before constructing the full body string; also reject oversized Content-Length early when present.

#### 9. Slack, Teams, and Telegram delivery can duplicate during outbox recovery

The job sends an external message, then records completion in Postgres ([outbox.ts:61](../../apps/api/src/jobs/outbox.ts:61), [outbox.ts:66](../../apps/api/src/jobs/outbox.ts:66)). If the external send succeeds and the worker stops before the completion write, the database recovers a message stuck in “sending” after five minutes ([007_tasks_and_outbox.sql:288](../../sql/007_tasks_and_outbox.sql:288)). The Slack, Teams, and Telegram adapters do not attach a stable idempotency key ([integrations.ts:144](../../apps/api/src/lib/channels/integrations.ts:144), [integrations.ts:161](../../apps/api/src/lib/channels/integrations.ts:161)). Resend has an idempotency key, but the other adapters do not.

**Impact:** Recipients can receive repeated alerts or approvals after a worker interruption or completion-RPC failure.

**Recommendation:** Use provider-supported idempotency where available and document at-least-once delivery where it is not; consider a delivery-attempt state that makes the uncertainty visible.

#### 10. AI consent does not re-check the notice version

The owner-consent function returns if any active consent exists, without comparing its version to the version being accepted ([056_provider_connections.sql:161](../../sql/056_provider_connections.sql:161)). If the notice changes from v1, an organization that accepted the old notice could remain treated as consented without accepting the new one.

**Recommendation:** Compare the active version to the requested version and require a fresh audited acceptance when it changes. Add a test for v1 consent followed by v2.

#### 11. Ollama address validation disagrees with the UI requirement

The database accepts either HTTP or HTTPS and does not reject localhost/private addresses ([056_provider_connections.sql:53](../../sql/056_provider_connections.sql:53)). The shared provider definition tells users the address must be internet-reachable over HTTPS ([integrations.ts:166](../../packages/shared/src/integrations.ts:166)). The actual Ollama adapter is not built yet, so this is a configuration correctness and pre-release hardening issue, not a demonstrated current data-exposure path.

**Recommendation:** Enforce the documented HTTPS/public-host requirement before any server-side adapter calls the configured URL, and define how approved private-network connectivity would work if needed.

### P2 — UI, performance, and process

#### 12. Screen chunks are all fetched after sign-in

The app splits screens into lazy chunks, but the shell schedules a preload of every registered screen while the browser is idle ([Shell.tsx:99](../../apps/web/src/components/Shell.tsx:99), [registry.tsx:314](../../apps/web/src/modules/registry.tsx:314)). This cuts waits when a screen is opened but also downloads screens the user may never visit, which can consume mobile data and compete with useful work on a weak connection.

**Recommendation:** Preload only likely next screens or stop preloading on constrained connections; verify the tradeoff with actual bundle/network measurements.

#### 13. One empty table header remains

ConnectPhone has a blank final table header ([ConnectPhone.tsx:73](../../apps/web/src/modules/messaging/ConnectPhone.tsx:73)). The latest UI audit also records it as unfixed. A screen reader cannot understand the purpose of that column.

**Recommendation:** Give the column a visually hidden Actions label or restructure the table if it has no semantic column heading.

#### 14. CI runs automated browser tests despite the repository rule

The agent instructions say not to use automated browser testing ([agents.md:55](../../agents.md:55)), while the production CI workflow installs Playwright and runs test:e2e on every relevant CI run ([ci-deploy.yml:55](../../.github/workflows/ci-deploy.yml:55)). This is a direct policy conflict, not a finding about whether the smoke test itself passes.

**Recommendation:** Resolve the conflict by changing either the repo rule or the workflow, with the repo owner deciding which policy is intended.

#### 15. Production build defaults a demo autofill action to one account-specific email

The production workflow defaults DEMO_AUTOFILL_EMAILS to chris.johnson.wiz@gmail.com when no repository variable is set ([ci-deploy.yml:93](../../.github/workflows/ci-deploy.yml:93)). This is account-specific access behavior embedded in deployment configuration. The repo rules say customer-specific settings belong in organization/configuration data, not hardcoded defaults.

**Impact:** The production build silently grants the sample-data autofill action to one named account unless deployment configuration overrides it.

**Recommendation:** Require an explicit deployment variable or use a non-user-specific feature flag. Confirm whether the exposed account is synthetic and whether the production action is still needed.

#### 16. Provider integrations are not end-to-end features yet

The source has provider API routes and SQL 056, but the latest worklog says the migration is not applied and the provider settings screen, AI notice UI, payment/shipping/store/AI adapters, and setup guide are not built ([WORKLOG.md:37](../../documentation/operations/WORKLOG.md:37), [WORKLOG.md:45](../../documentation/operations/WORKLOG.md:45)). Treat this as roadmap/status, not as a working customer capability.

**Recommendation:** Keep providers marked as setup scaffolding until migration approval, UI, adapters, and an end-to-end verification path are complete.

### P3 — Product polish and evidence gaps

#### 17. Arabic is not yet ready to claim as fully supported

The current UI audit says the new Arabic strings are machine drafts without native-speaker review and that live Arabic and live phone checks were not run ([2026-11-06-ui-audit.md:32](2026-11-06-ui-audit.md:32), [2026-11-06-ui-audit.md:39](2026-11-06-ui-audit.md:39)). This is consistent with an early build, but the README language claim should be qualified until reviewed.

#### 18. Audit conclusions are not fresh runtime verification

The UI score and most security conclusions here come from source and existing dated reports. I did not run typecheck, tests, SQL tests, live API checks, or browser checks. This report therefore identifies code and process risks; it does not certify that the current branch builds, that the database matches the migration log, or that the live deployment contains this source.

## Technical quality score

Provisional 0–4 scores based on static review and recorded audit evidence:

| Dimension | Score | Reason |
|---|---:|---|
| Accessibility | 3/4 | Recent sample audit reports labels, contrast, and touch-target fixes; blank header remains, and live Arabic/phone are unverified. |
| Performance | 3/4 | Lazy chunks exist, but all screens are preloaded after sign-in. No fresh network measurement. |
| Theming | 3/4 | Token-based light/dark themes exist; live post-fix appearance was not rechecked. |
| Responsive design | 3/4 | Recorded sample audit found no horizontal overflow; live phone layout was not checked. |
| Anti-patterns | 4/4 | Source shows an intentional warehouse-oriented palette and type choices; no strong generic AI-dashboard styling was evident in code. |
| **Total** | **16/20 — Good** | Score is provisional; visual appearance was not inspected in a browser. |

## Positive findings

- API requests use the caller’s JWT and publishable key for business reads and mutations; role and tenant checks are also designed into the database boundary.
- Module manifests centralize permissions and dependencies, and the API applies module guards before dispatching module routes.
- Stock and accounting use append-only/transactional database patterns, with a large SQL test corpus recorded in the repository.
- User-facing styles include theme tokens, logical CSS properties, reduced-motion handling, and phone-size touch-target rules.
- Provider secrets are designed for Vault storage and are not returned by the provider settings API. Worklog status distinguishes the 056 dry run from an applied migration.

## Recommended order

1. Make SQL tests a required deployment gate and reconcile migration 056’s status/instructions.
2. Refresh README, checklist, architecture page, and plan index from the current worklog; fix broken links and archive stale root notes.
3. Harden webhook body limits, add a test for AI notice-version changes, and decide how external delivery retries should handle duplicates.
4. Resolve the Playwright/repository-rule conflict and replace the implicit production autofill allowlist default.
5. Complete provider setup and adapters only after their database migration and approval path are clear.
6. Review Arabic with a native speaker and manually check live phone and RTL screens when available.

## Verification record

- Read and mapped the project’s first-party product, architecture, planning, operations, and review docs relevant to current status; imported ETA SDK reference pages and bundled skill documentation were not read page by page.
- Inspected current API middleware and integration/provider routes, the outbox and webhook paths, frontend shell/registry/styles, migration 056, SQL test 051, deployment workflows, and key project metadata.
- Relative Markdown-link scan: eight non-template broken/mislocated links found among the first-party docs examined.
- Tests and browser checks: not run. The available PowerShell launcher was denied by the environment; direct Node subprocess launch also returned EPERM. No database or production operations were attempted.
- Files changed: REPO_AUDIT_REPORT.md only.

---

## Addendum: re-verification and new findings (6 November 2026, later the same day)

**Scope:** every finding above re-checked against the current tree (branch `integrations-all`; its application code is identical to `main`, only documentation files differ), plus a further pass over the webhooks, outbox, AI service, migrations 053–060, route permission checks, git-tracked files and Markdown links. Revised the same night after a second reviewer's reply (`REPLY_TO_CLAUDE_CHAT.md`); every point in that reply was checked against the code before it was accepted. Static review; no tests, database or production operations were run.

### Status of the original findings

| # | Finding | Status now |
|---|---|---|
| 1 | SQL tests are not a deploy gate | **Confirmed.** Extra complications: `sql-tests.yml` only triggers on `sql/**` changes, and it reports success when the database could not start (N12). Neither is fit to be a required check as written. |
| 2 | Migration 056 status conflict | **Superseded.** 056–060 are all applied to live (worklog 6 Nov night; [sql/README.md](../../sql/README.md)). The remaining drift: [README.md:46](../../README.md:46) still says the real app needs `sql/001`–`035`. |
| 3 | Canonical product docs stale | **Confirmed.** |
| 4 | Checklist contradicts itself | **Confirmed.** |
| 5 | ARCHITECTURE.md and plan index are placeholders | **Confirmed.** |
| 6 | Broken internal links (8) | **Confirmed: 9.** Root cause of five: ADR-0004 moved to `architecture/decisions/` but links still use `../planning/`, and the ADR's own links use `../plans/` (should be `../../plans/`). Two more point at research teardowns that were never written (see N5). |
| 7 | Root scratch files and `{{PRODUCT_NAME}}` | **Confirmed and wider** (see N6, N8). |
| 8 | WhatsApp body read before size cap | **Confirmed and wider.** Telegram, Paymob, Fawry, Bosta and Shopify webhooks do the same ([index.ts:57](../../apps/api/src/index.ts:57) onwards); Paymob, Fawry and Bosta buffer before any authentication. `/v1/core/ai/transcribe` parses the whole multipart upload with `formData()` before its 5 MB check. The caps compare UTF-16 string length, not bytes. Limits differ per route on purpose: 100,000 for most webhooks, 1,000,000 for Shopify ([index.ts:117](../../apps/api/src/index.ts:117)), 5 MB for audio. |
| 9 | Duplicate delivery after recovery | **Confirmed.** The WhatsApp adapter has no idempotency key either. |
| 10 | AI consent ignores notice version | **Confirmed** ([056_provider_connections.sql:161](../../sql/056_provider_connections.sql:161)). |
| 11 | Ollama URL validation | **Partly fixed.** The server now calls `assertSafeOllamaUrl` (https only, no localhost, IP literals or `.local/.internal/.lan`) before every request ([aiProviders.ts:41](../../apps/api/src/lib/aiProviders.ts:41)). Remaining: the database still accepts `http://`, and the request follows redirects (N3). See also N10. |
| 12 | All screens preloaded after sign-in | **Confirmed** (production builds only, [Shell.tsx:95](../../apps/web/src/components/Shell.tsx:95)). |
| 13 | Empty ConnectPhone header | **Confirmed** ([ConnectPhone.tsx:73](../../apps/web/src/modules/messaging/ConnectPhone.tsx:73)). |
| 14 | Playwright vs. repo rule | **Confirmed as a policy conflict.** The project owner's standing guidance is that the browser ban targets specific agents, so the rule wording, not CI, is the likely fix. |
| 15 | Account-specific autofill default | **Confirmed.** The same address is also used in [onboardingSample.test.ts:43](../../apps/web/src/modules/help/onboardingSample.test.ts:43). |
| 16 | Provider integrations not end-to-end | **Mostly superseded.** Stages A–E (settings, pay links, Bosta, Shopify, AI and voice) are built, on `main`, and their migrations applied. Stage F (bank statement import, CBE rates) and G (setup guide) are not started. The integrations report's step "merge `integrations-all` into `main` so the new screens go live" is stale: the code is already on `main`. |
| 17 | Arabic not ready to claim | Still true. |
| 18 | Not runtime-verified | Still true, including for this addendum. |

### New findings

#### N1 (P2). One failed completion write aborts the whole delivery pass

[outbox.ts:67](../../apps/api/src/jobs/outbox.ts:67) throws inside the send loop when `msg_complete_delivery` fails. The rest of the claimed batch waits five minutes in `sending`, and the message whose send succeeded is sent again.

**Recommendation:** do **not** simply continue the loop: if the database is down, continuing sends the whole batch with nothing recorded, and all of it is resent later. Instead retry the completion write once or twice; treat `INVALID_STATE` on a retry as "the first write already committed" (the result is ambiguous, because `msg_complete` refuses any row no longer in `sending`); if it still fails, stop sending and return a result rather than throwing.

#### N2 (P2). Worklog is out of order and carries stale status

The 2026-11-05 review entry sits above the 11-06 entries in [WORKLOG.md](../../documentation/operations/WORKLOG.md), breaking "newest first". Several 6 Nov entries still say 058–060 are not applied and Stage E is not committed, while later entries record 056–060 applied and Stage E is on `main`. They are valid historical snapshots, but none is marked superseded, and the worklog is the declared source of truth.

**Recommendation:** move the misplaced entry; add a one-line "Superseded by …" note to each stale status entry rather than rewriting history.

#### N3 (P3). Ollama request follows redirects

`chatOllama` uses the default `redirect: 'follow'`, so a host that passes `assertSafeOllamaUrl` can redirect the call elsewhere (including plain http). Cloudflare Workers cannot reach private networks, so impact is low, but the guard should not be bypassable by one hop.

**Recommendation:** `redirect: 'manual'`, with a clear message asking for the final address.

#### N4 (P3). sql/README describes the SQL workflow incorrectly

[sql/README.md](../../sql/README.md) says the SQL workflow "has not run on GitHub yet". GitHub Actions history shows it has: five successful runs on 6 Nov 2026 (including PR #9 and its merge). "Non-blocking" is still accurate, since deploy does not depend on it.

#### N5 (P2). Competitor research is git-ignored despite the rule requiring it there

`.gitignore` contains `documentation/research`, while agents.md requires research under `documentation/research/<slug>/`. Existing files (Miracle, Odoo) were force-added, so any new teardown is silently left out unless someone remembers `git add -f`. The ERPNext and Dolibarr teardowns linked from SUPERFIX_WORKFLOW_PLAN.md do not exist locally either: the plan cites research that was never written.

#### N6 (accepted by the owner). Personal and working files in a public repository

The GitHub repository is public and tracks `email updates for grant.zip` (six `.eml` emails plus a workbook), `Trial_capture_workbook_v13.xlsx`, `ERP_integrations_table.pdf` and a saved page `Home (11_2_2026 …).html`; the worklog, CI workflow and a test name staff and demo email addresses. The `eyJ…` string in the HTML is image data, not a token; the `.eml` contents were not inspected. The repository has no forks.

**Owner decision (6 Nov 2026):** accepted as is. The owner considers the emails worthless and the account unseen; no visibility change or history rewrite. Kept here only so later reviewers do not re-raise it.

#### N7 (P2). agents.md and PRODUCT_BRIEF describe the old product direction

Both describe a warehouse-first product with a general ledger out of scope; the current direction (Nov 2026) is a general-purpose ERP with the accounting suite first. agents.md is loaded by every AI agent in every session, so it propagates the old direction into new work.

#### N8 (P3). This report breaks the root allowlist

`REPO_AUDIT_REPORT.md` sits at the root, which the documentation rules reserve for a fixed list of files; reviews belong in `documentation/reviews/`.

#### N9 (P3). Test fixture uses a real account email

[onboardingSample.test.ts](../../apps/web/src/modules/help/onboardingSample.test.ts) uses the demo presenter's real address. Use a reserved `.test` address.

#### N10 (P2). Ollama sends company data to an outside host without the AI notice

`ai__provider_state` enables Ollama without consent ([060_ai_state.sql:20](../../sql/060_ai_state.sql:20): `k = 'ollama' or v_consent`), on the premise that it is the company's own machine. But the server only accepts a public https host name ([aiProviders.ts:41](../../apps/api/src/lib/aiProviders.ts:41)), and the assistant sends the question plus matched item names and stock levels to it ([aiService.ts:118](../../apps/api/src/lib/aiService.ts:118)). An admin (not only the owner) can therefore point company data at any internet host, with no owner notice. The integrations report's line "Ollama keeps all data inside the company" ([2026-11-06-integrations-report.md:56](../../documentation/operations/2026-11-06-integrations-report.md:56)) is not true as built: data leaves our servers and crosses the internet to whatever host is configured.

**Recommendation:** either require the AI notice for Ollama too (simplest, and honest), or require the owner to confirm the host as company-controlled, audited. Correct the integrations report wording.

#### N11 (P2). The USD 100 shared AI cap is not a hard cap

`checkCaps` reads the month's spend, the provider is called, and usage is recorded afterwards ([aiService.ts:41](../../apps/api/src/lib/aiService.ts:41) onwards). Concurrent requests can all pass the check before any is recorded, and a failed usage write is logged and swallowed, so that cost is never counted. Speech cost is estimated from file size at a fixed 16 kB per second ([aiProviders.ts:35](../../apps/api/src/lib/aiProviders.ts:35)); a low-bitrate recording is under-counted. The overshoot per request is small (800 output tokens, 5 MB audio), so this is a soft cap with bounded overrun, not an open tap.

**Recommendation:** document it as a soft cap; reserve an estimated cost in the database before the call (one function that checks and inserts atomically), then settle the real cost; set a provider-side spending limit on our OpenAI account as the true hard stop.

#### N12 (P2). The SQL workflow passes when no SQL test ran

In [sql-tests.yml](../../.github/workflows/sql-tests.yml) the stack start is `continue-on-error`; if it fails, a warning is printed and the test step is skipped, and the job still finishes green. As a required check it would let a SQL-changing PR merge untested.

**Recommendation:** when SQL changed and the stack could not start, fail the job with a distinct message ("infrastructure: tests did not run, re-run"), so "passed" only ever means "tests ran and passed".

### Checked and found sound

- Migrations 053–060: every new table has `org_id`, RLS enabled, `revoke all` from `anon`/`authenticated`, then `grant select` (057 and 058 do it in a loop).
- Every webhook signature or secret comparison is constant-time (`safeEqual`, `equalText`).
- The AI assistant's PostgREST `.or()` filter is built from words matching `[\p{L}\p{N}-]`, so commas, dots and parentheses cannot inject filter syntax.
- `/v1/core/session`, `/me/language` and `/people` have no `requirePermission` by design: they are self-scoped or names-only for any member.
- Demo passwords live in `.temp/demo-credentials.txt`, which is git-ignored and untracked.
- Approval decisions reject a repeat (`inv_decide_request` raises `INVALID_STATE` unless the request is `submitted`), so a duplicated approval prompt cannot double-approve.

### Updated recommended order

This order matches the reverse review; where the two documents differ, the reverse review wins.

1. Code, low risk: per-route body limits for all webhooks and `/transcribe` (finding 8); outbox retry-then-stop with the ambiguous-result rule (N1); Ollama `redirect: 'manual'` (N3); ConnectPhone header; `.test` email in the fixture (N9).
2. AI: decide N10 (notice for Ollama, or owner-confirmed host); make the shared cap a reservation (N11) and set a provider-side limit; correct the integrations report.
3. Migration 061, applied by the owner: consent version kept in the database (finding 10), Ollama `https://` only (finding 11), and N10/N11 if they need SQL.
4. CI: make `sql-tests.yml` run on every PR, skip cleanly when no SQL changed, fail distinctly when the stack cannot start (N12), and mark it required in branch protection; keep deploy independent. Remove the hard-coded autofill default after the variable is set.
5. Docs: README, sql/README (N4), PRODUCT_BRIEF and agents.md positioning (owner's sentence), checklist, ARCHITECTURE.md, plans index, nine links, worklog order and superseded notes (N2); move this report to `documentation/reviews/`.
6. Measure the screen preload before changing it.

A reverse review of these fixes (what each could break, and cheaper alternatives) is in [documentation/reviews/2026-11-06-repo-audit-fixes-reverse-review.md](2026-11-06-repo-audit-fixes-reverse-review.md).

### Implementation (6 Nov 2026, night)

Done on branch `fix/repo-audit` (worktree `.claude/worktrees/repo-audit`), **not merged, not deployed, not committed by the agent**. Lint, typecheck and `npm test` pass (shared 30 + 1 skipped, API 285 + 7 skipped, web 67). SQL changes were not run locally (no Docker on this machine); CI's SQL workflow runs them on the pull request.

| Finding | What was done | Where |
|---|---|---|
| 8 | Body caps before the body is read: 100 KB for WhatsApp, Telegram, Paymob, Fawry, Bosta; 1 MB for Shopify; 5 MB + 64 KB for `/transcribe`. Old per-route checks kept as a second line. Tests for each route and for a streamed body with no Content-Length | `apps/api/src/middleware/bodyLimit.ts`, `src/index.ts`, `modules/core/aiRoutes.ts`, `test/body_limit.test.ts` |
| N1 | Delivery result retried (3 tries); `INVALID_STATE` checked against the row; on failure the pass stops sending and reports `stoppedOnError` instead of throwing | `apps/api/src/jobs/outbox.ts`, `test/outbox_record.test.ts` |
| N3 | Ollama call uses `redirect: 'manual'` and explains a redirect | `apps/api/src/lib/aiProviders.ts`, `test/ai.test.ts` |
| 10, 11, N10 | Migration 061: notice version in the database (`v2`), consent replaced and audited, Ollama under the notice, withdrawal switches Ollama off, Ollama address https-only when saved or changed. `AI_NOTICE_VERSION` = `v2`; settings screen and Arabic strings say Ollama is reached over the internet and show "the AI notice has changed" | `sql/061_ai_notice_version.sql`, `sql/tests/056_ai_notice_version.sql` (new), tests 051 and 055 updated, `packages/shared/src/integrations.ts`, `apps/web/src/modules/core/settings/ProvidersSettings.tsx`, `apps/web/src/lib/i18nScreens.ts` |
| N11 | Usage write retried once and logged loudly if still lost; the cap is documented as soft, with the provider-side limit as the hard stop | `apps/api/src/lib/aiService.ts` |
| 1, N12 | SQL workflow runs on every PR, passes at once without SQL changes, **fails** when the database cannot start | `.github/workflows/sql-tests.yml` |
| 6 | 7 links fixed; a link checker runs in CI; the 2 ADR-0004 links are on a known list (agents may not edit ADRs) | `scripts/check-doc-links.mjs`, `scripts/check-doc-links.known.txt`, `ci-deploy.yml` |
| 15, N9 | No built-in autofill account: the button shows only for accounts in the `DEMO_AUTOFILL_EMAILS` repository variable | `.github/workflows/ci-deploy.yml` |
| 14 | Browser rule reworded: the CI smoke test is exempt | `agents.md` |
| N5 | Teardowns committed; screenshots, imports and media under `research/` ignored | `.gitignore`, `agents.md` |
| 2, 3, 4, 5, N2, N4, N8 | README status and migration wording; sql/README (061 row, apply routine, CI paragraph); checklist overview rewritten and the 28 Oct task list archived; ARCHITECTURE.md written; plans index rebuilt; PRODUCT_BRIEF facts; worklog order and superseded notes; this report moved to `documentation/reviews/` | the files named |

**Not done, on purpose:** the ConnectPhone header and the screen preload (13, 12): another session is changing the UI, so they were left to avoid clashing edits. The product positioning (N7): Ben's sentence. The ADR-0004 links: ADR folder is off-limits to agents. Branch protection and provider spending limits: GitHub and provider settings Ben changes.

### Addendum verification record

- Link scan: Node script over all git-tracked Markdown (excluding templates and `documentation/reference/`): 9 broken.
- Grep sweeps: webhook body handling, `safeEqual` usage, `requirePermission` counts per route file, `revoke`/RLS per migration 053–060, tokens in tracked files.
- `git ls-files`, `git check-ignore`, `git diff`; `gh repo view` (public, 0 forks); `gh run list` for the SQL workflow (5 successful runs on 6 Nov).
- Read `node_modules/hono/dist/middleware/body-limit`: it trusts Content-Length when present without Transfer-Encoding, and counts streamed bytes otherwise.
- Not run: typecheck, tests, SQL tests, browser. Files changed: `REPO_AUDIT_REPORT.md` (this addendum), the reverse review, the integrations report (two stale lines), and the worklog.
