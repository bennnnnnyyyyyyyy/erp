// scripts/concurrency-check.mjs
// O10: proves the rules hold when several people act AT THE SAME TIME, through the real API (Supabase REST with real
// logins). SQL tests run inside one transaction and cannot do this. It uses the throwaway organization
// "Concurrency Check (test)" (sql/seed/003_concurrency_org.sql), never the demo organization, and creates its own item and
// warehouse each run (names start with "CONC-").
//
// Races: (1) six people reserve the same scarce stock at once, (2) two managers approve the same request at once,
//        (3) three people issue the same approved request at once, (4) two delivery jobs run at once.
// Needs Node 22+. Settings (environment, never in a file that is committed):
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, API (the Worker URL)
//   CONC_OWNER_EMAIL / CONC_OWNER_PASSWORD, CONC_MANAGER_EMAIL / CONC_MANAGER_PASSWORD, CONC_REQUESTER_EMAIL / CONC_REQUESTER_PASSWORD

const need = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'API', 'CONC_OWNER_EMAIL', 'CONC_OWNER_PASSWORD', 'CONC_MANAGER_EMAIL', 'CONC_MANAGER_PASSWORD', 'CONC_REQUESTER_EMAIL', 'CONC_REQUESTER_PASSWORD'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.log('Missing settings: ' + missing.join(', '));
  process.exit(2);
}
const E = process.env;
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const j = async (r) => r.json().catch(() => ({}));

async function login(email, password) {
  const s = await j(await fetch(`${E.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: E.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
  if (!s.access_token) throw new Error(`sign-in failed for ${email}: ${s.error_description ?? s.msg ?? s.message ?? 'unknown'}`);
  const m = await j(await fetch(`${E.SUPABASE_URL}/rest/v1/memberships?select=org_id`, { headers: { apikey: E.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.access_token}` } }));
  const org = m[0]?.org_id;
  const headers = { apikey: E.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.access_token}`, 'X-Org-Id': org, 'Content-Type': 'application/json' };
  return {
    org,
    rpc: async (fn, args) => { const r = await fetch(`${E.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) }); const body = await j(r); return { ok: r.ok, status: r.status, body, code: r.ok ? 'OK' : String(body.message ?? '') }; },
    rest: async (path) => { const r = await fetch(`${E.SUPABASE_URL}/rest/v1/${path}`, { headers }); return { status: r.status, body: await j(r) }; },
    api: async (method, path) => { const r = await fetch(`${E.API}${path}`, { method, headers: { Authorization: headers.Authorization, 'X-Org-Id': org } }); return { status: r.status, body: await j(r) }; },
  };
}
const count = (rs, code) => rs.filter((r) => r.code === code).length;

const owner = await login(E.CONC_OWNER_EMAIL, E.CONC_OWNER_PASSWORD);
const manager = await login(E.CONC_MANAGER_EMAIL, E.CONC_MANAGER_PASSWORD);
const requester = await login(E.CONC_REQUESTER_EMAIL, E.CONC_REQUESTER_PASSWORD);
console.log(`Signed in as owner, manager and requester of ${owner.org}`);

// ---- setup: a fresh warehouse and an item with exactly 10 units
const stamp = Date.now().toString(36).toUpperCase();
const wh = await owner.rpc('inv_create_warehouse', { p_code: `CONC-${stamp}`, p_name: 'Concurrency warehouse' });
const item = await owner.rpc('inv_create_item', { p_sku: `CONC-${stamp}`, p_name: 'Concurrency test item', p_uom: 'piece', p_opening_qty: 10, p_warehouse_id: wh.body });
check('setup: warehouse and item with 10 units created', wh.ok && item.ok, `${wh.code} / ${item.code}`);
const lines = (qty) => [{ itemId: item.body, qty }];

// ---- race 1: six requests of 4 against 10 available at the same time: at most 2 can be reserved
const race1 = await Promise.all(Array.from({ length: 6 }, () => requester.rpc('inv_submit_request', { p_warehouse_id: wh.body, p_reason: 'race', p_lines: lines(4) })));
const made = race1.filter((r) => r.ok);
check('race 1: exactly 2 of 6 simultaneous reservations succeed', made.length === 2, `${made.length} succeeded`);
check('race 1: the other 4 are refused as INSUFFICIENT_AVAILABLE', count(race1, 'INSUFFICIENT_AVAILABLE') === 4, race1.map((r) => r.code).join(','));
const bal = await owner.rest(`inv_stock_balances?select=on_hand,reserved&item_id=eq.${item.body}`);
check('race 1: reserved is exactly 8 and never above what exists', bal.body[0] && Number(bal.body[0].reserved) === 8 && Number(bal.body[0].on_hand) === 10, JSON.stringify(bal.body[0]));

// ---- race 2: owner and manager approve the same request at the same time: exactly one decision wins
const first = made[0]?.body.id;
const second = made[1]?.body.id;
const race2 = await Promise.all([owner.rpc('inv_decide_request', { p_request_id: first, p_decision: 'approved' }), manager.rpc('inv_decide_request', { p_request_id: first, p_decision: 'approved' })]);
check('race 2: exactly one of two simultaneous approvals is accepted', count(race2, 'OK') === 1 && count(race2, 'INVALID_STATE') === 1, race2.map((r) => r.code).join(','));
const appr = await owner.rest(`inv_approvals?select=id&request_id=eq.${first}`);
check('race 2: exactly one approval record exists', appr.body.length === 1, `${appr.body.length} records`);

// ---- race 3: three people issue the same approved request at the same time: stock leaves exactly once
const race3 = await Promise.all([requester, owner, manager].map((u) => u.rpc('inv_post_issue', { p_request_id: first })));
check('race 3: exactly one of three simultaneous issues is accepted', count(race3, 'OK') === 1 && count(race3, 'INVALID_STATE') === 2, race3.map((r) => r.code).join(','));
const moves = await owner.rest(`inv_stock_moves?select=qty&kind=eq.issue&request_id=eq.${first}`);
check('race 3: exactly one issue movement of -4 in the ledger', moves.body.length === 1 && Number(moves.body[0].qty) === -4, JSON.stringify(moves.body));
const bal2 = await owner.rest(`inv_stock_balances?select=on_hand,reserved&item_id=eq.${item.body}`);
check('race 3: on hand 6 and reserved 4 (only the still-waiting request)', Number(bal2.body[0].on_hand) === 6 && Number(bal2.body[0].reserved) === 4, JSON.stringify(bal2.body[0]));
await requester.rpc('inv_cancel_request', { p_request_id: second }); // tidy: release the waiting reservation

// ---- race 4: two delivery jobs at the same time: no message is claimed or sent twice
const job = await Promise.all([owner.api('POST', '/v1/messaging/process'), owner.api('POST', '/v1/messaging/process')]);
check('race 4: both job runs answered', job.every((r) => r.status === 200), job.map((r) => r.status).join(','));
const outbox = await owner.api('GET', '/v1/messaging/outbox');
const rows = outbox.body.data ?? [];
check('race 4: no message was tried more than once, none is stuck sending', rows.length > 0 && rows.every((m) => m.attempts <= 1 && m.status !== 'sending'), `${rows.length} messages`);
const sent = job.reduce((n, r) => n + (r.body.data?.sent ?? 0), 0);
const claimed = job.reduce((n, r) => n + (r.body.data?.claimed ?? 0), 0);
check('race 4: everything claimed by the two runs was sent exactly once', sent === claimed, `claimed ${claimed}, sent ${sent}`);

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} OF ${results.length} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
