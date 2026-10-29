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
      'inventory.request.create',
      'inventory.request.approve',
      'inventory.stock.issue',
    ],
    memberGrants: ['inventory.items.manage', 'inventory.request.create', 'inventory.stock.issue'],
    suite: 'Warehouse',
  },
];

export function findModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function allPermissionKeys(): string[] {
  return MODULES.flatMap((m) => m.permissions);
}
