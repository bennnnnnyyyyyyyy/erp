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
const MySettings = lazyNamed(() => import('./core/settings/MySettings'), 'MySettings');
const BatchesPage = lazyNamed(() => import('./inventory/Batches'), 'BatchesPage');
const ForecastPage = lazyNamed(() => import('./inventory/Forecast'), 'ForecastPage');
const GuidePage = lazyNamed(() => import('./help/Guide'), 'GuidePage');
const NewTransfer = lazyNamed(() => import('./inventory/Transfers'), 'NewTransfer');
const TransferPage = lazyNamed(() => import('./inventory/Transfers'), 'TransferPage');
const TransfersList = lazyNamed(() => import('./inventory/Transfers'), 'TransfersList');
const CountsList = lazyNamed(() => import('./inventory/Counts'), 'CountsList');
const CountPage = lazyNamed(() => import('./inventory/Counts'), 'CountPage');
const ItemPage = lazyNamed(() => import('./inventory/ItemPage'), 'ItemPage');
const InventoryOverview = lazyNamed(() => import('./inventory/Overview'), 'InventoryOverview');
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
const OnlineOrders = lazyNamed(() => import('./sales/OnlineOrders'), 'OnlineOrders');
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
const TreasuryPage = lazyNamed(() => import('./treasury/Treasury'), 'TreasuryPage');
const TreasuryAccountPage = lazyNamed(() => import('./treasury/Treasury'), 'TreasuryAccountPage');
const TransfersPage = lazyNamed(() => import('./treasury/Treasury'), 'TransfersPage');
const BankStatementsPage = lazyNamed(() => import('./treasury/Statements'), 'BankStatementsPage');
const BankStatementPage = lazyNamed(() => import('./treasury/Statements'), 'BankStatementPage');
const StatementsPage = lazyNamed(() => import('./finance/Statements'), 'StatementsPage');
const ImportFromFile = lazyNamed(() => import('./core/settings/ImportFromFile'), 'ImportFromFile');
const IntegrationsSettings = lazyNamed(() => import('./core/settings/IntegrationsSettings'), 'IntegrationsSettings');
const BranchesSettings = lazyNamed(() => import('./core/settings/BranchesSettings'), 'BranchesSettings');
const AccountingSetupPage = lazyNamed(() => import('./accounting/Setup'), 'AccountingSetupPage');
const StockValuePage = lazyNamed(() => import('./accounting/Setup'), 'StockValuePage');
const ChartPage = lazyNamed(() => import('./accounting/Setup'), 'ChartPage');
const EntriesPage = lazyNamed(() => import('./accounting/Ledger'), 'EntriesPage');
const EntryPage = lazyNamed(() => import('./accounting/Ledger'), 'EntryPage');
const JournalsPage = lazyNamed(() => import('./accounting/Ledger'), 'JournalsPage');
const JournalEditPage = lazyNamed(() => import('./accounting/Ledger'), 'JournalEditPage');
const JournalPage = lazyNamed(() => import('./accounting/Ledger'), 'JournalPage');
const TrialBalancePage = lazyNamed(() => import('./accounting/Ledger'), 'TrialBalancePage');
const AccountLinesPage = lazyNamed(() => import('./accounting/Ledger'), 'AccountLinesPage');


// Apps shown as tiles on the home screen. Each belongs to a module (packages/shared/src/modules.ts);
// an app appears only when its module is enabled for the org and the user can open at least one page.

export type AppPage = {
  /** Relative to the app's basePath; '' is the app's first page. `:name` segments become params. */
  path: string;
  label: string;
  permission?: string;
  /** Shown when the user has at least one of these (used instead of `permission`). */
  anyPermission?: string[];
  component: ComponentType;
  /** false keeps the page out of the app menu (record pages). */
  nav?: boolean;
  /** Sidebar entry to highlight while on this page (its `path`). */
  parent?: string;
  /** Shown even before the app's module is switched on (its set-up pages; the module must list them in `openBeforeEnabled`). */
  beforeEnabled?: boolean;
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
  // Order and groups: inventory redesign Q2 and Q3 (Ben, 10 Nov 2026). The overview opens first; the clerk's three pages (stock,
  // requests, transfers) come next as single items; the rest sit in groups (MENU_GROUPS below).
  pages: [
    { path: '', label: 'Overview', permission: READ, component: InventoryOverview },
    { path: '/stock', label: 'Stock on hand', permission: READ, component: StockPage },
    { path: '/items/:id', label: 'Item', permission: READ, component: ItemPage, nav: false, parent: '/stock' },
    { path: '/requests', label: 'Stock requests', permission: READ, component: RequestsList },
    { path: '/requests/new', label: 'New request', permission: READ, component: NewRequest, nav: false, parent: '/requests' },
    { path: '/requests/:id', label: 'Request', permission: READ, component: RequestPage, nav: false, parent: '/requests' },
    { path: '/transfers', label: 'Stock transfers', permission: 'inventory.transfers.read', component: TransfersList },
    { path: '/transfers/new', label: 'New transfer', permission: 'inventory.transfers.create', component: NewTransfer, nav: false, parent: '/transfers' },
    { path: '/transfers/:id', label: 'Transfer', permission: 'inventory.transfers.read', component: TransferPage, nav: false, parent: '/transfers' },
    // Stock counts (sql/042): the sample-data demo has no counts, so only in the real app.
    ...(demoMode
      ? []
      : [
          { path: '/counts', label: 'Stock counts', permission: 'inventory.adjustments.read', component: CountsList },
          { path: '/counts/:id', label: 'Stock count', permission: 'inventory.adjustments.read', component: CountPage, nav: false, parent: '/counts' },
        ]),
    { path: '/adjustments', label: 'Stock adjustments', permission: 'inventory.adjustments.read', component: AdjustmentsPage },
    { path: '/reorder-levels', label: 'Reorder levels', permission: READ, component: ReorderLevelsPage },
    ...(demoMode ? [] : [{ path: '/forecast', label: 'Stock forecast', permission: 'inventory.forecast.read', component: ForecastPage }]),
    ...(demoMode ? [] : [{ path: '/batches', label: 'Batches and expiry', permission: 'inventory.batches.read', component: BatchesPage }]),
    { path: '/ledger', label: 'Stock ledger', permission: READ, component: LedgerPage },
    { path: '/approval-policies', label: 'Approval policies', permission: READ, component: ApprovalPoliciesPage },
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
    // Moved from Settings (Ben, 9 Nov 2026): Settings connects an integration, the apps use it. Same permission as its API route.
    { path: '/online-orders', label: 'Online orders', permission: 'core.integrations.view', component: OnlineOrders },
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
    { path: '/whatsapp', label: 'Connect WhatsApp and Telegram', permission: 'messaging.notifications.read', component: ConnectPhonePage },
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
      { path: '/statements', label: 'Statement of account', permission: 'finance.statements.view', component: StatementsPage },
    ],
  } satisfies AppDef]),
  // Accounting (documentation/plans/ACCOUNTING_PLAN.md section 6). Real API only. Owner and admin only. Set-up and the chart show
  // before accounting is on, so the company can prepare and switch on; the rest needs it on.
  ...(demoMode ? [] : [{
    key: 'accounting', module: 'accounting', name: 'Accounting', description: 'Chart of accounts, journal, manual entries and trial balance',
    suite: 'Finance', basePath: '/accounting', pages: [
      { path: '', label: 'Trial balance', permission: 'accounting.ledger.view', component: TrialBalancePage },
      { path: '/trial-balance', label: 'Trial balance', permission: 'accounting.ledger.view', component: TrialBalancePage, nav: false, parent: '' },
      { path: '/entries', label: 'Journal', permission: 'accounting.ledger.view', component: EntriesPage },
      { path: '/entries/:id', label: 'Journal entry', permission: 'accounting.ledger.view', component: EntryPage, nav: false, parent: '/entries' },
      { path: '/journals', label: 'Manual journals', permission: 'accounting.ledger.view', component: JournalsPage },
      { path: '/journals/new', label: 'New manual journal', permission: 'accounting.journal.create', component: JournalEditPage, nav: false, parent: '/journals' },
      { path: '/journals/:id', label: 'Manual journal', permission: 'accounting.ledger.view', component: JournalPage, nav: false, parent: '/journals' },
      { path: '/journals/:id/edit', label: 'Change draft', permission: 'accounting.journal.create', component: JournalEditPage, nav: false, parent: '/journals' },
      { path: '/accounts', label: 'Chart of accounts', permission: 'accounting.ledger.view', component: ChartPage, beforeEnabled: true },
      { path: '/accounts/:id', label: 'Account', permission: 'accounting.ledger.view', component: AccountLinesPage, nav: false, parent: '/accounts' },
      // Decision D8 (9 Nov 2026): the stock value check has its own page; only the owner or head accountant can post from it.
      { path: '/stock-value', label: 'Stock value', permission: 'accounting.ledger.view', component: StockValuePage },
      { path: '/setup', label: 'Accounting setup', permission: 'accounting.ledger.view', component: AccountingSetupPage, beforeEnabled: true },
    ],
  } satisfies AppDef]),
  // Treasury (documentation/plans/TREASURY_PLAN.md §6). Real API only. Owner and admin only; needs accounting on.
  ...(demoMode ? [] : [{
    key: 'treasury', module: 'treasury', name: 'Treasury', description: 'Cash boxes, bank accounts and transfers, by branch',
    suite: 'Finance', basePath: '/treasury', pages: [
      { path: '', label: 'Cash and banks', permission: 'treasury.accounts.view', component: TreasuryPage },
      { path: '/accounts/:id', label: 'Treasury account', permission: 'treasury.accounts.view', component: TreasuryAccountPage, nav: false, parent: '' },
      { path: '/transfers', label: 'Transfers', permission: 'treasury.accounts.view', component: TransfersPage },
      // Bank statements (sql/067; BANK_STATEMENT_IMPORT_PLAN.md).
      { path: '/statements', label: 'Bank statements', permission: 'treasury.statements.view', component: BankStatementsPage },
      { path: '/statements/:id', label: 'Bank statement', permission: 'treasury.statements.view', component: BankStatementPage, nav: false, parent: '/statements' },
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
    // Staff see only "My settings"; company pages need the matching manage permission (decision D10, 9 Nov 2026: staff used to see
    // greyed-out company, user, app and audit pages). /settings opens the first page a person can see (resolveRoute).
    pages: [
      { path: '', label: 'General', permission: 'core.org.manage', component: GeneralSettings },
      { path: '/me', label: 'My settings', component: MySettings },
      { path: '/users', label: 'Users', permission: 'core.users.manage', component: UsersSettings },
      // Real API only: the sample-data demo has no branches (it stayed on the loading skeleton; found by the smoke test).
      ...(demoMode ? [] : [{ path: '/branches', label: 'Branches', permission: 'core.org.manage', component: BranchesSettings }]),
      // Integrations (INTEGRATIONS_PLAN.md wave 1). Real API only. Owner and admin only.
      ...(demoMode ? [] : [{ path: '/integrations', label: 'Integrations', permission: 'core.integrations.view', component: IntegrationsSettings }]),
      // Import items, customers and suppliers from a CSV or Excel file (Sheets option A). Each kind needs its own manage permission.
      ...(demoMode ? [] : [{ path: '/import', label: 'Import from a file', anyPermission: ['inventory.items.manage', 'sales.customers.manage', 'purchasing.suppliers.manage'], component: ImportFromFile }]),
      { path: '/apps', label: 'Apps', permission: 'core.org.manage', component: AppsSettings },
      { path: '/audit', label: 'Audit log', permission: 'core.org.manage', component: AuditLog },
    ],
  },
];

export const SUITE_ORDER: AppDef['suite'][] = ['Warehouse', 'Sales & Purchasing', 'Finance', 'Core'];

/**
 * Menu groups for apps with many pages: the left list shows each group under its heading, after the single pages. Pages not listed are
 * single menu items. Keyed by app key, then by page path.
 */
export const MENU_GROUPS: Record<string, Record<string, string>> = {
  // Ben, 10 Nov 2026 (inventory redesign Q3): Overview, Stock on hand, Requests and Transfers stay single items on top.
  inventory: {
    '/counts': 'Counting', '/adjustments': 'Counting',
    '/reorder-levels': 'Planning', '/forecast': 'Planning', '/batches': 'Planning',
    '/ledger': 'Records and rules', '/approval-policies': 'Records and rules',
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
  return APPS.filter((a) => (session.modules.includes(a.module) || a.pages.some((p) => p.beforeEnabled)) && (a.visible?.(session) ?? true))
    .map((a) => {
      const on = session.modules.includes(a.module);
      return { ...a, pages: a.pages.filter((p) => (on || p.beforeEnabled) && (!p.permission || hasPermission(session.permissions, p.permission)) && (!p.anyPermission || p.anyPermission.some((k) => hasPermission(session.permissions, k)))) };
    })
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
  // The app's own address when its first page is not open to this person (accounting before switch-on shows only its set-up pages):
  // open the first page they can see.
  if (rest === '') {
    const first = app.pages.find((p) => p.nav !== false && !p.path.includes(':'));
    if (first) return { app, page: first, params: {} };
  }
  for (const page of app.pages) {
    const params = page.path.includes(':') ? matchPath(page.path, rest) : null;
    if (params) return { app, page, params };
  }
  return { app, page: null, params: {} };
}
