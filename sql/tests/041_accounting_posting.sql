-- sql/tests/041_accounting_posting.sql
-- Accounting slice 2 (sql/046): automatic posting from the real document functions. Always rolls back. Needs sql/001-046.
-- Covers, for a company with accounting on: opening stock and manual receipts need a cost (RECEIPT_COST_REQUIRED) and post to
-- opening balances; a purchase receipt posts inventory / GRNI; a sale's issue posts COGS at the move's cost; an internal issue posts
-- to its reason's account; an approved adjustment posts the difference; a customer invoice posts receivables / sales; a supplier
-- invoice releases GRNI to payables; payments post by method (cash, cheque out to issued cheques); "other" needs a note; voids reverse;
-- an approved credit note posts sales returns / receivables; every entry balances; the totals tie out. A company without accounting
-- posts nothing and still receives stock without a cost.
-- Deferred triggers (invoices, balance checks) run at commit and this test never commits, so it forces them with SET CONSTRAINTS ... IMMEDIATE:
-- the invoice postings first, then the balance checks (as at a real commit, where the balance checks of new entries run last).

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B (accounting off)
  o uuid; ob uuid; w uuid; wb uuid; i uuid; i2 uuid; c uuid; so uuid; rq uuid; rq2 uuid; ol uuid; cinv uuid; sup uuid; po uuid; pol uuid; sinv uuid;
  cat uuid; ex uuid; p1 uuid; p2 uuid; il uuid; note uuid; adj uuid; acc33 uuid; acc_samples uuid; reason uuid; j jsonb;
  n bigint; ok boolean; v_dr bigint; v_cr bigint; v_cost bigint; v_bal bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'accp-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'accp-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'accp-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'accp-x@tests.invalid');
  o := public.bootstrap_organization('Posting Test A', 'posting-test-a', 'accp-o@tests.invalid');
  ob := public.bootstrap_organization('Posting Test B', 'posting-test-b', 'accp-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  -- accounting on for A only: the default chart, then the module row the way switch-on (sql/047) will add it
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc__seed_chart(o);
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main');

  -- ---- P2: receipts without a cost are refused; with a cost they post to opening balances
  ok := false; begin perform public.inv_create_item('P-0', 'No cost', null, 'piece', 5, w); exception when others then ok := (sqlerrm = 'RECEIPT_COST_REQUIRED'); end;
  if not ok then raise exception 'FAIL P2a: opening stock without a cost was accepted with accounting on'; end if;
  i := public.inv_create_item('P-1', 'Posted item', null, 'piece', 50, w, 100);
  reset role;
  select coalesce(sum(l.debit_minor), 0) into v_dr from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   join public.acc_accounts ac on ac.id = l.account_id where e.org_id = o and e.event = 'received_other' and ac.code = '161';
  select coalesce(sum(l.credit_minor), 0) into v_cr from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   join public.acc_accounts ac on ac.id = l.account_id where e.org_id = o and e.event = 'received_other' and ac.code = '231';
  if v_dr <> 5000 or v_cr <> 5000 then raise exception 'FAIL P2b: opening stock posted dr % cr %, expected 5000 each', v_dr, v_cr; end if;
  set local role authenticated;
  ok := false; begin perform public.inv_receive_stock(i, w, 1, 'found'); exception when others then ok := (sqlerrm = 'RECEIPT_COST_REQUIRED'); end;
  if not ok then raise exception 'FAIL P2c: a manual receipt without a cost was accepted'; end if;

  -- ---- P1: purchase receipt (10 at 120)
  sup := public.pur_create_supplier('Supplier', null, null, null);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 120))) ->> 'id')::uuid;
  perform public.pur_receive_order(po);
  reset role;
  select count(*) into n from public.acc_entries e join public.acc_entry_lines l on l.entry_id = e.id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.event = 'received' and ac.code = '282' and l.credit_minor = 1200 and l.party_type = 'supplier' and l.party_id = sup;
  if n <> 1 then raise exception 'FAIL P1a: no GRNI credit of 1200 for the supplier'; end if;

  -- ---- P4: a sale's issue posts COGS at the move's unit cost
  set local role authenticated;
  c := public.sal_create_customer('Customer', null, null, null);
  so := (public.sal_create_order(c, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 4, 'unitPriceMinor', 19999))) ->> 'id')::uuid;
  reset role;
  select id into ol from public.sal_order_lines where order_id = so;
  select id into pol from public.pur_order_lines where order_id = po;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; rq := (public.sal_request_stock(so) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  select unit_cost_minor into v_cost from public.inv_stock_moves where org_id = o and request_id = rq and kind = 'issue';
  select coalesce(sum(l.debit_minor), 0) into v_dr from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   join public.acc_accounts ac on ac.id = l.account_id where e.org_id = o and e.event = 'issued_sale' and ac.code = '341';
  if v_dr <> round(4 * v_cost) or v_dr = 0 then raise exception 'FAIL P4a: COGS %, expected % (4 x %)', v_dr, round(4 * v_cost), v_cost; end if;

  -- ---- P8 and P3: customer invoice (4 x 199.99 = 799.96) and supplier invoice (10 x 120)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cinv := ((public.sal_create_invoice(so, current_date, jsonb_build_array(jsonb_build_object('orderLineId', ol, 'qty', 4)))) ->> 'id')::uuid;
  sinv := public.pur_record_supplier_invoice(sup, po, 'SUP-1', current_date, jsonb_build_array(jsonb_build_object('orderLineId', pol, 'qty', 10)));
  execute 'set constraints public.acc_post_sal_invoice, public.acc_post_pur_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  reset role;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'customer_invoice' and e.source_id = cinv::text and
         ((ac.code = '171' and l.debit_minor = 79996 and l.party_id = c) or (ac.code = '411' and l.credit_minor = 79996));
  if n <> 2 then raise exception 'FAIL P8a: the customer invoice did not post 799.96 to customers and sales'; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_type = 'supplier_invoice' and
         ((ac.code = '282' and l.debit_minor = 1200) or (ac.code = '281' and l.credit_minor = 1200 and l.party_id = sup) or ac.code = '334');
  if n <> 2 then raise exception 'FAIL P3a: the supplier invoice did not move 1200 from GRNI to suppliers with no price difference (% lines)', n; end if;

  -- ---- P13-P15: payments by method; "other" needs a note
  set local role authenticated;
  ok := false; begin perform public.fin_record_payment('out', 1, current_date, 'other', null, sinv); exception when others then ok := (sqlerrm = 'NOTE_REQUIRED'); end;
  if not ok then raise exception 'FAIL P14a: an "other" payment without a note was accepted'; end if;
  p1 := ((public.fin_record_payment('in', 79996, current_date, 'cash', cinv)) ->> 'id')::uuid;
  p2 := ((public.fin_record_payment('out', 1200, current_date, 'cheque', null, sinv)) ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_id = p1::text and ((ac.code = '191' and l.debit_minor = 79996) or (ac.code = '171' and l.credit_minor = 79996));
  if n <> 2 then raise exception 'FAIL P13a: the cash receipt did not post cash / customers'; end if;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_id = p2::text and ((ac.code = '281' and l.debit_minor = 1200) or (ac.code = '286' and l.credit_minor = 1200));
  if n <> 2 then raise exception 'FAIL P14b: the cheque payment did not post suppliers / issued cheques'; end if;

  -- ---- P12 and P16: expense, then voids reverse (expense and the customer payment)
  set local role authenticated;
  cat := public.fin_create_category('Rent');
  ex := ((public.fin_record_expense(current_date, cat, 5000, null, 'November rent')) ->> 'id')::uuid;
  perform public.fin_void_expense(ex);
  perform public.fin_void_payment(p1);
  reset role;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   where e.org_id = o and e.source_type = 'expense' and e.source_id = ex::text;
  select count(*) into n from public.acc_entries where org_id = o and source_type = 'expense' and source_id = ex::text;
  if n <> 2 or v_bal <> 0 then raise exception 'FAIL P16a: expense and its void: % entries, net %', n, v_bal; end if;
  select count(*) into n from public.acc_entries e where e.org_id = o and e.source_id = p1::text and e.event = 'voided' and e.reverses_entry_id is not null;
  if n <> 1 then raise exception 'FAIL P16b: the payment void did not post a linked reversal'; end if;

  -- ---- P9: an approved credit note (1 x 199.99), requested by the owner, approved by the admin
  select id into il from public.sal_invoice_lines where invoice_id = cinv;
  set local role authenticated;
  note := ((public.sal_submit_note(cinv, 'credit', 'Damaged', jsonb_build_array(jsonb_build_object('invoiceLineId', il, 'qty', 1)))) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.sal_decide_note(note, 'approved'); reset role;
  select count(*) into n from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.source_id = note::text and ((ac.code = '412' and l.debit_minor = 19999) or (ac.code = '171' and l.credit_minor = 19999 and l.party_id = c));
  if n <> 2 then raise exception 'FAIL P9a: the credit note did not post sales returns / customers'; end if;

  -- ---- P6: an approved count difference (system 56 after the sale, counted 54: 2 short)
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; adj := ((public.inv_submit_adjustment(i, w, 54, 'Count')) ->> 'id')::uuid; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_adjustment(adj, 'approved'); reset role;
  select count(*) into n from public.acc_entries e join public.acc_entry_lines l on l.entry_id = e.id join public.acc_accounts ac on ac.id = l.account_id
   where e.org_id = o and e.event = 'adjusted' and ac.code = '332' and l.debit_minor > 0;
  if n <> 1 then raise exception 'FAIL P6a: the stock shortage did not post to count differences'; end if;

  -- ---- P5: an internal issue posts to its reason's account
  set local role authenticated;
  select id into acc33 from public.acc_accounts where org_id = o and code = '33';
  acc_samples := public.acc_create_account(acc33, '335', 'Free samples', 'عينات مجانية');
  reason := public.acc_save_issue_reason(null, 'Samples', 'عينات', acc_samples);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rq2 := ((public.inv_submit_request(w, 'Samples for a fair', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1)))) ->> 'id')::uuid;
  perform public.inv_set_request_reason(rq2, reason);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq2, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq2); reset role;
  select count(*) into n from public.acc_entries e join public.acc_entry_lines l on l.entry_id = e.id
   where e.org_id = o and e.event = 'issued_internal' and l.account_id = acc_samples and l.debit_minor > 0;
  if n <> 1 then raise exception 'FAIL P5a: the internal issue did not post to the reason''s account'; end if;

  -- ---- every entry balances (forced now) and the books tie out
  execute 'set constraints public.acc_post_sal_invoice, public.acc_post_pur_invoice immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints all deferred';
  select coalesce(sum(l.debit_minor), 0), coalesce(sum(l.credit_minor), 0) into v_dr, v_cr from public.acc_entry_lines l where l.org_id = o;
  if v_dr <> v_cr then raise exception 'FAIL T1a: the books do not balance: debits %, credits %', v_dr, v_cr; end if;
  -- customers: 799.96 invoiced - 799.96 paid + 799.96 payment voided - 199.99 credited = 599.97
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.org_id = o and ac.code = '171';
  if v_bal <> 59997 then raise exception 'FAIL T1b: customers balance %, expected 59997', v_bal; end if;
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.org_id = o and ac.code = '282';
  if v_bal <> 0 then raise exception 'FAIL T1c: GRNI left %, expected 0 after billing', v_bal; end if;
  -- inventory account = the value of what moved in and out at the costs posted
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_bal from public.acc_entry_lines l join public.acc_accounts ac on ac.id = l.account_id
   where l.org_id = o and ac.code = '161';
  select coalesce(sum(round(abs(mv.qty) * mv.unit_cost_minor) * sign(mv.qty)), 0) into v_dr from public.inv_stock_moves mv where mv.org_id = o;
  if v_bal <> v_dr then raise exception 'FAIL T1d: inventory account % vs stock moves %', v_bal, v_dr; end if;

  -- ---- a company without accounting: nothing posts, receipts need no cost
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wb := public.inv_create_warehouse('MAIN', 'Main');
  i2 := public.inv_create_item('B-1', 'Item', null, 'piece', 5, wb);
  reset role;
  select count(*) into n from public.acc_entries where org_id = ob;
  if n <> 0 then raise exception 'FAIL T2a: % entries for a company without accounting', n; end if;

  -- ---- internal posting functions are closed to signed-in users
  if has_function_privilege('authenticated', 'public.acc__post_move(uuid, bigint, boolean)', 'execute') then raise exception 'FAIL T3a: users can post moves'; end if;
  if has_function_privilege('anon', 'public.inv_set_request_reason(uuid, uuid)', 'execute') then raise exception 'FAIL T3b: anonymous can set reasons'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
