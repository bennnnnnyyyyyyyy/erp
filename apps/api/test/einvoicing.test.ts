import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor } from '@erp/shared';
import app from '../src/index';

// E-invoicing tax data (sql/036) and credit / debit notes (sql/037), documentation/plans/ETA_EINVOICING_PLAN.md slices A1 and A2.
// The database functions enforce the rules and are tested in sql/tests/030 and 031; these tests cover the API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', '/v1/einvoicing/settings'],
  ['GET', '/v1/einvoicing/codes'],
  ['GET', '/v1/einvoicing/readiness'],
  ['PUT', '/v1/einvoicing/profile'],
  ['POST', '/v1/einvoicing/branches'],
  ['PUT', `/v1/einvoicing/branches/${ID}`],
  ['DELETE', `/v1/einvoicing/branches/${ID}`],
  ['POST', '/v1/einvoicing/rates'],
  ['PUT', `/v1/einvoicing/rates/${ID}`],
  ['DELETE', `/v1/einvoicing/rates/${ID}`],
  ['PUT', `/v1/einvoicing/customers/${ID}/tax`],
  ['PUT', `/v1/einvoicing/items/${ID}/codes`],
  ['GET', '/v1/sales/notes'],
  ['GET', `/v1/sales/notes/${ID}`],
  ['POST', `/v1/sales/invoices/${ID}/notes`],
  ['POST', `/v1/sales/notes/${ID}/approve`],
  ['POST', `/v1/sales/notes/${ID}/reject`],
  ['POST', `/v1/sales/notes/${ID}/cancel`],
];

const einvoicingSource = readFileSync(join(__dirname, '../src/modules/einvoicing/routes.ts'), 'utf8');
const notesSource = readFileSync(join(__dirname, '../src/modules/sales/notes.ts'), 'utf8');

describe('e-invoicing and credit / debit note API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  it('puts a permission check on every e-invoicing route', () => {
    const declared = einvoicingSource.match(/einvoicingRoutes\.(get|post|put|delete)\(/g) ?? [];
    const guarded = einvoicingSource.match(/einvoicingRoutes\.(get|post|put|delete)\([^\n]*requirePermission\('einvoicing\.settings\.(read|manage)'\)/g) ?? [];
    expect(declared.length).toBe(12);
    expect(guarded.length).toBe(declared.length);
  });

  it('asks for the manage permission on every change and only the read permission on reads', () => {
    const changes = einvoicingSource.match(/einvoicingRoutes\.(post|put|delete)\([^\n]*requirePermission\('einvoicing\.settings\.(read|manage)'\)/g) ?? [];
    expect(changes.length).toBe(9);
    expect(changes.every((x) => x.includes('einvoicing.settings.manage'))).toBe(true);
    const reads = einvoicingSource.match(/einvoicingRoutes\.get\([^\n]*requirePermission\('einvoicing\.settings\.(read|manage)'\)/g) ?? [];
    expect(reads.every((x) => x.includes('einvoicing.settings.read'))).toBe(true);
  });

  it('changes tax data only through database functions', () => {
    for (const fn of ['eta_save_profile', 'eta_save_branch', 'eta_remove_branch', 'eta_save_tax_rate', 'eta_remove_tax_rate', 'eta_set_customer_tax', 'eta_set_item_codes']) {
      expect(einvoicingSource).toContain(`'${fn}'`);
    }
    // Query-builder writes only; `einvoicingRoutes.delete(` is an HTTP route, not a database delete.
    expect(einvoicingSource).not.toMatch(/(?<!Routes)\.(insert|update|delete|upsert)\(/);
  });

  it('puts a permission check on every note route and reaches notes only through database functions', () => {
    const declared = notesSource.match(/routes\.(get|post)\(/g) ?? [];
    const guarded = notesSource.match(/routes\.(get|post)\([^\n]*requirePermission\('sales\.notes\.(read|create|approve)'\)/g) ?? [];
    expect(declared.length).toBe(5);
    expect(guarded.length).toBe(declared.length);
    for (const fn of ['sal_submit_note', 'sal_decide_note', 'sal_cancel_note']) expect(notesSource).toContain(`'${fn}'`);
    expect(notesSource).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('asks for approval permission on approve and reject, never the create permission', () => {
    const loop = notesSource.slice(notesSource.indexOf('for (const [action, decision]'), notesSource.indexOf("'/notes/:id/cancel'"));
    expect(loop).toContain("requirePermission('sales.notes.approve')");
    expect(loop).not.toContain("requirePermission('sales.notes.create')");
  });

  it('lets members request notes and read tax data but never approve notes or change tax data', () => {
    const member = defaultPermissionsFor('member');
    expect(member).toContain('sales.notes.create');
    expect(member).toContain('sales.notes.read');
    expect(member).toContain('einvoicing.settings.read');
    expect(member).not.toContain('sales.notes.approve');
    expect(member).not.toContain('einvoicing.settings.manage');
    const viewer = defaultPermissionsFor('viewer');
    expect(viewer).toContain('sales.notes.read');
    expect(viewer).not.toContain('sales.notes.create');
    expect(defaultPermissionsFor('admin')).toEqual(expect.arrayContaining(['sales.notes.approve', 'einvoicing.settings.manage']));
  });
});
