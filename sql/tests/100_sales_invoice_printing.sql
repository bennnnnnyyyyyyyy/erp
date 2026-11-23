-- sql/tests/100_sales_invoice_printing.sql
-- sql/103: invoice printing (INVOICE_PRINTING_PLAN.md, step 1c). Always rolls back. Needs sql/001-103.
-- Covers: P1 numbers per type and year; P2 drafts (no number, nothing in sal_invoices, members cannot, replace lines, over-invoicing
-- refused, issue gives the number, an issued or discarded draft never changes); P3 issued invoices are locked (date, number, lines,
-- delete, un-void), voiding still works; P4 document settings (owners and admins, checks, audit); P5 print data (draft amounts,
-- invoice, note, settings); P6 links (members may, same token again, a new one stops the old, switch off, void stops it, anon only
-- reads); P7 send records (append-only, drafts refused); P8 isolation; P9 no direct writes; P10 audit rows and chain.

do $$
declare
  u uuid := gen_random_uuid();  -- owner of A
  m uuid := gen_random_uuid();  -- member of A
  x uuid := gen_random_uuid();  -- owner of B
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid;
  d1 uuid; d2 uuid; d3 uuid; inv1 uuid; inv2 uuid; inv0 uuid; note1 uuid; il1 uuid;
  y int := extract(year from current_date)::int;
  n bigint; ok boolean; j jsonb; t1 text; t2 text; t3 text; s text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ip-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'ip-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'ip-x@tests.invalid');
  o := public.bootstrap_organization('Inv Print A', 'inv-print-a', 'ip-o@tests.invalid');
  ob := public.bootstrap_organization('Inv Print B', 'inv-print-b', 'ip-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('IP-1', 'Print item', null, 'piece', 50, w);
  c := public.sal_create_customer('Print customer', null, 'Cairo', '+201000000000');
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 20, 'unitPriceMinor', 250))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  -- deliver it: member requests, owner approves, member issues
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;

  -- ---- P2: drafts
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P2a: a member saved a draft invoice'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 3)));
  d1 := (j ->> 'id')::uuid;
  select count(*) into n from public.sal_invoices where org_id = o;
  if n <> 0 then raise exception 'FAIL P2b: a draft made % row(s) in sal_invoices', n; end if;
  -- the same draft again: lines replaced; the same order line twice is added up (2 + 2 = 4)
  perform public.sal_save_invoice_draft(d1, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 2), jsonb_build_object('orderLineId', ol, 'qty', 2)));
  select sum(qty) into n from public.sal_invoice_draft_lines where draft_id = d1;
  if n <> 4 then raise exception 'FAIL P2c: draft quantity % (expected 4)', n; end if;
  ok := false; begin perform public.sal_save_invoice_draft(d1, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 21))); exception when others then ok := (sqlerrm = 'INVOICE_QTY_EXCEEDS_DELIVERED'); end;
  if not ok then raise exception 'FAIL P2d: a draft above the delivered quantity was saved'; end if;
  ok := false; begin perform public.sal_save_invoice_draft(d1, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', gen_random_uuid(), 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P2e: a line from another order was saved'; end if;

  -- ---- P5a: print data of a draft: no number, amounts as issue would make them
  j := public.sal_doc_print_data('draft', d1);
  if j -> 'document' ->> 'number' is not null or j -> 'document' ->> 'type' <> 'draft' then raise exception 'FAIL P5a: draft print %', j -> 'document'; end if;
  if (j -> 'document' ->> 'netMinor')::bigint <> 1000 or (j -> 'document' ->> 'grossMinor')::bigint <> (j -> 'document' ->> 'netMinor')::bigint + (j -> 'document' ->> 'taxMinor')::bigint then
    raise exception 'FAIL P5b: draft amounts %', j -> 'document';
  end if;
  if j -> 'customer' ->> 'name' <> 'Print customer' or jsonb_array_length(j -> 'lines') <> 1 or j -> 'lines' -> 0 ->> 'sku' <> 'IP-1' then
    raise exception 'FAIL P5c: draft customer or lines %', j;
  end if;
  if j -> 'settings' ->> 'language' <> 'ar' or j -> 'settings' ->> 'digits' <> 'latn' then raise exception 'FAIL P5d: default settings %', j -> 'settings'; end if;
  if j::text ~ 'avg_cost|avgCost' then raise exception 'FAIL P5e: print data shows cost'; end if;

  -- ---- P1 and P2: issue gives the number; the draft is then closed
  j := public.sal_issue_invoice_draft(d1);
  inv1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> format('INV-%s-00001', y) then raise exception 'FAIL P1a: first number %', j ->> 'number'; end if;
  select gross_minor - tax_minor into n from public.sal_invoices where id = inv1;
  if n <> 1000 then raise exception 'FAIL P2f: issued net % (expected 1000)', n; end if;
  select status into s from public.sal_invoice_drafts where id = d1;
  if s <> 'issued' then raise exception 'FAIL P2g: draft status %', s; end if;
  ok := false; begin perform public.sal_issue_invoice_draft(d1); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P2h: a draft was issued twice'; end if;
  ok := false; begin perform public.sal_save_invoice_draft(d1, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P2i: an issued draft was changed'; end if;
  -- a second invoice (straight, as the API's older route still does) and one dated last year: own sequence per year
  inv2 := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1)))) ->> 'id')::uuid;
  select number into s from public.sal_invoices where id = inv2;
  if s <> format('INV-%s-00002', y) then raise exception 'FAIL P1b: second number %', s; end if;
  j := public.sal_create_invoice(so, make_date(y - 1, 6, 1), jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1)));
  inv0 := (j ->> 'id')::uuid;
  if j ->> 'number' <> format('INV-%s-00001', y - 1) then raise exception 'FAIL P1c: last year''s number %', j ->> 'number'; end if;
  -- discard
  d2 := (public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))) ->> 'id')::uuid;
  perform public.sal_discard_invoice_draft(d2);
  ok := false; begin perform public.sal_issue_invoice_draft(d2); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'INVALID_STATE')); end;
  if not ok then raise exception 'FAIL P2j: a discarded draft was issued'; end if;
  d3 := (public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))) ->> 'id')::uuid;

  -- a credit note on invoice 1 (the owner is the only owner or admin, so it is self-approved, D1)
  select id into il1 from public.sal_invoice_lines where invoice_id = inv1;
  j := public.sal_submit_note(inv1, 'credit', 'Damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1)));
  note1 := (j ->> 'id')::uuid;
  if j ->> 'number' !~ '^CN-[0-9]{4}-00001$' then raise exception 'FAIL P1d: note number %', j ->> 'number'; end if;
  perform public.sal_decide_note(note1, 'approved');
  reset role;

  -- ---- P3: issued invoices are locked (even for the table owner, without the fixture setting)
  ok := false; begin update public.sal_invoices set invoice_date = invoice_date - 1 where id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3a: an issued invoice''s date changed'; end if;
  ok := false; begin update public.sal_invoices set number = 'X-1' where id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3b: an issued invoice''s number changed'; end if;
  ok := false; begin delete from public.sal_invoices where id = inv2; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3c: an issued invoice was deleted'; end if;
  ok := false; begin update public.sal_invoice_lines set qty = 9 where invoice_id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3d: an issued invoice''s line changed'; end if;
  ok := false; begin delete from public.sal_invoice_lines where invoice_id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3e: an issued invoice''s line was deleted'; end if;
  ok := false; begin update public.sal_invoice_drafts set invoice_date = invoice_date - 1 where id = d1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3f: an issued draft changed'; end if;
  -- the fixture switch never helps an app role: a signed-in caller who sets it is still refused
  perform set_config('erp.allow_issued_fix', 'on', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.sal_invoices set invoice_date = invoice_date - 1 where id = inv1; get diagnostics n = row_count; ok := (n = 0);
  exception when insufficient_privilege then ok := true; when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3h: a signed-in caller used the fixture switch'; end if;
  reset role;
  perform set_config('erp.allow_issued_fix', '', true);

  -- ---- P4: document settings
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_save_doc_settings('{"footerText":"x"}'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P4a: a member changed the document settings'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_save_doc_settings('{"logo":"data:image/svg+xml;base64,PHN2Zz4="}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P4b: an SVG logo was accepted'; end if;
  ok := false; begin perform public.core_save_doc_settings('{"colour":"red"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P4c: an unknown setting was accepted'; end if;
  ok := false; begin perform public.core_save_doc_settings('{"digits":"roman"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P4d: an unknown digits choice was accepted'; end if;
  ok := false; begin perform public.core_save_doc_settings('{"marginTopMm":500}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P4e: a 500 mm margin was accepted'; end if;
  ok := false; begin perform public.core_save_doc_settings(jsonb_build_object('logo', 'data:image/png;base64,' || repeat('A', 420000))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P4f: an oversized logo was accepted'; end if;
  j := public.core_save_doc_settings('{"logo":"data:image/png;base64,iVBORw0KGgo=","footerText":"  Thank you  ","digits":"arab","language":"both","layout":"detailed","sendMode":"queue"}');
  if jsonb_array_length(j -> 'changed') < 5 then raise exception 'FAIL P4g: changed %', j; end if;
  j := public.core_save_doc_settings('{"digits":"arab"}');
  if jsonb_array_length(j -> 'changed') <> 0 then raise exception 'FAIL P4h: no change reported as %', j; end if;
  j := public.sal_doc_print_data('invoice', inv1);
  if j -> 'settings' ->> 'footerText' <> 'Thank you' or j -> 'settings' ->> 'digits' <> 'arab' or j -> 'settings' ->> 'logo' not like 'data:image/png;base64,%' then
    raise exception 'FAIL P4i: settings in the print %', j -> 'settings';
  end if;
  -- ---- P5: invoice and note print data
  if j -> 'document' ->> 'number' <> format('INV-%s-00001', y) or j -> 'document' ->> 'status' <> 'issued' then raise exception 'FAIL P5f: invoice print %', j -> 'document'; end if;
  j := public.sal_doc_print_data('note', note1);
  if j -> 'document' ->> 'kind' <> 'credit' or j -> 'document' ->> 'invoiceNumber' <> format('INV-%s-00001', y) or jsonb_array_length(j -> 'lines') <> 1 then
    raise exception 'FAIL P5g: note print %', j -> 'document';
  end if;
  ok := false; begin perform public.sal_doc_print_data('invoice', gen_random_uuid()); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P5h: a missing invoice printed'; end if;
  reset role;

  -- ---- P6: links
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_doc_link('draft', d3); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P6a: a draft got a link'; end if;
  t1 := public.sal_doc_link('invoice', inv1) ->> 'token';
  if t1 !~ '^[0-9a-f]{64}$' then raise exception 'FAIL P6b: token %', t1; end if;
  t2 := public.sal_doc_link('invoice', inv1) ->> 'token';
  if t2 <> t1 then raise exception 'FAIL P6c: asking again made a new link'; end if;
  t2 := public.sal_doc_link('invoice', inv1, true) ->> 'token';
  if t2 = t1 then raise exception 'FAIL P6d: a new link kept the old token'; end if;
  t3 := public.sal_doc_link('note', note1) ->> 'token';
  ok := false; begin perform count(*) from public.sal_doc_links; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P6e: users can read the links table (and its tokens)'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false; begin perform public.sal_doc_link_print(t1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P6f: the replaced link still works'; end if;
  j := public.sal_doc_link_print(t2);
  if j -> 'document' ->> 'number' <> format('INV-%s-00001', y) then raise exception 'FAIL P6g: link print %', j -> 'document'; end if;
  j := public.sal_doc_link_print(t3);
  if j -> 'document' ->> 'kind' <> 'credit' then raise exception 'FAIL P6h: note link print %', j -> 'document'; end if;
  ok := false; begin perform public.sal_doc_link_print('nothex'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P6i: a malformed token was not refused'; end if;
  ok := false; begin perform public.sal_doc_link('invoice', inv1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P6j: anonymous made a link'; end if;
  ok := false; begin perform public.sal_doc_print_data('invoice', inv1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P6k: anonymous read print data without a token'; end if;
  reset role;
  select read_count into n from public.sal_doc_links where token = t2;
  if n <> 1 then raise exception 'FAIL P6l: read count % (expected 1)', n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sal_revoke_doc_link('note', note1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false; begin perform public.sal_doc_link_print(t3); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P6m: a switched-off link still works'; end if;
  reset role;

  -- ---- P7: send records
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sal_record_doc_send('invoice', inv1, 'whatsapp', 'device', '+201000000000', 'simple', 'ar');
  perform public.sal_record_doc_send('invoice', inv1, 'download', 'device', null, 'eta', 'ar');
  ok := false; begin perform public.sal_record_doc_send('invoice', inv1, 'fax', 'device', null, null, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P7a: an unknown channel was recorded'; end if;
  ok := false; begin perform public.sal_record_doc_send('draft', d3, 'print', 'device', null, null, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P7b: a draft send was recorded'; end if;
  select count(*) into n from public.core_doc_sends where doc_id = inv1;
  if n <> 2 then raise exception 'FAIL P7c: % send records (expected 2)', n; end if;
  ok := false; begin insert into public.core_doc_sends (org_id, doc_type, doc_id, channel, sent_by) values (o, 'invoice', inv1, 'print', m); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P7d: a user wrote a send record directly'; end if;
  reset role;
  ok := false; begin update public.core_doc_sends set recipient = 'someone else' where doc_id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P7e: a send record was changed'; end if;
  ok := false; begin delete from public.core_doc_sends where doc_id = inv1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P7f: a send record was deleted'; end if;

  -- ---- P8: isolation (the owner of company B)
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_invoice_drafts; if n <> 0 then raise exception 'FAIL P8a: B sees % drafts', n; end if;
  select count(*) into n from public.sal_invoice_draft_lines; if n <> 0 then raise exception 'FAIL P8b: B sees % draft lines', n; end if;
  select count(*) into n from public.core_doc_settings; if n <> 0 then raise exception 'FAIL P8c: B sees % settings rows', n; end if;
  select count(*) into n from public.core_doc_sends; if n <> 0 then raise exception 'FAIL P8d: B sees % send records', n; end if;
  ok := false; begin perform public.sal_doc_print_data('invoice', inv1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8e: B printed A''s invoice'; end if;
  ok := false; begin perform public.sal_doc_print_data('draft', d3); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8f: B printed A''s draft'; end if;
  ok := false; begin perform public.sal_doc_link('invoice', inv1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8g: B made a link to A''s invoice'; end if;
  ok := false; begin perform public.sal_record_doc_send('invoice', inv1, 'print', 'device', null, null, null); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8h: B recorded a send of A''s invoice'; end if;
  ok := false; begin perform public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8i: B made a draft on A''s order'; end if;
  ok := false; begin perform public.sal_issue_invoice_draft(d3); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P8j: B issued A''s draft'; end if;
  reset role;
  -- B's owner naming company A in the header is not a member there
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_doc_print_data('invoice', inv1); exception when others then ok := (sqlerrm in ('FORBIDDEN', 'NOT_A_MEMBER', 'ORG_REQUIRED')); s := sqlerrm; end;
  if not ok then raise exception 'FAIL P8k: a non-member printed through A (%)', s; end if;
  reset role;

  -- ---- P9: no direct writes for users
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.sal_invoice_drafts set invoice_date = current_date where id = d3; get diagnostics n = row_count; ok := (n = 0); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P9a: a user wrote a draft directly'; end if;
  ok := false; begin insert into public.core_doc_settings (org_id, footer_text) values (ob, 'x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P9b: a user wrote document settings directly'; end if;
  ok := false; begin perform public.sal__doc_print_data(o, 'invoice', inv1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL P9c: a user called the internal print builder'; end if;

  -- ---- P3 (end): voiding still works, and it stops the invoice's link; a void invoice stays void
  perform public.sal_void_invoice(inv2);
  t1 := public.sal_doc_link('invoice', inv0) ->> 'token';
  perform public.sal_void_invoice(inv0);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false; begin perform public.sal_doc_link_print(t1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P6n: the link of a void invoice still works'; end if;
  reset role;
  ok := false; begin update public.sal_invoices set status = 'issued' where id = inv2; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL P3g: a void invoice was made issued again'; end if;

  -- ---- P10: audit rows, and the chain
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.invoice_draft.created'; if n <> 3 then raise exception 'FAIL P10a: % draft-created rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.invoice_draft.saved'; if n <> 1 then raise exception 'FAIL P10b: % draft-saved rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.invoice_draft.issued'; if n <> 1 then raise exception 'FAIL P10c: % draft-issued rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.invoice_draft.discarded'; if n <> 1 then raise exception 'FAIL P10d: % discarded rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'core.doc_settings.updated'; if n <> 1 then raise exception 'FAIL P10e: % settings rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.document_link.created'; if n < 3 then raise exception 'FAIL P10f: % link rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.document_link.revoked'; if n <> 1 then raise exception 'FAIL P10g: % revoked rows', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.document.sent'; if n <> 2 then raise exception 'FAIL P10h: % sent rows', n; end if;
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL P10i: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
