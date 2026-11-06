-- sql/tests/045_branches_codes.sql
-- Phase 2, slice 1 (sql/050): branches and customer/supplier codes. Always rolls back. Needs sql/001-050.
-- Covers: a new company gets MAIN; a new warehouse lands in MAIN; owner/admin only; branch code rules and uniqueness; cannot
-- deactivate a branch with warehouses or the last active branch; moving a warehouse; automatic and typed party codes, prefix setting,
-- uniqueness (case-insensitive), automatic codes skip typed ones; changing a code; isolation; audit; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; main uuid; alex uuid; wh uuid; c1 uuid; c2 uuid; c3 uuid; s1 uuid; n bigint; ok boolean; v text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'br-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'br-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'br-x@tests.invalid');
  o := public.bootstrap_organization('Branch Test A', 'branch-test-a', 'br-o@tests.invalid');
  ob := public.bootstrap_organization('Branch Test B', 'branch-test-b', 'br-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- ---- B1: MAIN seeded for a new company, once
  select id into main from public.core_branches where org_id = o and code = 'MAIN';
  if main is null then raise exception 'FAIL B1a: no MAIN branch for a new company'; end if;
  select count(*) into n from public.core_branches where org_id = o;
  if n <> 1 then raise exception 'FAIL B1b: % branches, expected 1', n; end if;
  if public.core__seed_branch(o) <> main then raise exception 'FAIL B1c: seeding twice made another branch'; end if;

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- B2: a new warehouse lands in MAIN
  wh := public.inv_create_warehouse('WH1', 'Warehouse 1');
  if (select branch_id from public.inv_warehouses where id = wh) is distinct from main then raise exception 'FAIL B2: new warehouse not in MAIN'; end if;

  -- ---- B3: add a branch, code rules, uniqueness
  alex := public.core_save_branch(null, 'alx', 'Alexandria', 'الإسكندرية');
  if (select code from public.core_branches where id = alex) <> 'ALX' then raise exception 'FAIL B3a: code not upper-cased'; end if;
  ok := false; begin perform public.core_save_branch(null, 'ALX', 'Again'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL B3b: duplicate branch code accepted'; end if;
  ok := false; begin perform public.core_save_branch(null, 'bad code!', 'X'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL B3c: bad branch code accepted'; end if;

  -- ---- B4: move the warehouse; deactivation rules
  perform public.inv_set_warehouse_branch(wh, alex);
  if (select branch_id from public.inv_warehouses where id = wh) <> alex then raise exception 'FAIL B4a: warehouse not moved'; end if;
  ok := false; begin perform public.core_save_branch(alex, 'ALX', 'Alexandria', null, false); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL B4b: deactivated a branch that has a warehouse'; end if;
  perform public.inv_set_warehouse_branch(wh, main);
  perform public.core_save_branch(alex, 'ALX', 'Alexandria', null, false);
  ok := false; begin perform public.core_save_branch(main, 'MAIN', 'Main', null, false); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL B4c: deactivated the last active branch (MAIN still has a warehouse too)'; end if;
  ok := false; begin perform public.inv_set_warehouse_branch(wh, alex); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL B4d: moved a warehouse into an inactive branch'; end if;

  -- ---- C1: automatic customer and supplier codes, typed codes, skip, uniqueness
  c1 := public.sal_create_customer('Nile Pharmacy');
  if (select code from public.sal_customers where id = c1) <> 'C-00001' then raise exception 'FAIL C1a: first automatic code %', (select code from public.sal_customers where id = c1); end if;
  c2 := public.sal_create_customer('Delta Stores', p_code => 'C-00002');
  c3 := public.sal_create_customer('Cairo Mart');
  if (select code from public.sal_customers where id = c3) <> 'C-00003' then raise exception 'FAIL C1b: automatic code did not skip a typed one: %', (select code from public.sal_customers where id = c3); end if;
  ok := false; begin perform public.sal_create_customer('Copy', p_code => 'c-00001'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL C1c: duplicate customer code (different case) accepted'; end if;
  ok := false; begin perform public.sal_create_customer('Bad', p_code => 'has space'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C1d: bad customer code accepted'; end if;
  s1 := public.pur_create_supplier('Glass Co');
  if (select code from public.pur_suppliers where id = s1) <> 'S-00001' then raise exception 'FAIL C1e: first supplier code'; end if;
  perform public.pur_create_supplier('Old call', 'contact', 'city', 'phone');   -- the sql/017 4-argument call still works

  -- ---- C2: change a code; uniqueness on change; audit
  perform public.sal_set_customer_code(c1, 'NILE-1');
  if (select code from public.sal_customers where id = c1) <> 'NILE-1' then raise exception 'FAIL C2a: code not changed'; end if;
  ok := false; begin perform public.sal_set_customer_code(c3, 'nile-1'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL C2b: changed to a code already used'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action in ('core.branch.created', 'core.branch.changed', 'inventory.warehouse.branch_changed',
    'sales.customer.code_changed', 'sales.customer.created', 'purchasing.supplier.created');
  if n < 9 then raise exception 'FAIL C2c: only % audit rows', n; end if;

  -- ---- C3: prefix setting
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"customer_code_prefix": "CU"}' where id = o;
  set local role authenticated;
  c3 := public.sal_create_customer('Prefixed');
  if (select code from public.sal_customers where id = c3) <> 'CU00004' then raise exception 'FAIL C3: prefix not used: %', (select code from public.sal_customers where id = c3); end if;

  -- ---- R1: members cannot manage
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_save_branch(null, 'M1', 'Member branch'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1a: a member added a branch'; end if;
  ok := false; begin perform public.inv_set_warehouse_branch(wh, main); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R1b: a member moved a warehouse'; end if;
  select count(*) into n from public.core_branches;
  if n <> 2 then raise exception 'FAIL R1c: a member sees % branches, expected 2', n; end if;
  ok := false; begin insert into public.core_branches (org_id, code, name) values (o, 'HACK', 'Direct'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL R1d: direct insert into branches allowed'; end if;

  -- ---- I1: another company sees nothing and changes nothing
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.core_branches where org_id = o;
  if n <> 0 then raise exception 'FAIL I1a: another company sees % branches', n; end if;
  ok := false; begin perform public.core_save_branch(alex, 'ALX', 'Taken over'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1b: another company changed a branch'; end if;
  ok := false; begin perform public.sal_set_customer_code(c1, 'MINE'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1c: another company changed a customer code'; end if;
  c2 := public.sal_create_customer('B first customer');
  reset role;
  if (select code from public.sal_customers where id = c2) <> 'C-00001' then raise exception 'FAIL I1d: company B''s counter is not its own'; end if;

  -- ---- A1: no anonymous use
  if has_function_privilege('anon', 'public.core_save_branch(uuid, text, text, text, boolean, uuid)', 'execute')
     or has_function_privilege('anon', 'public.sal_set_customer_code(uuid, text)', 'execute') then
    raise exception 'FAIL A1: anonymous can call branch or code functions';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
