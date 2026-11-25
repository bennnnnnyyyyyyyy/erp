import { hasPermission } from '@erp/shared';

// Shortcuts elsewhere in the app (home cards, notifications) that are about a report open it in Reports & Insights (Ben, 24 Nov 2026),
// but only when the company has the app switched on and the person may open reports. Otherwise they keep their older page.

type Access = { modules: readonly string[]; permissions: readonly string[] };

export const canOpenReports = (s: Access): boolean => s.modules.includes('reports') && hasPermission(s.permissions, 'reports.custom.read');

/** A ready-made report (packages/shared/src/reportTemplates.ts) when the person can open it, else `fallback`. */
export const readyReportOr = (s: Access, templateKey: string, fallback: string): string =>
  canOpenReports(s) ? `/reports/template/${templateKey}` : fallback;
