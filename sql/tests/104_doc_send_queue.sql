-- sql/tests/104_doc_send_queue.sql
-- sql/107: send an invoice or note from the company (queue mode). Always rolls back. Needs sql/001-107.
-- Covers: Q1 refused while the company sends from the device; Q2 email refused until email is connected; Q3 a member queues an email
-- (outbox row to the outside address, link made, send record with the message, audit row, message text); Q4 a double click queues once;
-- Q5 bad addresses and channels refused; Q6 a viewer cannot queue; drafts and void invoices refused; Q7 the status shows the customer's
-- email and the queued send; Q8 another company cannot queue or see it; Q9 device records cannot claim 'queue'; Q10 the outbox shape
-- rule; users cannot read doc_params; Q11 audit chain.

do $$
declare
  u uuid := gen_random_uuid();  -- owner of A
  m uuid := gen_random_uuid();  -- member of A
  v uuid := gen_random_uuid();  -- viewer of A
  x uuid := gen_random_uuid();  -- owner of B
  o uuid; ob uuid; w uuid; i uuid; c uuid; so uuid; rq uuid; ol uuid; d1 uuid; inv1 uuid; inv2 uuid;
  n bigint; ok boolean; j jsonb; j2 jsonb; r record;
  app text := 'https://erp.example';
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sq-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'sq-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'sq-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'sq-x@tests.invalid');
  o := public.bootstrap_organization('Send Queue A', 'send-queue-a', 'sq-o@tests.invalid');
  ob := public.bootstrap_organization('Send Queue B', 'send-queue-b', 'sq-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- an issued invoice for a customer with an email
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');
  i := public.inv_create_item('SQ-1', 'Queue item', null, 'piece', 50, w);
  c := public.sal_create_customer('Queue customer', null, 'Cairo', '01000000000', null, null, null, 'buyer@example.com');
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitPriceMinor', 1000))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  d1 := (public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 4))) ->> 'id')::uuid;
  inv1 := (public.sal_issue_invoice_draft(d1) ->> 'id')::uuid;
  reset role;

  -- ---- Q1: the company sends from the device (the default): refused
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', 'simple', 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL Q1: queued while the company sends from the device'; end if;
  reset role;

  -- the owner switches to "send from the company"
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.core_save_doc_settings(jsonb_build_object('sendMode', 'queue')); reset role;

  -- ---- Q2: email is not connected yet: refused
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', 'simple', 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL Q2: queued an email while email is not connected'; end if;
  reset role;
  insert into public.core_integrations (org_id, kind, mode, enabled) values (o, 'email', 'live', true);

  -- ---- Q3: a member queues an email
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.sal_queue_doc_send('invoice', inv1, 'email', ' Buyer@Example.com ', 'eta', 'both', app);
  if (j ->> 'duplicate')::boolean then raise exception 'FAIL Q3a: first send marked duplicate'; end if;
  reset role;
  select * into r from public.msg_outbox where id = (j ->> 'outboxId')::uuid;
  if r.org_id <> o or r.kind <> 'document' or r.channel <> 'email' or r.recipient_id is not null or r.to_address <> 'buyer@example.com' or r.status <> 'pending' then
    raise exception 'FAIL Q3b: outbox row % % % % %', r.kind, r.channel, r.recipient_id, r.to_address, r.status;
  end if;
  if r.entity_type <> 'sales_invoice' or r.entity_id <> inv1 then raise exception 'FAIL Q3c: outbox entity % %', r.entity_type, r.entity_id; end if;
  if position('https://erp.example/i/' in r.body) = 0 or position('فاتورة INV-' in r.body) = 0 or position('Invoice INV-' in r.body) = 0 then
    raise exception 'FAIL Q3d: message text %', r.body;
  end if;
  if (r.doc_params ->> 'grossMinor')::bigint <> (select gross_minor from public.sal_invoices where id = inv1) or r.doc_params ->> 'currency' is null then
    raise exception 'FAIL Q3e: doc_params %', r.doc_params;
  end if;
  select count(*) into n from public.sal_doc_links where org_id = o and doc_type = 'invoice' and doc_id = inv1 and revoked_at is null;
  if n <> 1 then raise exception 'FAIL Q3f: % working links', n; end if;
  select count(*) into n from public.core_doc_sends where org_id = o and doc_id = inv1 and mode = 'queue' and outbox_id = r.id and sent_by = m and channel = 'email' and layout = 'eta';
  if n <> 1 then raise exception 'FAIL Q3g: % queue send records', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'sales.document.queued' and entity_id = inv1::text and actor_user_id = m;
  if n <> 1 then raise exception 'FAIL Q3h: % queued audit rows', n; end if;

  -- ---- Q4: the same send again in the same minute is the same message
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j2 := public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', 'eta', 'both', app);
  if not (j2 ->> 'duplicate')::boolean or j2 ->> 'outboxId' <> j ->> 'outboxId' then raise exception 'FAIL Q4a: double click %', j2; end if;
  reset role;
  select count(*) into n from public.core_doc_sends where org_id = o and doc_id = inv1 and mode = 'queue';
  if n <> 1 then raise exception 'FAIL Q4b: % send records after a double click', n; end if;

  -- ---- Q5: bad input
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'not-an-email', null, 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q5a: bad email queued'; end if;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'whatsapp', '+20 100', null, 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q5b: bad WhatsApp number queued'; end if;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'slack', 'x', null, 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q5c: slack accepted'; end if;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', null, 'ar', 'https://evil.example/x?'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q5d: an app address with a path accepted'; end if;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', null, 'ar', 'http://evil.example'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q5e: a plain http address accepted'; end if;
  -- a draft is not a sendable document
  ok := false; begin perform public.sal_queue_doc_send('invoice', d1, 'email', 'buyer@example.com', null, 'ar', app); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL Q5f: a draft id queued'; end if;
  -- WhatsApp is allowed by the database (the API checks that WhatsApp is set up on the server)
  j2 := public.sal_queue_doc_send('invoice', inv1, 'whatsapp', '201000000000', 'simple', 'ar', app);
  reset role;
  select count(*) into n from public.msg_outbox where id = (j2 ->> 'outboxId')::uuid and channel = 'whatsapp' and to_address = '201000000000' and doc_params ->> 'language' = 'ar';
  if n <> 1 then raise exception 'FAIL Q5g: WhatsApp message not queued'; end if;

  -- ---- Q6: a viewer cannot queue; a void invoice cannot be queued
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', null, 'ar', app); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL Q6a: a viewer queued'; end if;
  -- ---- Q7: the status (a viewer may read it)
  j := public.sal_doc_queue_status('invoice', inv1);
  if j ->> 'sendMode' <> 'queue' or not (j ->> 'emailConnected')::boolean or j ->> 'customerEmail' <> 'buyer@example.com' or j ->> 'customerPhone' <> '01000000000' then
    raise exception 'FAIL Q7a: status %', j;
  end if;
  -- both sends were queued in this one transaction (same time), so their order is not fixed here
  if jsonb_array_length(j -> 'sends') <> 2
     or not (j -> 'sends') @> jsonb_build_array(jsonb_build_object('channel', 'email', 'recipient', 'buyer@example.com', 'status', 'pending')) then
    raise exception 'FAIL Q7b: status sends %', j -> 'sends';
  end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  d1 := (public.sal_save_invoice_draft(null, so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 1))) ->> 'id')::uuid;
  inv2 := (public.sal_issue_invoice_draft(d1) ->> 'id')::uuid;
  perform public.sal_void_invoice(inv2);
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv2, 'email', 'buyer@example.com', null, 'ar', app); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL Q6b: a void invoice queued'; end if;
  reset role;

  -- ---- Q8: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_queue_doc_send('invoice', inv1, 'email', 'buyer@example.com', null, 'ar', app); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'INVALID_STATE')); end;
  if not ok then raise exception 'FAIL Q8a: company B queued company A''s invoice'; end if;
  ok := false; begin perform public.sal_doc_queue_status('invoice', inv1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL Q8b: company B read company A''s send status'; end if;
  select count(*) into n from public.msg_outbox where org_id = o;
  if n <> 0 then raise exception 'FAIL Q8c: company B sees % of A''s outbox rows', n; end if;
  select count(*) into n from public.core_doc_sends where org_id = o;
  if n <> 0 then raise exception 'FAIL Q8d: company B sees % of A''s send records', n; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- ---- Q9: a device record cannot claim to be a queue send
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_record_doc_send('invoice', inv1, 'email', 'queue', 'a@b.c', null, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL Q9a: a device call recorded a queue send'; end if;
  perform public.sal_record_doc_send('invoice', inv1, 'print', 'device', null, 'simple', 'ar');
  -- ---- Q10: no direct writes; doc_params is not readable
  ok := false; begin insert into public.msg_outbox (org_id, channel, kind, subject, idempotency_key, to_address) values (o, 'email', 'document', 's', 'k', 'a@b.c'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL Q10a: a user wrote the outbox directly'; end if;
  ok := false; begin perform doc_params from public.msg_outbox limit 1; exception when others then ok := (sqlstate = '42501'); end;
  if not ok then raise exception 'FAIL Q10b: a user read doc_params'; end if;
  reset role;
  -- the shape rule: an outside address only on a document, a document never to a member
  ok := false; begin insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, idempotency_key, to_address) values (o, u, 'email', 'info', 's', 'k1', 'a@b.c'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL Q10c: an outside address on a non-document message'; end if;
  ok := false; begin insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, idempotency_key, to_address) values (o, u, 'email', 'document', 's', 'k2', 'a@b.c'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL Q10d: a document to a member'; end if;
  ok := false; begin insert into public.msg_outbox (org_id, channel, kind, subject, idempotency_key, to_address) values (o, 'telegram', 'document', 's', 'k3', 'a@b.c'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL Q10e: a document by Telegram'; end if;

  -- ---- Q11: audit chain
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL Q11: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
