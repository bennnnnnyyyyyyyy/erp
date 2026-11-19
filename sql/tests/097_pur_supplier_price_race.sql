-- sql/tests/097_pur_supplier_price_race.sql
-- sql/100 (Codex audit findings 1 and 2): a bill price is never replaced by an order price, also when the row appears between the read and
-- the write (the conflict rule), and a change of source at the same cost writes a history row naming the new source. Always rolls back.
-- Needs sql/001-100. A true two-connection race can't run here; the key lock makes it impossible and the conflict rule is tested directly.

do $$
declare
  u uuid := gen_random_uuid(); o uuid; w uuid; i1 uuid; i2 uuid; sup uuid; bill uuid := gen_random_uuid(); ord uuid := gen_random_uuid();
  r public.pur_supplier_prices; n bigint;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'spr2-o@tests.invalid');
  o := public.bootstrap_organization('Price Race A', 'price-race-a', 'spr2-o@tests.invalid');
  insert into public.org_modules (org_id, module_key) values (o, 'inventory'), (o, 'purchasing'), (o, 'sales');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('RC-1', 'Juice');
  i2 := public.inv_create_item('RC-2', 'Water');
  sup := public.pur_create_supplier('Supplier', null, null, null);
  reset role;

  -- R1: order then bill at the SAME cost: the bill becomes the source, and a history row says so (finding 2)
  perform public.pur__record_supplier_price(o, sup, i1, 'EGP', 1000, 'order', ord, 'PO-0001');
  perform public.pur__record_supplier_price(o, sup, i1, 'EGP', 1000, 'bill', bill, 'BILL-1');
  select * into r from public.pur_supplier_prices where org_id = o and item_id = i1;
  if r.source_kind <> 'bill' or r.source_number <> 'BILL-1' then raise exception 'FAIL R1a: source % %', r.source_kind, r.source_number; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'purchasing.supplier_price.recorded' and entity_id = i1::text
     and after ->> 'sourceNumber' = 'BILL-1' and before ->> 'source' = 'order';
  if n <> 1 then raise exception 'FAIL R1b: % history rows for the order-to-bill change at the same cost', n; end if;

  -- R2: bill then order: the bill is kept, nothing changes, no history row
  select count(*) into n from public.audit_log where org_id = o and action = 'purchasing.supplier_price.recorded';
  perform public.pur__record_supplier_price(o, sup, i1, 'EGP', 900, 'order', gen_random_uuid(), 'PO-0002');
  select * into r from public.pur_supplier_prices where org_id = o and item_id = i1;
  if r.source_kind <> 'bill' or r.last_cost_minor <> 1000 then raise exception 'FAIL R2a: % %', r.source_kind, r.last_cost_minor; end if;
  if (select count(*) from public.audit_log where org_id = o and action = 'purchasing.supplier_price.recorded') <> n then
    raise exception 'FAIL R2b: a history row was written although nothing changed';
  end if;

  -- R3 (finding 1, the conflict rule): the bill's row appears after an order's read saw nothing. Simulated by inserting the bill row
  -- directly, then recording an order for the same key: the on-conflict update must keep the bill.
  insert into public.pur_supplier_prices (org_id, supplier_id, item_id, currency, last_cost_minor, source_kind, source_id, source_number)
  values (o, sup, i2, 'EGP', 2500, 'bill', bill, 'BILL-2');
  perform public.pur__record_supplier_price(o, sup, i2, 'EGP', 2000, 'order', gen_random_uuid(), 'PO-0003');
  select * into r from public.pur_supplier_prices where org_id = o and item_id = i2;
  if r.source_kind <> 'bill' or r.last_cost_minor <> 2500 then raise exception 'FAIL R3: the order replaced the bill (% %)', r.source_kind, r.last_cost_minor; end if;

  -- R4: users still cannot call the recorder directly
  set local role authenticated;
  begin
    perform public.pur__record_supplier_price(o, sup, i1, 'EGP', 1, 'bill', gen_random_uuid(), 'X');
    raise exception 'FAIL R4: a user called the recorder';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
