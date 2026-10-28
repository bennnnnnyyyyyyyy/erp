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
  suite: 'Core' | 'Sales & Clients' | 'People' | 'Work' | 'Finance' | 'Operations';
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
  {
    key: 'crm',
    name: 'CRM',
    description: 'Companies, contacts, deals and the sales pipeline.',
    core: false,
    dependsOn: [],
    permissions: ['crm.records.read', 'crm.records.manage', 'crm.records.delete', 'crm.settings.manage'],
    memberGrants: ['crm.records.manage'],
    suite: 'Sales & Clients',
  },
];

export function findModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function allPermissionKeys(): string[] {
  return MODULES.flatMap((m) => m.permissions);
}
