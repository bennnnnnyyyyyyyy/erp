import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0003: the secret-key client bypasses row level security. Only these files may import it.
const ADMIN_DB_ALLOWED = new Set(['lib/db.admin.ts', 'lib/audit.ts', 'modules/core/memberRoutes.ts']);

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

  it('nothing inserts into audit_log directly from the API', () => {
    const offenders = sourceFiles(srcDir)
      .map((f) => relative(srcDir, f).split(sep).join('/'))
      .filter((rel) => /from\(\s*['"]audit_log['"]\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(readFileSync(join(srcDir, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
