import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// A person's language saved on their account (sql/038, tested in sql/tests/032). These tests cover the API layer in front of it.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const source = readFileSync(join(__dirname, '../src/modules/core/routes.ts'), 'utf8');
// Just the language route: from its start to the next route.
const start = source.indexOf("coreRoutes.post('/me/language'");
const languageRoute = source.slice(start, source.indexOf('coreRoutes.', start + 10) === -1 ? undefined : source.indexOf('coreRoutes.', start + 10));

describe('saved language API', () => {
  it('needs a signed-in user to save or to read the session', async () => {
    for (const [method, path] of [['POST', '/v1/core/me/language'], ['GET', '/v1/core/session']] as const) {
      const res = await app.request(path, { method }, env);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
    }
  });
  it('saves only through the database function, which uses the caller\'s own identity', () => {
    const route = languageRoute;
    expect(route).toContain("'core_set_my_language'");
    expect(route).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // nothing in the request chooses whose language it is
    expect(route).not.toMatch(/user_?id/i);
  });
  it('accepts only en, ar or null', () => {
    const route = languageRoute;
    expect(route).toContain("language !== null && language !== 'en' && language !== 'ar'");
  });
  it('still loads the session when the saved language cannot be read', () => {
    const fn = source.slice(source.indexOf('async function savedLanguage'), source.indexOf("coreRoutes.get('/session'"));
    expect(fn).toContain('try {');
    expect(fn).toContain('catch');
    expect(fn).toContain('if (error) return null');
  });
});
