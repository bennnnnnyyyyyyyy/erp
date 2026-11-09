# Work orders after the management meeting

Date: 29 October 2026. Owner: Ben Arthur. Source: Grant's notes from the meeting.

## What management asked for

Keep digging on: market share per competitor; services provided and which we can add (and how); voice input with labeling; white-labeling; additional cons across all competitors; more on cost breakdown; mobile apps; UI issues; feature list (when and how to apply); top 6 competitors and what we do about each; try their apps.

**Assumptions to confirm with Grant (do this first, one message):**

- White-labeling = customers or resellers brand the product as their own.
- Voice input with labeling = voice commands where the transcript and intent are tagged (and possibly white-labeled voice). If he means something else, change item 6 under "Orders for Claude" below.

## Three workstreams

- **A. Deeper research** (Claude, this chat) answers Grant's questions.
- **B. Feature list and tech stack locked** (Ben decides, Claude and Claude Code supply evidence).
- **C. Live demo on a real database** (Claude Code).

---

## ORDERS FOR BEN

**Today / tomorrow**

1. Message Grant to confirm the two assumptions above (white-labeling, voice labeling).
2. Run the trial checklist in every trial account: Edara, Odoo, Zoho, NetSuite, Daftra, Wafeq. Per vendor, send screenshots of:
   - the audit or change log after editing a stock item;
   - an outgoing stock transfer and its approval screen (does it block stock?);
   - any WhatsApp, voice or AI feature;
   - ETA/ZATCA e-invoicing settings;
   - the price page for 5 and 15 users with warehouses;
   - the mobile app, if one exists (screenshots of the main screens);
   - any white-label, reseller or branding settings.
3. Install and try each competitor's phone app (Edara, Daftra, Odoo, Zoho, Wafeq, NetSuite, ERPNext if available). Note: works offline? can you approve stock? Arabic? what annoys you? Screenshots.
4. Ask each vendor's sales team for an EGP quote (5 and 15 users, warehouses, mobile, e-invoicing, implementation). Paste replies.
5. Click through the demo once before any further showing.

**This week** 6. Lock the feature list (workstream B) after reviewing my draft; decide what is day one and what is later. 7. Book 8-10 customer interviews with Egyptian SMEs that hold stock (questions in the meeting prep). 8. Tell Claude Code to start workstream C (prompt below).

**Decisions only you or management can make:** product name; e-invoicing day one or later; white-label stance; mobile app route (native or installable web app); WhatsApp provider.

## ORDERS FOR CLAUDE (this chat: research)

Deliver one research workbook plus an updated report, with a source and a confidence tag on every figure.

1. **Market share per competitor.** Per vendor: customers, users, countries, Egypt/GCC presence, partner count, website-usage and analyst data, app-store download bands. Then a labeled estimate of relative position in Egypt and GCC. Say plainly where the data does not exist.
2. **Services map.** Per vendor: implementation, training, support hours, localization, marketplace, white-label or reseller program, API. Then "services we can add" with how and when.
3. **Mobile apps.** Per vendor: app exists, platforms, store rating, download band, recurring complaints, offline support, what can be approved on mobile. Recommend our route.
4. **Cost breakdown.** Per vendor, total cost for 5 and 15 users: licence, required add-ons, implementation, mobile, e-invoicing. Update from Ben's quotes.
5. **Additional cons.** Deeper cons per vendor from reviews, app-store reviews and forums, tagged by source.
6. **Voice and conversational input.** What each competitor offers (dictation, assistants, WhatsApp); what labeling would mean for us; competitors' white-label models.
7. **UI issues.** From reviews and Ben's screenshots: recurring complaints per vendor.
8. **Top 6: what we do.** Decision table: learn, match, beat or ignore, for each of the six.
9. **Feature list with timing.** Each feature: why (which finding), phase, how to implement, effort.
10. Update the management summary, working report, sheet and meeting prep after each batch. Keep the "confirmed vs unconfirmed" labels honest.

Order of work: 1, 3, 4 first (public sources), then 2, 5, 6, then 7-9 once Ben's screenshots and quotes arrive.

## ORDERS FOR CLAUDE CODE (workstream C, paste-ready)

```
Goal: replace the sample-data demo with a live demo on a real Supabase database, so management can see the approval flow and audit log working for real.

Read first: documentation/operations/WORKLOG.md, TECHNICAL_PLAN.md, ADR-0003, sql/001-005, agents.md.

Scope (nothing else):
1. Staging Supabase project with sql/001-005 applied (run 005 only after reviewing it; log results in the worklog).
2. Real sign-in (Supabase Auth). Two or three test users: a requester, a manager, an owner, in one demo organization. No real customer data.
3. Inventory slice on the database: items, warehouse, stock ledger, outgoing stock request, manager approval, issue. Approval must be enforced in the database (a stock issue can only be posted by the function that checks the request is approved and the approver is not the requester). Every step writes an audit entry in the same transaction.
4. The existing demo screens (request, approval, history, audit log) wired to the real API instead of demoInventory.ts.
5. SQL tests in sql/tests/: direct insert into the stock ledger refused; issue without approval refused; self-approval refused; reservation; audit entry per step; hash chain verifies; user in another organization sees nothing.
6. Keep the old sample-data demo available as a fallback URL.
7. Stay web first. Do not build WhatsApp, voice, e-invoicing or billing. Arabic UI text is a later item unless trivial; keep the RTL toggle.

Rules: follow agents.md; add a WORKLOG entry for every migration run and deploy; do not commit; no secrets in source or logs; no destructive SQL without my confirmation; tell me what I must test manually.

Finish with: what works end to end, what was tested, what is not done, and the URL.
```

## Definition of done for this phase

- Research workbook answers every question in Grant's notes, with sources and confidence tags, and a "top 6: what we do" table.
- Feature list and tech stack locked in a decisions table (decided vs waiting on trials or interviews).
- Live demo on a real database passes the SQL tests and Ben has clicked through it.
