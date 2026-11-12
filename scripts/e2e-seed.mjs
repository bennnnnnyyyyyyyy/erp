// scripts/e2e-seed.mjs
// Seeds the throwaway LOCAL Supabase used by the workflow browser tests (apps/web/e2e-workflows, audit 11 Nov 2026, finding 17).
// Creates three people through Supabase Auth (so they can really sign in) and two companies through the same database functions the
// SQL tests use: Company A with an owner and a staff member, a warehouse and one item with opening stock; Company B with its own owner.
// Refuses any Supabase URL or database that is not on this machine, so it can never touch the real project.
//
// Needs (CI sets them from `supabase status -o env`): SUPABASE_URL, SUPABASE_SECRET_KEY, DB_URL, E2E_PASSWORD. Also psql on the PATH.
// Run after every migration in sql/ has been applied: node scripts/e2e-seed.mjs

import { execFileSync } from 'node:child_process';

const { SUPABASE_URL, SUPABASE_SECRET_KEY, DB_URL, E2E_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !DB_URL || !E2E_PASSWORD) {
  console.error('Missing SUPABASE_URL, SUPABASE_SECRET_KEY, DB_URL or E2E_PASSWORD.');
  process.exit(2);
}
// Checks the host the address really names (parsed, not a text prefix), and refuses connection options that could point psql elsewhere.
const local = (u) => {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  const hostOk = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const schemeOk = ['postgresql:', 'postgres:', 'http:', 'https:'].includes(url.protocol);
  const noOverride = ![...url.searchParams.keys()].some((k) => ['host', 'hostaddr', 'service'].includes(k.toLowerCase()));
  return hostOk && schemeOk && noOverride;
};
if (!local(SUPABASE_URL) || !local(DB_URL)) {
  console.error('Refusing to seed: SUPABASE_URL and DB_URL must both point at this machine.');
  process.exit(2);
}

export const PEOPLE = {
  ownerA: 'owner-a@e2e.test',
  staffA: 'staff-a@e2e.test',
  ownerB: 'owner-b@e2e.test',
};

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: E2E_PASSWORD, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`creating ${email}: ${res.status} ${await res.text()}`);
}

for (const email of Object.values(PEOPLE)) await createUser(email);

// As postgres for the bootstrap, then as each owner for the setup, exactly as sql/tests do it.
const sql = `
do $$
declare oa uuid; ob uuid; ua uuid; ub uuid; w uuid; m text;
begin
  select id into ua from auth.users where email = '${PEOPLE.ownerA}';
  select id into ub from auth.users where email = '${PEOPLE.ownerB}';
  oa := public.bootstrap_organization('Workflow Test A', 'workflow-test-a', '${PEOPLE.ownerA}');
  ob := public.bootstrap_organization('Workflow Test B', 'workflow-test-b', '${PEOPLE.ownerB}');
  insert into public.memberships (org_id, user_id, role)
    select oa, id, 'member' from auth.users where email = '${PEOPLE.staffA}';
  foreach m in array array['inventory', 'tasks', 'messaging', 'purchasing', 'sales', 'finance', 'alerts'] loop
    insert into public.org_modules (org_id, module_key) values (oa, m), (ob, m) on conflict do nothing;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse(p_code => 'MAIN', p_name => 'Main warehouse');
  perform public.inv_create_item(p_sku => 'GLV-001', p_name => 'Safety gloves', p_uom => 'pair', p_opening_qty => 100, p_warehouse_id => w);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse(p_code => 'B-MAIN', p_name => 'Company B warehouse');
  perform public.inv_create_item(p_sku => 'B-ONLY', p_name => 'Company B item', p_opening_qty => 7, p_warehouse_id => w);
  reset role;
end $$;
`;
execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'inherit' });
console.log('Seeded: Company A (owner, staff, 100 Safety gloves), Company B (owner, its own item).');
