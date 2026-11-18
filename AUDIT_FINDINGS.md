# ERP App and Design Lab Audit

**Date:** 18 November 2026  
**Scope:** Read-only review of the main checkout and local `.claude/worktrees/ui-warm` Design Lab worktree.  
**Changes:** This report is the only file created for this audit. No application code was changed.

## What the Git author list means

You confirmed that you are the only engineer. The four strings returned by Git are author-name aliases used in your commits during the last 90 days:

- `ben arthur @ waz/ggo`
- `bennnnnnyyyyyyyy`
- `meetingsdmedeskai-cmyk`
- `prodbyabdo`

They are not four separate contributors. Git history still cannot tell us CI success, production deploy frequency, incidents, or recovery time.

The local Design Lab worktree was clean, with 3 local commits ahead of and 7 behind its remote branch at review time. The pasted CI changes are on the separate `ci/guards` branch, not in the main checkout reviewed here.

## Findings

### P2 — Design Lab selections are not announced to assistive technology

The selected option state is shown with a visual `.on` class, but controls do not expose selected state through `aria-pressed`, `aria-checked`, or equivalent semantics. Some text inputs rely on placeholders instead of explicit labels.

**Suggested improvement:** Add appropriate selection semantics and labels, then verify with keyboard and screen reader use.

Evidence: [DesignLab.tsx](.claude/worktrees/ui-warm/apps/web/src/components/DesignLab.tsx)

### P2 — The contrast panel can imply broader WCAG coverage than it provides

The panel is titled “Contrast check (WCAG)” but checks five token pairs. It does not cover every rendered component/state, including status colors, chips, selected controls, and gradients.

**Suggested improvement:** Either expand checks to actual UI pairs and states, or describe the result as a five-pair token sample.

Evidence: [DesignLab.tsx](.claude/worktrees/ui-warm/apps/web/src/components/DesignLab.tsx), [designLab.ts](.claude/worktrees/ui-warm/apps/web/src/lib/designLab.ts)

### P2 — The Design Lab launcher can cover content on phones

The launcher is fixed near the viewport edge without a safe-area offset. The rollout notes also record that it overlaps content on phone layouts.

**Suggested improvement:** Account for safe areas and provide a way to reposition or dismiss the launcher.

Evidence: [design-lab.css](.claude/worktrees/ui-warm/apps/web/src/design-lab.css), [rollout plan](documentation/planning/2026-11-12-new-look-rollout-plan.md)

### P2 — Three core API routes do not show the project-required route permission check

`/session`, `/me/language`, and `/people` do not call `requirePermission`. The inspected handlers appear limited by caller identity or active organization membership; I found no confirmed cross-tenant data exposure. This is a defense-in-depth and project-policy gap.

**Suggested improvement:** Add suitable permission checks or document and test explicit exceptions.

Evidence: [core/routes.ts](apps/api/src/modules/core/routes.ts)

### P2 — Project status documents lag the migration register

The root README and checklist describe older migration state. The worklog's latest entries predate migrations that [sql/README.md](sql/README.md) records as applied on 17 and 18 November. This makes the operational record difficult to use as a current status source.

**Suggested improvement:** Bring the status summaries and worklog up to date with the latest verified state.

Evidence: [README.md](README.md), [checklist.md](documentation/plans/checklist.md), [WORKLOG.md](documentation/operations/WORKLOG.md), [sql/README.md](sql/README.md)

### Verify — SQL workflows are required checks

SQL tests and workflow tests run in separate workflows from the deploy workflow. I could not inspect branch-protection settings, so I cannot confirm whether they block merge/deploy. The CI improvements in the pasted transcript may change this after review and merge.

**Suggested improvement:** Confirm the SQL and workflow checks are marked required for the relevant branches.

## Resolved issue checked during review

The SQL history records that migration 095 added `inv_items.group_id` without the needed column read grant, causing item screens to remain loading. Migration 096 adds the grant and the SQL test covers the regression. I treated this as fixed, not as an open finding. A focused review of migrations 094–096 found no additional confirmed SQL isolation or grant issue.

## Provisional Design Lab scorecard

These scores are source-based and provisional; no fresh browser, keyboard, or assistive-technology pass was run.

| Area | Score (0–4) | Basis |
|---|---:|---|
| Accessibility | 2 | Selection semantics and some explicit labels are missing. |
| Performance | 3 | Lab is loaded only for development/preview; no fresh device performance run. |
| Theming | 2 | Token system exists, but the contrast panel covers a narrow sample. |
| Responsive behavior | 2 | Phone launcher overlap is documented and visible in the CSS positioning. |
| Visual conventions | 3 | A deliberate design-token system exists; score needs a fresh visual review. |

Prior project notes report contrast and layout checks on selected screens. Those historical checks are not a fresh verification of the current worktree.

## Metrics still needed

Since you are the only engineer, the engineer count is one; the four Git names are aliases. To calculate the remaining operational measures, use:

- **CI success and duration:** GitHub Actions workflow runs and job durations.
- **Deployment frequency and lead time:** production deployment records linked to commit timestamps.
- **Change failure rate, incident age, and MTTR:** incident/postmortem records linked to releases.
- **Test split, coverage, skipped tests, and feature-flag age:** test and flag inventories; Git alone is insufficient.

No tests, browser checks, production probes, or automated security scanners were run for this review. The SQL review was limited to migrations 094–096; findings elsewhere are static code/documentation observations.
