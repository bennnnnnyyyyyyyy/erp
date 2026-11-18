-- sql/tests/094_inv_item_groups_leaf.sql
-- sql/098: items only in groups without sub-groups. Always rolls back. Needs sql/001-098.
-- Covers: L1 an item cannot be created in, or moved to, a group that has sub-groups; L2 it can in a sub-group; L3 a sub-group cannot be
-- added under (or moved under) a group that holds items; L4 once its items move out, it can; L5 a deleted sub-group no longer counts;
-- L6 another company's group is still NOT_FOUND (not a leaf error that would reveal it exists).

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; g10 uuid; g03 uuid; g20 uuid; g21 uuid; i1 uuid; i2 uuid; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'igl-o@tests.invalid'), (x, 'authenticated', 'authenticated', 'igl-x@tests.invalid');
  o := public.bootstrap_organization('Leaf groups A', 'leaf-groups-a', 'igl-o@tests.invalid');
  ob := public.bootstrap_organization('Leaf groups B', 'leaf-groups-b', 'igl-x@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;

  g10 := public.inv_create_item_group(null, '10', 'Drinks');
  g03 := public.inv_create_item_group(g10, '03', 'Juice');
  g20 := public.inv_create_item_group(null, '20', 'Snacks');

  -- ---- L1: not in a group with sub-groups
  ok := false; begin perform public.inv_create_item('X-1', 'In a heading', null, 'piece', 0, null, null, g10); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL L1a: an item was created in a group with sub-groups'; end if;
  -- ---- L2: fine in the sub-group and in a group without sub-groups
  i1 := public.inv_create_item('J-1', 'Juice', null, 'piece', 0, null, null, g03);
  i2 := public.inv_create_item('S-1', 'Chips', null, 'piece', 0, null, null, g20);
  ok := false; begin perform public.inv_set_item_group(i1, g10); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL L1b: an item was moved into a group with sub-groups'; end if;

  -- ---- L3: no sub-group under a group that holds items
  ok := false; begin perform public.inv_create_item_group(g20, '01', 'Crisps'); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL L3a: a sub-group was added under a group with items'; end if;
  g21 := public.inv_create_item_group(null, '21', 'Nuts');
  ok := false; begin perform public.inv_move_item_group(g21, g20); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL L3b: a group was moved under a group with items'; end if;

  -- ---- L4: after the items move out, sub-groups are allowed
  perform public.inv_set_item_group(i2, g21);
  perform public.inv_move_item_group(g03, g20);
  ok := false; begin perform public.inv_set_item_group(i2, g20); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL L4: an item went back into a group that now has a sub-group'; end if;

  -- ---- L5: g10 has no live sub-group now (Juice moved away): items may go in
  perform public.inv_set_item_group(i2, g10);

  -- ---- L6: another company sees NOT_FOUND, not the leaf rule
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  ok := false; begin perform public.inv_create_item('B-1', 'B item', null, 'piece', 0, null, null, g20); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL L6a: company B learned about A''s group'; end if;
  ok := false; begin perform public.inv_create_item_group(g10, '01', 'Under A'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL L6b: company B learned about A''s group'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
