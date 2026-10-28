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
