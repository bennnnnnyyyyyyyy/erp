# Update (paste this into the chat)

Kept current by Claude at the end of every turn. Last updated: 2026-10-29. Standing brief: `neworder.md` (Status block mirrors this).

## Last done
- Read `neworder.md` (the living brief: star feature = outbound voice/WhatsApp approvals and tasks; build order slice 1 to 5). We are finishing **slice 1**.
- Everything Supabase now goes through the CLI. Created the 3 demo users by SQL (no emails): **chris = owner, joseph = manager (admin), grant = requester (member)**. Passwords are random and saved only in `.temp\demo-credentials.txt` (git-ignored, on your machine). Not printed anywhere else.
- Ran the demo seed: **Demo Trading Co.** with 2 warehouses, 5 items with Arabic names, 1 issued request, 1 waiting for approval, 21 audit rows, audit chain clean. Stock read back correctly (gloves 120 with 30 reserved, cartons 460, tape 54).
- **Real sign-in test passed for all three users** (15/15, 15/15, 17/17 checks) through Supabase's REST API: own organization accepted, other/missing refused, isolation, no direct writes, issue without approval refused, member cannot approve. This was the one path the SQL tests could not prove.
- Inventory API routes and screens on the real API are written; typecheck clean, 17 tests pass. Not yet run through the Worker.
- Worklog, `neworder.md` status/backlog, update.md updated. Not committed (you commit).

## Doing now
- Nothing running; waiting on you for the deploy step below.

## Next
1. Deploy the Worker (needs your two `wrangler secret put` commands) and a web build against it.
2. You click through: grant submits a request, joseph approves, grant issues; check the history and audit log.
3. Slice 2 (from `neworder.md`): tasks and the notification outbox with a fake channel adapter.

## Needs your input
- Say **go** for the deploy and I will give you the two `wrangler secret put` commands: `SUPABASE_URL` is not secret but the **Supabase secret key** is, so you run that one yourself (Project Settings, API). I will not see it.
- Passwords: open `C:\Users\ben.arthur\Desktop\ERP\.temp\demo-credentials.txt`.
- Leaked-password protection (Supabase advisor warning): turn on or ignore.
- Management items in `orders.md`: trials and interviews, e-invoicing, WhatsApp provider, payment gateway.
- Note for the star feature: I will need a decision later on the voice/LLM key (Worker secret) and which WhatsApp provider; not needed yet (fake adapters first).

## Where to look
`neworder.md`, `documentation/operations/WORKLOG.md`, `sql/seed/001_demo_organization.sql`, `scripts/real-login-check.mjs`, `.temp\demo-credentials.txt` (yours only).
