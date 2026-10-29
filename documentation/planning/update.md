# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Last updated: 2026-10-29. Source: `orders.md`, workstream C (live demo on a real database).

## Last done
- Used the Supabase CLI on your linked project (`plhuuhcpvlytozyedamt`): state check, advisors, applied migrations, ran tests. Nothing needed pasting from you.
- **`sql/005`** applied: fixes the Supabase advisor warnings (pinned function search paths, faster membership policy). Verified.
- **`INVENTORY_PLAN.md`** written (slice 1 only).
- **`sql/006_inventory_core.sql`** applied and verified: items, warehouses, stock ledger, balances, stock requests, approvals, and seven functions. The approval is enforced in the database: stock can only be issued for an approved request, nobody can approve their own request, the ledger can't be edited, every step writes an audit row in the same transaction.
- **`sql/tests/002_inventory_approval.sql`** passed on the first run on your real database (rolled back, nothing left behind: still 1 org, 0 items, 2 users). `sql/tests/001` still passes.
- API error codes extended (state, not found, module off). Typecheck clean, 17 tests pass.
- Worklog, checklist, SQL READMEs updated. Not committed (you commit).

## Doing now
- Nothing running. Local dev server stays stopped.

## Next (workstream C, in order)
1. Inventory API routes in the Worker (call the seven functions; reads through your login).
2. Switch the demo screens to the real API (same screens, real data); keep the sample-data demo as the fallback link.
3. Test users and a demo organization in your Supabase; enable the inventory module for it.
4. Deploy the Worker and a second web build, then you click through.
5. SQL/real-login test for the inventory calls.

## Needs your input
- **Test users:** in Supabase dashboard, Authentication, Users, "Add user", tick auto-confirm, create three with a password you choose (and can share with management for the demo): a requester (becomes member), a manager (becomes admin), and an owner. Tell me the three emails, not the passwords. `ben@prime-ad.com` can be the owner if you prefer.
- **Cloudflare Worker secrets (you run these, I must not see them):** when I reach the deploy step I will give you two `wrangler secret put` commands; one needs the Supabase secret key from the dashboard (Project Settings, API).
- **Decide:** turn on "leaked password protection" in Supabase Auth settings (advisor warning; may need a paid plan).
- Management: go-ahead for the trials and interviews, e-invoicing now or later, WhatsApp provider, payment gateway (orders.md "decisions only you or management can make").
- Your click-through of the sample-data demo (orders.md item 5).

## Where to look
`orders.md`, `documentation/plans/INVENTORY_PLAN.md`, `sql/006_inventory_core.sql`, `sql/tests/002_inventory_approval.sql`, `documentation/operations/WORKLOG.md`.
