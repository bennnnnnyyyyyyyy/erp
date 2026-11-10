-- sql/tests/071_sku_format.sql
-- Company SKU format and the next free code (sql/075). Always rolls back. Needs sql/001-075.
-- Covers: no format means no next code; an owner sets it (bad prefix and digits refused), a member cannot; the next code is the highest
-- number with that prefix plus one (other prefixes, non-numeric tails and deleted items count correctly); setting it is audited with
-- before/after; another organization has its own format and numbering; anonymous cannot call anything.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; v text; f jsonb; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sk-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'sk-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'sk-x@tests.invalid');
  o := public.bootstrap_organization('Sku Test A', 'sku-test-a', 'sk-o@tests.invalid');
  ob := public.bootstrap_organization('Sku Test B', 'sku-test-b', 'sk-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- K1: no format yet
  if public.inv_next_sku() is not null then raise exception 'FAIL K1a: a code without a format'; end if;
  if public.inv_sku_format() is not null then raise exception 'FAIL K1b: a format nobody chose'; end if;

  -- K2: rules
  ok := false; begin perform public.inv_set_sku_format('bad prefix!', 4); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL K2a: a bad prefix accepted'; end if;
  ok := false; begin perform public.inv_set_sku_format('ITM-', 0); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL K2b: zero digits accepted'; end if;
  ok := false; begin perform public.inv_set_sku_format('ITM-', 9); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL K2c: nine digits accepted'; end if;

  -- K3: set, then the first code
  f := public.inv_set_sku_format('itm-', 4);
  if f <> '{"prefix": "ITM-", "digits": 4}'::jsonb then raise exception 'FAIL K3a: format %', f; end if;
  v := public.inv_next_sku();
  if v <> 'ITM-0001' then raise exception 'FAIL K3b: first code %', v; end if;

  -- K4: highest number plus one; other prefixes and odd tails are ignored; deleted items still hold their code
  perform public.inv_create_item('ITM-0001', 'One', null, 'piece', 0, null);
  perform public.inv_create_item('ITM-0007', 'Seven', null, 'piece', 0, null);
  perform public.inv_create_item('OTHER-0099', 'Other', null, 'piece', 0, null);
  perform public.inv_create_item('ITM-ABC', 'Odd', null, 'piece', 0, null);
  v := public.inv_next_sku();
  if v <> 'ITM-0008' then raise exception 'FAIL K4a: next code %', v; end if;
  reset role;
  update public.inv_items set deleted_at = now() where org_id = o and sku = 'ITM-0007';
  set local role authenticated;
  v := public.inv_next_sku();
  if v <> 'ITM-0008' then raise exception 'FAIL K4b: a deleted item freed its code: %', v; end if;
  perform public.inv_set_sku_format('', 3);
  perform public.inv_create_item('12', 'Plain twelve', null, 'piece', 0, null);
  v := public.inv_next_sku();
  if v <> '013' then raise exception 'FAIL K4c: no prefix: %', v; end if;
  perform public.inv_set_sku_format('ITM-', 4);

  -- K5: audited with before and after
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.sku_format_changed' and after ->> 'prefix' = 'ITM-' and before ->> 'prefix' = '';
  if n <> 1 then raise exception 'FAIL K5: audit rows %', n; end if;
  set local role authenticated;

  -- K6: a member can ask for the next code but cannot change the format
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if public.inv_next_sku() <> 'ITM-0008' then raise exception 'FAIL K6a: member next code'; end if;
  ok := false; begin perform public.inv_set_sku_format('MEM-', 4); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL K6b: a member changed the format'; end if;

  -- K7: another organization has its own format and numbering
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if public.inv_next_sku() is not null then raise exception 'FAIL K7a: B inherited A''s format'; end if;
  perform public.inv_set_sku_format('ITM-', 4);
  if public.inv_next_sku() <> 'ITM-0001' then raise exception 'FAIL K7b: B numbering sees A''s items'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  ok := false; begin perform public.inv_next_sku(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL K7c: B user used A''s organization'; end if;

  -- K8: anonymous
  reset role;
  if has_function_privilege('anon', 'public.inv_next_sku()', 'execute') or has_function_privilege('anon', 'public.inv_set_sku_format(text, int)', 'execute')
     or has_function_privilege('anon', 'public.inv_sku_format()', 'execute') then
    raise exception 'FAIL K8: something is open to anonymous users';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
