import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor, hasPermission } from './permissions';
import { formatMoney } from './money';

describe('permissions', () => {
  it('gives viewers read permissions only', () => {
    const perms = defaultPermissionsFor('viewer');
    expect(perms.length).toBeGreaterThan(0);
    expect(perms.every((p) => p.endsWith('.read'))).toBe(true);
  });

  it('keeps manage permissions away from members', () => {
    expect(defaultPermissionsFor('member')).not.toContain('core.users.manage');
  });

  it('lets members run a transfer but never approve one', () => {
    const member = defaultPermissionsFor('member');
    for (const key of ['inventory.transfers.read', 'inventory.transfers.create', 'inventory.transfers.dispatch', 'inventory.transfers.receive']) {
      expect(member).toContain(key);
    }
    expect(member).not.toContain('inventory.transfers.approve');
    expect(defaultPermissionsFor('admin')).toContain('inventory.transfers.approve');
    expect(defaultPermissionsFor('viewer').filter((p) => p.startsWith('inventory.transfers.'))).toEqual(['inventory.transfers.read']);
  });

  it('matches wildcard grants by prefix', () => {
    expect(hasPermission(['core.*'], 'core.users.manage')).toBe(true);
    expect(hasPermission(['core.*'], 'inventory.items.read')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats minor units', () => {
    expect(formatMoney({ amountMinor: 123456, currency: 'USD' })).toBe('$1,234.56');
    expect(formatMoney({ amountMinor: 500, currency: 'JPY' }, 'en-US')).toBe('¥500');
  });
});
