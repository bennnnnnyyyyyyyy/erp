# Response to the ERP audit of 11 November 2026

**For:** Ben. **Answers:** `ERP audit — 11 November 2026.md` (one P1, thirteen P2, three P3; no P0).
**Written by:** Claude (the repo-audit session that built and merged most of the work under review).

For every finding: whether we agree, **what we did wrong** (where it was our doing), **why the fix is right**, and **who does it**.
Everything under "fix" is planned, including migration 084 and every test named; outcomes are intended and still need verification.
Nothing here is done yet unless it says so.

## Summary

We agree with every finding. The audit was a static review: it found no confirmed way for one company to reach another's data, but
it did not verify at runtime that the tenant, approval and audit controls hold. That runtime and SQL verification is still
outstanding (Batch 2 and 3 below). The problems it found come from three habits, not single bugs:

1. **We moved fast and let process slip.** PR #42 was merged while its checks were still running (recorded in the worklog; #44 was
   merged the same way, seen on its GitHub page on 11 Nov but not recorded), and SQL tests are not required for the deploy. Speed
   was right; doing it without a safety net was wrong.
2. **We treated "accepted risk" as permanent.** The personal files in the public repo were accepted on 9 November and never revisited
   as the product became something sold to other companies.
3. **We tested what we built, not what an attacker or a keyboard user would do.** Unit and SQL tests check our happy paths and our
   own rules, but not invalid tokens, failed audit writes, focus in pop-ups, or each child table's isolation.

The plan: **Ben** does two settings changes today (private repo, required checks). **Claude** fixes the code and documentation
findings in one PR (Batch 1), then adds the missing tests (Batch 2). The browser workflow tests are a planned project (Batch 3).

| # | Finding | Sev. | Agree | Who | When |
|---|---|---|---|---|---|
| 1 | Personal material in the public repo | P1 | Yes | **Ben** | Today |
| 2 | Paymob reference not bound to the signature | P2 | Yes | Claude | Batch 1 |
| 3 | Unauthenticated requests skip the rate limiter | P2 | Yes | Claude | Batch 1 |
| 4 | CI checks can be bypassed; SQL suite separate | P2 | Yes | **Ben** (setting) + Claude (workflow) | Today + Batch 1 |
| 5 | Pop-up windows do not manage focus | P2 | Yes | Claude | Batch 1 |
| 6 | Two menus lack keyboard behaviour | P2 | Yes | Claude | Batch 1 |
| 7 | Three action columns have empty headers | P2 | Yes | Claude | Batch 1 |
| 8 | Web code is not linted | P2 | Yes | Claude | Batch 1 |
| 9 | Architecture records contradict the access model | P2 | Yes | Claude | Batch 1 |
| 10 | Windows build workaround incomplete | P2 | Yes | Claude | Batch 1 |
| 11 | Demo controls bypass translation | P3 | Yes | Claude | Batch 1 |
| 12 | Status dates lag | P3 | Yes | Claude | Batch 1 |
| 13 | ADR-0004 links on the broken-link allowlist | P3 | Yes | Claude | Batch 1 |
| 14 | API boundary tests miss security paths | P2 | Yes | Claude | Batch 2 |
| 15 | Isolation tests miss sixteen tables | P2 | Yes | Claude | Batch 2 |
| 16 | No audit-failure rollback test | P2 | Yes | Claude | Batch 2 |
| 17 | Browser tests are a smoke test, not workflows | P2 | Yes | Claude, with a plan first | Batch 3 |

---

## 1. P1 — Personal material in the public repository

**Agree.** An email-update ZIP and a competitor trial workbook (with personal correspondence and staff addresses) are in
`documentation/archive/root-files-2026-11/` and in the git history of a public repository.

**What we did wrong.** On 9 November the risk was "accepted", and the files were moved into an archive folder. Moving a file in git
does not remove it: it stays readable in the repository and in every past commit. "Accepted" was decided when the repo was a
prototype; it was not revisited when the product became something sold to other companies, whose staff and correspondents never
agreed to be public. Personal data of people who are not us is not ours to accept a risk for.

**The fix, and why it is right.**
1. **Ben, today:** make the GitHub repository **private** (Settings → General → Danger Zone → Change visibility). This removes
   public access to the files *and* their history in one step and is reversible. It is not expected to break anything (deploys
   authenticate with a token, not public access), but check the next deploy and any external links to the repo afterwards. It is the only fix that closes the history exposure without rewriting history.
2. **Claude, Batch 1:** remove the two files from the repository and add the archive's binary patterns to `.gitignore`, so a future
   `git add .` cannot bring them back (the same mistake happened on 10 November with the Ian drafts).
3. **Only if the repo must stay public:** rewrite history (`git filter-repo`) to purge the files, then force-push. This changes every
   commit id, breaks open branches and worktrees, and needs every session stopped first; it is a planned, one-time operation, and
   the contents must be treated as already exposed regardless.
4. **Rule added to `agents.md`:** personal data of third parties (emails, addresses, phone numbers, correspondence) is never
   committed, even to an archive; private material stays outside the repo.

## 2. P2 — Paymob callback reference is not bound to the signature

**Agree.** Our own security review (11 Nov) found the same thing and left it open.

**What we did wrong.** We relied on Paymob's signature but used `merchant_order_id`, a field outside the signed list, to decide
*which* payment link to settle. A signature only protects the fields it covers. We knew this when we wrote 057 and noted it as
"unverified" instead of designing it out.

**The fix, and why it is right.** When the link is created, save Paymob's own order id on it; on the callback, require the signed
`order.id` to equal the saved one before settling. This is a **planned** migration (084, not yet written), recreating
`fin__settle_payment_link` from its latest version. The intended outcome: the link is chosen by a value Paymob signed, so an altered
reference cannot move a payment to another link. Planned tests: an altered reference is refused; a matching one settles once. Before payments are switched on for a real company, one real Paymob test
callback verifies the field names against Paymob's live answer.

## 3. P2 — Unauthenticated requests bypass the rate limiter

**Agree.** `requireAuth` runs before `rateLimit('api')`, so a request with no or a bad token is rejected before it is counted.

**What we did wrong.** We placed the limiter to count per user, which is right for signed-in traffic, and forgot that the
expensive, abusable traffic is the unauthenticated kind (token guessing, flooding sign-in).

**The fix, and why it is right.** Two layers: an IP-keyed limiter *before* `requireAuth` (generous, so an office behind one IP is
not blocked), and the existing per-user limiter after it. The intended outcome is that every request is counted before sign-in work is done; to be
verified by a planned test (repeated invalid-token requests from one IP reach 429) and on live after deploy.

## 4. P2 — CI checks can be bypassed; the SQL suite is separate

**Agree.** The worklog records #42 merged while its checks were running (#44 likewise, seen on GitHub, not recorded), and the deploy
does not wait for the SQL tests. The audit did not see the branch-protection settings; the check names below match the current
workflows.

**What we did wrong.** We relied on people (including Claude telling Ben "merge once CI is green") instead of on the system. When
two deploys were blocked by a GitHub runner problem, waiting became the obstacle, and checks were skipped. That nothing broke is
luck, not process.

**The fix, and why it is right.**
1. **Ben, today:** GitHub → Settings → Branches → add a rule for `main`: *Require a pull request before merging*; *Require status
   checks to pass* and select **"Typecheck, tests and web build"** and **"Migrations and SQL tests on a throwaway local database"**;
   *Require branches to be up to date*. The Merge button then stays grey until both pass. This cannot be forgotten in a hurry.
2. **Claude, Batch 1:** make the deploy job depend on the SQL tests when SQL changed (one workflow calling the other, or a combined
   job), so even a direct push cannot deploy code whose SQL tests fail.
3. Migrations: the rule stays "dry run on live, apply, then merge", and the merge is now blocked until both checks pass.

## 5. P2 — Pop-up windows declare themselves modal without managing focus

**Agree.**

**What we did wrong.** On 10 November we fixed pop-ups being cut off by moving them to the page body, and declared them
`aria-modal`, but did not add the behaviour that promise implies. A screen-reader or keyboard user can Tab into the page behind.
We fixed what we could see and not what we could not.

**The fix, and why it is right.** In the shared `Modal` (one place, so every pop-up benefits): move focus into the dialog when it
opens, keep Tab and Shift+Tab inside it, return focus to the button that opened it on close, and mark the rest of the page `inert`.
This is the standard modal-dialog pattern (WAI-ARIA Authoring Practices). Tests: focus moves in, cycles, and returns.

## 6. P2 — Two menus lack menu keyboard behaviour

**Agree.** The user menu and the notification menu use `menu`/`menuitem` roles but only support Escape.

**What we did wrong.** We used ARIA roles as labels. A role is a promise of behaviour; announcing "menu" without arrow keys is
worse than no role.

**The fix, and why it is right.** Use disclosure semantics (a button with `aria-expanded` that shows a list of ordinary links and
buttons). It is simpler than a full menu pattern, works with Tab as people expect, and promises nothing we do not deliver.

## 7. P2 — Three action columns have empty headers

**Agree.** Payment links, shipments and connected phones.

**What we did wrong.** The 6 November UI audit fixed most empty headers but left ConnectPhone open (it is in our own notes), and
the two newer screens repeated the pattern because nothing checks for it.

**The fix, and why it is right.** Add a translated, screen-reader-only "Actions" header to each, and a small test that fails when a
table header cell is empty, so the pattern cannot return.

## 8. P2 — Web source is excluded from lint and formatting

**Agree.** `biome.json` covers API and shared only; the web app (the largest part) is only typechecked.

**What we did wrong.** Agents repeatedly noted "biome only covers apps/api" and worked around it instead of fixing it. A known gap
that everyone steps around is a decision nobody made.

**The fix, and why it is right.** Extend Biome to `apps/web` in the same CI step. The first run will report many small issues; fix
them in the same PR (formatting automatically, real issues by hand), so the check is green from day one and stays meaningful.

## 9. P2 — Architecture records contradict the access model

**Agree.** ADR-0002 still says the API uses the service-role key; ADR-0002 and ADR-0003 are still "Proposed"; `sql/001`'s comment
says the same; the architecture page predates the integration changes.

**What we did wrong.** We updated `agents.md` (what agents read) and the worklog, but not the canonical architecture records (what
a new engineer or a buyer's auditor reads). Two sources of truth disagreed.

**The fix, and why it is right.** Mark ADR-0002 and ADR-0003 **Accepted**, with a note on how they are implemented; correct the
service-role sentence (requests run with the caller's own sign-in; the master key is limited to the listed exceptions); link the
"Master-key exceptions" in `agents.md` from the architecture page and update its date. Correct the `sql/001` comment in a new
comment-only line in the next migration's header (old migrations are not edited).

## 10. P2 — The Windows build workaround is incomplete

**Agree.** The README says `&&` fails in the project's PowerShell setup, and the web build script still uses it.

**What we did wrong.** We documented the problem instead of removing it.

**The fix, and why it is right.** Replace the chained script with two scripts (`build:types`, `build:vite`) run by npm's own
`--workspaces`-safe chaining, or a tiny Node script, so the same command works in PowerShell, cmd and CI. Update the README.

## 11. P3 — Demo controls bypass translation

**Agree.** **Fix:** route the demo banner and labels through `tr()` with Arabic drafts (added to the review sheet).

## 12. P3 — Status dates lag

**Agree.** README and checklist say 9 November. **Fix:** update both to 11 November with the applied-migration state (069–078,
081–083; 079 and 080 unused).

## 13. P3 — ADR-0004 links are on the broken-link allowlist

**Agree.** **What we did wrong:** we silenced a failing check instead of fixing the links. **Fix:** correct the relative links and
remove the exceptions, so the link checker is honest again.

---

## Testing gaps (Batch 2)

### 14. API boundary tests miss security-critical paths

**Agree.** **What we did wrong:** we tested that missing tokens are refused, not that *bad* ones are; and the master-key guard we
added on 11 November covers four entry points but not `attachProviderAddress` or `createBostaDelivery` (we checked those two by
reading the code, but a reading is not a guard).

**The fix:** tests for malformed, expired and wrong-issuer tokens; for the new IP limiter before sign-in; a guard that those two
helpers are only called with records loaded by the signed-in person's own database client; and one representative
"no permission" and "module off" rejection per route group.

### 15. Isolation tests do not cover every business table

**Agree.** `agents.md` says every business table has isolation tests. Sixteen tables rely on their parent's test.

**What we did wrong:** we broke our own rule. Testing the parent operation was taken as proof for the child tables, but row level
security is per table, and a missing policy on a child table would not be caught.

**The fix:** one new SQL test that, for each of the sixteen tables (`acc_fiscal_years`, `acc_issue_reasons`,
`acc_manual_journal_lines`, `acc_receipt_costs`, `acc_entry_lines`, `trs_statement_formats`, `trs_statement_imports`,
`trs_statement_matches`, `alr_teams`, `alr_firings`, `pur_order_lines`, `pur_supplier_invoice_lines`, `sal_order_lines`,
`sal_invoice_lines`, `inv_batch_balances`, `inv_batch_moves`), creates a row in company A, then as company B proves it cannot
read it and cannot write the table directly. Plus a check that fails when a new `org_id` table has no isolation test.

### 16. Audit atomicity has no failure-injection test

**Agree.** **What we did wrong:** we tested that audit rows appear, not that a change cannot exist without one.

**The fix:** a SQL test that makes the audit insert fail (a temporary trigger raising an error, inside the rolled-back test) and
proves the stock movement and an approval are rolled back with it.

### 17. Browser tests are a smoke test, not workflow tests

**Agree.** **What we did wrong:** we called the smoke test "browser testing" in reports. It proves pages render, not that people can
do their work.

**The fix (Batch 3, planned before building):** a separate Playwright suite against a test environment (local Supabase or a
staging project, never live) with seeded owner, staff and second-company users: sign in, request and approve stock, receive a
purchase order, issue a credit note, and prove company B sees nothing of A. It runs on pull requests next to the smoke test. A
short plan comes first because it needs a test environment decision.

---

## How we work from here

- **Checks block merges** (finding 4), not reminders.
- **Accepted risks get a review date**, and are reopened when the product's situation changes (finding 1).
- **Every new table ships with its own isolation test**, and the check in finding 15 enforces it.
- **A gap noted twice is fixed, not noted a third time** (findings 7, 8, 10, 13).
- **Reports say what was tested, not what was built**: "smoke-tested" is not "tested in a browser" (finding 17).

## What Ben needs to do

1. **Today:** make the repository private (finding 1).
2. **Today:** add the branch-protection rule for `main` with the two required checks (finding 4).
3. **Say go** for Batch 1 (one PR: Paymob binding with migration 084, IP limiter, accessibility, web lint, architecture records,
   Windows build, P3s, removing the archive files) and Batch 2 (the tests).
4. **Later:** choose the test environment for Batch 3 (local Supabase in CI, or a staging project).
