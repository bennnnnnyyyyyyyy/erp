# New look: rollout plan (12 Nov 2026)

Owner: Ben decides; Claude (UI session) builds and checks. Branch: `worktree-ui-warm` (the new look and the dev-only Design Lab).

## Where things stand

| Thing | State |
|---|---|
| Production (`https://erp-live.pages.dev`) | The OLD look. The new look was merged by mistake in PR #48 (12 Nov, 18:56 UTC) and taken off again by PR #49. |
| Preview of the new look | `https://worktree-ui-warm.erp-live.pages.dev`: the real app, real sign-in, real data, with the Design Lab. A snapshot of the branch at the time of deploy (before the phone fix below). |
| API | Accepts the preview address (PR #50, `ALLOWED_ORIGINS` in `apps/api/wrangler.toml`). Checked against the live API: preview accepted, other sites refused. |
| Branch `worktree-ui-warm` | The new look. Behind main by #49 (the undo) and #50. Do NOT merge main into it without also reverting the undo (see "Shipping"). It is no longer on the auto-sync list (`.github/sync-branches.txt`) for that reason. |
| Design Lab | Dev-only. Included in the preview build with `DESIGN_LAB=1`; never in a normal or production build (checked: 0 matches in a build without the switch). Ben's choices are saved in `apps/web/src/lib/designLab.ts` (`SEED`) and in `documentation/planning/2026-11-11-design-lab-choices.md`. |

## What was checked on 12 Nov (local sample-data build, in Chrome)

- Phone width (390px): no sideways overflow on Home and Inventory; the menu moves behind the menu button. One problem found and fixed on the branch: the Home title was 3.6rem and wrapped to two lines (now 2.4rem on phones, banner 196px tall instead of about 270px).
- Arabic right-to-left: the layout mirrors correctly (menu button, avatar, text alignment). The demo flips the layout only and does not translate the text, so real Arabic text is NOT checked.
- Light and dark mode: both look right.
- Contrast of Ben's near-grey custom palette (WCAG, measured on the page): every pair passes. Lowest: muted text on the page in light mode, 5.99 : 1 (target 4.5). Body text 14.7 : 1 light, 15.9 : 1 dark.
- Size: compared with the live app, the new look adds about 0.8 KB to the main script (+0.7%) and about 1.9 KB to the stylesheet (+8.5%), both compressed. Paint-cost items removed earlier (fixed background, blurred top bar, logo shadow). No timing test of a real device.

## Not checked yet (the gaps that remain)

1. The real screens behind sign-in: Sales, Purchasing, Accounting, Settings, forms, long tables with real data, pop-ups. (The demo has only part of the apps.)
2. Real Arabic text (account language set to Arabic), on desktop and phone.
3. A real phone (not a narrow frame): touch targets, the drawer menu, the keyboard.
4. Keyboard use and focus on the new sidebar and top bar; screen-reader labels.
5. Other browsers (Safari, Firefox). The theme uses `oklch()` and `color-mix()`, which need current browsers (the old theme already used `oklch()`).
6. A production-like speed test (a real build run on a device), not only file sizes.

## Small known items (my side, after Ben's decisions)

- The logo mark is teal and gold while Ben's palette is near-grey: decide whether the logo should follow the palette.
- On a phone the top bar shows two icons side by side (the logo and the app icon).
- Design Lab launcher overlaps content on a phone (dev only, does not ship).

## What Claude needs from Ben (nothing here blocks the others)

| # | Need | Why | Who |
|---|---|---|---|
| 1 | Review the preview and send, per screen, what looks wrong (screenshot is enough). Or sign in yourself in the Chrome window I use and say "continue": I will only look, never press approve/issue/save. | Closes gap 1. | Ben |
| 2 | Decide the 12 unconfirmed options (corner radius Subtle, card style Floating shadow, shadow Strong, table row height 0.5rem, content width Narrow, sidebar width 204px, group headings Hide, logo Sharp, tiles Big cards, tile edge None, stat cards Filled brand, chips Text only): keep or drop each. | Only decided options get baked into the real theme. | Ben |
| 3 | Decide the logo (keep teal and gold, or follow the palette). | Brand. | Ben |
| 4 | Review Arabic: set the account language to Arabic on the preview and look at 5 screens, or ask for the Arabic review sheet. | Closes gap 2. | Ben (speaks Arabic) |
| 5 | Open the preview on a real phone. | Closes gap 3. | Ben |
| 6 | Font: Readex Pro (friendly Arabic and Latin) needs `npm install` in the MAIN checkout (agents must not run installs in a worktree). Say yes or skip it. | Optional. | Ben |
| 7 | Optional: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets (today they exist only on the `production` environment), so the Preview deploy workflow works at one click. | Saves the manual deploy. | Ben |
| 8 | Say when to ship, and who merges. | Shipping is a production change. | Ben |

## What Claude does next (in this order)

1. Fix everything found in items 1, 3 and 4 above on the branch; run lint, typecheck and tests; tell Ben to redeploy the preview.
2. Bake the confirmed options into `theme.css` and `styles.css`; drop the unconfirmed ones; update the Lab's saved choices.
3. Gaps 4 to 6: keyboard and focus pass, other browsers (as far as Chrome allows), a real-build size and speed report.
4. Prepare "Ship the new look": merge main into the branch, revert the undo (PR #49) so the look comes back, run all checks, open nothing; Ben opens a clearly labelled PR.

## Refresh the preview (Ben, in PowerShell)

```
cd C:\Users\ben.arthur\Desktop\ERP\.claude\worktrees\ui-warm
git branch --show-current                      # must print worktree-ui-warm
$env:DESIGN_LAB='1'
$env:VITE_API_BASE_URL='https://erp-api.meetings-dmedeskai.workers.dev'
npm run build -w apps/web
npx wrangler pages deploy apps/web/dist --project-name erp-live --branch worktree-ui-warm
```

Use the alias address `https://worktree-ui-warm.erp-live.pages.dev`; the per-deployment address that wrangler also prints is refused by the API.
NEVER use `--branch main`: that replaces the live app. The preview uses the real database, so anything approved or issued there is real.

## Shipping (only when Ben says so)

Gate, all of: Ben approved the look screen by screen; the 12 options decided; Arabic and phone checked; all PR checks green (lint, typecheck, tests, SQL, real workflows); a quick look at the live app right after the deploy.
How: merging to main deploys production within minutes. The branch cannot be merged as it is, because main holds the undo; Claude prepares the branch (merge main, revert #49) and Ben merges the PR.
Rollback if it goes wrong: Cloudflare dashboard > Workers & Pages > erp-live > Deployments > the previous production deployment > Rollback (about 30 seconds); then revert the PR. Note: any later push to main redeploys, so do the revert PR too.

## Clean-up after shipping

- Remove the preview address from `ALLOWED_ORIGINS` in `apps/api/wrangler.toml` (production change).
- Remove the `*.erp-live` entry from Supabase Auth's redirect list if it is still there (invalid format; if needed use `https://*.erp-live.pages.dev/**`).
- Delete the Design Lab (`components/DesignLab.tsx`, `lib/designLab.ts`, `design-lab.css`, the line in `main.tsx`, the `DESIGN_LAB` switch in `vite.config.ts` and its check in `preview-deploy.yml`), or keep it dev-only if Ben wants it.
- Delete the branch `worktree-ui-warm` and its preview alias; the auto-sync list no longer needs it.
