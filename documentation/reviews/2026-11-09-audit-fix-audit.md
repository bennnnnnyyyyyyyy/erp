# Audit of repository audit fixes

**Date:** 9 November 2026  
**Scope:** Review of the fixes for the 6 November repository audit, including PRs #13 and #14 and the positioning/archive changes in PR #16.  
**Method:** Static review of the current `main` checkout, relevant SQL/API/docs/CI files, the original audit, the reverse review, and the worklog.  
**Outcome:** Review report only. No source, database, deployment, or Git changes were made for this review. No tests were run.

## Executive summary

Most implementation fixes match the reverse review and are supported by the recorded CI results. The body cap uses Hono's middleware with route-specific limits; outbox completion retries and stops the current pass if it cannot record a delivery; the AI notice version is stored in the database and Ollama now requires consent; and the SQL workflow fails when its database cannot start. PR #16 also moved the root notes into the documentation archive and updated the product positioning.

The fixes are not complete in every respect:

- **P1 — Public personal files remain public.** PR #16 moved the email archive and workbook but did not remove them from the public repository or Git history. The earlier worklog records that this risk was accepted; the move is a root-cleanup fix, not a privacy fix.
- **P2 — Migration 061's Ollama URL regex rejects valid hostnames starting with `s`.** The SQL test covers `ai.example.com`, so it misses this case.
- **P2 — Product status is contradictory.** The README says inventory comes next and later says inventory is built and live. The brief says the same “comes next” while its module table says inventory is built.
- **P2 — AI cap comments overstate the bound and operational hard stop.** Concurrent requests can all pass the pre-call check; provider-side spend controls are not independently verified here.
- **P2 — SQL CI is not confirmed as a required GitHub check.** The workflow is corrected, but branch protection was explicitly deferred.
- **P3 — ADR-0004 links remain broken and allowlisted.** The move to the archive added a root-clutter fix; it did not complete this separate link fix.

The exact `main` revision reviewed is `17d8182` (PR #16 merge); the working tree was clean and synchronized with `origin/main`. The worklog records that the SQL suite passed on PR #14 and that Ben applied migration 061 on 9 November. Those are recorded results, not tests or live-database checks repeated for this report.

## Fix disposition

| Area | Disposition | Review |
|---|---|---|
| Request body limits | Fixed, with a residual test gap | Route-specific Hono `bodyLimit` middleware is used before handlers read request bodies. See [bodyLimit.ts](../../apps/api/src/middleware/bodyLimit.ts) and [index.ts](../../apps/api/src/index.ts). The reverse review's false `Content-Length` case is still not recorded as tested. |
| Outbox delivery recording | Fixed as proposed | Completion writes retry up to three times, ambiguous `INVALID_STATE` results are checked against row state, and the job stops sending further messages in that pass if it still cannot record completion. See [outbox.ts](../../apps/api/src/jobs/outbox.ts). This reduces the batch-duplicate risk; third-party delivery remains at-least-once where providers lack idempotency. |
| AI notice version / consent | Fixed in source; live state recorded | Migration 061 stores the active notice version in the database, adds the re-accept path, and gates Ollama with the same consent. The worklog says 061 was applied to live and AI is off until the owner accepts v2. The browser re-accept flow is recorded as not yet checked. |
| Ollama URL validation | Partly fixed; SQL defect found | HTTPS is required when the saved address changes and redirects are not followed. The SQL regex has a false rejection described below. |
| AI usage recording | Improved, not a hard cap | A failed usage write is retried once. The code explicitly warns when both writes fail. This is safer, though the append-only retry can overcount if the first write committed but its response was lost. |
| SQL test workflow | Workflow fixed; merge enforcement unconfirmed | The workflow runs on pull requests, skips when SQL did not change, retries local database startup, and fails if tests could not run. PR #14 also fixed the empty-database startup problem. A workflow only becomes a required merge gate when repository branch protection requires it. |
| Docs and links | Partly fixed | The README, brief, worklog, checklist and architecture/index docs were updated. Seven links were fixed and the link check is recorded as passing. The two ADR-0004 links remain on the known-broken allowlist. |
| Product positioning | Updated, but status wording conflicts | The general-purpose, Egypt-first direction appears in `agents.md`, README and PRODUCT_BRIEF. The current state of inventory is described inconsistently within those same docs. |
| Root clutter | Fixed | PR #16 moved 14 files under `documentation/archive/root-files-2026-11/` and added an archive index. |
| Personal files in public repo (N6) | Not fixed; previously accepted risk | The email archive, trial workbook and other materials remain tracked in the public archive directory. The change improves organization but does not reduce public access or erase prior Git history. |

## Findings requiring follow-up

### P1 — Personal files remain accessible in the public repository

**Evidence:** The archive index lists the email archive and trial workbook in [`documentation/archive/root-files-2026-11/README.md`](../archive/root-files-2026-11/README.md). They were moved, not removed. The repository is public, so the archived paths remain readable, and previous file contents remain in Git history.

**Impact:** Personal correspondence and staff addresses identified in the original audit remain exposed. The archive makes the materials easier to locate. This finding was recorded as accepted by Ben on 6 November, so it is an unresolved accepted risk rather than a failed root-clutter change. Reconfirm that acceptance before treating N6 as closed.

### P2 — SQL URL regex rejects hostnames beginning with `s`

**Location:** [sql/061_ai_notice_version.sql, line 126](../../sql/061_ai_notice_version.sql#L126); current test at [sql/tests/056_ai_notice_version.sql](../../sql/tests/056_ai_notice_version.sql).

The trigger uses `v_new !~ '^https://[^\\s/]+'`. With PostgreSQL's default `standard_conforming_strings`, the regex receives the doubled backslash. In this bracket expression, that excludes a literal backslash and the character `s`, along with `/`. Consequently, a valid address such as `https://server.example` fails the trigger when inserted or changed. The test accepts `https://ai.example.com`, whose hostname starts with `a`, so it does not expose the regression.

**Impact:** Companies using a valid HTTPS Ollama host whose hostname begins with `s` cannot save or update that configuration through the database function.

**Recommendation:** Replace the expression with an unambiguous whitespace exclusion and add SQL cases for a hostname beginning with `s`, a hostname beginning with another letter, and whitespace or a missing hostname. Run them against PostgreSQL before considering the validator fixed.

### P2 — Product-status wording contradicts the built inventory status

**Locations:** [README.md, lines 3–5](../../README.md); [PRODUCT_BRIEF.md, lines 8 and 43](../../PRODUCT_BRIEF.md); [checklist.md, lines 8–12](../plans/checklist.md).

The positioning sentence says “inventory and the work around it come next,” while the following README status says inventory is built and live. The product brief repeats the “come next” wording, then marks inventory as built in its module table. The worklog/checklist support the built-and-live status.

**Impact:** Readers cannot tell whether “inventory” means the existing stock module or a broader future inventory track. This weakens the intended general-purpose positioning and can misstate what users can try today.

**Recommendation:** Keep the positioning, but name the next track precisely and make the status sentence consistent with the checklist and worklog.

### P2 — AI cap is soft, and its comment understates concurrent overrun

**Location:** [aiService.ts, lines 27–31](../../apps/api/src/lib/aiService.ts); duration estimate in [aiProviders.ts, line 36](../../apps/api/src/lib/aiProviders.ts).

The code checks spend before calling the provider and records usage afterward. Concurrent requests can all pass the check, so the overrun is not bounded by a single request; it can include each request already in flight. Audio duration is estimated from compressed bytes at a fixed 16 KB/s, which can understate the length of lower-bitrate recordings. The comment also says provider-side limits on OpenAI and ElevenLabs are the hard stop, but this review did not verify those account settings.

**Impact:** The source comment can lead operators to rely on a tighter spend bound or a configured provider stop than has been demonstrated. The in-app cap should be treated as an estimate and a soft guard.

**Recommendation:** Correct the concurrency wording and record provider spend-control configuration as an operational check before relying on it. The owner had explicitly skipped API-key and spend-limit setup, so this report does not classify that skipped setup as a completed fix.

### P2 — SQL CI is not yet proven to block merges

**Location:** [sql-tests.yml](../../.github/workflows/sql-tests.yml).

The workflow now distinguishes “no SQL changes” from “tests ran and passed” and fails on infrastructure startup failure. This addresses the false-green behavior in the workflow itself. The workflow comments say it is intended to be required, but required status checks are configured in GitHub repository settings, not by this YAML file. Branch protection was explicitly skipped in the worklog.

**Impact:** If the check is not required, a pull request may still merge without the SQL suite passing.

**Recommendation:** Keep this classified as deferred until a maintainer confirms the check is required for the relevant branch. No repository setting was changed or checked as part of this review.

### P2 — Hono body-limit false `Content-Length` case remains unverified

**Location:** [bodyLimit.ts](../../apps/api/src/middleware/bodyLimit.ts).

The implementation uses Hono's built-in `bodyLimit` middleware per route, matching the reverse review. Hono's middleware uses declared `Content-Length` when present and counts streamed bytes when it is absent. The reverse review specifically called out a request whose declared length is smaller than the actual body; no such test is recorded.

**Impact:** This is a validation gap, not a demonstrated bypass. Whether the Worker runtime accepts a mismatched body length should be established before claiming that case is covered.

**Recommendation:** Add or run a focused Worker-runtime check for an under-declared length and confirm the handler does not receive an oversized body.

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

## Review limits

This report is static. I did not rerun typecheck, unit tests, SQL tests, the documentation link checker, a browser flow, or a live database query. The worklog is the evidence for recorded CI and migration results. I did not independently verify GitHub branch protection or provider-side spending limits.
