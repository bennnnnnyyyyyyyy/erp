# UI audit brief: paste this into a NEW Claude Code chat (written 3 Nov 2026)

**How to use.** Open a new chat in this repo and paste the block under "PROMPT TO PASTE". Everything else in this file is reference the new chat can read from here. Nothing in this file is a secret. Move or delete the file after the audit (agents.md keeps the repo root for a few files only).

---

## PROMPT TO PASTE

> Read `UI_AUDIT_BRIEF.md` at the repo root first, then `agents.md`, then `documentation/reviews/2026-11-02-ui-audit.md` (an earlier code-only audit: build on it, do not repeat it). Run a **UI audit of the live demo path using the new UI skills in `.github/prompts/`** (read `ui-ux-pro-max.prompt.md`, `ui-styling/SKILL.md`, `design-system/SKILL.md`; the `Skill` tool may not list them, so read the files directly). I am rehearsing a management demo tomorrow, so this audit must be **read-only on live**: no data changes, no approving or submitting anything, no push, no deploy, no commit. Use Chrome (you have my permission) on the pages in section 5, in the viewports and modes in section 6. I will sign in myself in the browser first; never type a password into any form. Deliver the report described in section 8, ranked by severity, with screenshots-in-words (what you saw), and **do not change code until I approve a short list of fixes**.

---

## 1. The product in six lines

A warehouse-first, multi-tenant ERP for SMEs in Egypt/GCC (React + Vite web in `apps/web`, Hono Cloudflare Worker API in `apps/api`, Supabase Postgres in `sql/`, shared types in `packages/shared`). Its core ideas: **an outgoing stock movement needs a different person's approval, enforced in the database**; an append-only audit log; a messaging layer for approvals. Money is integer minor units, EGP by default. Arabic and English with RTL. It is sold to other companies, so nothing is hardcoded to one customer. The demo is a fictional cosmetics factory. Full rules: `agents.md`.

## 2. Rules for the new chat (from `agents.md` and what I have asked)

- **Never commit or push.** I commit. No deploys.
- **Live is read-only.** Browse; do not click Approve, Submit, Issue, Cancel, Void, Delete, Save, or switch any setting on live. Rehearsals are using the live company right now.
- **Passwords:** never enter a password in any browser field. I will sign in beforehand and you reuse my session. A file with the demo logins exists at `.temp/demo-credentials.txt`; do not read it unless I tell you to, and never print it.
- **Browser:** allowed (I permit it here), but announce which pages you open. If the extension misbehaves 2 to 3 times, stop and tell me.
- **Edits:** the background-session guard blocks edits in the main checkout. If you need to change code, **ask me before creating a worktree** (I do not want worktrees created without asking). Make surgical changes only, add a dated section to `documentation/operations/WORKLOG.md`, run `npm run typecheck` and `npm test` at the root before handing off.
- **Node and git live outside PATH:** node `C:\Users\ben.arthur\node-v24.14.1-win-x64\`, git `C:\Users\ben.arthur\PortableGit\bin\`. Use PowerShell. Use `rg` first for searching.
- **No hard-coded UI strings** (Arabic and English from the first screen) and **logical CSS only** (no left/right).

## 3. What is live right now (checked 3 Nov, about 18:00 local)

- App: https://erp-live.pages.dev (Cloudflare Pages). API: https://erp-api.meetings-dmedeskai.workers.dev (`/health` answers).
- Deployed by GitHub Actions "CI and Cloudflare deploy" on push to `main`. The deploy for `78ff6e9` succeeded (Worker `fb8d1690-8dd2-4685-bcb4-80db78f91c9f`, Pages `339a72fb`); the run for `3640719` (the newest commit) was still in progress when this was written. Check `gh run list --repo bennnnnnyyyyyyyy/erp --workflow "CI and Cloudflare deploy" --limit 3` before trusting what you see.
- The live bundle already contains the new language prompt, the Arabic home page and the per-company tour switch.
- Safety-net demo (no sign-in, sample data, resets on reload): https://erp-demo-bas.pages.dev. You can click around freely there.

### Companies and people

| Company | State | Who |
|---|---|---|
| **Demo Cosmetics Factory** (the demo; the "(sample data)" label was removed on 3 Nov, I renamed it myself) | 45 items, 12 months of history, tutorial **off**, tour **off** | chris (owner), joseph (admin/manager), grant (member/requester), me (admin) |
| **Test Organization** (the old empty company) | 0 warehouses and items, tutorial **on**, tour **on** | me (owner) |
| Demo Trading Co. | small sample, tutorial and tour off | chris, joseph, grant |

The **one-time language prompt** appears on first sign-in for a person never asked. If you see it, that is expected: pick a language (not "company default" if you want to see the Arabic).

## 4. Where the skills are

`.github/prompts/`: `ui-ux-pro-max.prompt.md` (the main one: accessibility checklist, interaction, light/dark contrast, layout; its CLI needs Python 3, check `python --version`, and **do not install anything** if it is missing: skip the CLI searches and use the written checklist), plus folders `ui-styling`, `design-system`, `design`, `brand`, `banner-design`, `slides` (the last four are probably not relevant to an audit). The ui-ux-pro-max file's mobile-only rules (safe areas, haptics, Dynamic Type) do not apply to this desktop-web app; its web accessibility items do.

## 5. Pages to audit (the demo path, in demo order)

Sign in as **chris** (owner) first, then spot-check **grant** (member) for what a requester sees. Cosmetics company unless noted.

1. Home `/` (owner cards: profit, money in/out, waiting for decision, stock and expiry, best sellers, dependencies; app tiles; the greeting)
2. Inventory > Stock forecast, Batches and expiry, Stock on hand, Reorder levels
3. Inventory > Stock requests (list), New request (form; **the warehouse dropdown defaults to Cold room, the demo needs Finished goods**), a request detail page
4. Inventory > Stock transfers (list, new, detail), "In transit now"
5. Stock ledger, Approval policies, Stock adjustments
6. Settings > Audit log, Settings > General (language, the Guide and Guided tour switches), Users, Apps
7. Sales > Customer invoices; Finance > Profit overview (and Expenses, Payments); Alerts > Rules and teams; Purchasing > Supplier invoices
8. **Guide** `/guide` (all companies) and, in **Test Organization**: **Getting started** `/start` and the **guided tour** (Take the tour button; it asks for a language first)
9. **Arabic** pass of everything above: pick Arabic, then walk 1 to 8 again

## 6. Dimensions to cover

- **Viewports:** 1440, 1024, 768, **390** (phone; the real users are warehouse staff on phones). The browser window-resize tool may not shrink the viewport: a same-origin `<iframe>` of the page at the target width works.
- **Modes:** dark and light (check contrast independently), **RTL/Arabic** (layout flips, icons and arrows, number and date formatting, text that stays English, mixed-script punctuation), keyboard-only (Tab order, visible focus, dialogs trap focus), reduced motion, text zoom to 200%.
- **States:** loading, empty, error, long text, many rows (the lists load every row, no pagination).
- **UX heuristics:** can a first-time viewer tell what a card or number means; are the demo actions obvious; anything that would embarrass me in front of management.

## 7. What is already known (do not report as new; do confirm or update)

From `documentation/reviews/2026-11-02-ui-audit.md` (code-only, no browser): translatability, 642 kB single JS bundle, small touch targets (default button 36 px, small 32 px), basic list screens, tiny component kit (only Button and Badge), two `window.confirm` pop-ups, no skip-to-content link, 30 `<th>` without `scope`. **Since then:** the shell, home page (greeting, date, app tiles), Guide, tutorial and tour are translated (Arabic is a machine draft awaiting a native reviewer; **the body of every other screen is English**); dates on Home follow the language; the tour's buttons are 40 px; dialogs take and trap keyboard focus.

Also known:
- Home app tiles for Purchasing, Sales and Getting started show a **letter** (P, S, G) instead of an icon.
- The owner-home line wrapping on narrow screens (flagged earlier, not confirmed on a real screen).
- "Failed to fetch" has been seen on some screens by some users and is **not diagnosed**; if you hit it, record the exact page, action, time and user, and check the browser console and network tab.
- The Stock requests and ledger lists cap at 200 and 500 rows.
- The tour only exists where a company switched it on; the demo build (`vite --mode demo`) has no sign-in, no first-run prompt and no tutorial.

## 8. Deliverable

Write `documentation/reviews/2026-11-04-ui-audit.md` (no other files), with: method and what you could not check; a table `# | severity (P0 blocks the demo, P1 embarrassing, P2 should fix, P3 polish) | page | what you saw | why it matters | suggested fix | effort (small/medium/large)`; a short "fix before the demo" list of **at most five** low-risk items; a "do not touch before the demo" list; and the Arabic/RTL findings in their own section. Then **stop and wait for my approval** before changing any code.

## 9. Useful facts for fixes (only after approval)

- UI code: `apps/web/src/` with `components/Shell.tsx` (top bar, sidebar, first-run language prompt, tour host), `components/ui/` (Button, Badge), `components/views/ListView.tsx` (all list screens), `components/LanguageChooser.tsx`, `modules/registry.tsx` (apps and pages), `modules/core/Home.tsx` and `OwnerHome.tsx`, `modules/inventory/Inventory.tsx` (stock, requests, ledger), `modules/help/` (Guide, Getting started, tour), `styles.css` and `theme.css` (tokens; light and dark).
- Translations: `lib/i18n.tsx` (provider, `t()` where the English text is the key) and `lib/i18nNav.ts` (navigation Arabic). A test fails if a registry app, description, page label or suite lacks Arabic.
- Run locally without signing in: from `apps/web`, `node ..\..\node_modules\vite\bin\vite.js --mode demo --port 5199`. Stop the server when done.
- Checks: `npm run typecheck` and `npm test` at the root (tests: shared 31, API 117 plus 7 PreProd tests that skip without credentials, web 39). Today all pass.
- Current commit on `main`: `3640719`.