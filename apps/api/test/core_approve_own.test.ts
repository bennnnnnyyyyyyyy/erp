import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The session tells screens whether the person may approve their own requests (UX audit 20 Nov: Approve showed on one's own credit
// note and the database refused it). It must follow core__sole_approver (sql/063, 077) and never widen it: the database still decides.

const source = readFileSync(join(__dirname, '../src/modules/core/routes.ts'), 'utf8');
const fn = source.slice(source.indexOf('async function mayApproveOwn'), source.indexOf("coreRoutes.get('/session'"));

describe('session mayApproveOwn', () => {
  it('is false for members and viewers', () => {
    expect(fn).toContain("if (role !== 'owner' && role !== 'admin') return false;");
  });
  it('is true for an owner when owners may approve their own (D1c), never for an admin by that setting', () => {
    expect(fn).toContain("if (role === 'owner' && ownerSelfApproval) return true;");
  });
  it("otherwise needs no other active owner or admin (D1), read with the caller's own sign-in", () => {
    expect(fn).toContain("callRpc<{ user_id: string; role: string; disabled_at: string | null }[]>(userDb(c), 'core_list_members'");
    expect(fn).toContain("m.user_id !== c.var.user.id && !m.disabled_at && (m.role === 'owner' || m.role === 'admin')");
  });
  it('is false on any error, so the session still loads', () => {
    expect(fn).toMatch(/catch \{\s*return false;/);
  });
  it('is sent in the session', () => {
    expect(source).toContain('mayApproveOwn: approveOwn,');
  });
});
