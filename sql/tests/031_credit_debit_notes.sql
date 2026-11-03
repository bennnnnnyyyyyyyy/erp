-- sql/tests/031_credit_debit_notes.sql
-- Credit and debit notes with approval (slice A2). Always rolls back. Needs sql/001-037.
-- Covers: who may request and decide, a credit note never exceeding the invoice (per line, cumulative, per unit), debit notes, the
-- requester never approving their own note (function and data constraint), channel handling, reject / cancel freeing the quantity,
-- voiding an invoice with active notes refused, immutability and append-only records, no direct writes, and another organization.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin, org A (second manager)
  uc uuid := gen_random_uuid();  -- member, org A (requests)
  ud uuid := gen_random_uuid();  -- viewer, org A
  uf uuid := gen_random_uuid();  -- second member, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  oa uuid; ob uuid;
  w1 uuid; i1 uuid; i2 uuid; cu uuid;
  so uuid; sol1 uuid; sol2 uuid;
  inv1 uuid; inv2 uuid; inv3 uuid; il1 uuid; il2 uuid; il3 uuid; il4 uuid;
  j jsonb; c1 uuid; c2 uuid; c3 uuid; c4 uuid; d1 uuid; k1 uuid; k2 uuid; k3 uuid;
  n bigint; s text; ok boolean; amt bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'nt-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'nt-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'nt-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'nt-d@tests.invalid'),
    (uf, 'authenticated', 'authenticated', 'nt-f@tests.invalid'), (ue, 'authenticated', 'authenticated', 'nt-e@tests.invalid');
  oa := public.bootstrap_organization('Notes Test A', 'nt-test-a', 'nt-a@tests.invalid');
  ob := public.bootstrap_organization('Notes Test B', 'nt-test-b', 'nt-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer'), (oa, uf, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'sales'), (ob, 'inventory'), (ob, 'sales');

  -- ---- fixtures: a customer, two items, a delivered order and three issued invoices (inserted directly: the order flow is tested elsewhere)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('FC50', 'Face cream 50ml', null, 'piece', 0, w1);
  i2 := public.inv_create_item('SVC', 'Consulting', null, 'piece', 0, w1);
  cu := public.sal_create_customer('Buyer One', null, 'Cairo', null);
  reset role;
  so := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, oa, 'SO-9001', cu, w1, 'stock_requested', 'EGP', ua);
  sol1 := gen_random_uuid(); sol2 := gen_random_uuid();
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (sol1, oa, so, i1, 10, 12550), (sol2, oa, so, i2, 1, 100000);
  inv1 := gen_random_uuid(); inv2 := gen_random_uuid(); inv3 := gen_random_uuid();
  il1 := gen_random_uuid(); il2 := gen_random_uuid(); il3 := gen_random_uuid(); il4 := gen_random_uuid();
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values
    (inv1, oa, 'INV-9001', so, cu, current_date, 'EGP', ua), (inv2, oa, 'INV-9002', so, cu, current_date, 'EGP', ua), (inv3, oa, 'INV-9003', so, cu, current_date, 'EGP', ua);
  insert into public.sal_invoice_lines (id, org_id, invoice_id, order_line_id, qty, unit_price_minor) values
    (il1, oa, inv1, sol1, 10, 12550), (il2, oa, inv1, sol2, 1, 100000), (il3, oa, inv2, sol1, 4, 12550), (il4, oa, inv3, sol1, 4, 12550);

  -- ---- S1: a member requests a credit note
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.sal_submit_note(inv1, 'credit', 'Damaged on arrival', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 2)));
  c1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'CN-0001' then raise exception 'FAIL S1a: first credit note is %, expected CN-0001', j ->> 'number'; end if;
  select total_minor, status into amt, s from public.sal_notes where id = c1;
  if amt <> 25100 or s <> 'submitted' then raise exception 'FAIL S1b: total % status %, expected 25100 and submitted', amt, s; end if;

  -- ---- S2: who may request
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2a: a viewer requested a note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);

  -- ---- S3: a credit note can never credit more than was invoiced
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', '[]'::jsonb); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3a: a note with no lines was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'refund', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3b: an unknown note kind was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', '  ', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3c: a note without a reason was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il3, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3d: a line of another invoice was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 0))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3e: a zero quantity was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1, 'unitPriceMinor', 20000))); exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL S3f: a credit above the invoiced unit price was accepted'; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 9))); exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL S3g: 9 credited while CN-0001 already holds 2 of 10'; end if;
  j := public.sal_submit_note(inv1, 'credit', 'Rest of the damaged goods', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 8, 'unitPriceMinor', 10000)));
  c2 := (j ->> 'id')::uuid;   -- exactly the remainder, at a lower unit price (a price reduction is allowed)
  select total_minor into amt from public.sal_notes where id = c2;
  if amt <> 80000 then raise exception 'FAIL S3h: total % for 8 at 10000, expected 80000', amt; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))); exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL S3i: a credit beyond the full invoiced quantity was accepted'; end if;
  -- the same line twice in one request is summed
  ok := false; begin perform public.sal_submit_note(inv2, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il3, 'qty', 3), jsonb_build_object('invoiceLineId', il3, 'qty', 2))); exception when others then ok := (sqlerrm = 'NOTE_EXCEEDS_INVOICE'); end;
  if not ok then raise exception 'FAIL S3j: two lines for the same item that add up to more than invoiced were accepted'; end if;

  -- ---- S4: a debit note may exceed the invoiced figures
  j := public.sal_submit_note(inv1, 'debit', 'Delivery surcharge', jsonb_build_array(jsonb_build_object('invoiceLineId', il2, 'qty', 1, 'unitPriceMinor', 150000)));
  d1 := (j ->> 'id')::uuid;
  if j ->> 'number' <> 'DN-0001' then raise exception 'FAIL S4a: first debit note is %, expected DN-0001', j ->> 'number'; end if;

  -- ---- S5: approval
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_decide_note(c1, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S5a: a member approved a note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  j := public.sal_submit_note(inv1, 'debit', 'Admin request', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1)));
  k1 := (j ->> 'id')::uuid;
  ok := false; begin perform public.sal_decide_note(k1, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL S5b: an admin approved their own note'; end if;
  ok := false; begin perform public.sal_decide_note(c1, 'approved', null, 'whatsapp'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5c: a non-app channel was accepted outside the messaging webhook'; end if;
  ok := false; begin perform public.sal_decide_note(c1, 'maybe', null, 'app'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S5d: an unknown decision was accepted'; end if;
  perform public.sal_decide_note(c1, 'approved', 'Looks right', 'app');
  select status into s from public.sal_notes where id = c1;
  if s <> 'approved' then raise exception 'FAIL S5e: status is %, expected approved', s; end if;
  ok := false; begin perform public.sal_decide_note(c1, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S5f: a note was approved twice'; end if;
  reset role;
  ok := false; begin update public.sal_notes set status = 'approved', decided_by = requester_id where id = k1; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL S5g: the data allowed a note to be decided by its own requester'; end if;
  select count(*) into n from public.sal_note_approvals where note_id = c1 and decision = 'approved' and channel = 'app' and approver_id = ub;
  if n <> 1 then raise exception 'FAIL S5h: % approval record(s) for CN-0001, expected 1', n; end if;
  set local role authenticated;

  -- ---- S6: reject and cancel free the quantity
  perform public.sal_decide_note(c2, 'rejected', 'Price change not agreed', 'app');
  select status into s from public.sal_notes where id = c2;
  if s <> 'rejected' then raise exception 'FAIL S6a: status is %, expected rejected', s; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  j := public.sal_submit_note(inv1, 'credit', 'Again at full price', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 8)));
  c3 := (j ->> 'id')::uuid;   -- the rejected note no longer holds its 8
  perform set_config('request.jwt.claims', json_build_object('sub', uf, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_cancel_note(c3); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S6b: another member cancelled someone else''s note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform public.sal_cancel_note(c3);
  ok := false; begin perform public.sal_cancel_note(c3); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S6c: a cancelled note was cancelled again'; end if;
  j := public.sal_submit_note(inv1, 'credit', 'After cancel', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 8)));
  c4 := (j ->> 'id')::uuid;   -- the cancelled note no longer holds its 8
  ok := false; begin perform public.sal_decide_note(c4, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S6d: a member decided a note'; end if;

  -- ---- S7: an invoice with active notes cannot be voided
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_void_invoice(inv1); exception when others then ok := (sqlerrm = 'ACTIVE_NOTES'); end;
  if not ok then raise exception 'FAIL S7a: an invoice with an approved note was voided'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  j := public.sal_submit_note(inv3, 'debit', 'To be cancelled', jsonb_build_array(jsonb_build_object('invoiceLineId', il4, 'qty', 1)));
  k2 := (j ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_void_invoice(inv3); exception when others then ok := (sqlerrm = 'ACTIVE_NOTES'); end;
  if not ok then raise exception 'FAIL S7b: an invoice with a waiting note was voided'; end if;
  perform public.sal_cancel_note(k2);
  perform public.sal_void_invoice(inv3);
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.sal_submit_note(inv3, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il4, 'qty', 1))); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S7c: a note was requested against a void invoice'; end if;
  -- a note that waits while its invoice is voided elsewhere (set directly) cannot be approved
  reset role;
  update public.sal_invoices set status = 'void' where id = inv2;
  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id)
  values (gen_random_uuid(), oa, 'CN-9999', 'credit', inv2, cu, 'EGP', 'on a void invoice', 100, uc) returning id into k3;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.sal_decide_note(k3, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S7d: a note on a void invoice was approved'; end if;

  -- ---- S8: records cannot be edited, deleted or truncated
  reset role;
  ok := false; begin update public.sal_notes set total_minor = 1 where id = c1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S8a: a note total was edited'; end if;
  ok := false; begin update public.sal_notes set status = 'rejected' where id = c1; exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S8b: an approved note was changed to rejected'; end if;
  ok := false; begin delete from public.sal_note_lines where note_id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S8c: note lines were deleted'; end if;
  ok := false; begin update public.sal_note_approvals set decision = 'rejected' where note_id = c1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S8d: an approval record was edited'; end if;
  ok := false; begin truncate public.sal_note_approvals; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S8e: approval records were truncated'; end if;

  -- ---- S9: no direct writes for the app roles
  set local role authenticated;
  ok := false; begin insert into public.sal_notes (org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id) values (oa, 'X', 'credit', inv1, cu, 'EGP', 'x', 1, ua); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9a: a direct insert into sal_notes was allowed'; end if;
  ok := false; begin update public.sal_notes set status = 'approved' where id = k1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S9b: a direct update of sal_notes was allowed'; end if;

  -- ---- S10: audit trail
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action like 'sales.note.%';
  if n <> 11 then raise exception 'FAIL S10a: % note audit rows, expected 11 (7 submitted, 1 approved, 1 rejected, 2 cancelled)', n; end if;
  if not exists (select 1 from public.audit_log where org_id = oa and action = 'sales.note.approved' and actor_user_id = ub and entity_id = c1::text) then
    raise exception 'FAIL S10b: the approval of CN-0001 was not audited with the approver';
  end if;

  -- ---- S11: another organization sees and changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.sal_notes;
  if n <> 0 then raise exception 'FAIL S11a: organization B can read % note(s) of organization A', n; end if;
  select count(*) into n from public.sal_note_lines;
  if n <> 0 then raise exception 'FAIL S11b: organization B can read % note line(s)', n; end if;
  select count(*) into n from public.sal_note_approvals;
  if n <> 0 then raise exception 'FAIL S11c: organization B can read % approval record(s)', n; end if;
  ok := false; begin perform public.sal_submit_note(inv1, 'credit', 'x', jsonb_build_array(jsonb_build_object('invoiceLineId', il1, 'qty', 1))); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S11d: organization B requested a note on organization A''s invoice'; end if;
  ok := false; begin perform public.sal_decide_note(c4, 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S11e: organization B decided organization A''s note'; end if;
  ok := false; begin perform public.sal_cancel_note(c4); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S11f: organization B cancelled organization A''s note'; end if;

  reset role;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
