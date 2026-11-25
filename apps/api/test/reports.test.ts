import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Reports & Insights step 2: the report builder and saved reports (sql/109; documentation/plans/REPORTS_INSIGHTS_PLAN.md). The database
// test (sql/tests/106) covers who may run, save and see what, the fixed list of sources and the refusals; these check the API in front.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';
const src = readFileSync(join(__dirname, '../src/modules/reports/routes.ts'), 'utf8');

const routes: [string, string][] = [
  ['GET', '/v1/reports/sources'],
  ['POST', '/v1/reports/run'],
  ['GET', '/v1/reports/saved'],
  ['GET', `/v1/reports/saved/${ID}`],
  ['POST', `/v1/reports/saved/${ID}/run`],
  ['POST', '/v1/reports/saved'],
  ['PATCH', `/v1/reports/saved/${ID}`],
  ['DELETE', `/v1/reports/saved/${ID}`],
  ['GET', '/v1/reports/forecast/sales?by=item&horizon=30'],
  ['POST', `/v1/reports/saved/${ID}/alert`],
  ['GET', '/v1/reports/schedules'],
  ['POST', '/v1/reports/schedules'],
  ['PATCH', `/v1/reports/schedules/${ID}`],
  ['DELETE', `/v1/reports/schedules/${ID}`],
];

describe('scheduled reports API (sql/112)', () => {
  it('owners and admins only, through the database functions', () => {
    for (const r of ["get('/schedules'", "post('/schedules'", "patch('/schedules/:id'", "delete('/schedules/:id'"]) {
      expect(src).toContain(`${r}, requirePermission('reports.schedules.manage')`);
    }
    for (const fn of ['rpt_schedule_list', 'rpt_save_schedule', 'rpt_set_schedule_enabled', 'rpt_delete_schedule'])
      expect(src).toContain(`'${fn}'`);
  });

  it('the five-minute job sends them, and a missing function does not stop delivery', () => {
    const job = readFileSync(join(__dirname, '../src/jobs/outbox.ts'), 'utf8');
    expect(job).toContain("client.rpc('rpt_run_schedules', { p_org: opts.orgId ?? null })");
    expect(job).toContain("schedules.error.code !== 'PGRST202'");
  });
});

describe('report builder API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  it('checks the right permission on each route', () => {
    for (const r of ["get('/sources'", "post('/run'", "get('/saved'", "get('/saved/:id'", "post('/saved/:id/run'"]) {
      expect(src).toContain(`${r}, requirePermission('reports.custom.read')`);
    }
    for (const r of ["post('/saved'", "patch('/saved/:id'", "delete('/saved/:id'"]) {
      expect(src).toContain(`${r}, requirePermission('reports.custom.create')`);
    }
    expect(src).toContain("get('/forecast/sales', requirePermission('reports.forecast.read')");
    // "alert me when" is an alert rule: owners and admins (the alerts key), checked again by the database
    expect(src).toContain("post('/saved/:id/alert', requirePermission('alerts.rules.manage')");
    expect(src).toContain("'alr_create_report_rule'");
    // a company report needs the manage key on top
    expect(src.match(/hasPermission\(c\.var\.tenant\.permissions, 'reports\.custom\.manage'\)/g)?.length).toBe(2);
  });

  it('never sends SQL: only a checked definition goes to the database function', () => {
    expect(src).toContain('reportDefinitionProblem(v)');
    expect(src).toContain("'rpt_run', { p_definition: definition }");
    expect(src).not.toMatch(/\bsql\b\s*:/i);
  });

  it('writes only through the database functions', () => {
    // (the route method reportsRoutes.delete is not a table write)
    expect(src.replaceAll('reportsRoutes.delete(', '')).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).toContain("'rpt_save_report'");
    expect(src).toContain("'rpt_delete_report'");
  });

  it('reads only the caller’s company', () => {
    for (const m of src.matchAll(/\.from\('rpt_reports'\)[^;]*/g)) expect(m[0]).toContain(".eq('org_id', c.var.tenant.orgId)");
  });

  it('answers a duplicate name with 409', () => {
    const rpc = readFileSync(join(__dirname, '../src/lib/rpc.ts'), 'utf8');
    expect(rpc).toContain('DUPLICATE_NAME: { status: 409,');
  });
});
