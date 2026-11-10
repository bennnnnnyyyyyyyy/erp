-- sql/tests/068_delivery_notes.sql
-- The supplier's delivery note number on receipts (sql/072). Always rolls back. Needs sql/001-072.
-- Covers: a receipt with a note records it with what arrived and who received it, in the same transaction as the stock; the note is
-- required for this function and limited to 60 characters; a refused receipt (more than ordered, or an order waiting for approval)
-- leaves no note behind; receipts cannot be changed or deleted; another company cannot see them; no anonymous use; audited.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i uuid; s uuid; po uuid; po2 uuid; l uuid; l2 uuid; r jsonb; ok boolean; n int; q numeric;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'dn-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'dn-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'dn-x@tests.invalid');
  o := public.bootstrap_organization('Delivery Note A', 'delivery-note-a', 'dn-o@tests.invalid');
  ob := public.bootstrap_organization('Delivery Note B', 'delivery-note-b', 'dn-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  i := public.inv_create_item('DN-1', 'Bottles', null, 'piece', 0, null);
  s := public.pur_create_supplier('Note Supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 300))) ->> 'id')::uuid;
  select id into l from public.pur_order_lines where order_id = po;

  -- ---- D1: the clerk receives 6 with delivery note DN-7781; stock and note together
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  r := public.pur_receive_with_note(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 6)), true, '  DN-7781 ');
  if r ->> 'status' <> 'ordered' or r ->> 'receiptId' is null then raise exception 'FAIL D1a: %', r; end if;
  select received_qty into q from public.pur_order_lines where id = l;
  if q <> 6 then raise exception 'FAIL D1b: received %', q; end if;
  if not exists (select 1 from public.pur_receipts where order_id = po and delivery_note_no = 'DN-7781' and received_by = m
                 and (lines -> 0 ->> 'qty')::numeric = 6) then
    raise exception 'FAIL D1c: note not recorded with what arrived';
  end if;

  -- ---- D2: no note, or a note too long: refused, and nothing received
  ok := false; begin perform public.pur_receive_with_note(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 1)), true, '  ');
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2a: blank note accepted'; end if;
  ok := false; begin perform public.pur_receive_with_note(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 1)), true, repeat('x', 61));
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL D2b: 61-character note accepted'; end if;

  -- ---- D3: a refused receipt (more than is still to come) leaves no note behind
  ok := false; begin perform public.pur_receive_with_note(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 5)), true, 'DN-9999');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D3a: over-receipt accepted'; end if;
  if exists (select 1 from public.pur_receipts where delivery_note_no = 'DN-9999') then raise exception 'FAIL D3b: a note without its receipt'; end if;

  -- ---- D4: an order waiting for approval cannot be received with a note either
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.pur_set_po_approval(true, 0);
  po2 := (public.pur_create_order(s, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 2, 'unitCostMinor', 300))) ->> 'id')::uuid;
  select id into l2 from public.pur_order_lines where order_id = po2;
  ok := false; begin perform public.pur_receive_with_note(po2, jsonb_build_array(jsonb_build_object('lineId', l2, 'qty', 2)), false, 'DN-1');
  exception when others then ok := (sqlerrm = 'NOT_APPROVED'); end;
  if not ok then raise exception 'FAIL D4: waiting order received with a note'; end if;

  -- ---- D5: another company sees nothing and cannot receive
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pur_receipts;
  if n <> 0 then raise exception 'FAIL D5a: another company sees % receipts', n; end if;
  ok := false; begin perform public.pur_receive_with_note(po, jsonb_build_array(jsonb_build_object('lineId', l, 'qty', 1)), true, 'DN-X');
  exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL D5b: another company received'; end if;

  -- ---- D6: receipts cannot be changed or deleted; users cannot write the table; audited; no anonymous use
  reset role;
  ok := false; begin update public.pur_receipts set delivery_note_no = 'changed' where order_id = po; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D6a: a receipt was changed'; end if;
  ok := false; begin delete from public.pur_receipts where order_id = po; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL D6b: a receipt was deleted'; end if;
  if has_table_privilege('authenticated', 'public.pur_receipts', 'insert') then raise exception 'FAIL D6c: users can insert receipts'; end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'purchasing.order.delivery_note' and summary like '%DN-7781%') then
    raise exception 'FAIL D6d: not audited';
  end if;
  if has_function_privilege('anon', 'public.pur_receive_with_note(uuid, jsonb, boolean, text)', 'execute') then raise exception 'FAIL D6e: anonymous use'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
