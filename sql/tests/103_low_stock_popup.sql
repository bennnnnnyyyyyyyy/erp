-- sql/tests/103_low_stock_popup.sql
-- The low stock pop-up (sql/106). Always rolls back. Needs sql/001-106.
-- Covers: W1 the work week is set by owners and admins, audited, and refused when wrong; a member cannot set it; W2 "tomorrow" is the
-- next workday at the start time in the company's time zone, "week" the first workday of next week; P1 the pop-up lists low items
-- only, with the suggested quantity (up to the maximum level: the plan's example 300 - 100 = 200); P2 snooze hides an item for that
-- person only, and it comes back when the snooze ends; P3 mute hides it, and it comes back at zero; P4 a viewer gets nothing;
-- M1 the maximum level is set by owners and admins only, audited; I1 another company sees and changes nothing; A1 no anonymous use;
-- G1 a person reads only their own states, and cannot write them directly.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; it uuid; it2 uuid; ok boolean; n int; t timestamptz; ww jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ls-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'ls-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'ls-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'ls-x@tests.invalid');
  o := public.bootstrap_organization('Low stock A', 'low-stock-a', 'ls-o@tests.invalid');
  ob := public.bootstrap_organization('Low stock B', 'low-stock-b', 'ls-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer');
  update public.organizations set timezone = 'Africa/Cairo' where id = o;
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('MAIN', 'Main', null);
  it := public.inv_create_item('LS-1', 'Cream', null, 'piece', 100, w);
  it2 := public.inv_create_item('LS-2', 'Soap', null, 'piece', 500, w);
  perform public.inv_set_reorder_level(it, 150);
  perform public.inv_set_reorder_level(it2, 50);

  -- W1: work week
  ok := false; begin perform public.core_set_work_week(array[9], '09:00', '17:00'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL W1a: a day 9 accepted'; end if;
  ok := false; begin perform public.core_set_work_week(array[0,1], '17:00', '09:00'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL W1b: start after end accepted'; end if;
  ww := public.core_set_work_week(array[4, 0, 1, 2, 3, 3], '08:30', '16:30');
  if ww <> '{"days":[0,1,2,3,4],"start":"08:30","end":"16:30"}'::jsonb then raise exception 'FAIL W1c: saved %', ww; end if;
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'organization.work_week_changed') then raise exception 'FAIL W1d: not audited'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_work_week(array[1], '09:00', '17:00'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL W1e: a member set the work week'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- W2: Thursday 26 Nov 2026, 15:00 in Cairo (13:00 UTC); workdays Sunday to Thursday, start 08:30
  reset role;
  t := public.core__next_work_start(o, '2026-11-26 13:00+00', 1);
  if t <> '2026-11-29 08:30 Africa/Cairo'::timestamptz then raise exception 'FAIL W2a: tomorrow after Thursday is %', t; end if;
  t := public.core__next_work_start(o, '2026-11-24 13:00+00', 1);
  if t <> '2026-11-25 08:30 Africa/Cairo'::timestamptz then raise exception 'FAIL W2b: tomorrow after Tuesday is %', t; end if;
  t := public.core__next_work_start(o, '2026-11-24 13:00+00', 1, true);
  if t <> '2026-11-29 08:30 Africa/Cairo'::timestamptz then raise exception 'FAIL W2c: next week after Tuesday is %', t; end if;
  set local role authenticated;

  -- P1: only the low item (available 100 <= level 150); the suggestion fills to the maximum level (300 - 100 = 200)
  perform public.inv_set_max_level(it, 300);
  select count(*) into n from public.inv_low_stock_popup();
  if n <> 1 then raise exception 'FAIL P1a: % items in the pop-up, expected 1', n; end if;
  if (select suggested_qty from public.inv_low_stock_popup() where item_id = it) <> 200 then raise exception 'FAIL P1b: suggested quantity is not 200'; end if;

  -- P2: snooze hides it for the owner only; it comes back when the snooze ends
  perform public.inv_snooze_low_stock(it, 'hour');
  if exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL P2a: a snoozed item shows'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL P2b: the snooze hid it from another person'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role;
  update public.inv_stock_alert_states set snoozed_until = now() - interval '1 minute' where user_id = u and item_id = it;
  set local role authenticated;
  if not exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL P2c: it did not come back after the snooze'; end if;
  ok := false; begin perform public.inv_snooze_low_stock(it, 'forever'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P2d: an unknown snooze accepted'; end if;

  -- P3: mute hides it; at zero it comes back
  perform public.inv_mute_low_stock(it, true);
  if exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL P3a: a muted item shows'; end if;
  reset role;
  update public.inv_stock_balances set on_hand = 0 where org_id = o and item_id = it;
  set local role authenticated;
  if not exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL P3b: a muted item at zero does not come back'; end if;
  perform public.inv_mute_low_stock(it, false);

  -- G1: own rows only; no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.inv_stock_alert_states where user_id = u) then raise exception 'FAIL G1a: a member reads the owner''s states'; end if;
  ok := false; begin insert into public.inv_stock_alert_states (org_id, user_id, item_id, muted_at) values (o, m, it, now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL G1b: a direct insert worked'; end if;

  -- M1: the maximum level: owners and admins only, audited
  ok := false; begin perform public.inv_set_max_level(it, 10); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL M1a: a member set the maximum level'; end if;
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'inventory.max_level.set' and entity_id = it::text) then raise exception 'FAIL M1b: not audited'; end if;
  set local role authenticated;

  -- P4: a viewer
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_low_stock_popup(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P4: a viewer read the pop-up'; end if;

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.inv_low_stock_popup() where item_id = it) then raise exception 'FAIL I1a: another company sees the item'; end if;
  ok := false; begin perform public.inv_snooze_low_stock(it, 'hour'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1b: another company snoozed the item'; end if;
  ok := false; begin perform public.inv_set_max_level(it, 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1c: another company set the maximum level'; end if;
  if exists (select 1 from public.inv_stock_alert_states) then raise exception 'FAIL I1d: another company reads states'; end if;
  reset role;

  -- A1: no anonymous use
  if has_function_privilege('anon', 'public.inv_low_stock_popup()', 'execute')
     or has_function_privilege('anon', 'public.inv_snooze_low_stock(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.core_set_work_week(int[], text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.core__next_work_start(uuid, timestamptz, int, boolean)', 'execute') then
    raise exception 'FAIL A1: anonymous or direct use of a pop-up function';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
