-- sql/tests/030_einvoicing_tax_data.sql
-- E-invoicing tax master data (slice A1). Always rolls back. Needs sql/001-034 and sql/036.
-- Covers: module switch, who may change what, input validation (ETA code pairs, units, EGS code format), default-rate uniqueness,
-- soft delete and the in-use guard, customer and item fields, the audit trail, no direct writes for app roles, and another
-- organization seeing and changing nothing.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin, org A
  uc uuid := gen_random_uuid();  -- member, org A
  ud uuid := gen_random_uuid();  -- viewer, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  oa uuid; ob uuid;
  w1 uuid; i1 uuid; cu uuid; cu2 uuid;
  br1 uuid; br2 uuid; r_vat uuid; r_vat2 uuid; r_wht uuid;
  n bigint; s text; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'eta-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'eta-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'eta-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'eta-d@tests.invalid'),
    (ue, 'authenticated', 'authenticated', 'eta-e@tests.invalid');
  oa := public.bootstrap_organization('ETA Test A', 'eta-test-a', 'eta-a@tests.invalid');
  ob := public.bootstrap_organization('ETA Test B', 'eta-test-b', 'eta-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'sales'), (ob, 'inventory'), (ob, 'sales');
  -- 'einvoicing' is deliberately NOT enabled yet for either organization.

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('FC50', 'Face cream 50ml', null, 'piece', 0, w1);
  cu := public.sal_create_customer('Buyer One', null, 'Cairo', null);
  cu2 := public.sal_create_customer('Walk-in Person', null, 'Giza', null);

  -- ---- S1: the module is off by default
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'preprod'); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL S1a: e-invoicing worked with the module switched off'; end if;
  reset role;
  insert into public.org_modules (org_id, module_key) values (oa, 'einvoicing');
  set local role authenticated;

  -- ---- S2: who may change tax data
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'preprod'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2a: a member changed the company tax profile'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.eta_save_tax_rate(null, 'T1', 'V009', 14, 'VAT 14', true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2b: a viewer created a tax rate'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);

  -- ---- S3: the company tax profile
  ok := false; begin perform public.eta_save_profile('!!', 'Test Seller LLC', '4620', 'preprod'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3a: a bad registration number was accepted'; end if;
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', 'abc', 'preprod'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3b: a bad activity code was accepted'; end if;
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'staging'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3c: an unknown mode was accepted'; end if;
  -- no mode given: the default is preprod, ETA's own test system (sql/082: our simulated mode is no longer a choice)
  perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620');
  select eta_mode into s from public.tax_profiles where org_id = oa;
  if s <> 'preprod' then raise exception 'FAIL S3d: default mode is %, expected preprod', s; end if;
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'simulated'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3e: the removed simulated mode was accepted'; end if;
  perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'preprod');
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'einvoicing.profile.mode_changed';
  if n <> 0 then raise exception 'FAIL S3f: saving the same mode logged % mode changes', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'einvoicing.profile.saved';
  if n <> 2 then raise exception 'FAIL S3g: % profile saves audited, expected 2', n; end if;
  set local role authenticated;
  -- production is refused until credentials and a real signer exist, and the saved mode does not change
  ok := false; begin perform public.eta_save_profile('100200300', 'Test Seller LLC', '4620', 'production'); exception when others then ok := (sqlerrm = 'PRODUCTION_NOT_READY'); end;
  if not ok then raise exception 'FAIL S3h: production mode was accepted without credentials and a real signer'; end if;
  select eta_mode into s from public.tax_profiles where org_id = oa;
  if s <> 'preprod' then raise exception 'FAIL S3i: a refused production change altered the mode to %', s; end if;
  -- ---- S4: branches
  br1 := public.eta_save_branch(null, '0', 'Head office', 'Cairo', 'Nasr City', '1 Test St', '1');
  ok := false; begin perform public.eta_save_branch(null, '0', 'Duplicate', 'Cairo', 'Nasr City', '2 Test St', '2'); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL S4a: two active branches with the same code were accepted'; end if;
  ok := false; begin perform public.eta_save_branch(null, '1', 'No street', 'Cairo', 'Nasr City', '', '3'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S4b: a branch without a street was accepted'; end if;
  br2 := public.eta_save_branch(null, '1', 'Alexandria', 'Alexandria', 'Smouha', '5 Test St', '5', '21500', '2', null, 'Near tram', null, 'EG');
  perform public.eta_save_branch(br2, '1', 'Alexandria branch', 'Alexandria', 'Smouha', '5 Test St', '5');
  select name into s from public.tax_branches where id = br2;
  if s <> 'Alexandria branch' then raise exception 'FAIL S4c: branch name is %, expected the updated name', s; end if;
  perform public.eta_remove_branch(br2);
  br2 := public.eta_save_branch(null, '1', 'Alexandria again', 'Alexandria', 'Smouha', '5 Test St', '5');  -- code is free again after removal
  ok := false; begin perform public.eta_remove_branch(gen_random_uuid()); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S4d: removing an unknown branch did not say NOT_FOUND'; end if;

  -- ---- S5: tax rates
  ok := false; begin perform public.eta_save_tax_rate(null, 'T1', 'W001', 14, 'Bad pair', false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5a: a tax type with another type''s subtype was accepted'; end if;
  ok := false; begin perform public.eta_save_tax_rate(null, 'T1', 'V009', 1000, 'Too high', false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5b: a rate above 999 was accepted'; end if;
  r_vat := public.eta_save_tax_rate(null, 'T1', 'V009', 14, 'VAT standard', true);
  r_vat2 := public.eta_save_tax_rate(null, 'T1', 'V003', 0, 'VAT exempt', true);   -- becomes the default; the first loses it
  select count(*) into n from public.tax_rates where org_id = oa and tax_type = 'T1' and is_default and deleted_at is null;
  if n <> 1 then raise exception 'FAIL S5c: % default T1 rates, expected exactly 1', n; end if;
  if (select is_default from public.tax_rates where id = r_vat) then raise exception 'FAIL S5d: the old default kept its default flag'; end if;
  ok := false; begin perform public.eta_save_tax_rate(null, 'T1', 'V010', 5, 'vat standard', false); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL S5e: two rates with the same label (any case) were accepted'; end if;
  r_wht := public.eta_save_tax_rate(null, 'T4', 'W004', 5, 'Withholding services', false);

  -- ---- S6: customer tax identity
  ok := false; begin perform public.eta_set_customer_tax(cu, 'X', '123', 'EG', 'Cairo', 'Nasr City', '1 St', '1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S6a: an unknown tax id type was accepted'; end if;
  ok := false; begin perform public.eta_set_customer_tax(cu, 'B', '', 'EG', 'Cairo', 'Nasr City', '1 St', '1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S6b: a business customer without a registration number was accepted'; end if;
  ok := false; begin perform public.eta_set_customer_tax(cu, 'B', '200300400', 'EG', 'Cairo', '', '1 St', '1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S6c: a business customer without a full address was accepted'; end if;
  perform public.eta_set_customer_tax(cu, 'B', '200300400', 'EG', 'Giza', 'Dokki', '2 Test St', '2');
  perform public.eta_set_customer_tax(cu2, 'P', null, null, null, null, null, null);
  select tax_id into s from public.sal_customers where id = cu;
  if s <> '200300400' then raise exception 'FAIL S6d: customer tax id is %', s; end if;
  select country into s from public.sal_customers where id = cu2;
  if s <> 'EG' then raise exception 'FAIL S6e: a person customer got country %, expected the EG default', s; end if;

  -- ---- S7: item codes
  ok := false; begin perform public.eta_set_item_codes(i1, 'GS1', '10001774', 'NOPE', null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S7a: an unknown unit code was accepted'; end if;
  ok := false; begin perform public.eta_set_item_codes(i1, 'EGS', 'EG-999-FC50', 'EA', null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S7b: an EGS code for another registration number was accepted'; end if;
  ok := false; begin perform public.eta_set_item_codes(i1, 'GS1', '10001774', 'EA', gen_random_uuid()); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S7c: an unknown tax rate was accepted'; end if;
  perform public.eta_set_item_codes(i1, 'EGS', 'EG-100200300-FC50', 'EA', r_vat);
  reset role;
  select eta_item_code into s from public.inv_items where id = i1;
  if s <> 'EG-100200300-FC50' then raise exception 'FAIL S7d: item code is %', s; end if;
  set local role authenticated;
  if not has_column_privilege('authenticated', 'public.inv_items', 'eta_item_code', 'select') or not has_column_privilege('authenticated', 'public.inv_items', 'default_tax_rate_id', 'select') then
    raise exception 'FAIL S7g: the new item code columns cannot be read by signed-in users (inv_items uses column grants)';
  end if;
  ok := false; begin perform public.eta_remove_tax_rate(r_vat); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL S7e: a tax rate still used by an item was removed'; end if;
  perform public.eta_set_item_codes(i1, 'GS1', '10001774', 'EA', null);
  perform public.eta_remove_tax_rate(r_vat);
  if exists (select 1 from public.tax_rates where id = r_vat and deleted_at is null) then raise exception 'FAIL S7f: the removed rate is still active'; end if;

  -- ---- S8: the audit trail
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action like 'einvoicing.%';
  if n < 14 then raise exception 'FAIL S8a: only % einvoicing audit rows, expected at least 14', n; end if;
  if not exists (select 1 from public.audit_log where org_id = oa and action = 'einvoicing.item.codes_set' and actor_user_id = ub) then
    raise exception 'FAIL S8b: item code change was not audited with the actor';
  end if;
  set local role authenticated;

  -- ---- S9: app roles cannot write directly
  ok := false; begin insert into public.tax_rates (org_id, tax_type, sub_type, rate, label) values (oa, 'T1', 'V009', 14, 'direct'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9a: a direct insert into tax_rates was allowed'; end if;
  ok := false; begin update public.tax_profiles set legal_name = 'x'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9b: a direct update of tax_profiles was allowed'; end if;
  ok := false; begin insert into public.eta_unit_types (code, description) values ('ZZ', 'fake'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9c: a direct insert into the ETA unit table was allowed'; end if;
  select count(*) into n from public.eta_unit_types;
  if n < 100 then raise exception 'FAIL S9d: only % unit codes are readable', n; end if;
  select count(*) into n from public.eta_tax_subtypes;
  if n <> 56 then raise exception 'FAIL S9e: % tax subtypes, expected 56', n; end if;

  -- ---- S10: another organization sees and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from public.tax_profiles;
  if n <> 0 then raise exception 'FAIL S10a: organization B can read % tax profile(s) of organization A', n; end if;
  select count(*) into n from public.tax_branches;
  if n <> 0 then raise exception 'FAIL S10b: organization B can read % branch(es) of organization A', n; end if;
  select count(*) into n from public.tax_rates;
  if n <> 0 then raise exception 'FAIL S10c: organization B can read % tax rate(s) of organization A', n; end if;
  ok := false; begin perform public.eta_save_profile('555666777', 'B Co', '4620', 'preprod'); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL S10d: organization B (module off) could save a tax profile'; end if;
  reset role;
  insert into public.org_modules (org_id, module_key) values (ob, 'einvoicing');
  set local role authenticated;
  ok := false; begin perform public.eta_remove_branch(br1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S10e: organization B could remove organization A''s branch'; end if;
  ok := false; begin perform public.eta_save_tax_rate(r_wht, 'T4', 'W004', 99, 'Hijack', false); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S10f: organization B could change organization A''s tax rate'; end if;
  ok := false; begin perform public.eta_set_item_codes(i1, 'GS1', '1', 'EA', null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S10g: organization B could set codes on organization A''s item'; end if;
  ok := false; begin perform public.eta_set_customer_tax(cu, 'P', null, null, null, null, null, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S10h: organization B could change organization A''s customer'; end if;
  perform public.eta_save_profile('555666777', 'B Co', '4620', 'preprod');
  select count(*) into n from public.tax_profiles;
  if n <> 1 then raise exception 'FAIL S10i: organization B sees % profiles, expected only its own', n; end if;

  reset role;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
