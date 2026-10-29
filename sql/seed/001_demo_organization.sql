-- sql/seed/001_demo_organization.sql
-- DEMO DATA, not a migration. Creates the organization "Demo Trading Co." for the live demo (orders.md, workstream C)
-- with three existing Supabase Auth users and a little stock and history, all written through the real functions
-- (sql/006), so the audit log and the stock ledger are genuine.
--
--   chris.johnson.wiz@gmail.com   owner
--   joseph.brown.wiz@gmail.com    admin   (the manager who approves)
--   grant.holden.wiz@gmail.com    member  (the requester)
--
-- The three users must already exist in Supabase Authentication (Add user, auto-confirm). Nothing here creates users
-- or sets passwords. Safe to rerun: it does nothing if the organization already exists. It never deletes anything.
-- Needs sql/001 to sql/006. Run: supabase db query --linked -f sql/seed/001_demo_organization.sql

do $$
declare
  uo uuid;  -- owner
  um uuid;  -- manager (admin)
  ur uuid;  -- requester (member)
  oid uuid;
  w1 uuid;
  w2 uuid;
  i1 uuid;
  i2 uuid;
  i3 uuid;
  i4 uuid;
  i5 uuid;
  r1 uuid;
begin
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  select id into um from auth.users where lower(email) = 'joseph.brown.wiz@gmail.com';
  select id into ur from auth.users where lower(email) = 'grant.holden.wiz@gmail.com';
  if uo is null or um is null or ur is null then
    raise exception 'Create the three users in Supabase Authentication first (missing: %)',
      concat_ws(', ', case when uo is null then 'chris.johnson.wiz@gmail.com' end,
                      case when um is null then 'joseph.brown.wiz@gmail.com' end,
                      case when ur is null then 'grant.holden.wiz@gmail.com' end);
  end if;

  if exists (select 1 from public.organizations where slug = 'demo-trading') then
    raise notice 'Demo organization already exists; nothing to do.';
    return;
  end if;

  oid := public.bootstrap_organization('Demo Trading Co.', 'demo-trading', 'chris.johnson.wiz@gmail.com');
  update public.organizations set default_currency = 'EGP', timezone = 'Africa/Cairo', settings = settings || '{"date_format": "DD/MM/YYYY"}'::jsonb where id = oid;
  insert into public.memberships (org_id, user_id, role, invited_by) values (oid, um, 'admin', uo), (oid, ur, 'member', uo);
  insert into public.org_modules (org_id, module_key, enabled_by) values (oid, 'inventory', uo);

  -- As the owner: warehouses, items and opening stock.
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oid)::text, true);

  w1 := public.inv_create_warehouse('MAIN', 'Main warehouse, Cairo', 'المستودع الرئيسي، القاهرة');
  w2 := public.inv_create_warehouse('ALEX', 'Alexandria depot', 'مخزن الإسكندرية');

  i1 := public.inv_create_item('GLV-001', 'Safety gloves', 'قفازات أمان', 'pair', 120, w1);
  i2 := public.inv_create_item('TAP-002', 'Packing tape', 'شريط تغليف', 'roll', 60, w1);
  i3 := public.inv_create_item('CRT-003', 'Carton 40x30', 'كرتونة 40×30', 'piece', 500, w1);
  i4 := public.inv_create_item('WRP-004', 'Pallet wrap', 'فيلم تغليف بالتات', 'roll', 24, w1);
  i5 := public.inv_create_item('LBL-005', 'Barcode labels', 'ملصقات باركود', 'box', 30, w1);
  perform public.inv_receive_stock(i1, w2, 40, 'opening stock');
  perform public.inv_receive_stock(i3, w2, 150, 'opening stock');
  perform public.inv_receive_stock(i4, w2, 10, 'opening stock');
  perform public.inv_receive_stock(i5, w2, 5, 'opening stock');

  -- History: the requester asks, the manager approves, the requester issues.
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  r1 := (public.inv_submit_request(w1, 'Dispatch to Giza customer, order 4471',
          jsonb_build_array(jsonb_build_object('itemId', i3, 'qty', 40), jsonb_build_object('itemId', i2, 'qty', 6))) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  perform public.inv_decide_request(r1, 'approved', 'OK to ship');
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  perform public.inv_post_issue(r1);

  -- One request left waiting, so the manager has something to approve in the demo.
  perform public.inv_submit_request(w1, 'Gloves for the night shift', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 30)));
end $$;
