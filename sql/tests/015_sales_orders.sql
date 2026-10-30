-- Sales must use the approved inventory request flow; the order is delivered only after issue.
-- Needs 001-019. All fixtures roll back at the deliberate success marker.
do $$
declare u uuid:=gen_random_uuid();m uuid:=gen_random_uuid();x uuid:=gen_random_uuid();o uuid;ob uuid;w uuid;i uuid;c uuid;so uuid;rq uuid;n bigint;s text;ok boolean;
begin
 insert into auth.users(id,aud,role,email) values(u,'authenticated','authenticated','sales-owner@tests.invalid'),(m,'authenticated','authenticated','sales-member@tests.invalid'),(x,'authenticated','authenticated','sales-other@tests.invalid');
 o:=public.bootstrap_organization('Sales Test A','sales-test-a','sales-owner@tests.invalid');ob:=public.bootstrap_organization('Sales Test B','sales-test-b','sales-other@tests.invalid');insert into public.memberships(org_id,user_id,role) values(o,m,'member');insert into public.org_modules(org_id,module_key) values(o,'inventory'),(o,'sales'),(ob,'inventory'),(ob,'sales');
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);perform set_config('request.headers',json_build_object('x-org-id',o)::text,true);set local role authenticated;
 w:=public.inv_create_warehouse('MAIN','Main');i:=public.inv_create_item('S-1','Sales item',null,'piece',10,w);c:=public.sal_create_customer('Customer',null,null,null);so:=(public.sal_create_order(c,w,jsonb_build_array(jsonb_build_object('itemId',i,'qty',3,'unitPriceMinor',250)))->>'id')::uuid;reset role;
 perform set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true);set local role authenticated;rq:=(public.sal_request_stock(so)->>'id')::uuid;reset role;
 select status into s from public.sal_orders where id=so;if s<>'stock_requested' then raise exception 'FAIL S1: order state %',s;end if;
 perform set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true);set local role authenticated;ok:=false;begin perform public.inv_decide_request(rq,'approved');exception when others then ok:=(sqlerrm='FORBIDDEN');end;if not ok then raise exception 'FAIL S2: member approved request';end if;reset role;
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;perform public.inv_decide_request(rq,'approved');reset role;
 select status into s from public.inv_requests where id=rq;if s<>'approved' then raise exception 'FAIL S3: request approval failed';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true);set local role authenticated;perform public.inv_post_issue(rq);reset role;
 select status into s from public.inv_requests where id=rq;if s<>'issued' then raise exception 'FAIL S4: issue failed';end if;
 select count(*) into n from public.audit_log where org_id=o and entity_id=so::text and action in('sales.order.created','sales.order.stock_requested');if n<>2 then raise exception 'FAIL S5: sales audit events %',n;end if;select count(*) into n from public.audit_verify(o);if n<>0 then raise exception 'FAIL S6: audit chain broken';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',x,'role','authenticated')::text,true);perform set_config('request.headers',json_build_object('x-org-id',ob)::text,true);set local role authenticated;select count(*) into n from public.sal_orders;if n<>0 then raise exception 'FAIL S7: cross-org order visible';end if;ok:=false;begin perform public.sal_request_stock(so);exception when others then ok:=(sqlerrm='NOT_FOUND');end;if not ok then raise exception 'FAIL S8: cross-org request succeeded';end if;reset role;
 raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
