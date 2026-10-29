// scripts/real-login-check.mjs
// Proves the rules over the REAL path: a real sign-in, then the same HTTP calls the app makes to Supabase's
// REST API (PostgREST), including the `X-Org-Id` header. sql/tests/ proves the rules with a simulated login;
// this proves the header really reaches the database function through PostgREST.
//
// Read-only by design, except one attempted change by a plain member that must be refused. It never prints
// the password or the token.
//
// Needs Node 22+. Set, in your own terminal (never in a file that is committed):
//   SUPABASE_URL              e.g. https://<project-ref>.supabase.co   (Supabase > Project Settings > API)
//   SUPABASE_PUBLISHABLE_KEY  the publishable (anon) key                (same page; safe to use in a browser)
//   TEST_EMAIL, TEST_PASSWORD an existing user who belongs to an organization
// Values are also read from the repo-root .env if it exists. Run: node scripts/real-login-check.mjs

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  console.log('Missing settings. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_EMAIL and TEST_PASSWORD (see the top of this file).');
  process.exit(2);
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// ---- sign in
const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
const session = await signIn.json().catch(() => ({}));
if (!signIn.ok || !session.access_token) {
  console.log(`Sign-in failed (${signIn.status}): ${session.error_description ?? session.msg ?? 'unknown error'}`);
  console.log('If this user has only been invited, accept the invite or set a password first.');
  process.exit(2);
}
console.log(`Signed in as ${TEST_EMAIL}`);

async function rest(path, { method = 'GET', org, body } = {}) {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
  if (org) headers['X-Org-Id'] = org;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const message = (r) => String(r.json?.message ?? r.text ?? '');
const refused = (r) => r.status >= 400;

// ---- who am I
const mine = await rest('memberships?select=org_id,role&disabled_at=is.null');
check('can read own memberships', mine.status === 200 && Array.isArray(mine.json) && mine.json.length > 0, `status ${mine.status}`);
if (!Array.isArray(mine.json) || mine.json.length === 0) process.exit(1);
const { org_id: orgId, role } = mine.json[0];
console.log(`Using organization ${orgId} as ${role}`);

// ---- isolation through the API
const orgs = await rest('organizations?select=id');
check('sees only organizations they belong to', orgs.status === 200 && orgs.json.length === mine.json.length && orgs.json.every((o) => mine.json.some((m) => m.org_id === o.id)), `${orgs.json?.length} visible, ${mine.json.length} memberships`);
const audit = await rest('audit_log?select=org_id');
check('audit log shows only their organizations', audit.status === 200 && audit.json.every((a) => mine.json.some((m) => m.org_id === a.org_id)));

// ---- the header, through PostgREST
const good = await rest('rpc/current_org_id', { method: 'POST', org: orgId, body: {} });
check('X-Org-Id of their own organization is accepted', good.status === 200 && good.json === orgId, `status ${good.status}`);
const stranger = await rest('rpc/current_org_id', { method: 'POST', org: crypto.randomUUID(), body: {} });
check('X-Org-Id of an organization they are not in is refused', refused(stranger) && message(stranger).includes('NOT_A_MEMBER'), message(stranger));
const none = await rest('rpc/current_org_id', { method: 'POST', body: {} });
check('missing X-Org-Id is refused', refused(none) && message(none).includes('ORG_REQUIRED'), message(none));

// ---- no direct writes over the API
const before = await rest(`organizations?select=name&id=eq.${orgId}`);
const patch = await rest(`organizations?id=eq.${orgId}`, { method: 'PATCH', body: { name: 'changed by direct write' } });
const after = await rest(`organizations?select=name&id=eq.${orgId}`);
check('direct update of organizations is refused and changes nothing', refused(patch) && after.json?.[0]?.name === before.json?.[0]?.name, `status ${patch.status}`);
const del = await rest('audit_log?id=gt.0', { method: 'DELETE' });
check('direct delete from audit_log is refused', refused(del), `status ${del.status}`);
const forged = await rest('audit_log', { method: 'POST', body: { org_id: orgId, action: 'forged', entity_type: 'x' } });
check('direct insert into audit_log is refused', refused(forged), `status ${forged.status}`);

// ---- admin-only functions
const append = await rest('rpc/audit_append_admin', { method: 'POST', org: orgId, body: { p_org_id: orgId, p_actor: null, p_action: 'forged', p_entity_type: 'x' } });
check('audit_append_admin is not callable', refused(append), `status ${append.status}`);
const verify = await rest('rpc/audit_verify', { method: 'POST', org: orgId, body: { p_org_id: orgId } });
check('audit_verify is not callable', refused(verify), `status ${verify.status}`);

// ---- roles
if (role === 'owner' || role === 'admin') {
  console.log('SKIP  role check for core_update_org: this user is an owner/admin and the call would change data. Run again as a plain member to test it.');
} else {
  const update = await rest('rpc/core_update_org', { method: 'POST', org: orgId, body: { p_name: 'renamed by a member' } });
  check('a plain member cannot change organization settings', refused(update) && message(update).includes('FORBIDDEN'), message(update));
}

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} OF ${results.length} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
