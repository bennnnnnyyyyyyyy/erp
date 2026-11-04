-- sql/tests/039_item_units.sql
-- S5a (SUPERFIX_WORKFLOW_PLAN): units with a conversion factor. Always rolls back. Needs sql/001-044.
-- Covers: owners and admins add and change units, members cannot; validation (factor above zero, not the base unit); conversion to the
-- base unit, case-insensitive; an unknown unit refused; removal keeps history and stops conversion; a removed unit can be added again;
-- audit rows; isolation; no direct writes; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; i uuid; uid1 uuid; uid2 uuid; q numeric; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'iu-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'iu-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'iu-x@tests.invalid');
  o := public.bootstrap_organization('Units Test A', 'units-test-a', 'iu-o@tests.invalid');
  ob := public.bootstrap_organization('Units Test B', 'units-test-b', 'iu-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  i := public.inv_create_item('IU-1', 'Shampoo', null, 'piece', 0, null);

  -- ---- T1: validation and roles
  ok := false; begin perform public.inv_set_item_unit(i, 'piece', 1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1a: the base unit was added as an extra unit'; end if;
  ok := false; begin perform public.inv_set_item_unit(i, 'box', 0); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1b: a zero factor was accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_set_item_unit(i, 'box', 12); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1c: a member added a unit'; end if;

  -- ---- T2: add, change, convert
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  uid1 := public.inv_set_item_unit(i, 'Box', 12);
  if public.inv_set_item_unit(i, 'box', 12) <> uid1 then raise exception 'FAIL T2a: the same unit (other case) made a second row'; end if;
  perform public.inv_set_item_unit(i, 'carton', 48, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);   -- members may convert
  q := public.inv_to_base_qty(i, 'BOX', 3);
  if q <> 36 then raise exception 'FAIL T2b: 3 boxes = %, expected 36', q; end if;
  q := public.inv_to_base_qty(i, null, 5);
  if q <> 5 then raise exception 'FAIL T2c: no unit gave %, expected 5', q; end if;
  q := public.inv_to_base_qty(i, 'Piece', 5);
  if q <> 5 then raise exception 'FAIL T2d: the base unit gave %, expected 5', q; end if;
  ok := false; begin perform public.inv_to_base_qty(i, 'pallet', 1); exception when others then ok := (sqlerrm = 'UNKNOWN_UNIT'); end;
  if not ok then raise exception 'FAIL T2e: an unknown unit converted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.inv_set_item_unit(i, 'box', 10);   -- change the factor
  q := public.inv_to_base_qty(i, 'box', 3);
  if q <> 30 then raise exception 'FAIL T2f: after the change 3 boxes = %, expected 30', q; end if;

  -- ---- T3: remove keeps history; re-add works
  perform public.inv_remove_item_unit(i, 'box');
  ok := false; begin perform public.inv_to_base_qty(i, 'box', 1); exception when others then ok := (sqlerrm = 'UNKNOWN_UNIT'); end;
  if not ok then raise exception 'FAIL T3a: a removed unit still converts'; end if;
  uid2 := public.inv_set_item_unit(i, 'box', 6);
  if uid2 = uid1 then raise exception 'FAIL T3b: re-adding reused the removed row'; end if;
  reset role;
  select count(*) into n from public.inv_item_units where item_id = i and lower(unit) = 'box';
  if n <> 2 then raise exception 'FAIL T3c: % box row(s), expected 2 (one removed, one live)', n; end if;
  select count(*) into n from public.audit_log where org_id = o and entity_id = i::text and action like 'inventory.item_unit.%';
  if n <> 5 then raise exception 'FAIL T3d: % unit audit row(s), expected 5 (box, carton, box changed, box removed, box added)', n; end if;

  -- ---- T4: isolation and no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.inv_item_units;
  if n <> 0 then raise exception 'FAIL T4a: org B sees % unit row(s)', n; end if;
  ok := false; begin perform public.inv_set_item_unit(i, 'crate', 2); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T4b: org B added a unit to org A''s item'; end if;
  ok := false; begin perform public.inv_to_base_qty(i, 'carton', 1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T4c: org B converted with org A''s units'; end if;
  ok := false; begin insert into public.inv_item_units (org_id, item_id, unit, factor) values (ob, i, 'x', 1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL T4d: a user inserted a unit row directly'; end if;

  -- ---- T5: no anonymous use
  reset role;
  if has_function_privilege('anon', 'public.inv_set_item_unit(uuid, text, numeric, boolean, boolean)', 'execute') then raise exception 'FAIL T5a: anonymous can set units'; end if;
  if has_function_privilege('anon', 'public.inv_to_base_qty(uuid, text, numeric)', 'execute') then raise exception 'FAIL T5b: anonymous can convert'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
