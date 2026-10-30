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
};

export const MODULES: readonly ModuleManifest[] = [
  {
    key: 'core',
    name: 'Core',
    description: 'Organization, users, roles, settings and the audit log.',
    core: true,
    dependsOn: [],
    permissions: ['core.org.read', 'core.org.manage', 'core.users.read', 'core.users.manage', 'core.audit.read'],
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
    ],
    memberGrants: ['inventory.items.manage', 'inventory.request.create', 'inventory.stock.issue', 'inventory.adjustments.create'],
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
    permissions: ['purchasing.suppliers.read', 'purchasing.suppliers.manage', 'purchasing.orders.read', 'purchasing.orders.create', 'purchasing.orders.receive', 'purchasing.orders.manage', 'purchasing.invoices.read', 'purchasing.invoices.record'],
    memberGrants: ['purchasing.orders.receive'],
    suite: 'Sales & Purchasing',
  },
  {
    key: 'sales', name: 'Sales', description: 'Customer orders fulfilled through approved warehouse stock requests.', core: false,
    dependsOn: ['inventory'], permissions: ['sales.customers.read','sales.customers.manage','sales.orders.read','sales.orders.create','sales.orders.fulfill','sales.orders.manage','sales.invoices.read','sales.invoices.manage'],
    memberGrants: ['sales.orders.create','sales.orders.fulfill'], suite: 'Sales & Purchasing',
  },
  {
    // Owner/admin only on purpose: neither key ends in ".read", so members and viewers never get them by default.
    key: 'finance', name: 'Finance', description: 'Expenses and payments: money in, money out, and what is still owed.', core: false,
    dependsOn: ['inventory'], permissions: ['finance.reports.view', 'finance.entries.manage'], suite: 'Finance',
  },
];

export function findModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function allPermissionKeys(): string[] {
  return MODULES.flatMap((m) => m.permissions);
}
