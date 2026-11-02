# Endpoint and button audit, 2 Nov 2026 (code-level plus live API checks)

**Method.** Parsed every API route in `apps/api/src/modules` (109) and every `/v1/...` call in `apps/web/src` (140 call sites, 89 unique), matched them, checked which web actions have error handling, checked the live Worker log, and read the database seed. **Not done:** authenticated calls as each role (no sign-in as the sample users), so permission-denied paths were checked by reading, and by the SQL tests, not by clicking.

## Results

| Check | Result |
|---|---|
| Web calls with no matching API route | **0 of 140** (nothing would 404) |
| API routes without a permission check on the declaring line | 2: `GET /v1/core/session` (the caller's own session, intended) and `GET /v1/core/people` (member names for display; confirm it only returns the caller's own organization) |
| API routes the web app does not call | 9, probably helper-built calls my matcher missed: `PUT alerts/rules/:id/recipients`, `POST core/modules/:key/enable|disable`, `GET inventory/adjustments/:id`, `POST inventory/warehouses/:id/storage`, `POST purchasing/suppliers`, `POST purchasing/orders`, `POST sales/customers`, `POST sales/orders`, `GET sales/orders/:id/billing`. Check by clicking: add supplier, add customer, new purchase order, new sales order |
| Buttons and actions (108 `<button>` elements, 57 awaited API calls) | 54 of 57 are inside a shared `run()` or `act()` helper that catches errors and shows the message. **3 are not**: `GeneralSettings.tsx` tutorial show/hide, `Messaging.tsx` "mark all read", `UsersSettings.tsx` (the confirm-then-disable path relies on `act`, which is fine; the tutorial toggle and mark-all-read have no catch, so a failure is silent) |
| Native browser pop-ups (`window.confirm`) | 2 (disable user, switch an app off): unstyled and English-only |
| Live Worker log (385 requests while the tail ran) | all `outcome: ok`, 0 exceptions, 0 server errors |
| Unauthenticated live smoke test | not usable for route existence: authentication runs before routing, so every `/v1/...` path returns 401 |
| "Failed to fetch" | **cause not found.** API up, CORS correct for `erp-live.pages.dev`, no Worker errors during the tail. Needs the failing click reproduced on the cosmetics org |

## Data finding (affects the demo)
The sample company's history stops in **September 2026**. See the answer in the chat: the seed generates the 12 months before the month it was run in (30 Oct), so October and November have no sales, stock movements, expenses or purchase orders. Query result (cosmetics org): Oct 2025 to Sep 2026 each have 24 to 27 invoices, 78 to 90 stock issues, 5 to 6 expenses, 11 purchase orders; Oct 2026 and Nov 2026 have **0 of everything**.

Effects: the owner home headline "last full month" is October, so it reads "Made 0"; "this month so far" is empty; the forecast looks at the latest 30 days, which are empty, so items show little or no usage; best sellers (last 90 days) cover only about two of the three months; the numbers the other chat quoted (1.59M revenue) are the September-era figures.

## Recommended fixes, in order
1. Top-up the sample data for Oct 2026 and 1 to 2 Nov 2026 (and make the seed rerunnable relative to today) so the demo has a current month. Needs Ben's go-ahead: it adds rows to the sample organization.
2. Add a catch to the two unguarded buttons (tutorial toggle, mark all read).
3. Click-test the 4 create buttons listed above as an owner.
4. Reproduce "failed to fetch" on the cosmetics org and read the Worker log.
