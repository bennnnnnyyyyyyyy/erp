import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { HttpError } from '../src/lib/errors';
import { callRpc } from '../src/lib/rpc';
import { docTotals, lineOut, noteTotals } from '../src/modules/sales/vatRows';

// VAT part 1 (sql/086). The rules (line maths, rates, posting, amount owed) are proven in sql/tests/082; here: the routes need a
// signed-in user, the stored figures are read (with the old computation when the database has no VAT columns yet), and the new
// database error has a message.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };

describe('VAT routes', () => {
  it.each([
    ['GET', '/v1/core/org/vat'],
    ['PUT', '/v1/core/org/vat'],
  ])('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  it('VAT_RATE_MISSING answers 409 with a plain message', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'VAT_RATE_MISSING', details: null, code: 'P0001' } }) };
    const err = await callRpc(client as unknown as Parameters<typeof callRpc>[0], 'sal_create_invoice').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe('vat_rate_missing');
    expect((err as HttpError).message).toBe('Choose the default VAT rate in Settings, then try again');
  });

  const org = readFileSync(join(__dirname, '../src/modules/core/org.ts'), 'utf8');
  it('the setting goes through the audited database function, with the manage permission', () => {
    const route = org.slice(org.indexOf("orgRoutes.put('/vat'"), org.indexOf("orgRoutes.post('/blind-counts'"));
    expect(route).toContain("requirePermission('core.org.manage')");
    expect(route).toContain("'core_set_vat'");
    expect(route).not.toMatch(/\.from\(/);
  });
  it('the rates read is VAT (T1) rates of the signed-in company only', () => {
    const route = org.slice(org.indexOf("orgRoutes.get('/vat'"), org.indexOf("orgRoutes.put('/vat'"));
    expect(route).toContain(".eq('org_id', c.var.tenant.orgId)");
    expect(route).toContain(".eq('tax_type', 'T1')");
    expect(route).toContain(".is('deleted_at', null)");
  });

  const sales = readFileSync(join(__dirname, '../src/modules/sales/routes.ts'), 'utf8');
  it('the create route passes a line rate only when it is an id or "exempt"', () => {
    const route = sales.slice(sales.indexOf("salesRoutes.post('/orders/:id/invoices'"));
    expect(route).toContain("taxRateId !== 'exempt' && !UUID_RE.test(taxRateId)");
  });
});

describe('stored VAT figures', () => {
  it('reads a line as stored', () => {
    expect(lineOut({ qty: '3', unit_price_minor: 333, net_minor: 999, tax_minor: 140, tax_rate: '14.00000', tax_rate_id: 'r' })).toEqual({
      qty: 3,
      unitPriceMinor: 333,
      taxRateId: 'r',
      taxRate: 14,
      netMinor: 999,
      taxMinor: 140,
      grossMinor: 1139,
    });
  });
  it('computes a line the old way before sql/086 (no VAT)', () => {
    expect(lineOut({ qty: 1.5, unit_price_minor: 101 })).toMatchObject({ netMinor: 152, taxMinor: 0, grossMinor: 152, taxRate: 0, taxRateId: null });
  });
  it('takes the document totals as stored, else sums the lines', () => {
    const lines = [lineOut({ qty: 1, unit_price_minor: 100, net_minor: 100, tax_minor: 14 })];
    expect(docTotals({ net_minor: 2149, tax_minor: 193, gross_minor: 2342 }, lines)).toEqual({ netMinor: 2149, taxMinor: 193, grossMinor: 2342 });
    expect(docTotals({}, lines)).toEqual({ netMinor: 100, taxMinor: 14, grossMinor: 114 });
  });
  it('reads a note as stored, else its total is the gross with no VAT', () => {
    expect(noteTotals({ total_minor: 380, net_minor: 333, tax_minor: 47, gross_minor: 380 })).toEqual({ netMinor: 333, taxMinor: 47, grossMinor: 380 });
    expect(noteTotals({ total_minor: 250 })).toEqual({ netMinor: 250, taxMinor: 0, grossMinor: 250 });
  });
});
