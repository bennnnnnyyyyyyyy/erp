import type { Role } from './api';
import { MODULES, allPermissionKeys } from './modules';

// Default grants per built-in role. Organizations can later add custom roles in the
// database; these are the fallback when a membership has no custom role.
export function defaultPermissionsFor(role: Role): string[] {
  const all = allPermissionKeys();
  switch (role) {
    case 'owner':
    case 'admin':
      return all;
    case 'member':
      return [...all.filter((p) => p.endsWith('.read')), ...MODULES.flatMap((m) => m.memberGrants ?? [])];
    case 'viewer':
      return all.filter((p) => p.endsWith('.read'));
  }
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  // `inventory.*` grants every inventory permission.
  return granted.some((g) => g.endsWith('.*') && required.startsWith(g.slice(0, -1)));
}
