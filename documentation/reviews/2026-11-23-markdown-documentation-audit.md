# Markdown documentation audit — 2026-11-23

## Purpose

This is a handoff for Claude: it records the Markdown inventory, current-state contradictions, memory recommendations, and content that should not be indexed or copied into project docs. It is an audit report, not approval to change live data, rewrite Git history, or delete local files.

## Scope and evidence

- Inventoried 1,777 Markdown files under the repository, including ignored paths; excluded `.git/` and `node_modules/`.
- The inventory included approximately 803 installed skill files under `.agents/`, 520 files in four `.claude/worktrees/` checkouts, 57 local prompt files under `.github/prompts/`, 33 Markdown files under `.temp/`, 345 files under `documentation/`, and the remaining root/script/SQL files.
- At the time of the initial audit, the checked-out `main` was clean, but it was behind `origin/main`. After fetching current `main`, PR #97's 23 November worklog and SQL-register updates were included in this refresh. Recent history includes PR #93 (HR integration), PR #95 (Bellvox plans and UX audit), and PR #97 (HR live-state record).
- Compared current-state claims with `documentation/operations/WORKLOG.md`, `sql/README.md`, the current checklist, and recent Git history. No live database query, browser session, test, or deployment check was run.
- Read the canonical status documents and plan status sections; used a whole-tree filename and status-claim scan to find conflicts. Installed skills and full worktree copies were classified by location, not read as ERP documentation. Credential and correspondence contents were not opened or copied into this report.

## Current-state summary

The initial audit found a conflict about migration 102: tracked docs said it was not applied while the ignored `.temp/plan-2026-11-23.md` said it was. That conflict is now resolved in current `main` by PR #97. The SQL register and 23 November worklog record `sql/102` as live and document read-only live checks for the HR tables, permissions, and deployed API. This audit did not independently query the database or make a deployment check. The recorded result is that no company is connected yet.

PR #95 is already in `main`; therefore, the ignored `.temp/status-2026-11-23.md` statement that PR #95 had not reached `main` is stale. The ignored plan says the Bellvox roadmap was approved, while tracked roadmap/checklist text still says approval is pending. Treat the durable approval record as unresolved until Ben confirms that decision and it is recorded in tracked docs.

## Stale or conflicting documents

1. [`../../README.md`](../../README.md), line 5: status is dated 18 November and predates migration 101, PR #93, and PR #95. Refresh the status paragraph and keep it brief.
2. [`../plans/checklist.md`](../plans/checklist.md), lines 3, 11–12: date and migration boundary are stale. It still places migration 100 after a pending merge, although the register says 100 and 101 are live. It says units on order lines are next even though migration 101 implements them. Its migration 102 and HR status have since been updated by PR #97. Bellvox approval still needs a durable decision record if Ben has approved it.
3. [`../../PRODUCT_BRIEF.md`](../../PRODUCT_BRIEF.md), line 32: says HR and payroll are not planned. The HR integration plan was approved and its code merged in PR #93. Update the scope statement while preserving unconfirmed customer-demand claims.
4. [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md), line 9: last reviewed 18 November, before PR #93 and the 19 November on-prem work. Update the system map to cover the HR webhook, 15-minute sync job, Node API entry point, and on-prem packaging, or state precisely which pieces are outside the deployed Cloudflare path.
5. [`../plans/MASTER_DATA_PLAN.md`](../plans/MASTER_DATA_PLAN.md), line 4: its status says slices 097 and 099 are not applied; the migration register reports them applied. It also predates slice 101, which implements line units. Correct the status block and retain the plan as the target design.
6. [`../plans/ACCOUNTING_PLAN.md`](../plans/ACCOUNTING_PLAN.md), line 4: still marked Draft although migrations 045–049 are reported applied. Mark phase 1 built or state the remaining plan scope explicitly.
7. [`../plans/ROADMAP_ACCOUNTING_SUITE.md`](../plans/ROADMAP_ACCOUNTING_SUITE.md), lines 3 and 38: says it awaits approval and that units on order lines are not built. Both claims predate current implementation. Refresh the roadmap status or label this as a historical roadmap and point to current approved plans.
8. [`../plans/SUPERFIX_WORKFLOW_PLAN.md`](../plans/SUPERFIX_WORKFLOW_PLAN.md), line 3: says its early slices were not run on any database and later slices remain open. Several workflows have since shipped, including line units in migration 101. Update the build-status section or mark it historical.
9. [`../plans/HR_APP_INTEGRATION_PLAN.md`](../plans/HR_APP_INTEGRATION_PLAN.md), line 4: verify the plan's branch reference and setup steps against merged PR #93. Its status now correctly says phase 1 is merged, `sql/102` is live, and the API was checked on 23 November. Keep the remaining first-connection prerequisites visible.
10. [`../plans/BELLVOX_READINESS_ROADMAP.md`](../plans/BELLVOX_READINESS_ROADMAP.md), line 3, and the checklist: still say Ben must approve. The 23 November local plan says approval was given. Record the approval and date in the roadmap/checklist; keep individual phase-plan or mockup approval gates that remain open.
11. [`../plans/IN_APP_TOUR_PLAN.md`](../plans/IN_APP_TOUR_PLAN.md), line 68: the document correctly labels itself a historical build record, but retains a stale note that server-side language preference was not applied; migration 038 is recorded as applied. Remove or correct that leftover.
12. [`operations/ETA_WORKSTREAM_LOG.md`](../operations/ETA_WORKSTREAM_LOG.md), lines 3–5: says its entries were merged into the canonical worklog on 3 November. It is duplicate history and should not be presented as a second source of truth.
13. [`operations/DEMO_SCRIPT_2026-11-02.md`](../operations/DEMO_SCRIPT_2026-11-02.md) and [`operations/COSMETICS_WALKTHROUGH.md`](../operations/COSMETICS_WALKTHROUGH.md): their figures and walkthrough details are dated 2 November. Refresh against the current demo before using them; do not repeat their numbers as current facts.
14. The 11 November click-through checklist and dated audit reports are historical snapshots. Keep them as evidence, but do not use unchecked items or old screen descriptions as current status without rerunning the checks.

The broad [`../plans/INTEGRATIONS_PLAN.md`](../plans/INTEGRATIONS_PLAN.md) is explicitly a draft for future waves and explains that scope at its build-status section. Do not call it stale solely because integration stages A–E are already built; preserve the distinction between shipped slices and the remaining umbrella plan.

## AI memory: what to load and what to keep on demand

### Default project context

Use a small, source-of-truth set: `agents.md`, `PLANS.md`, `documentation/README.md`, the current checklist, `documentation/architecture/ARCHITECTURE.md`, and `sql/README.md`. Add only the plan and ADR relevant to the task. Search the worklog for relevant entries; do not load all 3,591 lines (~410 KB) by default.

### Do not index as ERP state

- `.agents/skills/`: installed skill/tool instructions, not project architecture or product status.
- `.claude/worktrees/`: four full checkouts with roughly 520 Markdown files, many duplicating branch-era docs. Exclude them from repository-wide AI retrieval to avoid returning stale branch copies. Do not remove a worktree without checking whether it is active.
- `.github/prompts/`: local prompt packs, not product documentation. Invoke only when relevant.
- `.temp/` and ignored root scratch Markdown: ephemeral session notes, not durable status. The 23 November status memo is already stale about PR #95; the plan's migration-102 claim is unverified.
- `documentation/archive/`, completed audits, old walkthroughs and dated work reports: historical evidence only. Load a specific item when tracing a decision or finding.
- `documentation/reference/eta-sdk/`, Odoo imports/screenshots, and video transcripts: external or third-party reference material. Do not auto-load or copy into product requirements. Use a specific source only when needed, then record our own factual summary in the relevant reference or teardown.

## Content that is harmful or risky

1. `.temp/` contains personal correspondence drafts and files named as credentials. The values are intentionally omitted here. Ignoring files does not remove them from the workspace or protect them from local indexing. Move private drafts and credentials outside the repository; if any credential is real, rotate it. Do not commit or auto-index these files.
2. `documentation/archive/root-files-2026-11/` contains archived reply/message-named material. Review it for personal or third-party correspondence and remove any such material from the current tree. Moving it does not erase Git history; history remediation is a separate decision.
3. A local ignored status note claims the demo organization contains real people's email addresses and misleading balances. This was not independently checked against live data. Treat it as a privacy and demo-readiness issue: verify the demo data through an approved read-only review before presenting it. Do not include any actual addresses or account details in docs.
4. The ignored 23 November plan tells agents to write long reports into `.temp/`. That conflicts with the repo's documentation boundary and the rule to keep private drafts outside the repository. Do not reuse that instruction; put approved project docs in `documentation/` and keep private notes outside the workspace.
5. [`../../PLANS.md`](../../PLANS.md), line 6: says every module plan comes from a competitor teardown. This is too restrictive for approved requirements that come from customers, partners, or internal product decisions (the HR integration is an example). Change the principle to require approved, evidenced requirements; competitor research should remain one possible input.

## Recommended order of work

1. Treat `sql/README.md` and the 23 November worklog entry from PR #97 as the current recorded evidence for migration 102. Do not rely on the older ignored plan as the status source.
2. Refresh the checklist and README status; confirm and record the Bellvox roadmap approval in durable docs if Ben approved it.
3. Update the product brief, architecture, accounting/master-data/roadmap/superfix status sections, and HR branch reference.
4. Mark the ETA workstream log as superseded or remove the duplicate after confirming the canonical worklog contains the required entries.
5. Move private correspondence and credentials out of the workspace; review the archived root-file collection for prohibited material. Keep sensitive values out of the audit and any future report.
6. Refresh the demo walkthroughs only after checking current UI and demo data. Keep historical screenshots/figures clearly dated.
7. Configure AI retrieval to exclude skills, prompts, worktrees, ignored scratch, archives, and bulk third-party references by default.

## Findings and work done

- The main documentation issue is status drift: the README, checklist, several plan headers, and architecture review lag behind the 18–20 November implementation and PR #95.
- The migration 102 discrepancy identified in the initial audit was resolved on `main` by PR #97, which records the 23 November live checks. This audit relied on that checked-in evidence and did not independently access live systems.
- Ignored does not mean safe or harmless: local correspondence, credentials, vendor material, and stale worktree copies can still leak into AI context.
- This report is the only file created by the audit. No code, database, production state, Git history, or ignored local file was changed. No tests or deployment checks were run.
