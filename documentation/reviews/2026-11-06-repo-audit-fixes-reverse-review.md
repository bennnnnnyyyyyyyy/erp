# Reverse review: fixes proposed by the 6 Nov repository audit

**Date:** 6 November 2026 (revised the same night after a second reviewer's reply, `REPLY_TO_CLAUDE_CHAT.md`; every point in it was checked against the code before being accepted)
**Reviews:** the fixes proposed in [`2026-11-06-repo-audit.md`](2026-11-06-repo-audit.md) (formerly `REPO_AUDIT_REPORT.md` at the root; original findings 1–18 and addendum N1–N12).
**Purpose:** argue against each fix before anyone builds it. For every fix: what it could break, what it misses, a cheaper or safer option, and a verdict.
**Status:** static review only. No tests, database or production operations were run.

## Summary

Most fixes survive, but six should change before they are built:

1. **The SQL check belongs on pull requests, not on deploy, and it must not pass when nothing ran.** Migrations reach live when Ben applies them by hand, often before the code merges, so a deploy gate does not stand between a migration and the live database. The workflow also finishes green when the database cannot start (N12).
2. **"Continue the outbox loop on a completion error" would make duplicates worse.** Retry the write, treat "already completed" as success, then stop cleanly.
3. **Body limits must stay per route.** One shared 100 KB limit would break Shopify (1 MB today) and audio (5 MB).
4. **Raising the AI notice version switches AI off for every company at once.** Keep the version in the database and ship the re-accept banner with it.
5. **Ollama is not "inside the company".** It sends data to a public host without the AI notice (N10). Decide the rule before tightening its URL check.
6. **Rewriting the docs risks producing the next stale copy.** Shrink and point to the sources of truth instead.

The public repository (N6) was raised and the owner accepted it as is on 6 Nov; it is out of scope here.

## Fix by fix

### A. Webhook and upload body limits (finding 8)

**Proposed:** enforce each limit before buffering, for all six webhooks and `/transcribe`.

**Against:**
- Real impact is bounded. Cloudflare caps request bodies per plan and an isolate has 128 MB of memory, so the worst case is one failed request, not a data issue. This is hardening, not an incident. Cloudflare's own guidance still says to enforce limits before buffering.
- A hand-written stream reader is new security-sensitive code. The HMAC must run over the exact raw bytes; a decoding mistake turns into "every Paymob callback has a bad signature" in production.
- **One shared limit is wrong.** Limits differ on purpose: 100 KB for most webhooks, 1 MB for Shopify (order payloads are large), 5 MB for audio.
- **Hono's `bodyLimit` trusts Content-Length.** When the header is present without Transfer-Encoding it compares the header and never counts bytes. Whether a Worker can receive a body longer than its declared Content-Length must be tested, not assumed.

**Safer option:** `bodyLimit` per route (`/webhooks/shopify` 1 MB, other webhooks 100 KB, `/v1/core/ai/transcribe` a little over 5 MB to allow multipart overhead), keeping the existing length checks after it as a second line until a test sends an oversized body with a false Content-Length through `wrangler dev` and shows a 413. `bodyLimit` also covers `/transcribe` properly, because it counts streamed bytes when no Content-Length is declared, rather than only checking the header.

**Verdict:** do it, per route. One test per route: oversized gives 413 and the handler is never called.

### B. Duplicate delivery (finding 9) and the outbox loop (N1)

**Proposed originally:** document at-least-once delivery; log and continue when `msg_complete_delivery` fails.

**Against "continue":** the usual reason the completion write fails is that the database is unreachable. Continuing then sends the whole batch with no record, and the five-minute recovery resends all of it. Today's throw stops after one duplicate. Slack and Teams incoming webhooks, Telegram and the WhatsApp Cloud API offer no idempotency key; only Resend does, and it already uses one.

**Against a naive retry:** the result of a failed RPC is ambiguous. The write may have committed and only the response was lost. A retry then hits `msg_complete`, which raises `INVALID_STATE` because the row is no longer `sending`. A retry that treats that as a failure would log a false error, or worse, mark a delivered message as failed.

**Safer option:** retry the completion write once or twice with a short delay; if a retry raises `INVALID_STATE`, read the row and treat `sent` (or a later state) as success; if it still fails, stop sending and return a result instead of throwing. Do not shorten the five-minute recovery window; a shorter window produces more duplicates.

**Verdict:** do the safer option. Document at-least-once delivery in the messaging plan. A duplicate approval prompt cannot double-approve: `inv_decide_request` raises `INVALID_STATE` unless the request is still `submitted`.

### C. AI consent versioning (finding 10), migration 061

**Proposed:** same version does nothing; a different version withdraws the old consent and inserts the new one, both audited; the state functions require the current version.

**Against:**
- "Require the current version" needs one authority for what is current. If it lives in `packages/shared` and the database compares a parameter, a Worker deployed before the migration (or after a rollback) sends the wrong version and AI silently turns off or stays on.
- Raising the version switches AI off for every company until an owner re-accepts. Correct, but without a visible "the AI notice changed" banner it looks like an outage.
- `core_set_ai_consent` is a live function; changing it is a production schema change and needs Ben's go-ahead, a dry run and test 051 updated.

**Safer shape:** keep the current version in the database (a constant function such as `core__ai_notice_version()`), have the API read it through `core_ai_status`, and have the UI show the notice for that version. Every row today is `v1`, so the migration changes nothing until the version is raised.

**Verdict:** do it with the version in the database and the banner in the same release, plus the v1→v2 test. Ben applies it.

### D. Ollama: address rule (finding 11, N3) and consent (N10)

**Proposed:** tighten the database URL check to match `assertSafeOllamaUrl`; stop following redirects; decide whether Ollama needs the AI notice.

**Against the URL changes:**
- The server check already blocks the dangerous cases. Two copies of the same host rule (TypeScript and a SQL regex) will drift, and a SQL regex for "not an IP, not localhost, not .local" is easy to get subtly wrong.
- A stricter check makes existing saved `http://` addresses impossible to re-save. Count them first.
- `redirect: 'error'` breaks proxies that redirect (trailing slash, `www`), and the error will read as "Ollama is down".

**Against leaving Ollama outside the notice (N10):** the server only allows a public https host, so every Ollama call crosses the internet to a host an admin typed. "Our own server" is a claim nobody verifies. The two sensible options:
- **Require the AI notice for Ollama too.** One-line change in `ai__provider_state` (drop `k = 'ollama' or`), consistent and honest. Cost: an owner must accept the notice even for their own machine.
- **Owner-confirmed host.** The owner (not an admin) ticks "this host is run by my company", audited. More code, and still only a claim.

**Verdict:** require the notice for Ollama (first option); it is the smallest change and matches what the system actually does. In the database, only require `https://`; leave host rules to the server. Use `redirect: 'manual'` with a message asking for the final address. Correct the integrations report's "keeps all data inside the company".

### E. AI spending cap (N11)

**Proposed:** make the cap a reservation in the database; set a provider-side limit.

**Against a full reservation system:** it adds a check-and-reserve function, a settle step and a sweeper for reservations whose request died. The overrun it prevents is small: each request is capped at 800 output tokens or 5 MB of audio, so even dozens of concurrent requests overshoot by cents.

**Cheaper option:** set a monthly spending limit on our OpenAI and ElevenLabs accounts (the true hard stop, outside our code); call the in-app figure a soft cap in the docs; make a failed usage write retry once rather than vanish. Do the reservation only if real usage approaches the cap.

**Verdict:** provider-side limit plus honest wording now; reservation later if needed.

### F. SQL tests as a check (finding 1, N12)

**Proposed originally:** a SQL job inside `ci-deploy.yml` gating deploy.

**Against:**
- **Wrong place.** Migrations are applied to live by hand, from branches, before merge (056–060 on 6 Nov). The deploy does not apply SQL.
- **It can pass without testing (N12).** The stack start is `continue-on-error`; on failure the job warns and stays green.
- The local Supabase stack takes about 4–5 minutes (Actions history) and depends on Docker Hub; blocking deploy on that blocks an urgent API fix at the worst moment.

**Better option:**
1. Run `sql-tests.yml` on every PR (no path filter). First step: if no SQL changed, exit successfully with "no SQL changes".
2. If SQL changed and the stack cannot start after the retries, **fail** with a distinct message ("infrastructure: SQL tests did not run; re-run the job"). Green then only ever means "ran and passed".
3. Mark it required in branch protection (Ben's GitHub setting).
4. In `sql/README.md`, add to the apply routine: a migration is applied to live only after its SQL tests passed on CI or locally, and the worklog entry names the run.
5. Keep deploy independent.

**Verdict:** change the fix as above.

### G. Autofill default email (finding 15, N9)

**Against:** the next deploy after the change hides "Fill with sample data" for the demo presenter unless the variable is set first.

**Verdict:** Ben sets `DEMO_AUTOFILL_EMAILS` first, then the default is removed; the test uses a `.test` address.

### H. Playwright in CI (finding 14)

**Against removing it:** it is the only check that every screen renders. The rule's purpose (agents should not drive a browser instead of asking a human) does not apply to a headless CI test.

**Verdict:** keep. Reword agents.md: "Agents do not run browser automation against live or user sessions without asking; the CI smoke test (`apps/web/e2e`) is exempt."

### I. Research ignore rule (N5)

**Against un-ignoring:** teardowns collect competitor screenshots, exports and trial notes; committing screenshots or copied text is a licensing risk, which is probably why the rule exists. (The tracked `odoo/import/odoo_customers.csv` is our own invented sample data with `.example.com` addresses, so it is fine.)

**Verdict:** keep screenshots and imports ignored (`**/screenshots/`, `**/import/`) and commit our own written teardowns; say so in agents.md. Remove or mark the two SUPERFIX links to teardowns that were never written.

### J. Docs refresh (findings 2–7, N2, N4, N7, N8)

**Against:**
- Every full rewrite becomes another document to keep in sync; the drift exists because there are already too many status copies.
- **agents.md positioning (N7)** is a product decision. "Warehouse-first" may still be the sales pitch even if accounting is built first; rewriting it without Ben's wording changes what every agent builds.
- **Worklog:** it is history. Moving one misplaced entry is fine; rewriting old entries is not. Add "Superseded by …" lines to the stale status entries instead.
- **Moving root notes:** `REPLY_TO_CLAUDE_CHAT.md`, `neworder.md`, `sss.md` and `colluege audit.md` are linked from at least nine docs. Moving them breaks those links unless they are updated in the same change. Moving this report breaks links to it too.

**Cheaper option:**
- README: change only the migration range, the date and an Arabic-draft note; point to `sql/README.md` and the worklog for status.
- sql/README: replace "has not run on GitHub yet" with the fact that it runs and is not yet required (N4).
- Checklist: one status table; old blocks to `documentation/archive/checklist-2026-10.md`.
- ARCHITECTURE.md: one page (request flow, tenancy, where rules are enforced, how migrations reach live), linking to ADRs.
- Links: fix the 9 now; add the link-scan script to `scripts/` and run it in CI.
- agents.md and PRODUCT_BRIEF: Ben supplies the positioning sentence.

**Verdict:** small edits; update links in the same change as any file move.

### K. UI items (findings 12, 13)

**Preload (12):** `navigator.connection` does not exist in Safari or Firefox, so a data-saver check does nothing on iPhones; the preload exists so tour steps don't stall (`Shell.tsx:94`), and turning it off on slow connections stalls the tour where it is slowest; no bundle measurement exists yet.

**Verdict:** measure first (sum of lazy chunks in `npm run build -w apps/web`). If small, close the finding; if large, preload only the current app's and the tour's screens.

**ConnectPhone header (13):** no objection. Add the `Actions` string to the Arabic file too.

## Revised order

1. **Code, low risk:** per-route `bodyLimit` (A); outbox retry with the ambiguous-result rule, then stop cleanly (B); Ollama `redirect: 'manual'` (D); ConnectPhone header with its Arabic string (K); `.test` email in the fixture (G).
2. **AI:** require the notice for Ollama (D); provider-side spending limits and soft-cap wording (E); correct the integrations report.
3. **Migration 061, Ben applies:** consent version in the database with the re-accept banner (C); Ollama `https://` only with a count of existing rows (D); the `ai__provider_state` change for Ollama (D).
4. **CI:** SQL workflow on every PR, fail distinctly when it could not run, required in branch protection, deploy independent (F); link check script (J); autofill default removed after Ben sets the variable (G).
5. **Docs:** README, sql/README, checklist archive, one-page ARCHITECTURE.md, 9 links, worklog order and superseded notes, research ignore narrowed; agents.md and PRODUCT_BRIEF once Ben gives the positioning (I, J).
6. **Measure** the preload before changing it (K).

## Status after implementation (6 Nov 2026, night)

Built on branch `fix/repo-audit` as revised above (not merged): A per route with `bodyLimit`; B retry, ambiguity rule and clean stop; C and D as migration 061 (version in the database, Ollama under the notice, https-only address via a trigger that ignores unchanged rows) with the re-accept message on the settings screen; E retry plus soft-cap wording; F on pull requests, failing when it could not run, deploy left independent; G default removed; H rule reworded; I narrowed ignore rule; J small edits, link checker in CI, checklist archive. Details and file list: the implementation table in [`2026-11-06-repo-audit.md`](2026-11-06-repo-audit.md).

Left open: K (UI items, another session is editing the UI); the ADR-0004 links; the positioning sentence; the GitHub and provider settings below.

## Decisions needed from Ben

- Ollama under the AI notice was built as recommended; revert it in 061 if an owner-confirmed host is preferred.
- Apply migration 061 to live together with the API and web change (after its CI SQL run passes).
- Set the `DEMO_AUTOFILL_EMAILS` repository variable before merging, or the sample-data button disappears.
- Branch protection with SQL tests as a required check.
- Set spending limits on our OpenAI and ElevenLabs accounts.
- The positioning sentence for agents.md and PRODUCT_BRIEF.
- Fix the two ADR-0004 links (`../plans/` → `../../plans/`), then remove them from `scripts/check-doc-links.known.txt`.
