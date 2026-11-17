-- sql/tests/090_inv_item_groups.sql
-- sql/095: item groups and item codes (MASTER_DATA_PLAN.md slice A). Always rolls back. Needs sql/001-095.
-- Covers: G1 groups and sub-groups with codes, sibling code unique, same code allowed at another level; G2 the group rule builds
-- 10-03-007 and counts deleted items; G3 a group is required under the group rule, optional otherwise; G4 an item moved to another
-- group keeps its code, a re-coded group leaves old codes; G5 no cycles; G6 a group in use cannot be deleted; G7 roles (members read
-- and place items, only owners and admins change groups and the rule); G8 audit rows; G9 isolation (read and write); G10 no direct
-- writes; G11 the prefix rule and "typed" still work as before.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; g10 uuid; g03 uuid; g04 uuid; g20 uuid; gx uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; ib uuid;
  v text; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'igr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'igr-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'igr-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'igr-x@tests.invalid');
  o := public.bootstrap_organization('Item groups A', 'item-groups-a', 'igr-o@tests.invalid');
  ob := public.bootstrap_organization('Item groups B', 'item-groups-b', 'igr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;

  -- ---- G11a: no rule saved and no format: "typed", no next code
  if public.inv_item_code_rule() ->> 'rule' <> 'typed' then raise exception 'FAIL G11a: default rule is %', public.inv_item_code_rule() ->> 'rule'; end if;
  if public.inv_next_sku() is not null then raise exception 'FAIL G11a: a next code under the typed rule'; end if;
  ok := false; begin perform public.inv_create_item('', 'No code'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G11a: an item without a code was created under the typed rule'; end if;
  i4 := public.inv_create_item('OLD-1', 'Typed item');   -- the 6-argument call still works

  -- ---- G1: a tree with codes
  g10 := public.inv_create_item_group(null, '10', 'Drinks', 'مشروبات');
  g03 := public.inv_create_item_group(g10, '03', 'Juice', 'عصير');
  g04 := public.inv_create_item_group(g10, '04', 'Water', null);
  g20 := public.inv_create_item_group(null, '20', 'Snacks', null);
  ok := false; begin perform public.inv_create_item_group(g10, '03', 'Juice again'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL G1a: two sibling groups with code 03'; end if;
  perform public.inv_create_item_group(g20, '03', 'Chips');   -- same code under another parent is fine
  ok := false; begin perform public.inv_create_item_group(null, '1-0', 'Bad'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1b: a code with a dash was accepted'; end if;

  -- ---- G2: the group rule builds codes
  perform public.inv_set_item_code_rule('group', '-', 3);
  if public.inv_next_item_code(g03) <> '10-03-001' then raise exception 'FAIL G2a: first code is %', public.inv_next_item_code(g03); end if;
  if public.inv_next_sku() is not null then raise exception 'FAIL G2b: a next code without a group under the group rule'; end if;
  -- six items typed by hand in the group's pattern, one of them deleted afterwards: the next is still 007
  for k in 1..5 loop perform public.inv_create_item(format('10-03-%s', lpad(k::text, 3, '0')), format('Juice %s', k), null, 'piece', 0, null, null, g03); end loop;
  i3 := public.inv_create_item('10-03-006', 'Juice 6', null, 'piece', 0, null, null, g03);
  reset role;
  update public.inv_items set deleted_at = now() where id = i3;
  set local role authenticated;
  i1 := public.inv_create_item('', 'Mango juice', 'عصير مانجو', 'piece', 0, null, null, g03);   -- blank code: given by the database
  select sku into v from public.inv_items where id = i1;
  if v <> '10-03-007' then raise exception 'FAIL G2c: the 7th item got %, expected 10-03-007', v; end if;
  if public.inv_next_item_code(g04) <> '10-04-001' then raise exception 'FAIL G2d: water starts at %', public.inv_next_item_code(g04); end if;

  -- ---- G3: a group is required under the group rule
  ok := false; begin perform public.inv_create_item('X-1', 'No group'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G3a: an item without a group under the group rule'; end if;
  ok := false; begin perform public.inv_set_item_group(i1, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G3b: an item taken out of every group under the group rule'; end if;

  -- ---- G4: moving an item and re-coding a group keep the item's code
  perform public.inv_set_item_group(i1, g04);
  perform public.inv_set_item_group(i1, g04);   -- same again: no second audit row
  perform public.inv_update_item_group(g03, '30', 'Juices', 'عصائر', true);
  select sku into v from public.inv_items where id = i1;
  if v <> '10-03-007' then raise exception 'FAIL G4a: the moved item''s code changed to %', v; end if;
  if public.inv_next_item_code(g03) <> '10-30-001' then raise exception 'FAIL G4b: re-coded group gives %', public.inv_next_item_code(g03); end if;
  if public.inv_next_item_code(g04) <> '10-04-001' then raise exception 'FAIL G4c: the moved item counted in its new group'; end if;

  -- ---- G5: no cycles
  ok := false; begin perform public.inv_move_item_group(g10, g03); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G5a: a group moved under its own sub-group'; end if;
  ok := false; begin perform public.inv_move_item_group(g10, g10); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G5b: a group moved under itself'; end if;
  perform public.inv_move_item_group(g03, g20);   -- Juices (30) under Snacks: allowed
  if public.inv_next_item_code(g03) <> '20-30-001' then raise exception 'FAIL G5c: after the move the code is %', public.inv_next_item_code(g03); end if;

  -- ---- G6: a group in use cannot be deleted; an empty one can; an inactive one takes no new items
  ok := false; begin perform public.inv_delete_item_group(g04); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL G6a: a group with an item was deleted'; end if;
  ok := false; begin perform public.inv_delete_item_group(g20); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL G6b: a group with sub-groups was deleted'; end if;
  gx := public.inv_create_item_group(null, '99', 'Empty');
  perform public.inv_delete_item_group(gx);
  perform public.inv_create_item_group(null, '99', 'Empty again');   -- a deleted group's code is free again
  perform public.inv_update_item_group(g04, '04', 'Water', null, false);
  ok := false; begin perform public.inv_create_item('', 'Still water', null, 'piece', 0, null, null, g04); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G6c: an item created in an inactive group'; end if;
  perform public.inv_update_item_group(g04, '04', 'Water', null, true);

  -- ---- G7: roles
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.inv_item_groups where org_id = o and deleted_at is null;
  if n <> 6 then raise exception 'FAIL G7a: a member sees % live groups, expected 6', n; end if;
  i2 := public.inv_create_item('', 'Sparkling water', null, 'piece', 0, null, null, g04);   -- members create items in a group
  perform public.inv_set_item_group(i2, g10);
  ok := false; begin perform public.inv_create_item_group(null, '50', 'Member group'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL G7b: a member created a group'; end if;
  ok := false; begin perform public.inv_update_item_group(g10, '10', 'Renamed'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL G7c: a member renamed a group'; end if;
  ok := false; begin perform public.inv_set_item_code_rule('typed'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL G7d: a member changed the code rule'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.inv_update_item_group(g10, '10', 'Beverages', 'مشروبات', true);   -- admins may

  -- ---- G10: no direct writes
  ok := false; begin insert into public.inv_item_groups (org_id, code, name) values (o, '77', 'Direct'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL G10a: a direct insert into item groups'; end if;
  ok := false; begin update public.inv_items set group_id = null where id = i1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL G10b: a direct update of an item''s group'; end if;

  -- ---- G9: another company sees none of A's groups and cannot use them
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from public.inv_item_groups where org_id = o;
  if n <> 0 then raise exception 'FAIL G9a: company B sees % of A''s groups', n; end if;
  ok := false; begin perform public.inv_update_item_group(g10, '10', 'Hijacked'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9b: company B renamed A''s group'; end if;
  ok := false; begin perform public.inv_delete_item_group(gx); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9c: company B touched A''s group'; end if;
  ok := false; begin perform public.inv_create_item_group(g10, '01', 'Under A'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9d: company B put a group under A''s'; end if;
  ok := false; begin perform public.inv_create_item('B-1', 'B item', null, 'piece', 0, null, null, g10); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9e: company B created an item in A''s group'; end if;
  ok := false; begin perform public.inv_set_item_group(i1, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9f: company B moved A''s item'; end if;
  ok := false; begin perform public.inv_next_item_code(g10); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9g: company B read the next code of A''s group'; end if;
  ib := public.inv_create_item('B-1', 'B item');
  ok := false; begin perform public.inv_set_item_group(ib, g10); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL G9h: company B put its item in A''s group'; end if;
  -- B's own rule is still "typed"
  if public.inv_item_code_rule() ->> 'rule' <> 'typed' then raise exception 'FAIL G9i: A''s rule leaked to B'; end if;

  -- ---- G11b: the prefix rule (sql/075) still gives the next code
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform public.inv_set_sku_format('ITM-', 4);
  if public.inv_item_code_rule() ->> 'rule' <> 'prefix' then raise exception 'FAIL G11b: a format without a rule is not "prefix"'; end if;
  if public.inv_next_sku() <> 'ITM-0001' then raise exception 'FAIL G11c: next prefix code is %', public.inv_next_sku(); end if;
  perform public.inv_create_item('', 'Auto prefix');
  if public.inv_next_sku() <> 'ITM-0002' then raise exception 'FAIL G11d: after one item the next is %', public.inv_next_sku(); end if;
  reset role;

  -- ---- G8: audit rows, one per change
  select count(*) into n from public.audit_log where org_id = o and action like 'inventory.item_group.%';
  -- created: 10, 03, 04, 20, 03 (chips), 99, 99 = 7; updated: 03->30, 04 off, 04 on, 10 renamed = 4; moved: 1; deleted: 1
  if n <> 13 then raise exception 'FAIL G8a: % group audit rows, expected 13', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'inventory.item.group_changed';
  if n <> 2 then raise exception 'FAIL G8b: % item group changes audited, expected 2', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.item_code_rule_changed';
  if n <> 1 then raise exception 'FAIL G8c: % rule changes audited, expected 1', n; end if;
  select count(*) into n from public.inv_items where org_id = o and group_id = g10 and id = i2;
  if n <> 1 then raise exception 'FAIL G8d: the member''s move did not stick'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
