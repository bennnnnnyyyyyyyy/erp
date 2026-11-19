import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Codex audit 18 Nov, finding 6: agents.md says every API route checks a permission (requirePermission) before touching data. This lists
// every /v1 route, read and write, and fails unless one of its handlers is a permission check or the route is an explained exception
// below. The database still re-checks on every call; this keeps the early refusal from being forgotten on a new route.
// Routes outside /v1 (health, webhooks, report links) are not tenant routes: webhooks verify a signature or secret and find the company
// through our own reference (agents.md, master-key exceptions); /r/* links carry their own signed token.

/** Routes that deliberately have no permission key, each with the reason. Keep this list short. */
const EXCEPTIONS: Record<string, string> = {
  'GET /v1/core/session': 'session bootstrap: who the caller is, their companies and permissions; needed before any permission exists',
  'POST /v1/core/me/language': 'changes only the caller’s own language setting',
  'GET /v1/core/people': 'names of the members of the caller’s own company (the tenant middleware has checked membership)',
};

type RouteEntry = { method: string; path: string; handler: { requiredPermission?: string } };

const routes = (app.routes as unknown as RouteEntry[]).filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL');
const byRoute = new Map<string, RouteEntry[]>();
for (const r of routes) {
  const key = `${r.method} ${r.path}`;
  byRoute.set(key, [...(byRoute.get(key) ?? []), r]);
}

describe('every /v1 route checks a permission or is an explained exception', () => {
  it('finds the routes', () => expect(byRoute.size).toBeGreaterThan(150));

  it('has no route without a permission check outside the exceptions', () => {
    const missing = [...byRoute.entries()]
      .filter(([key, entries]) => !(key in EXCEPTIONS) && !entries.some((e) => typeof e.handler.requiredPermission === 'string'))
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  it('keeps the exception list honest: every exception still exists and still has no permission check', () => {
    for (const key of Object.keys(EXCEPTIONS)) {
      const entries = byRoute.get(key);
      expect(entries, `${key} no longer exists: remove it from EXCEPTIONS`).toBeDefined();
      expect(
        entries?.some((e) => typeof e.handler.requiredPermission === 'string'),
        `${key} now checks a permission: remove it from EXCEPTIONS`,
      ).toBe(false);
    }
  });
});
