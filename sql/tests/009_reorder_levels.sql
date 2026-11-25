-- sql/tests/009_reorder_levels.sql
-- I6: reorder levels; since sql/112 the chasing job sends no low-stock message (the alert engine does). Always rolls back. Needs sql/001-112.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  ub uuid := gen_random_uuid();  -- admin
  uc uuid := gen_random_uuid();  -- member
  uf uuid := gen_random_uuid();  -- owner, messaging off
  oa uuid; ofx uuid;
  w1 uuid; w2 uuid; i1 uuid; i2 uuid; i3 uuid; ifx uuid; wf uuid;
  j jsonb;
  n bigint;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'low-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'low-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'low-c@tests.invalid'), (uf, 'authenticated', 'authenticated', 'low-f@tests.invalid');
  oa := public.bootstrap_organization('Low Test A', 'low-test-a', 'low-a@tests.invalid');
  ofx := public.bootstrap_organization('Low Test F', 'low-test-f', 'low-f@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'messaging'), (ofx, 'inventory');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  w2 := public.inv_create_warehouse('SIDE', 'Side');
  i1 := public.inv_create_item('GLV', 'Gloves', null, 'pair', 15, w1);      -- level 20: low
  perform public.inv_receive_stock(i1, w2, 3);                                -- 18 in total, still low
  i2 := public.inv_create_item('TAP', 'Tape', null, 'roll', 100, w1);        -- level 20: fine
  i3 := public.inv_create_item('BOX', 'Boxes', null, 'piece', 5, w1);        -- no level
  reset role;

  -- ---- S1: who can set a level, and what is valid
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_set_reorder_level(i1, 20); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S1a: a member set a reorder level'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_set_reorder_level(i1, -1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1b: a negative level was accepted'; end if;
  ok := false;
  begin perform public.inv_set_reorder_level(gen_random_uuid(), 5); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S1c: an unknown item was accepted'; end if;
  perform public.inv_set_reorder_level(i1, 20);
  perform public.inv_set_reorder_level(i2, 20);
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.reorder_level.set';
  if n <> 2 then raise exception 'FAIL S1d: expected 2 audit rows, found %', n; end if;
  ok := false;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.inv_items set reorder_level = 0; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S1e: a reorder level could be changed directly'; end if;
  reset role;

  -- ---- S2: since sql/112 the chasing job sends no low-stock message of its own (the alert engine's low stock rule does, sql/028);
  -- before, people got the same news twice. The item is low (18 at level 20), the job runs, nothing is queued about it.
  j := public.msg_run_chasing(oa);
  if (j ->> 'low_stock')::int <> 0 then raise exception 'FAIL S2a: the chasing job still counts low-stock messages: %', j; end if;
  select count(*) into n from public.msg_outbox where org_id = oa and entity_id in (i1, i2, i3);
  if n <> 0 then raise exception 'FAIL S2b: the chasing job queued % low-stock messages', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.lowstock.queued';
  if n <> 0 then raise exception 'FAIL S2c: a low-stock message was audited as queued'; end if;

  -- ---- S4: messaging off means no messages at all; no data crosses organizations
  perform set_config('request.jwt.claims', json_build_object('sub', uf, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ofx)::text, true);
  set local role authenticated;
  wf := public.inv_create_warehouse('MAIN', 'F');
  ifx := public.inv_create_item('GLV', 'F gloves', null, 'pair', 1, wf);
  perform public.inv_set_reorder_level(ifx, 50);
  reset role;
  j := public.msg_run_chasing(ofx);
  if (j ->> 'low_stock')::int <> 0 then raise exception 'FAIL S4b: low-stock messages were queued with messaging off: %', j; end if;
  select count(*) into n from public.msg_outbox where org_id = ofx;
  if n <> 0 then raise exception 'FAIL S4c: organization F has outbox rows'; end if;

  -- ---- S5: the job function is closed to signed-in users; chain clean
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_run_chasing(oa); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S5a: the chasing job is callable by a signed-in user'; end if;
  reset role;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S5b: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
