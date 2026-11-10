// A module is a sellable unit of functionality. The API and the web app both read this
// registry, and `org_modules` decides which ones each organization has switched on.

export type ModuleManifest = {
  key: string;
  name: string;
  description: string;
  /** Core modules are always on and cannot be disabled per organization. */
  core: boolean;
  /** Other modules that must be enabled first. */
  dependsOn: string[];
  /** Permission keys this module defines, as `<module>.<action>`. */
  permissions: string[];
  /** Extra keys the built-in member role gets (members otherwise get only `.read` keys). */
  memberGrants?: string[];
  /** Suite on the home screen and in Settings → Apps. */
  suite: 'Core' | 'Warehouse' | 'Sales & Purchasing' | 'Finance';
  /**
   * Switched on only by its own set-up flow, never by the plain Apps toggle (accounting: `acc_switch_on`, which posts the history
   * first; the database refuses any other way with USE_SWITCH_ON, and it can never be switched off).
   */
  switchOnOnly?: boolean;
  /** Route prefixes (under `/v1/<key>`) that work before the module is on: its set-up screens. */
  openBeforeEnabled?: string[];
};

export const MODULES: readonly ModuleManifest[] = [
  {
    key: 'core',
    name: 'Core',
    description: 'Organization, users, roles, settings and the audit log.',
    core: true,
    dependsOn: [],
    permissions: [
      'core.org.read',
      'core.org.manage',
      'core.users.read',
      'core.users.manage',
      'core.audit.read',
      'core.branches.manage',
      // Integrations (INTEGRATIONS_PLAN.md, sql/053): owners and admins only (neither key ends in ".read").
      'core.integrations.view',
      'core.integrations.manage',
    ],
    suite: 'Core',
  },
  // Permissions follow documentation/plans/INVENTORY_PLAN.md section 4. The database re-checks the role for
  // every change (sql/006); these keys give the API an early, clear refusal.
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Items, warehouses, stock, outgoing stock requests and approvals.',
    core: false,
    dependsOn: [],
    permissions: [
      'inventory.items.read',
      'inventory.items.manage',
      'inventory.warehouses.manage',
      'inventory.reorder.manage',
      'inventory.approval_policies.manage',
      'inventory.adjustments.read',
      'inventory.adjustments.create',
      'inventory.adjustments.approve',
      'inventory.request.create',
      'inventory.request.approve',
      'inventory.stock.issue',
      'inventory.batches.read',
      'inventory.forecast.read',
      'inventory.batches.receive',
      'inventory.batches.manage',
      'inventory.transfers.read',
      'inventory.transfers.create',
      'inventory.transfers.approve',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
    ],
    memberGrants: [
      'inventory.items.manage',
      'inventory.request.create',
      'inventory.stock.issue',
      'inventory.adjustments.create',
      'inventory.batches.receive',
      'inventory.transfers.create',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
    ],
    suite: 'Warehouse',
  },
  // Slice 2 (documentation/plans/TASKS_AND_OUTBOX_PLAN.md).
  {
    key: 'tasks',
    name: 'Tasks',
    description: 'Assign warehouse work with a due time, and follow it up.',
    core: false,
    dependsOn: [],
    permissions: ['tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.update'],
    memberGrants: ['tasks.tasks.update'],
    suite: 'Warehouse',
  },
  {
    key: 'messaging',
    name: 'Messaging',
    description: 'Notifications, reminders and escalation. Delivery goes through channels; approvals stay in the database.',
    core: false,
    dependsOn: [],
    permissions: ['messaging.notifications.read', 'messaging.outbox.manage'],
    suite: 'Warehouse',
  },
  {
    key: 'purchasing',
    name: 'Purchasing',
    description: 'Suppliers, purchase orders and receiving goods into stock.',
    core: false,
    dependsOn: ['inventory'],
    permissions: [
      'purchasing.suppliers.read',
      'purchasing.suppliers.manage',
      'purchasing.orders.read',
      'purchasing.orders.create',
      'purchasing.orders.receive',
      'purchasing.orders.manage',
      'purchasing.invoices.read',
      'purchasing.invoices.record',
    ],
    memberGrants: ['purchasing.orders.receive'],
    suite: 'Sales & Purchasing',
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Customer orders fulfilled through approved warehouse stock requests.',
    core: false,
    dependsOn: ['inventory'],
    permissions: [
      'sales.customers.read',
      'sales.customers.manage',
      'sales.orders.read',
      'sales.orders.create',
      'sales.orders.fulfill',
      'sales.orders.manage',
      'sales.invoices.read',
      'sales.invoices.manage',
      'sales.notes.read',
      'sales.notes.create',
      'sales.notes.approve',
    ],
    memberGrants: ['sales.orders.create', 'sales.orders.fulfill', 'sales.notes.create'],
    suite: 'Sales & Purchasing',
  },
  {
    // documentation/plans/ETA_EINVOICING_PLAN.md. Off until an organization switches it on (it is not part of the default apps).
    // Tax settings are read by everyone and changed by owner/admin only. Sending to ETA (later slices) gets its own keys.
    key: 'einvoicing',
    name: 'E-invoicing (Egypt)',
    description: 'Tax settings, branches, tax rates and ETA codes, for sending invoices to the Egyptian Tax Authority.',
    core: false,
    dependsOn: ['sales', 'inventory'],
    permissions: ['einvoicing.settings.read', 'einvoicing.settings.manage'],
    suite: 'Finance',
  },
  {
    // Owner/admin only on purpose: neither key ends in ".read", so members and viewers never get them by default.
    key: 'finance',
    name: 'Finance',
    description: 'Expenses and payments: money in, money out, and what is still owed.',
    core: false,
    dependsOn: ['inventory'],
    // finance.statements.view: customer, supplier and item statements of account (TREASURY_PLAN.md S1, sql/052).
    permissions: ['finance.reports.view', 'finance.entries.manage', 'finance.statements.view'],
    suite: 'Finance',
  },
  {
    // Owner/admin only (no ".read" key): the rules decide who hears what.
    key: 'alerts',
    name: 'Alerts',
    description:
      'Rules that tell the right people when stock is low, a batch is about to expire, an invoice is late or the month is losing money.',
    core: false,
    dependsOn: ['messaging'],
    permissions: ['alerts.rules.view', 'alerts.rules.manage'],
    suite: 'Warehouse',
  },
  {
    // documentation/plans/ACCOUNTING_PLAN.md section 4. No key ends in ".read", so members and viewers get nothing (the database also
    // refuses them). Owners and admins get every key here; the database narrows the chart, direct posting and reversal to the owner and
    // the head accountant, and switch-on to the owner.
    key: 'accounting',
    name: 'Accounting',
    description: 'General ledger: chart of accounts, automatic entries from every document, manual journals with approval, trial balance.',
    core: false,
    dependsOn: [],
    permissions: [
      'accounting.ledger.view',
      'accounting.chart.manage',
      'accounting.journal.create',
      'accounting.journal.approve',
      'accounting.journal.post_direct',
      'accounting.module.switch_on',
    ],
    suite: 'Finance',
    switchOnOnly: true,
    // Preparing to switch on: chart, roles, fiscal years, category and reason accounts, uncosted receipts, the switch itself.
    openBeforeEnabled: ['/setup', '/accounts', '/roles', '/fiscal-years', '/category-accounts', '/issue-reasons'],
  },
  {
    // documentation/plans/TREASURY_PLAN.md (sql/051). Needs accounting on: balances come from the ledger (the database refuses the
    // switch otherwise). Owners and admins only; the database narrows managing accounts to the owner and the head accountant.
    key: 'treasury',
    name: 'Treasury',
    description: 'Cash boxes and bank accounts by branch, payments through them, transfers between them, balances from the ledger.',
    core: false,
    dependsOn: ['accounting', 'finance'],
    permissions: [
      'treasury.accounts.view',
      'treasury.accounts.manage',
      'treasury.transfers.create',
      // Bank statements (sql/067). Reconcile is narrowed further by the company setting (who may reconcile).
      'treasury.statements.view',
      'treasury.statements.import',
      'treasury.statements.reconcile',
    ],
    suite: 'Finance',
  },
];

export function findModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function allPermissionKeys(): string[] {
  return MODULES.flatMap((m) => m.permissions);
}
