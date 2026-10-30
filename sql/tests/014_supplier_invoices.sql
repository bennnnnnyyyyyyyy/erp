-- Supplier invoices: received quantities cap billing; partial bills add up; audit and tenant isolation hold.
-- Needs migrations 001-018. Rolls back through the deliberate final exception.
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();x uuid:=gen_random_uuid();o uuid;other uuid;w uuid;i uuid;s uuid;po uuid;pl uuid;inv uuid;n bigint;q numeric;ok boolean;
begin
  insert into auth.users(id,aud,role,email) values(u,'authenticated','authenticated','si-owner@tests.invalid'),(v,'authenticated','authenticated','si-member@tests.invalid'),(x,'authenticated','authenticated','si-other@tests.invalid');
  o:=public.bootstrap_organization('SI Test A','si-test-a','si-owner@tests.invalid');other:=public.bootstrap_organization('SI Test B','si-test-b','si-other@tests.invalid');
  insert into public.memberships(org_id,user_id,role) values(o,v,'member');insert into public.org_modules(org_id,module_key) values(o,'inventory'),(o,'purchasing'),(other,'inventory'),(other,'purchasing');
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);perform set_config('request.headers',json_build_object('x-org-id',o)::text,true);set local role authenticated;
  w:=public.inv_create_warehouse('MAIN','Main');i:=public.inv_create_item('SI-1','Invoice test',null,'piece',0,w);s:=public.pur_create_supplier('Supplier');po:=(public.pur_create_order(s,w,jsonb_build_array(jsonb_build_object('itemId',i,'qty',10,'unitCostMinor',500)))->>'id')::uuid;perform public.pur_receive_order(po);reset role;
  select id into pl from public.pur_order_lines where order_id=po;
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  inv:=public.pur_record_supplier_invoice(s,po,'INV-1',current_date,jsonb_build_array(jsonb_build_object('orderLineId',pl,'qty',4)));
  perform public.pur_record_supplier_invoice(s,po,'INV-2',current_date,jsonb_build_array(jsonb_build_object('orderLineId',pl,'qty',6)));
  ok:=false;begin perform public.pur_record_supplier_invoice(s,po,'INV-3',current_date,jsonb_build_array(jsonb_build_object('orderLineId',pl,'qty',1)));exception when others then ok:=(sqlerrm='BILL_QTY_EXCEEDS_RECEIVED');end;if not ok then raise exception 'FAIL S1: billing beyond receipt was accepted';end if;
  ok:=false;begin perform public.pur_record_supplier_invoice(s,po,'INV-1',current_date,jsonb_build_array(jsonb_build_object('orderLineId',pl,'qty',1)));exception when others then ok:=(sqlerrm='DUPLICATE_INVOICE');end;if not ok then raise exception 'FAIL S2: duplicate supplier invoice number accepted';end if;reset role;
  select coalesce(sum(qty),0) into q from public.pur_supplier_invoice_lines where order_line_id=pl;if q<>10 then raise exception 'FAIL S3: billed qty %, expected 10',q;end if;
  select count(*) into n from public.audit_log where org_id=o and action='purchasing.supplier_invoice.recorded';if n<>2 then raise exception 'FAIL S4: invoice audit rows %',n;end if;
  select count(*) into n from public.audit_verify(o);if n<>0 then raise exception 'FAIL S5: audit chain is broken';end if;
  perform set_config('request.jwt.claims',json_build_object('sub',x,'role','authenticated')::text,true);perform set_config('request.headers',json_build_object('x-org-id',other)::text,true);set local role authenticated;
  select count(*) into n from public.pur_supplier_invoices;if n<>0 then raise exception 'FAIL S6: cross-org invoice visible';end if;
  ok:=false;begin perform public.pur_record_supplier_invoice(s,po,'OTHER-ORG',current_date,jsonb_build_array(jsonb_build_object('orderLineId',pl,'qty',1)));exception when others then ok:=(sqlerrm='NOT_FOUND');end;if not ok then raise exception 'FAIL S7: cross-org invoice write succeeded';end if;
  reset role;raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
