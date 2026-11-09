-- sql/tests/058_sole_approver.sql
-- A sole owner may approve their own stock request (sql/063). Always rolls back. Needs sql/001-063.
-- Covers: with no other owner or admin, the owner approves their own request, it is marked "self-approved" in the audit log, and the
-- stock can be issued; a second admin brings the strict rule back (SELF_APPROVAL); disabling that admin relaxes it again; a member
-- still cannot approve anything; an approval policy asking for several approvers does not block a sole owner; another company is not
-- affected.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; r1 uuid; r2 uuid; r3 uuid; ok boolean; st text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sa-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'sa-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'sa-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'sa-x@tests.invalid');
  o := public.bootstrap_organization('Solo Test A', 'solo-test-a', 'sa-o@tests.invalid');
  ob := public.bootstrap_organization('Solo Test B', 'solo-test-b', 'sa-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('SO-1', 'Solo item', null, 'piece', 100, w);

  -- ---- S1: the only owner approves their own request; marked in the audit log; stock can be issued
  r1 := (public.inv_submit_request(w, 'own request', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5))) ->> 'id')::uuid;
  perform public.inv_decide_request(r1, 'approved');
  select status into st from public.inv_requests where id = r1;
  if st <> 'approved' then raise exception 'FAIL S1a: sole owner''s request is %', st; end if;
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and entity_id = r1::text and action = 'inventory.request.self_approved' and summary like '%self-approved%') then
    raise exception 'FAIL S1b: self-approval not marked in the audit log';
  end if;
  set local role authenticated;
  perform public.inv_post_issue(r1);
  select status into st from public.inv_requests where id = r1;
  if st <> 'issued' then raise exception 'FAIL S1c: stock not issued (%)', st; end if;

  -- ---- S2: a policy asking for several approvers does not block the only approver there is
  reset role;
  insert into public.inv_approval_policies (org_id, warehouse_id, min_total_qty, required_approvals) values (o, w, 1, 2);
  set local role authenticated;
  r3 := (public.inv_submit_request(w, 'policy', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 3))) ->> 'id')::uuid;
  perform public.inv_decide_request(r3, 'approved');
  select status into st from public.inv_requests where id = r3;
  if st <> 'approved' then raise exception 'FAIL S2: sole owner blocked by a policy (%)', st; end if;

  -- ---- S3: a second admin brings back the strict rule
  reset role;
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  set local role authenticated;
  r2 := (public.inv_submit_request(w, 'own request 2', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r2, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S3: owner approved their own request although an admin exists'; end if;

  -- ---- S4: disabling that admin relaxes it again
  reset role;
  update public.memberships set disabled_at = now() where org_id = o and user_id = a;
  set local role authenticated;
  perform public.inv_decide_request(r2, 'approved');
  select status into st from public.inv_requests where id = r2;
  if st <> 'approved' then raise exception 'FAIL S4: still refused after the second admin was disabled (%)', st; end if;

  -- ---- S5: a member never approves
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  r2 := (public.inv_submit_request(w, 'member request', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r2, 'approved'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S5: a member approved a request'; end if;

  -- ---- I1: another company cannot decide this company's requests
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_decide_request(r2, 'approved'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1: another company decided a request'; end if;
  reset role;

  if has_function_privilege('authenticated', 'public.core__sole_approver(uuid)', 'execute') then raise exception 'FAIL A1: the helper is open to users'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
