-- sql/tests/091_inv_item_group_read.sql
-- Regression for sql/096: a signed-in member can read inv_items.group_id (inv_items uses column-level grants; sql/095 added the column
-- without one and every item list failed). Also: a member of another company still sees none of the rows. Always rolls back.
-- Needs sql/001-096.

do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); oa uuid; ob uuid; w uuid; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'igr-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'igr-b@tests.invalid');
  oa := public.bootstrap_organization('Group Read A', 'group-read-a', 'igr-a@tests.invalid');
  ob := public.bootstrap_organization('Group Read B', 'group-read-b', 'igr-b@tests.invalid');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (ob, 'inventory');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  perform public.inv_create_item(p_sku => 'GR-1', p_name => 'Grouped item', p_warehouse_id => w);

  -- G1: the item list the API asks for, group_id included, as the signed-in user
  ok := true;
  begin
    select count(*) into n from (select id, sku, name, group_id from public.inv_items where org_id = oa) q;
  exception when insufficient_privilege then ok := false; end;
  if not ok then raise exception 'FAIL G1a: a signed-in user cannot read inv_items.group_id (missing column grant)'; end if;
  if n <> 1 then raise exception 'FAIL G1b: % items, expected 1', n; end if;

  -- G2: another company's member sees none of A's items
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  select count(*) into n from (select id, group_id from public.inv_items where org_id = oa) q;
  if n <> 0 then raise exception 'FAIL G2: company B sees % of company A''s items', n; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
