import { describe, expect, it } from 'vitest';
import { refuseDisable, refuseInvite, refuseRoleChange } from '../src/modules/core/members';
import { parseOrgUpdate } from '../src/modules/core/org';

const owner = { userId: 'u-owner', role: 'owner' as const };
const admin = { userId: 'u-admin', role: 'admin' as const };

describe('member role rules', () => {
  it('stops people changing their own role', () => {
    expect(refuseRoleChange(admin, { userId: 'u-admin', role: 'admin', disabled: false }, 'member', 1)).toMatch(/own role/);
  });

  it('lets only owners touch the owner role', () => {
    expect(refuseRoleChange(admin, { userId: 'x', role: 'member', disabled: false }, 'owner', 1)).toMatch(/Only an owner/);
    expect(refuseRoleChange(admin, { userId: 'x', role: 'owner', disabled: false }, 'admin', 2)).toMatch(/Only an owner/);
    expect(refuseRoleChange(owner, { userId: 'x', role: 'member', disabled: false }, 'owner', 1)).toBeNull();
  });

  it('keeps at least one active owner', () => {
    expect(refuseRoleChange(owner, { userId: 'x', role: 'owner', disabled: false }, 'admin', 1)).toMatch(/at least one owner/);
    expect(refuseRoleChange(owner, { userId: 'x', role: 'owner', disabled: false }, 'admin', 2)).toBeNull();
    expect(refuseDisable(owner, { userId: 'x', role: 'owner', disabled: false }, 1)).toMatch(/at least one owner/);
  });

  it('stops self-disable and admins disabling owners', () => {
    expect(refuseDisable(admin, { userId: 'u-admin', role: 'admin', disabled: false }, 1)).toMatch(/yourself/);
    expect(refuseDisable(admin, { userId: 'x', role: 'owner', disabled: false }, 3)).toMatch(/Only an owner/);
    expect(refuseDisable(admin, { userId: 'x', role: 'member', disabled: false }, 1)).toBeNull();
  });

  it('lets only owners invite owners', () => {
    expect(refuseInvite(admin, 'owner')).not.toBeNull();
    expect(refuseInvite(admin, 'admin')).toBeNull();
  });
});

describe('org settings validation', () => {
  it('normalises and accepts valid values', () => {
    expect(parseOrgUpdate({ name: ' GGO ', defaultCurrency: 'aed', timezone: 'Asia/Dubai', dateFormat: 'DD/MM/YYYY' })).toEqual({
      name: 'GGO',
      defaultCurrency: 'AED',
      timezone: 'Asia/Dubai',
      dateFormat: 'DD/MM/YYYY',
    });
  });

  it('rejects bad values', () => {
    expect(() => parseOrgUpdate({ defaultCurrency: 'dollars' })).toThrow(/ISO 4217/);
    expect(() => parseOrgUpdate({ timezone: 'Mars/Base' })).toThrow(/IANA/);
    expect(() => parseOrgUpdate({ dateFormat: 'D-M-Y' })).toThrow(/Date format/);
    expect(() => parseOrgUpdate({})).toThrow(/Nothing/);
  });
});
