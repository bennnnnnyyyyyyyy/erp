# Audit of repository audit fixes

**Date:** 9 November 2026  
**Scope:** Review of the fixes for the 6 November repository audit, including PRs #13, #14, #16, #17 and #18, plus a documentation follow-up in the current checkout.  
**Method:** Static review of the original audit, reverse review, current source and worklog. The initial code review was based on `17d8182`; later evidence from PRs #17 and #18 is recorded below. Claude's separate active worktree, shown in the pasted session, was not inspected or modified here.  
**Outcome:** Documentation updates only in this checkout; no API, database or deployment changes. No tests were run by this review.

## Executive summary

Most implementation fixes match the reverse review and are supported by recorded CI or worklog evidence. The body cap uses Hono's middleware with route-specific limits; outbox completion retries and stops the current pass if it cannot record a delivery; the AI notice version is stored in the database and Ollama now requires consent; and the SQL workflow fails when its database cannot start. PR #16 moved root notes into the documentation archive and updated product positioning. PR #17 added coverage for the Ollama URL edge case and corrected the AI cap comment; PR #18 withdrew the false regex finding.

The fixes are not complete in every respect:

- **P1 — Public personal files remain public.** PR #16 moved the email archive and workbook but did not remove them from the public repository or Git history. The earlier worklog records that this risk was accepted; the move is a root-cleanup fix, not a privacy fix.
- **Finding withdrawn — Migration 061's Ollama URL regex concern was a false positive.** The file has one backslash and the added SQL test accepts an `s`-starting host. The worklog records a read-only PostgreSQL check as well.
- **Resolved in documentation follow-up — Product status was contradictory.** The README and brief now distinguish the built first warehouse/stock capabilities from broader inventory workflows and future tracks; their status dates were updated.
- **Deferred operational control — Provider spending limits are not configured.** The AI comment now accurately describes concurrent soft-cap overrun and says to set provider limits before adding company keys. Ben explicitly deferred that setup.
- **P3 — Cloudflare edge behavior for mismatched Content-Length is unverified.** The worklog records a local Wrangler check that rejected an under-declared oversized body; Cloudflare's edge was not tested.
- **P2 — SQL CI is not confirmed as a required GitHub check.** The workflow is corrected, but branch protection was explicitly deferred.
- **P3 — ADR-0004 links remain broken and allowlisted.** The move to the archive added a root-clutter fix; it did not complete this separate link fix.

The initial review was against `17d8182` (PR #16 merge). Later commits in the current repository history include PRs #17 and #18. The worklog records that the SQL suite passed on PR #14 and migration 061 was applied by Ben on 9 November; it also records the PR #17 SQL test and local Wrangler check. These were not rerun for this report. Claude's separate in-progress worktree is outside this review.

## Fix disposition

| Area | Disposition | Review |
|---|---|---|
| Request body limits | Fixed; local mismatch check recorded, edge unverified | Route-specific Hono `bodyLimit` middleware is used before handlers read request bodies. See [bodyLimit.ts](../../apps/api/src/middleware/bodyLimit.ts) and [index.ts](../../apps/api/src/index.ts). The worklog records that Wrangler rejected a 200 KB body declaring 10 bytes; Cloudflare edge behavior was not checked. |
| Outbox delivery recording | Fixed as proposed | Completion writes retry up to three times, ambiguous `INVALID_STATE` results are checked against row state, and the job stops sending further messages in that pass if it still cannot record completion. See [outbox.ts](../../apps/api/src/jobs/outbox.ts). This reduces the batch-duplicate risk; third-party delivery remains at-least-once where providers lack idempotency. |
| AI notice version / consent | Fixed in source; live state recorded | Migration 061 stores the active notice version in the database, adds the re-accept path, and gates Ollama with the same consent. The worklog says 061 was applied to live and AI is off until the owner accepts v2. The browser re-accept flow is recorded as not yet checked. |
| Ollama URL validation | Fixed; prior regex finding withdrawn | HTTPS is required when the saved address changes and redirects are not followed. PR #17 added a host beginning with `s` and a missing-host SQL case; PR #18 corrected this report's false positive. |
| AI usage recording and cap wording | Improved; provider hard stop deferred | A failed usage write is retried once. The cap comment now says the overrun grows with requests in flight, speech cost is estimated, and no provider spending limit is set yet. The retry can still overcount if the first append committed but its response was lost. |
| SQL test workflow | Workflow fixed; merge enforcement unconfirmed | The workflow runs on pull requests, skips when SQL did not change, retries local database startup, and fails if tests could not run. PR #14 also fixed the empty-database startup problem. A workflow only becomes a required merge gate when repository branch protection requires it. |
| Docs and links | Partly fixed | The README, brief, worklog, checklist and architecture/index docs were updated. Seven links were fixed and the link check is recorded as passing. The two ADR-0004 links remain on the known-broken allowlist. |
| Product positioning | Updated; wording clarified after this review | The general-purpose, Egypt-first direction appears in `agents.md`, README and PRODUCT_BRIEF. The README and brief now distinguish the built first warehouse/stock capabilities from broader future inventory workflows. |
| Root clutter | Fixed | PR #16 moved 14 files under `documentation/archive/root-files-2026-11/` and added an archive index. |
| Personal files in public repo (N6) | Not fixed; previously accepted risk | The email archive, trial workbook and other materials remain tracked in the public archive directory. The change improves organization but does not reduce public access or erase prior Git history. |

## Findings requiring follow-up

### P1 — Personal files remain accessible in the public repository

**Evidence:** The archive index lists the email archive and trial workbook in [`documentation/archive/root-files-2026-11/README.md`](../archive/root-files-2026-11/README.md). They were moved, not removed. The repository is public, so the archived paths remain readable, and previous file contents remain in Git history.

**Impact:** Personal correspondence and staff addresses identified in the original audit remain exposed. The archive makes the materials easier to locate. This finding was recorded as accepted by Ben on 6 November, so it is an unresolved accepted risk rather than a failed root-clutter change. Reconfirm that acceptance before treating N6 as closed.

### Finding withdrawn — SQL URL regex concern was a false positive

**Location:** [sql/061_ai_notice_version.sql, line 126](../../sql/061_ai_notice_version.sql#L126); current test at [sql/tests/056_ai_notice_version.sql](../../sql/tests/056_ai_notice_version.sql).

The original review misread the source and treated its single backslash as doubled. The worklog records a byte-level source check and read-only PostgreSQL check: `https://server.example` is accepted. PR #17 added `https://server.example.com` and a missing-host case to [sql/tests/056_ai_notice_version.sql](../../sql/tests/056_ai_notice_version.sql); PR #18 records the correction. No SQL migration change was needed.

**Disposition:** No defect demonstrated. The initial claim was wrong and has been removed from the active findings. The test change and read-only check are recorded evidence; they were not rerun for this report.

### P2 — Product-status wording contradicted the built inventory status at review time

**Locations:** [README.md, lines 3–5](../../README.md); [PRODUCT_BRIEF.md, lines 8 and 43](../../PRODUCT_BRIEF.md); [checklist.md, lines 8–12](../plans/checklist.md).

The positioning sentence says “inventory and the work around it come next,” while the following README status says inventory is built and live. The product brief repeats the “come next” wording, then marks inventory as built in its module table. The worklog/checklist support the built-and-live status.

**Impact:** Readers cannot tell whether “inventory” means the existing stock module or a broader future inventory track. This weakens the intended general-purpose positioning and can misstate what users can try today.

**Status:** Resolved in the documentation-only follow-up recorded below. The positioning now says the first warehouse, stock and accounting capabilities are built, with broader inventory workflows and connected business tracks next. README, product brief and checklist dates now reflect the 9 November state.

### P2 — AI cap is soft, and its comment understates concurrent overrun

**Location:** [aiService.ts, lines 27–32](../../apps/api/src/lib/aiService.ts); duration estimate in [aiProviders.ts, line 36](../../apps/api/src/lib/aiProviders.ts).

The code checks spend before calling the provider and records usage afterward. Concurrent requests can all pass the check, so the overrun grows with each request already in flight. Audio duration is estimated from compressed bytes at a fixed 16 KB/s, which can understate the length of lower-bitrate recordings. PR #17 corrected the comment to describe both limits and states that no provider-side limit is set yet.

**Impact:** There is no provider-side hard stop configured yet. The in-app cap remains a soft guard; the code comment now states this explicitly.

**Disposition:** The concurrency wording was corrected in PR #17. Provider spend-limit setup remains deferred by Ben and is recorded as a prerequisite before adding provider keys, not as a completed code fix.

### P2 — SQL CI is not yet proven to block merges

**Location:** [sql-tests.yml](../../.github/workflows/sql-tests.yml).

The workflow now distinguishes “no SQL changes” from “tests ran and passed” and fails on infrastructure startup failure. This addresses the false-green behavior in the workflow itself. The workflow comments say it is intended to be required, but required status checks are configured in GitHub repository settings, not by this YAML file. Branch protection was explicitly skipped in the worklog.

**Impact:** If the check is not required, a pull request may still merge without the SQL suite passing.

**Recommendation:** Keep this classified as deferred until a maintainer confirms the check is required for the relevant branch. No repository setting was changed or checked as part of this review.

### P3 — Cloudflare edge behavior for mismatched `Content-Length` remains unverified

**Location:** [bodyLimit.ts](../../apps/api/src/middleware/bodyLimit.ts).

The implementation uses Hono's built-in `bodyLimit` middleware per route, matching the reverse review. The worklog records a raw-socket check against local `wrangler dev`: a 200 KB body declared as 10 bytes received 400, while a matching 200 KB declaration received 413. This indicates the local Worker runtime did not pass the oversized body to the handler.

**Impact:** No local bypass was demonstrated. The Cloudflare edge was not tested, so local behavior should not be presented as edge verification.

**Recommendation:** Treat the local test as evidence for `wrangler dev`; verify at the edge only if the deployment boundary needs separate assurance.

### P3 — ADR-0004 links are still broken

**Location:** [DRAFT_ADR-0004-general-ledger.md, lines 10–11](../architecture/decisions/DRAFT_ADR-0004-general-ledger.md); [check-doc-links.known.txt](../../scripts/check-doc-links.known.txt).

Both links still point to `../plans/` although the plans directory is two levels up. The link checker passes by allowlisting these exact failures. The worklog says this edit was blocked by local permissions.

**Impact:** Readers following either plan link reach a nonexistent path; a green link check does not mean these links work.

**Recommendation:** Change both relative paths to `../../plans/` and remove their allowlist entries, then rerun the link check.

## Positive findings

- The outbox fix follows the reverse review's safer retry-and-stop behavior rather than continuing after an unrecorded send.
- Body limits use Hono's middleware with distinct webhook, Shopify and audio sizes; this avoids introducing a custom stream reader into signature-sensitive webhook routes.
- AI consent versioning and the visible re-accept path were shipped together. The worklog records the expected live state after migration 061: AI disabled until v2 is accepted.
- SQL CI now reports infrastructure failure as failure, and PR #14 fixed the test stack so migrations and tests can run from an empty local database.
- PR #16 puts scratch and handoff files under the documented documentation tree and identifies them as historical material.
- PR #17 adds the missing Ollama URL SQL cases and corrects the AI cap comment; PR #18 removes the false regex claim from the review history.

## Review limits

This report is static. I did not rerun typecheck, unit tests, SQL tests, the documentation link checker, a browser flow, or a live database query. The worklog is the evidence for recorded CI and migration results. I did not independently verify GitHub branch protection or provider-side spending limits.

## Follow-up after this review — 9 November 2026

The active README and `agents.md` distinguish the first built warehouse/stock capabilities from broader inventory work. The product brief now covers the current product; the 29 October phase-one thesis is archived. The active checklist is a concise status page; its dated task snapshots are archived. Dates and the documentation index were updated. These edits resolve the product-status wording finding and archive-index gap; they do not alter the historical 6 November audit or reverse review. PRs #17 and #18 corrected the cap wording, added the URL test cases, and withdrew the regex false positive. The separate Claude worktree shown in the pasted session was not included in this report or modified by this follow-up.
