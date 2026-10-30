-- Proves purchasing isolation, closed direct writes, one-time receipt, stock effect and audit chain.
-- Needs 001-017. Self-contained: its deliberate final error rolls back every row it creates.
do $$
declare ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); oa uuid; ob uuid; w uuid; i uuid; s uuid; po uuid; n bigint; q numeric; ok boolean := false;
begin
  insert into auth.users(id,aud,role,email) values (ua,'authenticated','authenticated','pur-owner@tests.invalid'),(ub,'authenticated','authenticated','pur-member@tests.invalid'),(uc,'authenticated','authenticated','pur-other@tests.invalid');
  oa := public.bootstrap_organization('Purchasing Test A','purchasing-test-a','pur-owner@tests.invalid'); ob := public.bootstrap_organization('Purchasing Test B','purchasing-test-b','pur-other@tests.invalid');
  insert into public.memberships(org_id,user_id,role) values(oa,ub,'member'); insert into public.org_modules(org_id,module_key) values(oa,'inventory'),(oa,'purchasing'),(ob,'inventory'),(ob,'purchasing');
  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true); perform set_config('request.headers',json_build_object('x-org-id',oa)::text,true); set local role authenticated;
  w := public.inv_create_warehouse('MAIN','Main'); i := public.inv_create_item('PUR-001','Receipt item',null,'piece',0,w); s := public.pur_create_supplier('Test Supplier'); po := (public.pur_create_order(s,w,jsonb_build_array(jsonb_build_object('itemId',i,'qty',4,'unitCostMinor',1250)))->>'id')::uuid; reset role;
  select count(*) into n from public.pur_order_lines where order_id=po; if n <> 1 then raise exception 'FAIL S1: expected order line'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated')::text,true); set local role authenticated;
  begin insert into public.pur_orders(org_id,number,supplier_id,warehouse_id,currency,created_by) values(oa,'BAD',s,w,'EGP',ub); exception when insufficient_privilege then ok := true; end; if not ok then raise exception 'FAIL S2: member directly wrote purchase order'; end if;
  perform public.pur_receive_order(po); ok := false; begin perform public.pur_receive_order(po); exception when others then ok := (sqlerrm='INVALID_STATE'); end; if not ok then raise exception 'FAIL S3: order received twice'; end if; reset role;
  select on_hand into q from public.inv_stock_balances where org_id=oa and item_id=i and warehouse_id=w; if q <> 4 then raise exception 'FAIL S4: stock is %, expected 4',q; end if;
  select count(*) into n from public.inv_stock_moves where org_id=oa and item_id=i and kind='receipt' and ref='PO-0001'; if n <> 1 then raise exception 'FAIL S5: expected one receipt ledger row'; end if;
  select count(*) into n from public.audit_log where org_id=oa and entity_id=po::text and action in ('purchasing.order.created','purchasing.order.received'); if n <> 2 then raise exception 'FAIL S6: expected purchase audit rows'; end if;
  select count(*) into n from public.audit_verify(oa); if n <> 0 then raise exception 'FAIL S7: audit chain broken'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',uc,'role','authenticated')::text,true); perform set_config('request.headers',json_build_object('x-org-id',ob)::text,true); set local role authenticated;
  select count(*) into n from public.pur_orders; if n <> 0 then raise exception 'FAIL S8: other org sees orders'; end if; ok := false; begin perform public.pur_cancel_order(po); exception when others then ok := (sqlerrm='NOT_FOUND'); end; if not ok then raise exception 'FAIL S9: other org reached order'; end if;
  reset role; raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
