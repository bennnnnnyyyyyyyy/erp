import type { ComponentType } from 'react';
import { hasPermission, type SessionInfo } from '@erp/shared';
import { AppsSettings } from './core/settings/AppsSettings';
import { AuditLog } from './core/settings/AuditLog';
import { GeneralSettings } from './core/settings/GeneralSettings';
import { UsersSettings } from './core/settings/UsersSettings';
import { demoMode } from '../lib/demo';
import { LedgerPage, NewRequest, RequestPage, RequestsList, StockPage } from './inventory/InventoryDemo';
import { NewPurchaseOrder, PurchaseOrderPage, PurchaseOrders, Suppliers } from './purchasing/PurchasingDemo';
import { Customers, NewSalesOrder, SalesOrderPage, SalesOrders } from './sales/SalesDemo';

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
  /** Home-screen grouping (see packages/shared/src/modules.ts). */
  suite: 'Core' | 'Warehouse' | 'Sales & Purchasing' | 'Finance';
  basePath: string;
  pages: AppPage[];
};

// DEMO ONLY (npm run dev:demo): sample-data inventory screens. The real inventory app replaces this
// entry when the inventory module is built from its plan; in normal builds it is not registered.
const DEMO_INVENTORY_APP: AppDef = {
  key: 'inventory',
  module: 'inventory',
  name: 'Inventory',
  description: 'Stock, requests, approvals and the ledger (demo data)',
  suite: 'Warehouse',
  basePath: '/inventory',
  pages: [
    { path: '', label: 'Stock on hand', component: StockPage },
    { path: '/requests', label: 'Stock requests', component: RequestsList },
    { path: '/requests/new', label: 'New request', component: NewRequest, nav: false, parent: '/requests' },
    { path: '/requests/:id', label: 'Request', component: RequestPage, nav: false, parent: '/requests' },
    { path: '/ledger', label: 'Stock ledger', component: LedgerPage },
  ],
};

// DEMO ONLY: sample purchasing and sales (wave 2 in the plan), registered only in demo mode.
const DEMO_PURCHASING_APP: AppDef = {
  key: 'purchasing',
  module: 'purchasing',
  name: 'Purchasing',
  description: 'Suppliers and purchase orders; receiving adds stock (demo data)',
  suite: 'Sales & Purchasing',
  basePath: '/purchasing',
  pages: [
    { path: '', label: 'Purchase orders', component: PurchaseOrders },
    { path: '/orders', label: 'Purchase orders', component: PurchaseOrders, nav: false, parent: '' },
    { path: '/orders/new', label: 'New purchase order', component: NewPurchaseOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Purchase order', component: PurchaseOrderPage, nav: false, parent: '' },
    { path: '/suppliers', label: 'Suppliers', component: Suppliers },
  ],
};

const DEMO_SALES_APP: AppDef = {
  key: 'sales',
  module: 'sales',
  name: 'Sales',
  description: 'Customers and sales orders that raise stock requests (demo data)',
  suite: 'Sales & Purchasing',
  basePath: '/sales',
  pages: [
    { path: '', label: 'Sales orders', component: SalesOrders },
    { path: '/orders', label: 'Sales orders', component: SalesOrders, nav: false, parent: '' },
    { path: '/orders/new', label: 'New sales order', component: NewSalesOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Sales order', component: SalesOrderPage, nav: false, parent: '' },
    { path: '/customers', label: 'Customers', component: Customers },
  ],
};

export const APPS: AppDef[] = [
  ...(demoMode ? [DEMO_INVENTORY_APP, DEMO_SALES_APP, DEMO_PURCHASING_APP] : []),
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

export const SUITE_ORDER: AppDef['suite'][] = ['Warehouse', 'Sales & Purchasing', 'Finance', 'Core'];

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
  // Exact paths win over patterns, so /inventory/items beats /inventory/items/:id.
  const exact = app.pages.find((p) => p.path === rest);
  if (exact) return { app, page: exact, params: {} };
  for (const page of app.pages) {
    const params = page.path.includes(':') ? matchPath(page.path, rest) : null;
    if (params) return { app, page, params };
  }
  return { app, page: null, params: {} };
}
