-- sql/tests/105_scanning.sql
-- sql/108: scanning (phase 1d). Always rolls back. Needs sql/001-108.
-- Covers: A1 the four new AI kinds save their key (write-only, in the vault) and need the current notice (v3) to switch on; A2 the
-- reader choice: owners and admins only, only kinds that read documents, audited; A3 ai__provider_state shows all seven kinds and the
-- reader, service role only; A4 usage can be recorded for the new kinds; A5 another company cannot see or change it.
-- B1 attachments: members add, viewers cannot; only in the company's own folder, only on a record of the company; removal is a soft
-- delete by the person who added it or an owner or admin; audited; another company sees nothing. B2 the AI reading log: owners and admins
-- only, no direct writes, another company sees nothing. B3 matching data: supplier by tax number (digits only) and by a word of the
-- name; received orders with what is still to bill, the supplier's own item code; orders still waiting for goods; members refused.
-- B4 (sql/018 rule, master's condition 23 Nov): a bill for goods not yet received is refused by the database, whatever the screen does.

do $$
declare
  u uuid := gen_random_uuid();  -- owner of A
  a uuid := gen_random_uuid();  -- admin of A
  m uuid := gen_random_uuid();  -- member of A
  x uuid := gen_random_uuid();  -- owner of B
  vw uuid := gen_random_uuid(); -- viewer of A
  o uuid; ob uuid; w uuid; i1 uuid; i2 uuid; sup uuid; sup2 uuid; po1 uuid; po2 uuid; pl uuid; bill uuid; att uuid; ex uuid;
  n bigint; ok boolean; j jsonb; p text; p2 text; ib uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sc-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'sc-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'sc-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'sc-x@tests.invalid'),
    (vw, 'authenticated', 'authenticated', 'sc-v@tests.invalid');
  o := public.bootstrap_organization('Scanning A', 'scanning-a', 'sc-o@tests.invalid');
  ob := public.bootstrap_organization('Scanning B', 'scanning-b', 'sc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member'), (o, vw, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- ---- A1: new AI kinds
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.core__ai_notice_version() <> 'v3' then raise exception 'FAIL A1a: the notice is not v3'; end if;
  j := public.core_save_provider_fields('anthropic', '{"api_key": "sk-ant-TEST-111", "model": "claude-haiku-5-5"}');
  if not (j -> 'savedFields') ? 'api_key' then raise exception 'FAIL A1b: the Claude key was not saved'; end if;
  perform public.core_save_provider_fields('grok', '{"api_key": "xai-TEST-222"}');
  ok := false; begin perform public.core_save_integration('grok', true, 'live', '{}'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL A1c: Grok switched on without its model'; end if;
  ok := false; begin perform public.core_save_integration('anthropic', true, 'live', '{}'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL A1d: Claude switched on without the AI notice'; end if;
  ok := false; begin perform public.core_set_ai_consent(true, 'v2'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL A1e: consent to the old notice v2 accepted'; end if;
  perform public.core_set_ai_consent(true, 'v3');
  perform public.core_save_integration('anthropic', true, 'live', '{}');
  -- the key is not readable by users: settings show field names only
  select count(*) into n from public.core_integrations where org_id = o and kind = 'anthropic' and settings::text like '%sk-ant-TEST%';
  if n <> 0 then raise exception 'FAIL A1f: the key is readable in settings'; end if;

  -- ---- A2: the reader choice
  ok := false; begin perform public.core_set_ai_reader('elevenlabs'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL A2a: ElevenLabs chosen to read bills'; end if;
  perform public.core_set_ai_reader('anthropic');
  if (public.core_ai_status() ->> 'reader') is distinct from 'anthropic' then raise exception 'FAIL A2b: the reader is not shown'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.core_set_ai_reader('gemini');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_ai_reader('openai'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL A2c: a member chose the reader'; end if;
  ok := false; begin perform public.ai__provider_state(o); exception when others then ok := (sqlstate = '42501'); end;
  if not ok then raise exception 'FAIL A3a: a user read the AI state (keys)'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'core.ai.reader_changed';
  if n <> 2 then raise exception 'FAIL A2d: reader changes not audited (% rows)', n; end if;

  -- ---- A3: the server's view
  j := public.ai__provider_state(o);
  if (j ->> 'reader') is distinct from 'gemini' then raise exception 'FAIL A3b: reader %', j ->> 'reader'; end if;
  if not ((j -> 'providers') ?& array['openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter']) then
    raise exception 'FAIL A3c: kinds missing from the state';
  end if;
  if (j -> 'providers' -> 'anthropic' ->> 'enabled')::boolean is not true or (j -> 'providers' -> 'anthropic' -> 'credentials' ->> 'api_key') <> 'sk-ant-TEST-111' then
    raise exception 'FAIL A3d: Claude state %', j -> 'providers' -> 'anthropic';
  end if;

  -- ---- A4: usage for a new kind
  perform public.ai__record_usage(o, u, 'anthropic', 'bill_scan', 'claude-haiku-5-5', 900, 40, 0, 0, true, true);

  -- ---- A5: company B sees none of it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.core_integrations where org_id = o;
  if n <> 0 then raise exception 'FAIL A5a: B sees A''s integrations'; end if;
  if (public.core_ai_status() ->> 'reader') is not null then raise exception 'FAIL A5b: B has A''s reader'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);


  -- ---- setup: a supplier with a tax number, two items (one with the supplier's own code), a received order and a waiting one
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('CH-1', 'Caustic soda 25kg');
  i2 := public.inv_create_item('CH-2', 'Citric acid');
  sup := public.pur_create_supplier('Nile Chemicals', null, null, null, null, '100-200-300');
  sup2 := public.pur_create_supplier('Delta Paper', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  perform public.inv_set_party_item_code(i1, 'supplier', sup, 'NC-77', 'Soda caustic');
  po1 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 10, 'unitCostMinor', 50000),
                                                              jsonb_build_object('itemId', i2, 'qty', 4, 'unitCostMinor', 20000))) ->> 'id')::uuid;
  perform public.pur_receive_order(po1);
  po2 := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i2, 'qty', 3, 'unitCostMinor', 20000))) ->> 'id')::uuid;

  -- ---- B3: matching data
  j := public.pur_bill_scan_candidates('TIN 100200300', 'something else', null);
  if (j ->> 'supplierId')::uuid is distinct from sup then raise exception 'FAIL B3a: tax number did not find the supplier: %', j -> 'suppliers'; end if;
  if jsonb_array_length(j -> 'receivedOrders') <> 1 or (j -> 'receivedOrders' -> 0 ->> 'id')::uuid <> po1 then raise exception 'FAIL B3b: received orders %', j -> 'receivedOrders'; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'receivedOrders' -> 0 -> 'lines') l where l ->> 'supplierCode' = 'NC-77' and (l ->> 'receivedQty')::numeric = 10 and (l ->> 'billedQty')::numeric = 0) then
    raise exception 'FAIL B3c: lines %', j -> 'receivedOrders' -> 0 -> 'lines';
  end if;
  if jsonb_array_length(j -> 'waitingOrders') <> 1 or (j -> 'waitingOrders' -> 0 ->> 'id')::uuid <> po2 then raise exception 'FAIL B3d: waiting orders %', j -> 'waitingOrders'; end if;
  j := public.pur_bill_scan_candidates(null, 'DELTA paper co.', null);
  if (j ->> 'supplierId') is not null or not exists (select 1 from jsonb_array_elements(j -> 'suppliers') e where (e ->> 'id')::uuid = sup2 and e ->> 'how' = 'name') then
    raise exception 'FAIL B3e: name search %', j;
  end if;
  j := public.pur_bill_scan_candidates(null, null, sup2);
  if (j ->> 'supplierId')::uuid is distinct from sup2 or jsonb_array_length(j -> 'receivedOrders') <> 0 then raise exception 'FAIL B3f: chosen supplier %', j; end if;

  -- ---- B4: no received goods, no bill (sql/018 rule)
  select id into pl from public.pur_order_lines where order_id = po2;
  ok := false; begin perform public.pur_record_supplier_invoice(sup, po2, 'NC-9', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl, 'qty', 3)));
  exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL B4: a bill was saved for goods not yet received'; end if;

  -- a real bill for the received order (what Save does)
  select id into pl from public.pur_order_lines where order_id = po1 and item_id = i1;
  bill := public.pur_record_supplier_invoice(sup, po1, 'NC-1001', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pl, 'qty', 10)));
  j := public.pur_bill_scan_candidates('100200300', null, null);
  if exists (select 1 from jsonb_array_elements(j -> 'receivedOrders' -> 0 -> 'lines') l where l ->> 'supplierCode' = 'NC-77' and (l ->> 'billedQty')::numeric <> 10) then
    raise exception 'FAIL B3g: billed quantity not shown';
  end if;

  -- ---- B2: the AI reading log
  ex := public.pur_record_bill_scan('anthropic', 'claude-haiku-5-5', 'done', '{"billNumber": "NC-1001"}', null, repeat('a', 64), 'image/jpeg', 1000, 0);
  select count(*) into n from public.core_ai_extractions where id = ex and status = 'done' and result ->> 'billNumber' = 'NC-1001';
  if n <> 1 then raise exception 'FAIL B2a: extraction not readable by the owner'; end if;
  ok := false; begin insert into public.core_ai_extractions (org_id, kind, file_sha256, mime, bytes, provider, status, created_by)
    values (o, 'supplier_bill', repeat('b', 64), 'image/png', 1, 'openai', 'done', u); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2b: a user wrote the log directly'; end if;

  -- ---- B1: attachments
  p := format('org/%s/supplier_bill/%s/%s.jpg', o, bill, gen_random_uuid());
  p2 := format('org/%s/supplier_bill/%s/%s.pdf', o, bill, gen_random_uuid());
  -- Where Supabase Storage exists (CI, live), core_add_attachment also checks that the file was really uploaded: put the two test
  -- files in its index (as the test runner; rolled back), and check that a path with no file is refused.
  if to_regclass('storage.objects') is not null then
    reset role;
    execute 'insert into storage.objects (bucket_id, name) values (''doc-files'', $1), (''doc-files'', $2)' using p, p2;
    set local role authenticated;
    ok := false; begin perform public.core_add_attachment('supplier_bill', bill, format('org/%s/supplier_bill/%s/%s.jpg', o, bill, gen_random_uuid()), 'x.jpg', 'image/jpeg', 10, repeat('c', 64));
    exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
    if not ok then raise exception 'FAIL B1m: a file that was never uploaded was accepted'; end if;
  end if;
  ok := false; begin perform public.core_add_attachment('supplier_bill', bill, format('org/%s/supplier_bill/%s/%s.jpg', ob, bill, gen_random_uuid()), 'x.jpg', 'image/jpeg', 10, repeat('c', 64));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL B1a: a file in another company''s folder was accepted'; end if;
  ok := false; begin perform public.core_add_attachment('supplier_bill', gen_random_uuid(), p, 'x.jpg', 'image/jpeg', 10, repeat('c', 64));
  exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL B1b: a file on a record that does not exist was accepted'; end if;
  ok := false; begin perform public.core_add_attachment('supplier_bill', bill, 'org/x/../../etc.jpg', 'x.jpg', 'image/jpeg', 10, repeat('c', 64));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL B1c: a bad path was accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  att := public.core_add_attachment('supplier_bill', bill, p, 'bill.jpg', 'image/jpeg', 1000, repeat('a', 64));
  ok := false; begin perform public.core_add_attachment('supplier', sup, format('org/%s/supplier/%s/%s.pdf', o, bill, gen_random_uuid()), null, 'text/html', 10, repeat('c', 64));
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B1d: a file that is not a picture or PDF was accepted'; end if;
  -- the member cannot read the AI log, nor scan
  select count(*) into n from public.core_ai_extractions;
  if n <> 0 then raise exception 'FAIL B2c: a member reads the AI log'; end if;
  ok := false; begin perform public.pur_bill_scan_candidates('100200300', null, null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL B3h: a member read the matching data'; end if;
  ok := false; begin perform public.pur_record_bill_scan('openai', 'm', 'done', '{}', null, repeat('a', 64), 'image/jpeg', 1, 0); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL B2d: a member logged a scan'; end if;
  -- the viewer reads, cannot add
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  select count(*) into n from public.core_attachments where entity_id = bill;
  if n <> 1 then raise exception 'FAIL B1e: the viewer does not see the attachment'; end if;
  ok := false; begin perform public.core_add_attachment('supplier_bill', bill, format('org/%s/supplier_bill/%s/%s.png', o, bill, gen_random_uuid()), null, 'image/png', 10, repeat('d', 64));
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL B1f: a viewer added a file'; end if;
  if public.core__storage_allowed(p, true) or not public.core__storage_allowed(p, false) then raise exception 'FAIL B1g: viewer storage rights'; end if;
  ok := false; begin insert into public.core_attachments (org_id, entity_type, entity_id, file_path, mime, bytes, sha256, uploaded_by)
    values (o, 'supplier_bill', bill, p || 'x', 'image/jpeg', 1, repeat('e', 64), vw); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B1h: a user wrote attachments directly'; end if;
  -- the admin may remove the member's file; the row disappears from reads (soft delete)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.core_remove_attachment(att);
  select count(*) into n from public.core_attachments where id = att;
  if n <> 0 then raise exception 'FAIL B1i: a removed file is still listed'; end if;
  reset role;
  select count(*) into n from public.core_attachments where id = att and deleted_at is not null and deleted_by = a;
  if n <> 1 then raise exception 'FAIL B1j: removal is not a soft delete'; end if;
  select count(*) into n from public.audit_log where org_id = o and action in ('core.attachment.added', 'core.attachment.removed', 'purchasing.bill.scanned');
  if n <> 3 then raise exception 'FAIL B1k: audit rows %', n; end if;
  -- a member may not remove someone else's file
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  att := public.core_add_attachment('supplier_bill', bill, p2, 'b.pdf', 'application/pdf', 5, repeat('f', 64));
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_remove_attachment(att); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL B1l: a member removed someone else''s file'; end if;

  -- ---- B5: company B sees no files and no AI log; cannot use A's folder
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.core_attachments;
  if n <> 0 then raise exception 'FAIL B5a: B sees A''s files'; end if;
  select count(*) into n from public.core_ai_extractions;
  if n <> 0 then raise exception 'FAIL B5b: B sees A''s AI log'; end if;
  if public.core__storage_allowed(p, false) then raise exception 'FAIL B5c: B may read A''s folder'; end if;
  ok := false; begin perform public.core_add_attachment('supplier_bill', bill, p, null, 'image/jpeg', 10, repeat('a', 64)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL B5d: B attached into A''s folder'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);


  -- ---- C: barcodes (one per item, unique in each company)
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_set_item_barcode(i1, ' 6221234567890 ');
  select count(*) into n from public.inv_items where id = i1 and barcode = '6221234567890';
  if n <> 1 then raise exception 'FAIL C1: the member could not set a barcode (or it was not trimmed)'; end if;
  ok := false; begin perform public.inv_set_item_barcode(i2, '6221234567890'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL C2: two items of one company got the same barcode'; end if;
  ok := false; begin perform public.inv_set_item_barcode(i2, 'has space'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C3: a barcode with a space was accepted'; end if;
  ok := false; begin update public.inv_items set barcode = 'X1' where id = i2; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL C4: a user wrote a barcode directly'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.inv_set_item_barcode(i2, 'V-1'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C5: a viewer set a barcode'; end if;
  select count(*) into n from public.inv_items where barcode = '6221234567890';
  if n <> 1 then raise exception 'FAIL C6: the viewer cannot find the item by its barcode'; end if;
  -- company B: does not see A's barcode, cannot change A's item, may use the same barcode for its own item
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.inv_items where barcode = '6221234567890';
  if n <> 0 then raise exception 'FAIL C7: B finds A''s item by barcode'; end if;
  ok := false; begin perform public.inv_set_item_barcode(i1, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL C8: B changed A''s barcode'; end if;
  ib := public.inv_create_item('B-1', 'B item');
  perform public.inv_set_item_barcode(ib, '6221234567890');
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  -- clearing; both changes audited
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.inv_set_item_barcode(i1, '');
  reset role;
  select count(*) into n from public.inv_items where id = i1 and barcode is null;
  if n <> 1 then raise exception 'FAIL C9: a blank barcode did not clear it'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'inventory.item.barcode_changed';
  if n <> 2 then raise exception 'FAIL C10: barcode changes audited % times', n; end if;

  -- ---- Z: audit chain
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL Z: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
