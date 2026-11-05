import { lazy, type ComponentType } from 'react';
import { hasPermission, type SessionInfo } from '@erp/shared';
import { demoMode } from '../lib/demo';

// Each screen file is its own chunk, fetched the first time one of its pages is opened (system audit 2026-11-03, finding 11:
// the app shipped as a single 627 kB file). The Shell shows the loading skeleton while a chunk arrives.
const SCREEN_LOADERS: (() => Promise<unknown>)[] = [];
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): ComponentType {
  SCREEN_LOADERS.push(load);
  return lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType })));
}
const AppsSettings = lazyNamed(() => import('./core/settings/AppsSettings'), 'AppsSettings');
const AuditLog = lazyNamed(() => import('./core/settings/AuditLog'), 'AuditLog');
const GeneralSettings = lazyNamed(() => import('./core/settings/GeneralSettings'), 'GeneralSettings');
const UsersSettings = lazyNamed(() => import('./core/settings/UsersSettings'), 'UsersSettings');
const BatchesPage = lazyNamed(() => import('./inventory/Batches'), 'BatchesPage');
const ForecastPage = lazyNamed(() => import('./inventory/Forecast'), 'ForecastPage');
const GuidePage = lazyNamed(() => import('./help/Guide'), 'GuidePage');
const NewTransfer = lazyNamed(() => import('./inventory/Transfers'), 'NewTransfer');
const TransferPage = lazyNamed(() => import('./inventory/Transfers'), 'TransferPage');
const TransfersList = lazyNamed(() => import('./inventory/Transfers'), 'TransfersList');
const AdjustmentsPage = lazyNamed(() => import('./inventory/Inventory'), 'AdjustmentsPage');
const ApprovalPoliciesPage = lazyNamed(() => import('./inventory/Inventory'), 'ApprovalPoliciesPage');
const LedgerPage = lazyNamed(() => import('./inventory/Inventory'), 'LedgerPage');
const NewRequest = lazyNamed(() => import('./inventory/Inventory'), 'NewRequest');
const ReorderLevelsPage = lazyNamed(() => import('./inventory/Inventory'), 'ReorderLevelsPage');
const RequestPage = lazyNamed(() => import('./inventory/Inventory'), 'RequestPage');
const RequestsList = lazyNamed(() => import('./inventory/Inventory'), 'RequestsList');
const StockPage = lazyNamed(() => import('./inventory/Inventory'), 'StockPage');
const NewPurchaseOrder = lazyNamed(() => import('./purchasing/PurchasingDemo'), 'NewPurchaseOrder');
const PurchaseOrderPage = lazyNamed(() => import('./purchasing/PurchasingDemo'), 'PurchaseOrderPage');
const PurchaseOrders = lazyNamed(() => import('./purchasing/PurchasingDemo'), 'PurchaseOrders');
const Suppliers = lazyNamed(() => import('./purchasing/PurchasingDemo'), 'Suppliers');
const SupplierInvoicePage = lazyNamed(() => import('./purchasing/SupplierInvoices'), 'SupplierInvoicePage');
const SupplierInvoices = lazyNamed(() => import('./purchasing/SupplierInvoices'), 'SupplierInvoices');
const NotificationsPage = lazyNamed(() => import('./messaging/Messaging'), 'NotificationsPage');
const OutboxPage = lazyNamed(() => import('./messaging/Messaging'), 'OutboxPage');
const ConnectPhonePage = lazyNamed(() => import('./messaging/ConnectPhone'), 'ConnectPhonePage');
const TaskPage = lazyNamed(() => import('./tasks/Tasks'), 'TaskPage');
const TasksPage = lazyNamed(() => import('./tasks/Tasks'), 'TasksPage');
const Customers = lazyNamed(() => import('./sales/SalesDemo'), 'Customers');
const NewSalesOrder = lazyNamed(() => import('./sales/SalesDemo'), 'NewSalesOrder');
const SalesOrderPage = lazyNamed(() => import('./sales/SalesDemo'), 'SalesOrderPage');
const SalesOrders = lazyNamed(() => import('./sales/SalesDemo'), 'SalesOrders');
const CustomerInvoicePage = lazyNamed(() => import('./sales/CustomerInvoices'), 'CustomerInvoicePage');
const CustomerInvoices = lazyNamed(() => import('./sales/CustomerInvoices'), 'CustomerInvoices');
const ExpensesPage = lazyNamed(() => import('./finance/Finance'), 'ExpensesPage');
const PaymentsPage = lazyNamed(() => import('./finance/Finance'), 'PaymentsPage');
const ExpensePage = lazyNamed(() => import('./finance/FinanceRecords'), 'ExpensePage');
const PaymentPage = lazyNamed(() => import('./finance/FinanceRecords'), 'PaymentPage');
const AlertsPage = lazyNamed(() => import('./alerts/Alerts'), 'AlertsPage');
const GettingStartedPage = lazyNamed(() => import('./help/GettingStarted'), 'GettingStartedPage');
const OnboardingPage = lazyNamed(() => import('./help/Onboarding'), 'OnboardingPage');
const ProfitOverviewPage = lazyNamed(() => import('./finance/ProfitOverview'), 'ProfitOverviewPage');


// Apps shown as tiles on the home screen. Each belongs to a module (packages/shared/src/modules.ts);
// an app appears only when its module is enabled for the org and the user can open at least one page.

export type AppPage = {
  /** Relative to the app's basePath; '' is the app's first page. `:name` segments become params. */
  path: string;
  label: string;
  permission?: string;
  component: ComponentType;
  /** false keeps the page out of the app menu (record pages). */
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
  /** Extra rule for showing the app (for example only for companies that still show the tutorial). */
  visible?: (session: SessionInfo) => boolean;
};

// Inventory slice 1 (documentation/plans/INVENTORY_PLAN.md). Runs on the real API; in demo mode the same
// screens run on the in-browser sample data.
const READ = 'inventory.items.read';
const INVENTORY_APP: AppDef = {
  key: 'inventory',
  module: 'inventory',
  name: 'Inventory',
  description: demoMode ? 'Stock, requests, approvals and the ledger (demo data)' : 'Stock, requests, approvals, transfers and the stock ledger',
  suite: 'Warehouse',
  basePath: '/inventory',
  pages: [
    { path: '', label: 'Stock on hand', permission: READ, component: StockPage },
    { path: '/reorder-levels', label: 'Reorder levels', permission: READ, component: ReorderLevelsPage },
    ...(demoMode ? [] : [{ path: '/forecast', label: 'Stock forecast', permission: 'inventory.forecast.read', component: ForecastPage }]),
    ...(demoMode ? [] : [{ path: '/batches', label: 'Batches and expiry', permission: 'inventory.batches.read', component: BatchesPage }]),
    { path: '/approval-policies', label: 'Approval policies', permission: READ, component: ApprovalPoliciesPage },
    { path: '/adjustments', label: 'Stock adjustments', permission: 'inventory.adjustments.read', component: AdjustmentsPage },
    { path: '/transfers', label: 'Stock transfers', permission: 'inventory.transfers.read', component: TransfersList },
    { path: '/transfers/new', label: 'New transfer', permission: 'inventory.transfers.create', component: NewTransfer, nav: false, parent: '/transfers' },
    { path: '/transfers/:id', label: 'Transfer', permission: 'inventory.transfers.read', component: TransferPage, nav: false, parent: '/transfers' },
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
  description: demoMode ? 'Suppliers and purchase orders; receiving adds stock (demo data)' : 'Suppliers, purchase orders, goods receipt and purchase invoices',
  suite: 'Sales & Purchasing',
  basePath: '/purchasing',
  pages: [
    { path: '', label: 'Purchase orders', component: PurchaseOrders },
    { path: '/orders', label: 'Purchase orders', component: PurchaseOrders, nav: false, parent: '' },
    { path: '/orders/new', label: 'New purchase order', component: NewPurchaseOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Purchase order', component: PurchaseOrderPage, nav: false, parent: '' },
    { path: '/suppliers', label: 'Suppliers', component: Suppliers },
    // Real API only: the sample build has no purchase-invoice data (its page stayed on "Loading…"; found by the smoke test).
    ...(demoMode ? [] : [
      { path: '/invoices', label: 'Purchase invoices', permission: 'purchasing.invoices.read', component: SupplierInvoices },
      { path: '/invoices/:id', label: 'Purchase invoice', permission: 'purchasing.invoices.read', component: SupplierInvoicePage, nav: false, parent: '/invoices' },
    ]),
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
  key: 'sales', module: 'sales', name: 'Sales', description: 'Sales orders, invoicing and customers',
  suite: 'Sales & Purchasing', basePath: '/sales', pages: [
    { path: '', label: 'Sales orders', permission: 'sales.orders.read', component: SalesOrders },
    { path: '/orders/new', label: 'New sales order', permission: 'sales.orders.create', component: NewSalesOrder, nav: false, parent: '' },
    { path: '/orders/:id', label: 'Sales order', permission: 'sales.orders.read', component: SalesOrderPage, nav: false, parent: '' },
    { path: '/customers', label: 'Customers', permission: 'sales.customers.read', component: Customers },
    { path: '/invoices', label: 'Sales invoices', permission: 'sales.invoices.read', component: CustomerInvoices },
    { path: '/invoices/:id', label: 'Sales invoice', permission: 'sales.invoices.read', component: CustomerInvoicePage, nav: false, parent: '/invoices' },
  ],
};

// Slice 2 (documentation/plans/TASKS_AND_OUTBOX_PLAN.md). Real API only: the sample-data demo has no backend for these.
const TASKS_APP: AppDef = {
  key: 'tasks',
  module: 'tasks',
  name: 'Tasks',
  description: 'Task assignment, due dates and follow-up',
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
  description: 'Notifications and message delivery status',
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
    key: 'finance', module: 'finance', name: 'Finance', description: 'Expenses, payments and profit and loss',
    suite: 'Finance', basePath: '/finance', pages: [
      { path: '', label: 'Expenses', permission: 'finance.reports.view', component: ExpensesPage },
      { path: '/expenses/:id', label: 'Expense', permission: 'finance.reports.view', component: ExpensePage, nav: false, parent: '' },
      { path: '/overview', label: 'Profit and loss', permission: 'finance.reports.view', component: ProfitOverviewPage },
      { path: '/payments', label: 'Payments', permission: 'finance.reports.view', component: PaymentsPage },
      { path: '/payments/:id', label: 'Payment', permission: 'finance.reports.view', component: PaymentPage, nav: false, parent: '/payments' },
    ],
  } satisfies AppDef]),
  // The getting-started tutorial: only in companies created through sign-up (flag set by sql/032), never in the sample companies.
  ...(demoMode ? [] : [{
    key: 'start', module: 'core', name: 'Getting started', description: 'Setup checklist for a new company',
    suite: 'Core', basePath: '/start', visible: (s: SessionInfo) => s.org?.showTutorial === true, pages: [
      { path: '', label: 'Tutorial', component: GettingStartedPage },
      { path: '/setup', label: 'Set up your company', component: OnboardingPage, nav: false, parent: '' },
    ],
  } satisfies AppDef]),
  // Alert rules and teams (sql/028). Real API only. Owner and admin only.
  ...(demoMode ? [] : [{
    key: 'alerts', module: 'alerts', name: 'Alerts', description: 'Alerts for low stock, expiring batches and overdue receivables',
    suite: 'Warehouse', basePath: '/alerts', pages: [
      { path: '', label: 'Alert rules', permission: 'alerts.rules.view', component: AlertsPage },
    ],
  } satisfies AppDef]),
  // The guide: shown in every organization, including the sample companies (unlike the getting-started tutorial).
  {
    key: 'guide',
    module: 'core',
    name: 'Guide',
    description: 'User guide and guided tour',
    suite: 'Core',
    basePath: '/guide',
    pages: [{ path: '', label: 'Guide', component: GuidePage }],
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

export const SUITE_ORDER: AppDef['suite'][] = ['Warehouse', 'Sales & Purchasing', 'Finance', 'Core'];

/**
 * Menu groups for apps with many pages, Odoo style: the top bar shows each group as one dropdown, placed where its first page would
 * be. Pages not listed are single menu items. Keyed by app key, then by page path.
 */
export const MENU_GROUPS: Record<string, Record<string, string>> = {
  inventory: {
    '/requests': 'Operations', '/transfers': 'Operations', '/adjustments': 'Operations',
    '/ledger': 'Reporting', '/forecast': 'Reporting', '/batches': 'Reporting',
    '/reorder-levels': 'Configuration', '/approval-policies': 'Configuration',
  },
};

/**
 * Fetches every screen's code in the background (they are lazy chunks), so opening a page or a tour step later does not wait for a
 * download. Called once after sign-in, when the browser is idle.
 */
export function preloadScreens(): void {
  for (const load of SCREEN_LOADERS) void load().catch(() => undefined);
}

/** Apps this user can open, each with only the pages they are allowed to see. */
export function visibleApps(session: SessionInfo): AppDef[] {
  return APPS.filter((a) => session.modules.includes(a.module) && (a.visible?.(session) ?? true))
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
