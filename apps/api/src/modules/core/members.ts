import type { Role } from '@ggo/shared';

// Who may change whom. Pure so it can be unit tested; the routes load the facts and call these.

export type MemberFacts = { userId: string; role: Role; disabled: boolean };

export type Actor = { userId: string; role: Role };

/** Returns why the change is refused, or null if it is allowed. */
export function refuseRoleChange(actor: Actor, target: MemberFacts, newRole: Role, activeOwners: number): string | null {
  if (actor.userId === target.userId) return "You can't change your own role";
  if ((target.role === 'owner' || newRole === 'owner') && actor.role !== 'owner') {
    return 'Only an owner can make someone an owner or change an owner';
  }
  if (target.role === 'owner' && newRole !== 'owner' && !target.disabled && activeOwners <= 1) {
    return 'An organization needs at least one owner';
  }
  return null;
}

export function refuseDisable(actor: Actor, target: MemberFacts, activeOwners: number): string | null {
  if (actor.userId === target.userId) return "You can't disable yourself";
  if (target.role === 'owner' && actor.role !== 'owner') return 'Only an owner can disable an owner';
  if (target.role === 'owner' && activeOwners <= 1) return 'An organization needs at least one owner';
  return null;
}

/** Inviting someone straight in as owner is limited to owners. */
export function refuseInvite(actor: Actor, role: Role): string | null {
  if (role === 'owner' && actor.role !== 'owner') return 'Only an owner can invite an owner';
  return null;
}
