import type { ComponentType } from 'react';
import { hasPermission, type SessionInfo } from '@erp/shared';
import { AppsSettings } from './core/settings/AppsSettings';
import { AuditLog } from './core/settings/AuditLog';
import { GeneralSettings } from './core/settings/GeneralSettings';
import { UsersSettings } from './core/settings/UsersSettings';
import { demoMode } from '../lib/demo';
import { BatchesPage } from './inventory/Batches';
import { AdjustmentsPage, ApprovalPoliciesPage, LedgerPage, NewRequest, ReorderLevelsPage, RequestPage, RequestsList, StockPage } from './inventory/Inventory';
import { NewPurchaseOrder, PurchaseOrderPage, PurchaseOrders, Suppliers } from './purchasing/PurchasingDemo';
import { SupplierInvoices } from './purchasing/SupplierInvoices';
import { NotificationsPage, OutboxPage } from './messaging/Messaging';
import { ConnectPhonePage } from './messaging/ConnectPhone';
import { TaskPage, TasksPage } from './tasks/Tasks';
import { Customers, NewSalesOrder, SalesOrderPage, SalesOrders } from './sales/SalesDemo';
import { CustomerInvoices } from './sales/CustomerInvoices';
import { ExpensesPage, PaymentsPage } from './finance/Finance';

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

// Inventory slice 1 (documentation/plans/INVENTORY_PLAN.md). Runs on the real API; in demo mode the same
// screens run on the in-browser sample data.
const READ = 'inventory.items.read';
const INVENTORY_APP: AppDef = {
  key: 'inventory',
  module: 'inventory',
  name: 'Inventory',
  description: demoMode ? 'Stock, requests, approvals and the ledger (demo data)' : 'Stock, requests, approvals and the ledger',
  suite: 'Warehouse',
  basePath: '/inventory',
  pages: [
    { path: '', label: 'Stock on hand', permission: READ, component: StockPage },
    { path: '/reorder-levels', label: 'Reorder levels', permission: READ, component: ReorderLevelsPage },
    ...(demoMode ? [] : [{ path: '/batches', label: 'Batches and expiry', permission: 'inventory.batches.read', component: BatchesPage }]),
    { path: '/approval-policies', label: 'Approval policies', permission: READ, component: ApprovalPoliciesPage },
    { path: '/adjustments', label: 'Stock adjustments', permission: 'inventory.adjustments.read', component: AdjustmentsPage },
    { path: '/requests', label: 'Stock requests', permission: READ, component: RequestsList },
    { path: '/requests/new', label: 'New request', permission: READ, component: NewRequest, nav: false, parent: '/requests' },
    { path: '/requests/:id', label: 'Request', permission: READ, component: RequestPage, nav: false, parent: '/requests' },
    { path: '/ledger', label: 'Stock ledger', permission: READ, component: LedgerPage },
  ],
};

const PURCHASING_APP: AppDef = {
  key: 'purchasing',
  module: 'purchasing',
  name: 'Purchasing',
  description: demoMode ? 'Suppliers and purchase orders; receiving adds stock (demo data)' : 'Suppliers, purchase orders and receiving goods into stock',
  suite: 'Sales & Purchasing',
  basePath: '/purchasing',
  pages: [
    { path: '', label: 'Purchase orders', component: PurchaseOrders },
    { path: '/orders', label: 'Purchase orders', component: PurchaseOrders, nav: false, parent: '' },
    { path: '/orders/new', label: 'New purchase order', component: NewPurchaseOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Purchase order', component: PurchaseOrderPage, nav: false, parent: '' },
    { path: '/suppliers', label: 'Suppliers', component: Suppliers },
    { path: '/invoices', label: 'Supplier invoices', permission: 'purchasing.invoices.read', component: SupplierInvoices },
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

const SALES_APP: AppDef = {
  key: 'sales', module: 'sales', name: 'Sales', description: 'Customer orders fulfilled through approved warehouse stock requests',
  suite: 'Sales & Purchasing', basePath: '/sales', pages: [
    { path: '', label: 'Sales orders', permission: 'sales.orders.read', component: SalesOrders },
    { path: '/orders/new', label: 'New sales order', permission: 'sales.orders.create', component: NewSalesOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Sales order', permission: 'sales.orders.read', component: SalesOrderPage, nav: false, parent: '' },
    { path: '/customers', label: 'Customers', permission: 'sales.customers.read', component: Customers },
    { path: '/invoices', label: 'Customer invoices', permission: 'sales.invoices.read', component: CustomerInvoices },
  ],
};

// Slice 2 (documentation/plans/TASKS_AND_OUTBOX_PLAN.md). Real API only: the sample-data demo has no backend for these.
const TASKS_APP: AppDef = {
  key: 'tasks',
  module: 'tasks',
  name: 'Tasks',
  description: 'Assign work with a due time and follow it up',
  suite: 'Warehouse',
  basePath: '/tasks',
  pages: [
    { path: '', label: 'Tasks', permission: 'tasks.tasks.read', component: TasksPage },
    { path: '/:id', label: 'Task', permission: 'tasks.tasks.read', component: TaskPage, nav: false, parent: '' },
  ],
};

const MESSAGING_APP: AppDef = {
  key: 'messaging',
  module: 'messaging',
  name: 'Messages',
  description: 'Notifications, and delivery status for managers',
  suite: 'Warehouse',
  basePath: '/messaging',
  pages: [
    { path: '', label: 'Notifications', permission: 'messaging.notifications.read', component: NotificationsPage },
    { path: '/whatsapp', label: 'Connect WhatsApp', permission: 'messaging.notifications.read', component: ConnectPhonePage },
    { path: '/outbox', label: 'Message outbox', permission: 'messaging.outbox.manage', component: OutboxPage },
  ],
};

export const APPS: AppDef[] = [
  INVENTORY_APP,
  ...(demoMode ? [] : [TASKS_APP, MESSAGING_APP]),
  PURCHASING_APP,
  ...(demoMode ? [DEMO_SALES_APP] : [SALES_APP]),
  // Real API only (no sample-data version). Owner and admin only.
  ...(demoMode ? [] : [{
    key: 'finance', module: 'finance', name: 'Finance', description: 'Expenses and payments: money in, money out',
    suite: 'Finance', basePath: '/finance', pages: [
      { path: '', label: 'Expenses', permission: 'finance.reports.view', component: ExpensesPage },
      { path: '/payments', label: 'Payments', permission: 'finance.reports.view', component: PaymentsPage },
    ],
  } satisfies AppDef]),
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
