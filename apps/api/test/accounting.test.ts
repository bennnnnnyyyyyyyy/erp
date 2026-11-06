import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor, findModule, journalProblem } from '@erp/shared';
import app from '../src/index';
import type { AppEnv } from '../src/env';
import { requireModule } from '../src/middleware/tenant';
import { minorToText } from '../src/modules/accounting/routes';

// Accounting API (documentation/plans/ACCOUNTING_PLAN.md sections 4-5). The rules themselves live in the database and are proved by
// sql/tests/040-044; these cover the API layer: sign-in, a permission on every route, no direct writes, the module gate.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';
const source = readFileSync(join(__dirname, '../src/modules/accounting/routes.ts'), 'utf8');

const routes: [string, string][] = [
  ['GET', '/v1/accounting/setup/preview'],
  ['POST', '/v1/accounting/setup/prepare'],
  ['GET', '/v1/accounting/setup/uncosted-receipts'],
  ['PUT', '/v1/accounting/setup/receipt-costs/12'],
  ['POST', '/v1/accounting/setup/switch-on'],
  ['GET', '/v1/accounting/setup/head-accountants'],
  ['PUT', `/v1/accounting/setup/head-accountants/${ID}`],
  ['GET', '/v1/accounting/accounts'],
  ['POST', '/v1/accounting/accounts'],
  ['PATCH', `/v1/accounting/accounts/${ID}`],
  ['GET', `/v1/accounting/accounts/${ID}/lines?from=2026-01-01&to=2026-12-31`],
  ['GET', '/v1/accounting/roles'],
  ['PUT', '/v1/accounting/roles/cash'],
  ['GET', '/v1/accounting/category-accounts'],
  ['PUT', `/v1/accounting/category-accounts/${ID}`],
  ['GET', '/v1/accounting/issue-reasons'],
  ['POST', '/v1/accounting/issue-reasons'],
  ['PUT', `/v1/accounting/issue-reasons/${ID}`],
  ['GET', '/v1/accounting/fiscal-years'],
  ['POST', '/v1/accounting/fiscal-years'],
  ['GET', '/v1/accounting/entries'],
  ['GET', `/v1/accounting/entries/${ID}`],
  ['GET', '/v1/accounting/journals'],
  ['GET', `/v1/accounting/journals/${ID}`],
  ['POST', '/v1/accounting/journals'],
  ['PUT', `/v1/accounting/journals/${ID}`],
  ['POST', `/v1/accounting/journals/${ID}/approve`],
  ['POST', `/v1/accounting/journals/${ID}/reject`],
  ['POST', `/v1/accounting/journals/${ID}/cancel`],
  ['POST', `/v1/accounting/journals/${ID}/reverse`],
  ['GET', '/v1/accounting/trial-balance?from=2026-01-01&to=2026-12-31'],
];

describe('accounting routes', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  it('puts an accounting permission on every route', () => {
    const declared = source.match(/accountingRoutes(\.(get|post|put|patch|delete)|\[method\])\(/g) ?? [];
    const guarded = source.match(/accountingRoutes(\.(get|post|put|patch|delete)|\[method\])\([^\n]*requirePermission\('accounting\.[a-z_.]+'\)/g) ?? [];
    expect(declared.length).toBeGreaterThanOrEqual(28);
    expect(guarded.length).toBe(declared.length);
  });

  it('reads use the view key; changes never do', () => {
    const reads = source.match(/accountingRoutes\.get\([^\n]*/g) ?? [];
    expect(reads.every((r) => r.includes("'accounting.ledger.view'"))).toBe(true);
    const writes = source.match(/accountingRoutes\.(post|put|patch|delete)\([^\n]*/g) ?? [];
    expect(writes.some((w) => w.includes("'accounting.ledger.view'"))).toBe(false);
  });

  it('switch-on and the head accountant need the owner-level key; reversal needs direct posting', () => {
    expect(source).toMatch(/\.post\('\/setup\/switch-on', requirePermission\('accounting\.module\.switch_on'\)/);
    expect(source).toMatch(/\.put\('\/setup\/head-accountants\/:id', requirePermission\('accounting\.module\.switch_on'\)/);
    expect(source).toMatch(/\/journals\/:id\/reverse', requirePermission\('accounting\.journal\.post_direct'\)/);
    expect(source).toContain("hasPermission(c.var.tenant.permissions, 'accounting.journal.post_direct')");
  });

  it('changes go through database functions only (no direct writes)', () => {
    expect(source).not.toMatch(/(?<!Routes)\.(insert|update|delete|upsert)\(/);
    for (const fn of [
      'acc_prepare',
      'acc_switch_on',
      'acc_switch_on_preview',
      'acc_uncosted_receipts',
      'acc_set_receipt_cost',
      'acc_set_head_accountant',
      'acc_create_account',
      'acc_update_account',
      'acc_set_account_role',
      'acc_set_category_account',
      'acc_save_issue_reason',
      'acc_create_fiscal_year',
      'acc_save_journal',
      'acc_decide_journal',
      'acc_cancel_journal',
      'acc_reverse_journal',
      'acc_trial_balance',
      'acc_account_lines',
    ])
      expect(source).toContain(`'${fn}'`);
  });

  it('members and viewers get no accounting key; owners and admins get all', () => {
    for (const role of ['member', 'viewer'] as const) expect(defaultPermissionsFor(role).filter((p) => p.startsWith('accounting.'))).toEqual([]);
    const keys = findModule('accounting')!.permissions;
    for (const role of ['owner', 'admin'] as const) expect(defaultPermissionsFor(role)).toEqual(expect.arrayContaining(keys));
  });

  it('accounting cannot be switched on or off from the Apps toggle', () => {
    expect(findModule('accounting')?.switchOnOnly).toBe(true);
    const mod = readFileSync(join(__dirname, '../src/modules/core/moduleRoutes.ts'), 'utf8');
    expect(mod).toContain('if (mod.switchOnOnly) throw');
  });
});

describe('module gate with set-up paths', () => {
  const gated = (modules: string[]) => {
    const a = new Hono<AppEnv>();
    a.use('*', async (c, next) => {
      c.set('tenant', { modules } as AppEnv['Variables']['tenant']);
      await next();
    });
    a.use('/v1/accounting/*', requireModule('accounting', ['/setup', '/accounts']));
    a.all('/v1/accounting/*', (c) => c.text('reached'));
    a.onError((e, c) => c.text(e.message, 403));
    return a;
  };

  it('lets set-up paths through before accounting is on, and nothing else', async () => {
    const off = gated(['core']);
    expect((await off.request('/v1/accounting/setup/preview')).status).toBe(200);
    expect((await off.request('/v1/accounting/accounts')).status).toBe(200);
    expect((await off.request(`/v1/accounting/accounts/${ID}/lines`)).status).toBe(200);
    expect((await off.request('/v1/accounting/entries')).status).toBe(403);
    expect((await off.request('/v1/accounting/trial-balance')).status).toBe(403);
    expect((await off.request('/v1/accounting/setupx')).status).toBe(403);
    expect((await off.request('/v1/accounting/journals')).status).toBe(403);
  });

  it('lets everything through once accounting is on', async () => {
    const on = gated(['core', 'accounting']);
    expect((await on.request('/v1/accounting/entries')).status).toBe(200);
  });
});

describe('accounting helpers', () => {
  it('checks a journal like the database does', () => {
    const a = ID;
    expect(journalProblem([{ accountId: a, debitMinor: 100 }])).toBe('too_few_lines');
    expect(journalProblem([{ accountId: a, debitMinor: 100 }, { accountId: a, creditMinor: 90 }])).toBe('unbalanced');
    expect(journalProblem([{ accountId: a, debitMinor: 100, creditMinor: 100 }, { accountId: a, creditMinor: 0 }])).toBe('bad_line');
    expect(journalProblem([{ accountId: a, debitMinor: 1.5 }, { accountId: a, creditMinor: 1.5 }])).toBe('bad_line');
    expect(journalProblem([{ accountId: a, debitMinor: 100 }, { accountId: a, creditMinor: 100 }])).toBeNull();
  });

  it('writes exact amounts with the currency decimals', () => {
    expect(minorToText(9470490809, 'EGP')).toBe('94704908.09');
    expect(minorToText(-5, 'EGP')).toBe('-0.05');
    expect(minorToText(0, 'EGP')).toBe('0.00');
    expect(minorToText(1200, 'JPY')).toBe('1200');
  });
});
