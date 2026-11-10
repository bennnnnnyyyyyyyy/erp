-- sql/tests/075_customer_details.sql
-- More customer details (sql/081). Always rolls back. Needs sql/001-081.
-- Covers: create and update with the new fields; old five-argument calls still work; bad email, currency and too-long values refused;
-- empty values become null; an update audits before and after; members cannot create or edit; another organization cannot read or
-- change the customer; anonymous cannot call the functions; the table still has no direct writes for users.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; s1 uuid; s2 uuid; r public.sal_customers; n bigint; ok boolean; a jsonb; b jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'cd-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'cd-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'cd-x@tests.invalid');
  o := public.bootstrap_organization('Customer Details A', 'customer-details-a', 'cd-o@tests.invalid');
  ob := public.bootstrap_organization('Customer Details B', 'customer-details-b', 'cd-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- D1: create with details; an old five-argument call still works and leaves the details empty
  s1 := public.sal_create_customer('Nile Retail', 'Hana', 'Cairo', '+201000000001', null, '123-456-789', 'CR-5544', 'Orders@Nile.example', '12 Tahrir St, Cairo',
                                   'Bank Misr', 'EG380019000500000000263180002', 'egp', 'Pays late in August');
  s2 := public.sal_create_customer('Old Style Customer', 'Sami', 'Giza', '+201000000002', null);
  select * into r from public.sal_customers where id = s1;
  if r.tax_number <> '123-456-789' or r.commercial_registry <> 'CR-5544' or r.email <> 'Orders@Nile.example' or r.address <> '12 Tahrir St, Cairo'
     or r.bank_name <> 'Bank Misr' or r.bank_account <> 'EG380019000500000000263180002' or r.default_currency <> 'EGP' or r.notes <> 'Pays late in August' then
    raise exception 'FAIL D1a: details not stored as given (currency upper-cased)';
  end if;
  select * into r from public.sal_customers where id = s2;
  if r.tax_number is not null or r.email is not null or r.default_currency is not null then raise exception 'FAIL D1b: an old-style customer has details'; end if;

  -- D2: rules
  ok := false; begin perform public.sal_create_customer('Bad Mail', null, null, null, null, null, null, 'not an email'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2a: a bad email accepted'; end if;
  ok := false; begin perform public.sal_create_customer('Bad Currency', null, null, null, null, null, null, null, null, null, null, 'EURO'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2b: a bad currency accepted'; end if;
  ok := false; begin perform public.sal_create_customer('Long Notes', null, null, null, null, null, null, null, null, null, null, null, repeat('x', 2001)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2c: too-long notes accepted'; end if;
  ok := false; begin perform public.sal_create_customer('Long Tax', null, null, null, null, repeat('9', 41)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2d: a too-long tax number accepted'; end if;

  -- D3: update keeps and changes details, blanks become null, and the audit row has before and after
  perform public.sal_update_customer(s1, 'Nile Retail', 'Hana', 'Cairo', '+201000000001', '999-000-111', '  ', 'orders@nile.example', null, 'Bank Misr', null, 'USD', null);
  select * into r from public.sal_customers where id = s1;
  if r.tax_number <> '999-000-111' or r.commercial_registry is not null or r.address is not null or r.bank_account is not null or r.notes is not null or r.default_currency <> 'USD' then
    raise exception 'FAIL D3a: update result wrong';
  end if;
  reset role;
  select before, after into a, b from public.audit_log where org_id = o and action = 'sales.customer.updated' and entity_id = s1::text;
  if a ->> 'tax_number' <> '123-456-789' or b ->> 'tax_number' <> '999-000-111' or b ->> 'commercial_registry' is not null or a ->> 'bank_account' is null then
    raise exception 'FAIL D3b: audit before/after wrong: % / %', a, b;
  end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.customer.created' and entity_id in (s1::text, s2::text);
  if n <> 2 then raise exception 'FAIL D3c: create audit rows %', n; end if;
  set local role authenticated;

  -- D4: a member cannot create or edit
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_create_customer('Member Made', null, null, null, null, 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D4a: a member created a customer'; end if;
  ok := false; begin perform public.sal_update_customer(s1, 'Nile Retail', null, null, null, 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D4b: a member edited a customer'; end if;
  ok := false; begin update public.sal_customers set tax_number = 'hack' where id = s1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D4c: a direct update was allowed'; end if;

  -- D5: another organization cannot see or change it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.sal_customers where id in (s1, s2);
  if n <> 0 then raise exception 'FAIL D5a: another organization reads % customers', n; end if;
  ok := false; begin perform public.sal_update_customer(s1, 'Taken Over', null, null, null, 'x'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL D5b: another organization edited our customer'; end if;
  reset role;
  select * into r from public.sal_customers where id = s1;
  if r.name <> 'Nile Retail' or r.tax_number <> '999-000-111' then raise exception 'FAIL D5c: the customer changed'; end if;

  -- D6: anonymous
  if has_function_privilege('anon', 'public.sal_create_customer(text, text, text, text, text, text, text, text, text, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.sal_update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text)', 'execute') then
    raise exception 'FAIL D6: something is open to anonymous users';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
