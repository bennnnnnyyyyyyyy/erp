# Efficiency audit: why saving is slow (2026-11-04)

**Asked by Ben:** "saving takes so long, do an efficiency audit". **Scope:** the request path of every save, measured on the live site as Chris; the setup wizard's saves as the worst case. **Method:** read-only. Browser timing records of Ben's own session, a `/health` timing from the same tab, the Supabase project region, and the code of the API middleware and the wizard. Nothing was changed.

## 1. Measurements (live, as Chris, from Ben's own session)

| What | Calls | Median | Max |
|---|---|---|---|
| Browser → API, no database (`/health`) | 6 | **68 ms** | 72 ms |
| Storage conditions (list and create) | 6 | 260 ms | 280 ms |
| Warehouses (list and create) | 8 | 227 ms | 355 ms |
| Set warehouse storage | 5 | 288 ms | 321 ms |
| Session load | 2 | 795 ms | 795 ms |
| Notifications bell (polled about every 45 s) | 33 | 548 ms | 1,030 ms |

**Reading:** a typical write takes about 260 ms. Only about 68 ms of that is the trip to the API; **about 190 ms is three database calls in a row, roughly 60 ms each.**

## 2. Causes, biggest first

1. **The database is far from where the API runs.** Supabase project `ggoerp` is in **eu-west-1 (Ireland)**. The Worker runs at the Cloudflare location nearest the user (Cairo or Frankfurt), so every database call crosses Europe. Smart Placement, which runs the Worker next to its database, is off: `apps/api/wrangler.toml` has no `[placement]`.
2. **Every request makes three database calls, one after another.** `middleware/tenant.ts` reads the membership, *then* the enabled modules (two calls that could run at the same time), *then* the route calls its database function (the third).
3. **The wizard saves one row at a time, sequentially.** Each item is also two or three requests: create, then set cost, then sometimes the storage condition.

   "Fill everything" makes about **87 requests**: company 1; conditions about 3; warehouses about 12; items about 45; suppliers 13; customers 11; approval 2.

   87 × about 270 ms ≈ **20–25 seconds**. The items step alone is about 12 seconds.
4. Minor: the session call (about 800 ms) and the notifications poll (about 550 ms every 45 s) add background load, but they don't block a save.
5. Not about saving, but noticed: the last two CI deploys took **23 and 10 minutes**, against about 2 minutes before. Worth a look separately.

## 3. Fixes, ranked by payoff

| # | Fix | Where | Effect (estimate; to measure after) | Risk |
|---|---|---|---|---|
| F1 | **Smart Placement** for the Worker: add `[placement] mode = "smart"` to `apps/api/wrangler.toml` | config, 2 lines | Each database call should fall from about 60 ms to a few ms; a typical write from about 260 ms to about 100–120 ms. **The whole app gets faster**, not only the wizard. Cloudflare decides placement from traffic, so the effect shows after some minutes of use. | Low. Reverting is the same two lines. Requests that touch no database (`/health`) get slightly slower. |
| F2 | Run the tenant check's two reads **at the same time** (`Promise.all`) | `middleware/tenant.ts`, a few lines | One database round trip less on **every** request (about 60 ms today, a few ms after F1) | Low. Same queries and same checks; only the order changes. |
| F3 | Wizard: save **4 rows at a time** instead of 1 | `sampleFill.ts` (web only) | List steps about **4× faster** (items about 12 s → about 3 s today, about 1 s after F1) | Low. Each row is still its own audited call. The audit chain serialises safely in the database. Progress still counts up. |
| F4 | Item create accepts the cost in the same request (the route calls the existing cost function right after creating) | API route only, no migration | One request less per item (19 fewer in the fill) | Low |
| F5 | Later: one "create many" database function per table (items, parties), one call for the whole table | migration plus route | Fill everything in about 1–2 s | Medium. A migration, so it needs the full SQL test and apply routine. **Not before** F1–F4 are measured. |

**Expected result of F1 to F4 together:** "Fill everything" from about 20–25 s to roughly **3–5 s**, and every normal screen and save in the app noticeably quicker. These are estimates; the plan is to measure again with the same method after each fix.

## 4. Recommended order

1. **F1 and F2 first:** small, and they help the whole app. API config and code only; no web change and no migration. Deploy, use the app a few minutes, then re-measure with the method in §1.
2. **Then F3 and F4:** they make the wizard fast for the demo.
3. **F5** only if it is still too slow after that.

No fix needs a database migration except F5.

## 5. Status (2026-11-04, same day): F1–F4 done on branch `worktree-onboarding-wizard`, not merged

| Fix | Done | Where |
|---|---|---|
| F1 Smart Placement | yes | `apps/api/wrangler.toml` `[placement] mode = "smart"`; `wrangler deploy --dry-run` accepts it |
| F2 Tenant reads together | yes | `apps/api/src/middleware/tenant.ts` (`Promise.all`; same checks) |
| F3 4 rows at a time | yes | `sampleFill.ts` (`inPool`, `saveKeyed`: a row's key is claimed before saving, so duplicates in one table are not created twice). Test: never more than 4 at once. |
| F4 Cost in the create request | yes | `POST /v1/inventory/items` accepts `unitCostMinor` and calls the existing audited `inv_set_item_cost`. The wizard no longer makes a separate cost call. |
| F5 Bulk database functions | not done | Only if F1–F4 are not enough after measuring |

**Checks:** typecheck, `biome ci` and `npm test` (web 63) pass. The web build could not run on this machine at the end (out of memory), but it passed earlier the same day; CI builds it again before any deploy. **To do after merge:** measure again with the method in §1. For F1, use the app for a few minutes first, so Cloudflare places the Worker.

**Known trade-off (F4):** if the cost step fails after the item is created (for example, the person is not an owner or admin), the item exists without a cost and the request reports the error. Saving again skips the existing item. The cost can then be set later.
