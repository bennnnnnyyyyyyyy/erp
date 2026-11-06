# Reverse review: fixes proposed by the 6 Nov repository audit

**Date:** 6 November 2026
**Reviews:** the fixes proposed in [`REPO_AUDIT_REPORT.md`](../../REPO_AUDIT_REPORT.md) (original findings 1–18 and addendum N1–N9).
**Purpose:** argue against each fix before anyone builds it. For every fix: what it could break, what it misses, a cheaper or safer option, and a verdict.
**Status:** static review only. Nothing was changed apart from this file and the report addendum; no tests, database or production operations were run.

## Summary

Most fixes survive, but five should change before they are built:

1. **The SQL deploy gate protects less than it looks.** Migrations reach live when Ben runs `supabase db query --linked` by hand, often before the code merges (worklog, 6 Nov night). A gate on the Worker/Pages deploy does not stand between a migration and the live database. The check belongs on the pull request and in the manual apply routine, not on deploy.
2. **"Continue the outbox loop on a completion error" (N1) would make duplicates worse.** If the database is down, continuing sends every remaining message while recording none of them, and all of them are resent five minutes later. Today's throw is the safer behaviour. Only a narrower change is worth making.
3. **The public repository (N6) outranks everything else.** Docs, CI and link fixes can wait; the personal emails cannot. Making the repository private is one click and reversible; a history rewrite is neither.
4. **Bumping the AI notice version will switch AI off for every company at once.** That is the point of fix 10, but it needs the re-accept screen shipped first and a single source for the current version, or the Worker and database will disagree.
5. **Rewriting the docs risks producing the next stale copy.** Shrink and point to the sources of truth instead of re-describing them.

## Fix by fix

### A. Webhook and upload body limits (findings 8, wider)

**Proposed:** a shared `readBodyLimited(c, maxBytes)` that rejects on Content-Length, then counts bytes while streaming; use it in all six webhooks and check Content-Length before `formData()` in `/transcribe`.

**Against:**
- Real impact is bounded. Cloudflare already caps request bodies per plan (100 MB on Free and Pro), and a Worker isolate has 128 MB of memory, so the worst case is one failed isolate, not a data issue. This is hardening, not an incident.
- A hand-written stream reader is new security-sensitive code. The HMAC must run over the exact raw bytes; a decoding mistake (BOM, chunk-boundary UTF-8 split) turns into "every Paymob callback has a bad signature" in production.
- Content-Length can be absent (chunked) or lie, so the early check alone is not enough; the streaming count is the real guard.

**Cheaper option:** Hono already ships `hono/body-limit` (present in `node_modules/hono/dist/middleware/body-limit`). One `app.use('/webhooks/*', bodyLimit({ maxSize: 100 * 1024 }))` plus one on the transcribe route replaces six hand checks, handles chunked bodies, and leaves `c.req.text()` intact for the HMAC.

**Verdict:** do it, with `bodyLimit` rather than custom code. Keep the existing per-route checks until tests prove the middleware works, then remove them. Add one test per webhook: oversized body gives 413 and the provider function is never called.

### B. Duplicate delivery (finding 9) and the outbox loop (N1)

**Proposed:** document at-least-once delivery; log and continue when `msg_complete_delivery` fails.

**Against the "continue" half:**
- The usual reason the completion write fails is that the database is unreachable or overloaded. Continuing then sends every remaining message in the batch with no record, and the five-minute recovery resends all of them. Today's throw stops after one duplicate.
- Slack and Teams incoming webhooks, Telegram `sendMessage` and the WhatsApp Cloud API have no idempotency key, so "use provider idempotency" is only possible for Resend, which already has it.

**Narrower option:** retry the completion write once or twice with a short delay. If it still fails, stop sending (as now) but return a result instead of throwing, so the scheduled job logs a clear count instead of an unhandled error. Do not shorten the five-minute recovery window: a shorter window produces more duplicates, not fewer.

**Verdict:** change N1's recommendation to "retry, then stop cleanly". Document at-least-once delivery in the messaging plan and in the approval-message text ("if you get this twice, the second is a copy"). Approval decisions are already guarded in the database (`inv_decide_request` raises `INVALID_STATE` unless the request is still `submitted`), so a duplicate prompt cannot double-approve.

### C. AI consent versioning (finding 10) — migration 061

**Proposed:** same version does nothing; a different version withdraws the old consent and inserts the new one, both audited; `ai__provider_state` and `core_ai_status` require the current version.

**Against:**
- "Require the current version" needs one authority for what is current. If it lives in `packages/shared` and the database compares to a parameter, a Worker deployed before the migration (or after a rollback) sends the wrong version and AI silently turns off or stays on. If it lives only in the database, the UI cannot show the right notice text.
- Raising the version switches AI off for every company until an owner re-accepts. That is correct legally, but it must ship with a visible "the AI notice changed, please review" banner, or it looks like an outage.
- `core_set_ai_consent` is a live function with callers; changing its behaviour is a production schema change and needs Ben's go-ahead, a dry run and test 051 updated.

**Safer shape:** keep the current version in one database setting (for example `core_settings`, or a constant function `core__ai_notice_version()`), have the API read it through `core_ai_status`, and have the UI show the notice for that version. Today every row is `v1`, so the migration changes nothing until the version is raised, and it can be applied early with no effect.

**Verdict:** do it, but write it as "version lives in the database", ship the re-accept banner in the same release, and add the v1→v2 test. Ben applies it.

### D. Ollama address (finding 11, N3)

**Proposed:** tighten the database check to match `assertSafeOllamaUrl`; set `redirect: 'error'` on the fetch.

**Against:**
- The server check already blocks the dangerous cases. A matching database check is defence in depth, but two copies of the same rule (TypeScript and a SQL regex) will drift. A SQL regex for "not an IP literal, not localhost, not .local" is easy to get subtly wrong.
- A tighter check makes existing saved `http://` addresses impossible to re-save. Count them first.
- `redirect: 'error'` breaks setups where a proxy redirects (trailing slash, `www`), and the error will look like "Ollama is down".

**Cheaper option:** in the database, only require `https://` (one simple regex) and leave host rules to the server. For redirects, use `redirect: 'manual'` and return a clear message: "Your Ollama address redirected to X; save the final address instead."

**Verdict:** do the simple version. Put the `https://` change in migration 061 with a read-only verification query that counts existing non-https Ollama rows.

### E. SQL tests as a deploy gate (finding 1)

**Proposed:** a SQL job inside `ci-deploy.yml` that always runs, skips when no SQL changed, and blocks deploy when SQL changed and tests did not run.

**Against:**
- **Wrong place.** The worklog shows migrations applied to live by hand, from branches, before merge (056–060 on 6 Nov). The Worker deploy does not apply SQL, so gating it guards the code path that depends on SQL, not the SQL itself.
- The local Supabase stack takes minutes and depends on Docker Hub; the workflow header records "Rate exceeded" failures. Blocking deploy on infrastructure flakiness will block an urgent API fix at the worst moment.
- Merging the jobs into one workflow makes every main push slower.

**Better option:**
1. Keep `sql-tests.yml` separate, but make it run on every PR (no path filter) with a first step that exits successfully when no SQL changed, then mark it a **required check in branch protection**. That gates merging, which is when it matters.
2. Add to the apply routine in `sql/README.md`: a migration is applied to live only after its SQL test passed on CI or locally, and the worklog entry names the run.
3. Keep deploy independent, so an infrastructure outage on the SQL side never blocks an API hotfix.

**Verdict:** change the fix as above. Branch protection is a GitHub setting Ben changes himself.

### F. Autofill default email (finding 15, N9)

**Proposed:** default to `''`; Ben sets the repository variable; use a `.test` address in the test.

**Against:** the next deploy after the change hides "Fill with sample data" for the demo presenter unless the variable is set first. If a demo is close, that is a visible regression.

**Verdict:** do it, in this order: Ben sets `DEMO_AUTOFILL_EMAILS`, then the default is removed. In a public repository the address in the workflow is also public, which adds to N6.

### G. Playwright in CI (finding 14)

**Proposed:** keep Playwright and reword the rule.

**Against:** none of substance. Removing the smoke test would drop the only check that every screen renders. The rule's purpose (agents should not drive a browser instead of asking a human) does not apply to a headless CI test.

**Verdict:** keep. Reword agents.md: "Agents do not run browser automation against live or user sessions without asking; the CI smoke test (`apps/web/e2e`) is exempt."

### H. Public repository and committed personal data (N6)

**Proposed:** remove from tree, add to `.gitignore`, optionally rewrite history.

**Against a history rewrite:**
- It needs a force-push to `main`, breaks every clone, worktree and open PR, and other agents (Codex, Antigravity, Cursor) would keep working on the old history.
- It does not reach forks, clones or caches made while the repository was public.

**Against doing nothing:** the emails are readable now; this is the only finding with an ongoing exposure.

**Better order:**
1. Ben decides whether the repository should be public. If not, make it private now (GitHub settings, reversible, no history change).
2. Remove the files from the tree and add them to `.gitignore` in a normal commit.
3. Rewrite history only if the repository must stay public, and only after warning every contributor.
4. Separately, read the worklog for personal names and emails it does not need (it names four staff accounts) before any future public release.

**Verdict:** top priority, but the first step is a setting, not code.

### I. Research ignore rule (N5)

**Proposed:** un-ignore `documentation/research`, or keep it ignored deliberately.

**Against un-ignoring:** teardowns collect competitor screenshots, exports and trial notes. In a public repository, committing competitor screenshots or copied text is a licensing risk, which is probably why the rule exists. (The tracked `odoo/import/odoo_customers.csv` is our own invented sample data with `.example.com` addresses, so it is fine.)

**Verdict:** keep the folder ignored while the repository is public. Instead, ignore only `**/screenshots/` and `**/import/`, and commit our own written teardowns. Fix agents.md to say which parts are committed. Separately, remove or mark the two SUPERFIX links to teardowns that were never written.

### J. Docs refresh (findings 2–7, N2, N4, N7, N8)

**Proposed:** rewrite README, sql/README, PRODUCT_BRIEF, the agents.md positioning, the checklist, ARCHITECTURE.md and the plans index; fix 9 links; reorder the worklog; move the report.

**Against:**
- Every full rewrite becomes another document to keep in sync; the drift exists because there are already too many status copies.
- **agents.md positioning (N7)** is a product decision, not a doc fix. "Warehouse-first" may still be the sales pitch even if accounting is built first. Rewriting it without Ben's wording changes what every agent builds.
- **Worklog:** it is history. Moving one misplaced entry is fine; rewriting old entries is not. Mark stale lines with a dated note instead.
- **Moving root notes:** `REPLY_TO_CLAUDE_CHAT.md`, `neworder.md`, `sss.md` and `colluege audit.md` are linked from at least nine docs (worklog, day report, system audit, plans). Moving them breaks those links unless they are updated in the same change.
- **Moving this report** breaks the links that point at it.

**Cheaper option:**
- README: change only the migration range, the date and an Arabic-draft note, and point to `sql/README.md` and the worklog for status, instead of listing features.
- Checklist: one status table; everything else moved to `documentation/archive/checklist-2026-10.md`.
- ARCHITECTURE.md: one page (request flow, tenancy, where rules are enforced, how migrations reach live), linking to ADRs. No feature lists.
- Plans index: generate from the folder, or replace with "see the folder".
- Links: fix the 9 now; add the link-scan script to `scripts/` and run it in CI so they stay fixed.
- agents.md and PRODUCT_BRIEF: Ben supplies the positioning sentence; the agent applies it.

**Verdict:** do the small edits; get Ben's sentence for the positioning; add the link check to CI. Update links in the same change as any file move.

### K. UI items (findings 12, 13)

**Preload (12):**
- `navigator.connection` does not exist in Safari or Firefox, so a data-saver check does nothing for iPhone users, who are a large share of phone users in the GCC.
- The preload exists so tour steps don't stall (comment at `Shell.tsx:94`). Turning it off on slow connections makes the tour stall exactly where it is slowest.
- No bundle measurement exists yet; the cost may be small.

**Verdict:** measure first (`npm run build -w apps/web`, sum of lazy chunks). If small, close the finding. If large, preload only the current app's screens and the tour's screens.

**ConnectPhone header (13):** no objection. Add the `Actions` string to the Arabic file too, or the RTL view shows English.

## Revised order

1. **Ben:** decide whether the repository is public; make it private if not (H).
2. **Ben:** set `DEMO_AUTOFILL_EMAILS`, then the default can go (F).
3. **Code, low risk:** `bodyLimit` middleware (A); outbox retry then stop cleanly (B); ConnectPhone header with its Arabic string (K); `.test` email in the fixture (F).
4. **Migration 061, Ben applies:** consent version kept in the database, with the re-accept banner; Ollama `https://` only, with a count of existing rows (C, D).
5. **CI:** SQL tests as a required PR check in branch protection, deploy left independent; link check script (E, J).
6. **Docs:** small README and sql/README edits, checklist archive, one-page ARCHITECTURE.md, 9 links, worklog entry moved, research ignore narrowed; agents.md and PRODUCT_BRIEF once Ben gives the positioning (I, J).
7. **Measure** the preload before changing it (K).

## Decisions needed from Ben

- Should the repository stay public?
- If it stays public, rewrite history to remove the emails, or accept that they stay in history?
- The positioning sentence for agents.md and PRODUCT_BRIEF.
- Approval to write migration 061 (Ben applies it to live).
- Branch protection with SQL tests as a required check.
