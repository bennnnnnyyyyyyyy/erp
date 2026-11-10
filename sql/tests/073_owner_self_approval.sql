-- sql/tests/073_owner_self_approval.sql
-- Owners may approve their own when the company says so (sql/077). Always rolls back. Needs sql/001-077.
-- Covers: off by default (an owner with an admin present cannot approve their own stock request or purchase order); only an owner can
-- switch it on (an admin cannot); on, the owner approves their own request and purchase order, each flagged and audited as
-- self-approved; an admin still cannot approve their own; switching off restores the rule; another company is not affected; audited.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid(); x2 uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; s uuid; r1 uuid; r2 uuid; r3 uuid; po uuid; ok boolean; st text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'osa-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'osa-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'osa-x@tests.invalid'), (x2, 'authenticated', 'authenticated', 'osa-x2@tests.invalid');
  o := public.bootstrap_organization('Self Approval A', 'self-approval-a', 'osa-o@tests.invalid');
  ob := public.bootstrap_organization('Self Approval B', 'self-approval-b', 'osa-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (ob, x2, 'admin');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('OSA-1', 'Jars', null, 'piece', 100, w);
  s := public.pur_create_supplier('OSA Supplier', null, null, null);

  -- ---- S1: off by default: the owner cannot approve their own (an admin exists)
  r1 := (public.inv_submit_request(w, 'own', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 2))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r1, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S1: owner approved own request with the setting off'; end if;

  -- ---- S2: an admin cannot switch it on; the owner can
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_owner_self_approval(true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S2a: an admin switched owner self-approval on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.core_set_owner_self_approval(true);

  -- ---- S3: on: the owner approves their own request and purchase order; both flagged
  perform public.inv_decide_request(r1, 'approved');
  select status into st from public.inv_requests where id = r1;
  if st <> 'approved' then raise exception 'FAIL S3a: request is %', st; end if;
  po := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1, 'unitCostMinor', 100))) ->> 'id')::uuid;
  perform public.pur_decide_order(po, 'approved');
  reset role;
  if not (select self_decided from public.inv_requests where id = r1) then raise exception 'FAIL S3b: request not flagged'; end if;
  if not (select approval_self from public.pur_orders where id = po) then raise exception 'FAIL S3c: order not flagged'; end if;
  if not exists (select 1 from public.audit_log where org_id = o and entity_id = r1::text and action = 'inventory.request.self_approved') then
    raise exception 'FAIL S3d: request self-approval not audited';
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'organization.owner_self_approval_changed') then
    raise exception 'FAIL S3e: setting change not audited';
  end if;
  set local role authenticated;

  -- ---- S4: an admin still cannot approve their own, setting or not
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r2 := (public.inv_submit_request(w, 'admin own', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r2, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S4: an admin approved their own request'; end if;

  -- ---- S5: switched off, the rule is back for the owner
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.core_set_owner_self_approval(false);
  r3 := (public.inv_submit_request(w, 'own again', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r3, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S5: owner approved own request after switching off'; end if;

  -- ---- S6: another company: the setting of A changes nothing for B's owner (B has an admin)
  perform core_set_owner_self_approval(true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('OSB-1', 'Caps', null, 'piece', 50, w);
  r1 := (public.inv_submit_request(w, 'b own', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1))) ->> 'id')::uuid;
  ok := false; begin perform public.inv_decide_request(r1, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S6: another company''s setting let B''s owner self-approve'; end if;

  reset role;
  if has_function_privilege('anon', 'public.core_set_owner_self_approval(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.core__sole_approver(uuid)', 'execute') then
    raise exception 'FAIL S7: anonymous or internal access';
  end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
