-- sql/tests/113_party_detail_rules.sql
-- Customer and supplier detail rules (sql/116). Always rolls back. Needs sql/001-116.
-- Covers: R1 the rule functions (email, registry number, bank account / IBAN, Arabic digits); C1 a customer refuses a bad email, a
-- tax number with letters and a short Egyptian IBAN, and takes good ones; S1 the same for a supplier.

do $$
declare
  u uuid := gen_random_uuid(); o uuid; c uuid; s uuid; ok boolean; j jsonb;
begin
  -- R1
  foreach j in array array['["lskalmsalsasm.,ma", false]', '["a@b", false]', '["a b@c.com", false]', '["x@y.co", true]', '["", true]']::jsonb[] loop
    if public.core__email_ok(j ->> 0) <> (j ->> 1)::boolean then raise exception 'FAIL R1a: email %', j ->> 0; end if;
  end loop;
  if not public.core__registry_ok('١٢٣ ٤٥٦ ٧٨٩') or public.core__registry_ok('12a') then raise exception 'FAIL R1b: registry rule'; end if;
  if not public.core__bank_account_ok('EG38 0019 0005 0000 0000 2631 8000 2') or public.core__bank_account_ok('EG38 0019')
     or not public.core__bank_account_ok('1234 5678') or public.core__bank_account_ok('hello') then
    raise exception 'FAIL R1c: bank account rule';
  end if;

  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'pdr@tests.invalid');
  o := public.bootstrap_organization('Detail rules', 'detail-rules', 'pdr@tests.invalid');
  insert into public.sal_customers (org_id, name, code) values (o, 'Nile', 'C-1') returning id into c;
  insert into public.pur_suppliers (org_id, name, code) values (o, 'Delta', 'S-1') returning id into s;

  -- C1: customer
  ok := false; begin update public.sal_customers set email = 'lskalmsalsasm.,ma' where id = c; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL C1a: a bad customer email was saved'; end if;
  ok := false; begin update public.sal_customers set tax_number = '12A456789' where id = c; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL C1b: a tax number with letters was saved'; end if;
  ok := false; begin update public.sal_customers set bank_account = 'EG38 0019' where id = c; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL C1c: a short Egyptian IBAN was saved'; end if;
  update public.sal_customers set email = 'buyer@nile.com.eg', tax_number = '123-456-789', commercial_registry = '98765',
                                  bank_account = 'EG380019000500000000263180002' where id = c;

  -- S1: supplier
  ok := false; begin update public.pur_suppliers set email = 'not an email' where id = s; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL S1a: a bad supplier email was saved'; end if;
  update public.pur_suppliers set email = 'sales@delta.io', bank_account = '1234567890' where id = s;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
