Understood. The attachment is the same overnight report I just summarized, and none of it affects tonight. Ignore it until Thursday.

Your three priorities, in order:

1. Demo

Run the seven-step script on the live site with Chris, Joseph and Grant.
Do one transfer end to end and leave one in transit.
Confirm the “(sample data)” label is back on the company name.
Confirm e-invoicing is off in the two demo companies.
Check that the latest push is green in Actions.
Hold the rollback ids (Worker e1cb6fc6…, Pages 36072048, plus newer ones from Claude Code) and have the fallback demo open: https://erp-demo-bas.pages.dev

2. Tutorial

Run the full tour on the Cosmetics company with each of the three accounts.
Run it once in English and once in Arabic.
Confirm it starts, finishes, and doesn’t reappear when it shouldn’t.

3. Every app and Arabic

Click through every screen in both languages.
Look for English left over in Arabic mode, text cut off or overlapping, and layout that doesn’t flip right-to-left.
Also check the numbers, dates and currency formats.
Claude Code’s own report says Arabic is only verified for menus, the tutorial and the Guide. Judge the rest by eye, and have a native Arabic speaker (J or Caro) skim the demo screens if one is free.

Message for Claude Code (paste as is):

Freeze for the demo tonight. Do not touch main, do not push, do not apply any SQL to the live database. Keep the overnight slices (migrations 040–044 and their API changes) uncommitted or on a branch only. Until the demo, only do these things:

Run the browser check on the live site as Chris, Joseph and Grant, in English and in Arabic, on every screen and the tutorial. Report anything broken, untranslated, cut off, or not flipped right-to-left, with the screen name.
Report the live Worker and Pages rollback ids.
Switch e-invoicing off in Demo Cosmetics Factory and Demo Trading Co., and tell me who switched it on.
Fix only bugs that would show during the seven-step demo script, as small patches that I review before I commit.

On whether the fixes serve the end goal: the overnight slices (lock date, due dates, stock counts, returns, units) are the right workflow gaps, but they only matter once the SQL is proven and they have screens. They are for Thursday, and nothing in them makes the demo better.

Send me the screens Claude Code reports as broken in Arabic and I’ll help triage which are demo-critical.

i alr pushed i wanna fix i can always rewind

Checking what the push actually deployed.

Pushing is recoverable, as long as you check these in order.

1. See what the push did

Open GitHub Actions for the latest run on main. CI runs lint, the smoke test of every screen, and the isolation SQL tests, and a failing step blocks the deploy.
Red: nothing deployed and the live site is unchanged. Fix forward or revert at your leisure.
Green: the new API code is live, and the database still lacks migrations 040–044. That is the risky case.

2. If it’s green, test the screens that code touches

Finance → open items (the overdue list on the home page too)
Invoice lists and invoice pages
Customer and supplier pages
Settings → org
Credit notes

If any of them show errors or blanks, rewind.

3. How to rewind

Fastest: roll back the Worker to the last good version (e1cb6fc6-ee48-41a4-bf14-8add5bc29b5d, or the newer id from Claude Code), and Pages to the one before the push (36072048).
Clean: git revert the push on main and push again. This redeploys the old code through CI.
The database is unaffected either way. Nothing was applied to it, so a code rewind brings you fully back.

4. Don’t apply migrations 040–044 to live today. Applying them untested the day of the demo is the one thing that’s hard to undo.

Tell me:

Is the Actions run red or green?
Did you push main or a branch?

Then I can tell you whether to rewind or keep going.
