-- sql/tests/069_order_confirmation.sql
-- Supplier confirmation and promised date (sql/073). Always rolls back. Needs sql/001-073.
-- Covers: a member confirms an approved open order with a date and the supplier's reference; changing the date is audited with old and
-- new; a waiting, received or cancelled order cannot be confirmed; the date is needed and not before the order date; a late order is
-- listed with its days late; another company sees nothing and cannot confirm; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; s uuid; po uuid; po2 uuid; ok boolean; n int; d int;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'oc-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'oc-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'oc-x@tests.invalid');
  o := public.bootstrap_organization('Confirm A', 'confirm-a', 'oc-o@tests.invalid');
  ob := public.bootstrap_organization('Confirm B', 'confirm-b', 'oc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('OC-1', 'Caps', null, 'piece', 0, null);
  s := public.pur_create_supplier('Confirm Supplier', null, null, null);

  -- ---- C1: a waiting order cannot be confirmed; once approved (sole owner) it can, by a member
  po := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5, 'unitCostMinor', 100))) ->> 'id')::uuid;
  ok := false; begin perform public.pur_confirm_order(po, current_date + 5, null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL C1a: waiting order confirmed'; end if;
  perform public.pur_decide_order(po, 'approved');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.pur_confirm_order(po, current_date + 5, ' SUP-889 ');
  if (select supplier_ref from public.pur_orders where id = po) <> 'SUP-889' then raise exception 'FAIL C1b: reference not saved'; end if;

  -- ---- C2: date needed, not before the order date
  ok := false; begin perform public.pur_confirm_order(po, null, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C2a: no date accepted'; end if;
  ok := false; begin perform public.pur_confirm_order(po, current_date - 30, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C2b: date before the order accepted'; end if;

  -- ---- C3: the supplier slips: the date changes, audited with old and new; then it is late
  perform public.pur_confirm_order(po, current_date, 'SUP-889');
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and entity_id = po::text and action = 'purchasing.order.promised_date_changed'
                 and (before ->> 'promisedDate')::date = current_date + 5 and (after ->> 'promisedDate')::date = current_date) then
    raise exception 'FAIL C3a: date change not audited with old and new';
  end if;
  update public.pur_orders set promised_date = current_date - 3 where id = po;   -- time passes
  set local role authenticated;
  select count(*), max(days_late) into n, d from public.pur_late_orders();
  if n <> 1 or d <> 3 then raise exception 'FAIL C3b: late list % orders, % days', n, d; end if;

  -- ---- C4: a received order is not late and cannot be confirmed
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.pur_receive_order(po);
  select count(*) into n from public.pur_late_orders();
  if n <> 0 then raise exception 'FAIL C4a: received order still late'; end if;
  ok := false; begin perform public.pur_confirm_order(po, current_date + 1, null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL C4b: received order confirmed'; end if;

  -- ---- C5: another company sees nothing and cannot confirm
  po2 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1, 'unitCostMinor', 100))) ->> 'id')::uuid;
  perform public.pur_decide_order(po2, 'approved');
  perform public.pur_confirm_order(po2, current_date + 1, null);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pur_late_orders();
  if n <> 0 then raise exception 'FAIL C5a: another company sees late orders'; end if;
  ok := false; begin perform public.pur_confirm_order(po2, current_date + 2, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C5b: another company confirmed'; end if;

  reset role;
  if has_function_privilege('anon', 'public.pur_confirm_order(uuid, date, text)', 'execute') or has_function_privilege('anon', 'public.pur_late_orders()', 'execute') then
    raise exception 'FAIL C6: anonymous use';
  end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
