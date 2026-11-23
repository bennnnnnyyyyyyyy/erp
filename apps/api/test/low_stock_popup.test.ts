import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkWeek } from '../src/middleware/tenant';

// The low stock pop-up routes (sql/106; plan documentation/plans/LOW_STOCK_POPUP_BUILD_PLAN.md). The database tests (sql/tests/103)
// cover who may see and change what; these check the API layer in front of it.

const source = readFileSync(join(__dirname, '../src/modules/inventory/lowStock.ts'), 'utf8');
const org = readFileSync(join(__dirname, '../src/modules/core/org.ts'), 'utf8');

describe('low stock pop-up API', () => {
  it('lets only people who can reorder use the pop-up routes', () => {
    expect(source).toContain("const REORDER = 'inventory.request.create';");
    for (const path of ["'/low-stock/popup'", "'/low-stock/:itemId/snooze'", "'/low-stock/:itemId/mute'"]) {
      expect(source).toContain(`${path}, requirePermission(REORDER)`);
    }
    expect(source).toContain("'/items/:itemId/max-level', requirePermission('inventory.reorder.manage')");
  });
  it('accepts only hour, tomorrow or week for Remind me', () => {
    expect(source).toContain("new Set(['hour', 'tomorrow', 'week'])");
  });
  it('answers 503 not_set_up before sql/106, so no pop-up shows', () => {
    expect(source).toContain("throw new HttpError(503, 'The low stock pop-up needs a database update (sql/106).', 'not_set_up')");
    expect(org).toContain("throw new HttpError(503, 'The work week needs a database update (sql/106).', 'not_set_up')");
  });
  it('writes only through the database functions', () => {
    expect(source).not.toContain('.from(');
    expect(source).not.toMatch(/\.(insert|update|upsert)\(/);
  });
});

describe('readWorkWeek', () => {
  it('reads a saved work week', () => {
    expect(readWorkWeek({ days: [0, 1, 2, 3, 4], start: '08:30', end: '16:30' })).toEqual({
      days: [0, 1, 2, 3, 4],
      start: '08:30',
      end: '16:30',
    });
  });
  it('falls back to Sunday to Thursday, 09:00 to 17:00', () => {
    const d = { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' };
    expect(readWorkWeek(undefined)).toEqual(d);
    expect(readWorkWeek({ days: [], start: '09:00', end: '17:00' })).toEqual(d);
    expect(readWorkWeek({ days: [1], start: '9', end: '17:00' })).toEqual(d);
  });
});
