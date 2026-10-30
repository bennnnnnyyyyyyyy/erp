import { describe, expect, it } from 'vitest';
import { parseOrgUpdate } from '../src/modules/core/org';

// Member role rules (own role, owners only by owners, at least one owner) are enforced by the database functions in
// sql/025 and tested in sql/tests/021_security_audit_fixes.sql.

describe('org settings validation', () => {
  it('normalises and accepts valid values', () => {
    expect(parseOrgUpdate({ name: ' Acme ', defaultCurrency: 'egp', timezone: 'Africa/Cairo', dateFormat: 'DD/MM/YYYY' })).toEqual({
      name: 'Acme',
      defaultCurrency: 'EGP',
      timezone: 'Africa/Cairo',
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
