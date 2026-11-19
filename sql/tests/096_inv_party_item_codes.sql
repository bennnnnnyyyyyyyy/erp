-- sql/tests/096_inv_party_item_codes.sql
-- sql/099: supplier and customer item codes (MASTER_DATA_PLAN.md slice B). Always rolls back. Needs sql/001-099.
-- Covers: C1 add and change a code (one per item and party); C2 a code is unique per party (case-insensitive), the same code at another
-- party is fine; C3 the lookup finds items by a party's code; C4 remove, then the code is free again; C5 only owners and admins write,
-- members read and look up; C6 a party of another company, or not a supplier/customer, is refused; C7 audit rows; C8 isolation;
-- C9 no direct writes.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; i1 uuid; i2 uuid; sup uuid; sup2 uuid; cus uuid; supb uuid; r record; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'pic-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'pic-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'pic-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'pic-x@tests.invalid');
  o := public.bootstrap_organization('Party codes A', 'party-codes-a', 'pic-o@tests.invalid');
  ob := public.bootstrap_organization('Party codes B', 'party-codes-b', 'pic-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  supb := public.pur_create_supplier('B supplier', null, null, null);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  i1 := public.inv_create_item('10-03-007', 'Face cream 50ml');
  i2 := public.inv_create_item('10-03-008', 'Face cream 100ml');
  sup := public.pur_create_supplier('Delta', null, null, null);
  sup2 := public.pur_create_supplier('Gamma', null, null, null);
  cus := public.sal_create_customer('Nile Pharmacy');

  -- ---- C1: add, then change (still one code per item and party)
  perform public.inv_set_party_item_code(i1, 'supplier', sup, 'FC-50', 'Cream 50');
  perform public.inv_set_party_item_code(i1, 'supplier', sup, 'FC-050', null);
  perform public.inv_set_party_item_code(i1, 'supplier', sup, 'FC-050', null);   -- same again: no audit row
  perform public.inv_set_party_item_code(i1, 'customer', cus, 'NIL-778');
  select count(*) into n from public.inv_party_item_codes where org_id = o and item_id = i1 and party_type = 'supplier' and party_id = sup and deleted_at is null;
  if n <> 1 then raise exception 'FAIL C1a: % live codes for one item at one supplier', n; end if;
  select code into r from public.inv_party_item_codes where org_id = o and item_id = i1 and party_id = sup and deleted_at is null;
  if r.code <> 'FC-050' then raise exception 'FAIL C1b: the code is %', r.code; end if;

  -- ---- C2: unique per party, case-insensitive; fine at another party
  ok := false; begin perform public.inv_set_party_item_code(i2, 'supplier', sup, 'fc-050'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL C2a: two items share Delta''s code'; end if;
  perform public.inv_set_party_item_code(i2, 'supplier', sup2, 'FC-050');

  -- ---- C3: the lookup
  select * into r from public.inv_find_items_by_party_code('supplier', sup, 'fc-0');
  if r.item_id is distinct from i1 then raise exception 'FAIL C3a: lookup found %', r.item_id; end if;
  select count(*) into n from public.inv_find_items_by_party_code('customer', cus, 'FC');
  if n <> 0 then raise exception 'FAIL C3b: a supplier''s code was found at a customer'; end if;
  select count(*) into n from public.inv_find_items_by_party_code('customer', cus, '778');
  if n <> 1 then raise exception 'FAIL C3c: the customer code was not found by part of it'; end if;

  -- ---- C4: remove, then the code is free for another item
  perform public.inv_remove_party_item_code(i1, 'supplier', sup);
  perform public.inv_set_party_item_code(i2, 'supplier', sup, 'FC-050');
  ok := false; begin perform public.inv_remove_party_item_code(i1, 'supplier', sup); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C4: a removed code was removed again'; end if;

  -- ---- C6: wrong party
  ok := false; begin perform public.inv_set_party_item_code(i1, 'supplier', supb, 'X'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C6a: a code for another company''s supplier'; end if;
  ok := false; begin perform public.inv_set_party_item_code(i1, 'customer', sup, 'X'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C6b: a supplier was accepted as a customer'; end if;
  ok := false; begin perform public.inv_set_party_item_code(i1, 'partner', sup, 'X'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C6c: an unknown party type was accepted'; end if;

  -- ---- C5: roles
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.inv_party_item_codes where org_id = o and deleted_at is null;
  if n <> 3 then raise exception 'FAIL C5a: a member sees % live codes, expected 3', n; end if;
  select count(*) into n from public.inv_find_items_by_party_code('customer', cus, 'NIL');
  if n <> 1 then raise exception 'FAIL C5b: a member cannot look up codes'; end if;
  ok := false; begin perform public.inv_set_party_item_code(i1, 'supplier', sup2, 'M-1'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C5c: a member added a code'; end if;
  ok := false; begin perform public.inv_remove_party_item_code(i1, 'customer', cus); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C5d: a member removed a code'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_set_party_item_code(i1, 'supplier', sup2, 'G-1');   -- admins may

  -- ---- C9: no direct writes
  ok := false; begin insert into public.inv_party_item_codes (org_id, item_id, party_type, party_id, code) values (o, i1, 'supplier', sup, 'D'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL C9a: a direct insert'; end if;
  ok := false; begin update public.inv_party_item_codes set code = 'Z' where org_id = o; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL C9b: a direct update'; end if;

  -- ---- C8: another company sees and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from public.inv_party_item_codes where org_id = o;
  if n <> 0 then raise exception 'FAIL C8a: company B sees % of A''s codes', n; end if;
  select count(*) into n from public.inv_find_items_by_party_code('customer', cus, 'NIL');
  if n <> 0 then raise exception 'FAIL C8b: company B found A''s codes'; end if;
  ok := false; begin perform public.inv_set_party_item_code(i1, 'supplier', supb, 'X'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C8c: company B coded A''s item'; end if;
  ok := false; begin perform public.inv_remove_party_item_code(i1, 'customer', cus); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C8d: company B removed A''s code'; end if;
  reset role;

  -- ---- C7: audit rows: added 3 (FC-50, NIL-778, Gamma FC-050), changed 1, removed 1, added again 1 (i2 at Delta), admin G-1 1
  select count(*) into n from public.audit_log where org_id = o and action like 'inventory.party_code.%';
  if n <> 7 then raise exception 'FAIL C7: % party code audit rows, expected 7', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
