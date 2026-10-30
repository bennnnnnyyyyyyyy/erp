-- sql/tests/007_approval_policies.sql
-- I5: approval policies (two-step approval above a quantity). Always rolls back. Needs sql/001-011.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  ub uuid := gen_random_uuid();  -- admin
  uh uuid := gen_random_uuid();  -- admin
  uc uuid := gen_random_uuid();  -- member (requester)
  ux uuid := gen_random_uuid();  -- admin who requests
  ue uuid := gen_random_uuid();  -- owner of another organization
  oa uuid; ob uuid;
  w1 uuid; w2 uuid; i1 uuid; ib uuid; wb uuid;
  p1 uuid; p2 uuid; p3 uuid;
  ra uuid; rb uuid; rc uuid; rd uuid; rw2 uuid; rx uuid;
  n bigint;
  st text;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'pol-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'pol-b@tests.invalid'),
    (uh, 'authenticated', 'authenticated', 'pol-h@tests.invalid'), (uc, 'authenticated', 'authenticated', 'pol-c@tests.invalid'),
    (ux, 'authenticated', 'authenticated', 'pol-x@tests.invalid'), (ue, 'authenticated', 'authenticated', 'pol-e@tests.invalid');
  oa := public.bootstrap_organization('Policy Test A', 'pol-test-a', 'pol-a@tests.invalid');
  ob := public.bootstrap_organization('Policy Test B', 'pol-test-b', 'pol-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uh, 'admin'), (oa, uc, 'member'), (oa, ux, 'admin');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (ob, 'inventory');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  w2 := public.inv_create_warehouse('SIDE', 'Side');
  i1 := public.inv_create_item('GLV', 'Gloves', null, 'pair', 500, w1);
  perform public.inv_receive_stock(i1, w2, 500);

  -- ---- S1: managing policies: who may, and what is valid
  p1 := public.inv_set_approval_policy(null, 50, 2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_set_approval_policy(null, 10, 2); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1a: a member set a policy'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_set_approval_policy(null, 10, 0); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1b: zero required approvals was accepted'; end if;
  ok := false;
  begin perform public.inv_set_approval_policy(null, 10, 4); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1c: four required approvals was accepted'; end if;
  ok := false;
  begin perform public.inv_set_approval_policy(gen_random_uuid(), 10, 2); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1d: a policy for an unknown warehouse was accepted'; end if;
  if public.inv_set_approval_policy(null, 50, 2) <> p1 then raise exception 'FAIL S1e: setting the same threshold twice created a second policy'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.policy.set';
  if n <> 2 then raise exception 'FAIL S1f: expected 2 policy audit rows, found %', n; end if;

  -- ---- S2: below the threshold one approval is enough, as before
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ra := (public.inv_submit_request(w1, 'small', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10))) ->> 'id')::uuid;
  rb := (public.inv_submit_request(w1, 'big', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 60))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(ra, 'approved');
  reset role;
  select status into st from public.inv_requests where id = ra;
  if st <> 'approved' then raise exception 'FAIL S2: a small request is %, expected approved after one approval', st; end if;

  -- ---- S3: above the threshold: first approval is recorded, request stays waiting, stock stays reserved
  set local role authenticated;
  perform public.inv_decide_request(rb, 'approved', 'first');
  reset role;
  select status into st from public.inv_requests where id = rb;
  if st <> 'submitted' then raise exception 'FAIL S3a: after one of two approvals the request is %, expected submitted', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.approval_recorded' and entity_id = rb::text;
  if n <> 1 then raise exception 'FAIL S3b: the first approval was not audited as recorded'; end if;
  select b.reserved into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if n <> 70 then raise exception 'FAIL S3c: reserved is %, expected 70 (10 + 60)', n; end if;
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_request(rb, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S3d: the same person approved twice'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_post_issue(rb); exception when others then ok := (sqlerrm = 'APPROVAL_REQUIRED'); end;
  if not ok then raise exception 'FAIL S3e: stock was issued with only one of two approvals'; end if;
  reset role;

  -- ---- S4: the second, different approver completes it
  perform set_config('request.jwt.claims', json_build_object('sub', uh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rb, 'approved', 'second');
  reset role;
  select status into st from public.inv_requests where id = rb;
  if st <> 'approved' then raise exception 'FAIL S4a: after two approvals the request is %, expected approved', st; end if;
  select count(distinct approver_id) into n from public.inv_approvals where request_id = rb and decision = 'approved';
  if n <> 2 then raise exception 'FAIL S4b: expected 2 distinct approvers, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.approved' and entity_id = rb::text and summary like '%2 of 2%';
  if n <> 1 then raise exception 'FAIL S4c: the final approval audit row does not say 2 of 2'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_post_issue(rb);
  reset role;
  select status into st from public.inv_requests where id = rb;
  if st <> 'issued' then raise exception 'FAIL S4d: the fully approved request is %, expected issued', st; end if;

  -- ---- S5: one rejection ends it, even after a first approval
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rc := (public.inv_submit_request(w1, 'to reject', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 55))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rc, 'approved');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rc, 'rejected', 'no');
  reset role;
  select status into st from public.inv_requests where id = rc;
  if st <> 'rejected' then raise exception 'FAIL S5a: request is %, expected rejected', st; end if;
  select b.reserved into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1 and b.warehouse_id = w1;
  if n <> 10 then raise exception 'FAIL S5b: reserved is %, expected 10 (only the small approved request)', n; end if;

  -- ---- S6: a policy for one warehouse only; the highest matching policy wins
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  p2 := public.inv_set_approval_policy(w1, 100, 3);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rw2 := (public.inv_submit_request(w2, 'other warehouse', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 120))) ->> 'id')::uuid;
  rd := (public.inv_submit_request(w1, 'needs three', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 120))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rw2, 'approved');
  perform public.inv_decide_request(rd, 'approved');
  reset role;
  select status into st from public.inv_requests where id = rw2;
  if st <> 'submitted' then raise exception 'FAIL S6a: the other warehouse (policy needs 2, 120 units) is %, expected submitted after one approval', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rw2, 'approved');
  perform public.inv_decide_request(rd, 'approved');
  reset role;
  select status into st from public.inv_requests where id = rw2;
  if st <> 'approved' then raise exception 'FAIL S6b: warehouse 2 request is %, expected approved after two', st; end if;
  select status into st from public.inv_requests where id = rd;
  if st <> 'submitted' then raise exception 'FAIL S6c: the 3-approval request is %, expected submitted after two', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_decide_request(rd, 'approved');
  reset role;
  select status into st from public.inv_requests where id = rd;
  if st <> 'approved' then raise exception 'FAIL S6d: after three approvals the request is %, expected approved', st; end if;

  -- ---- S7: the requester can never be one of the approvers
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rx := (public.inv_submit_request(w2, 'admin own', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 60))) ->> 'id')::uuid;
  ok := false;
  begin perform public.inv_decide_request(rx, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S7: a requester approved their own request under a policy'; end if;
  reset role;

  -- ---- S8: removing a policy, other organizations, direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_remove_approval_policy(p2);
  ok := false;
  begin insert into public.inv_approval_policies (org_id, min_total_qty, required_approvals) values (oa, 1, 1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S8a: direct insert into policies was allowed'; end if;
  ok := false;
  begin update public.inv_approval_policies set required_approvals = 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S8b: direct update of policies was allowed'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.policy.removed';
  if n <> 1 then raise exception 'FAIL S8c: the removal was not audited'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_approval_policies;
  if n <> 0 then raise exception 'FAIL S8d: another organization sees these policies'; end if;
  wb := public.inv_create_warehouse('MAIN', 'B');
  ib := public.inv_create_item('GLV', 'B gloves', null, 'pair', 500, wb);
  reset role;
  select public.inv__required_approvals(ob, wb, 400) into n;
  if n <> 1 then raise exception 'FAIL S8e: another organization''s request needs % approvals, expected 1', n; end if;

  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S9: the audit chain is broken'; end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
