import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0003: the secret-key client bypasses row level security. Only these files may import it.
// No request route is on this list: member routes reach Supabase Auth only through lib/authAdmin.ts (sql/025). Every entry and its
// limits are written down in agents.md ("Master-key exceptions"); a new entry needs Ben's explicit yes.
const ADMIN_DB_ALLOWED = new Set([
  'lib/db.admin.ts',
  'lib/authAdmin.ts',
  'jobs/outbox.ts',
  'lib/channels/index.ts',
  'lib/channels/whatsapp.ts',
  'lib/channels/integrations.ts',
  'jobs/fx.ts',
  'lib/telegramInbound.ts',
  'lib/payments/links.ts',
  'lib/shipping/bosta.ts',
  'lib/store/shopify.ts',
  'lib/aiService.ts',
  'lib/whatsappInbound.ts',
  // "Check connection" (sql/082): reads a company's saved keys to make one real call; never writes, never returns a key.
  'lib/integrationChecks.ts',
]);
// Auth account calls (creating accounts, sign-in links) only from the member routes, after a database function has allowed it.
const AUTH_ADMIN_ALLOWED = new Set(['modules/core/memberRoutes.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('database client boundaries (ADR-0003)', () => {
  const srcDir = join(__dirname, '..', 'src');

  it('only allow-listed files import the admin (secret-key) client', () => {
    const offenders = sourceFiles(srcDir)
      .map((f) => relative(srcDir, f).split(sep).join('/'))
      .filter((rel) => !ADMIN_DB_ALLOWED.has(rel))
      .filter((rel) => /from\s+['"][^'"]*db\.admin['"]/.test(readFileSync(join(srcDir, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  // Ben, 11 Nov 2026: master-key code that runs while a person waits must only ever touch that person's company. These two guards make
  // a future change that takes a company from anywhere else fail here (see agents.md, "Master-key exceptions").
  const routeFiles = () =>
    sourceFiles(join(srcDir, 'modules'))
      .map((f) => relative(srcDir, f).split(sep).join('/'))
      .map((rel) => ({ rel, text: readFileSync(join(srcDir, rel), 'utf8') }));

  /** Master-key entry points that take a company: every call from a route must pass the company of the signed-in person. */
  const COMPANY_ENTRY_POINTS = ['runOutboxPass', 'askAi', 'transcribeAudio', 'checkIntegration'];

  it('routes call master-key entry points only with the signed-in company', () => {
    const offenders: string[] = [];
    for (const { rel, text } of routeFiles()) {
      for (const name of COMPANY_ENTRY_POINTS) {
        for (const m of text.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
          if (text.slice(Math.max(0, m.index - 40), m.index).match(/import|function\s*$/)) continue;
          const call = text.slice(m.index, m.index + 300);
          if (!/tenant\.orgId|who\(c\)/.test(call)) offenders.push(`${rel}: ${name}(…) without the signed-in company`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes that reach master-key code never take a company id from the request', () => {
    const masterKeyLib =
      /from\s+['"][^'"]*(jobs\/outbox|lib\/aiService|lib\/integrationChecks|lib\/payments\/links|lib\/shipping\/bosta|lib\/store\/shopify|lib\/channels\/[a-z]+|lib\/authAdmin)['"]/;
    const companyFromRequest =
      /c\.req\.(param|query|header)\(\s*['"](org|orgId|org_id|x-org-id)['"]|\b(orgId|org_id|p_org)\s*:\s*(b|body|input|q|query|params|payload)\s*[.[]/;
    const offenders = routeFiles()
      .filter(({ text }) => masterKeyLib.test(text) && companyFromRequest.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('only the member routes use the Auth admin helpers', () => {
    const offenders = sourceFiles(srcDir)
      .map((f) => relative(srcDir, f).split(sep).join('/'))
      .filter((rel) => !AUTH_ADMIN_ALLOWED.has(rel))
      .filter((rel) => /from\s+['"][^'"]*authAdmin['"]/.test(readFileSync(join(srcDir, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('nothing inserts into audit_log directly from the API', () => {
    const offenders = sourceFiles(srcDir)
      .map((f) => relative(srcDir, f).split(sep).join('/'))
      .filter((rel) =>
        /from\(\s*['"]audit_log['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(readFileSync(join(srcDir, rel), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
