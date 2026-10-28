import type { ComponentType } from 'react';
import { hasPermission, type SessionInfo } from '@ggo/shared';
import { AppsSettings } from './core/settings/AppsSettings';
import { AuditLog } from './core/settings/AuditLog';
import { GeneralSettings } from './core/settings/GeneralSettings';
import { UsersSettings } from './core/settings/UsersSettings';
import { CompaniesList, CompanyPage } from './crm/Companies';
import { ContactPage, ContactsList } from './crm/Contacts';
import { DealPage, DealsBoard, DealsList } from './crm/Deals';
import { PipelineSettings } from './crm/PipelineSettings';

// Apps shown as tiles on the home screen. Each belongs to a module (packages/shared/src/modules.ts);
// an app appears only when its module is enabled for the org and the user can open at least one page.

export type AppPage = {
  /** Relative to the app's basePath; '' is the app's first page. `:name` segments become params. */
  path: string;
  label: string;
  permission?: string;
  component: ComponentType;
  /** false keeps the page out of the sidebar (record pages). */
  nav?: boolean;
  /** Sidebar entry to highlight while on this page (its `path`). */
  parent?: string;
};

export type AppDef = {
  key: string;
  module: string;
  name: string;
  description: string;
  /** Home-screen grouping (MVP_PLAN section 4.1). */
  suite: 'Core' | 'Sales & Clients' | 'People' | 'Work' | 'Finance' | 'Operations';
  basePath: string;
  pages: AppPage[];
};

const CRM_READ = 'crm.records.read';

export const APPS: AppDef[] = [
  {
    key: 'crm',
    module: 'crm',
    name: 'CRM',
    description: 'Companies, contacts and deals',
    suite: 'Sales & Clients',
    basePath: '/crm',
    pages: [
      { path: '', label: 'Deals', permission: CRM_READ, component: DealsBoard },
      { path: '/deals', label: 'Deals list', permission: CRM_READ, component: DealsList, nav: false, parent: '' },
      { path: '/deals/:id', label: 'Deal', permission: CRM_READ, component: DealPage, nav: false, parent: '' },
      { path: '/companies', label: 'Companies', permission: CRM_READ, component: CompaniesList },
      { path: '/companies/:id', label: 'Company', permission: CRM_READ, component: CompanyPage, nav: false, parent: '/companies' },
      { path: '/contacts', label: 'Contacts', permission: CRM_READ, component: ContactsList },
      { path: '/contacts/:id', label: 'Contact', permission: CRM_READ, component: ContactPage, nav: false, parent: '/contacts' },
      { path: '/settings', label: 'Pipeline', permission: CRM_READ, component: PipelineSettings },
    ],
  },
  {
    key: 'settings',
    module: 'core',
    name: 'Settings',
    description: 'Organization, users, apps and audit log',
    suite: 'Core',
    basePath: '/settings',
    pages: [
      { path: '', label: 'General', permission: 'core.org.read', component: GeneralSettings },
      { path: '/users', label: 'Users', permission: 'core.users.read', component: UsersSettings },
      { path: '/apps', label: 'Apps', permission: 'core.org.read', component: AppsSettings },
      { path: '/audit', label: 'Audit log', permission: 'core.audit.read', component: AuditLog },
    ],
  },
];

export const SUITE_ORDER: AppDef['suite'][] = ['Sales & Clients', 'People', 'Work', 'Finance', 'Operations', 'Core'];

/** Apps this user can open, each with only the pages they are allowed to see. */
export function visibleApps(session: SessionInfo): AppDef[] {
  return APPS.filter((a) => session.modules.includes(a.module))
    .map((a) => ({ ...a, pages: a.pages.filter((p) => !p.permission || hasPermission(session.permissions, p.permission)) }))
    .filter((a) => a.pages.length > 0);
}

function matchPath(pattern: string, rest: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = rest.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const p = a[i] ?? '';
    const v = b[i] ?? '';
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  return params;
}

export type Route = { app: AppDef; page: AppPage | null; params: Record<string, string> };

export function resolveRoute(path: string, apps: AppDef[]): Route | null {
  const clean = path.replace(/\/+$/, '') || '/';
  const app = apps.find((a) => clean === a.basePath || clean.startsWith(`${a.basePath}/`));
  if (!app) return null;
  const rest = clean.slice(app.basePath.length);
  // Exact paths win over patterns, so /crm/deals beats /crm/deals/:id.
  const exact = app.pages.find((p) => p.path === rest);
  if (exact) return { app, page: exact, params: {} };
  for (const page of app.pages) {
    const params = page.path.includes(':') ? matchPath(page.path, rest) : null;
    if (params) return { app, page, params };
  }
  return { app, page: null, params: {} };
}
