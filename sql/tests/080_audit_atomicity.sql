-- sql/tests/080_audit_atomicity.sql
-- Audit response 2026-11-11, finding 16: failure injection. The rule is "a change must not be able to exist without its audit row, in
-- the same transaction". Earlier tests prove audit rows appear; this one proves the other half. A temporary trigger on audit_log
-- raises an error for one chosen action; the database function that writes that audit row must then fail as a whole, and nothing
-- it did may remain: no status change, no stock move, no balance change, no journal or ledger entry, no audit row. After each
-- failure the trigger is switched off and the very same call is made again: it must succeed, which proves the first failure came from
-- the injected audit error and not from something else.
-- Paths: stock request approval, stock issue (ledger + balance), purchase order receipt (ledger + balance + order status),
-- direct manual journal posting (accounting ledger). Always rolls back. Needs sql/001-083.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid();
  o uuid; w uuid; i uuid; sup uuid; po uuid; rq uuid; cash uuid; bank uuid;
  ok boolean; msg text; n bigint; st text;
  moves0 bigint; bal0 numeric; aud0 bigint; ent0 bigint; jr0 bigint; lines0 bigint; ost text;
  v_lines jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'atom-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'atom-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'atom-m@tests.invalid');
  o := public.bootstrap_organization('Atomicity Test', 'atomicity-test', 'atom-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  update public.organizations set default_currency = 'EGP' where id = o;
  perform public.core_enable_all_modules(o);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- accounting on, so stock movements also post to the ledger (as sql/tests/061)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.acc_prepare(); reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  select id into cash from public.acc_accounts where org_id = o and code = '191';
  select id into bank from public.acc_accounts where org_id = o and code = '192';
  v_lines := jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 700), jsonb_build_object('accountId', cash, 'creditMinor', 700));

  -- master data and some stock: 10 units at 20.00 bought and received first (no injection yet)
  set local role authenticated;
  w := public.inv_create_warehouse('ATOM', 'Atomicity warehouse', null);
  i := public.inv_create_item('ATOM-1', 'Atomicity item', null, 'piece', 0, w);
  sup := public.pur_create_supplier('Atomicity supplier', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 10, 'unitCostMinor', 2000))) ->> 'id')::uuid;
  reset role;
  set local role authenticated; perform public.pur_receive_order(po); reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';

  -- the failure injector: raises when an audit row has the action named in the setting test.fail_action
  create function public.t080_fail_audit() returns trigger language plpgsql as $f$
  begin
    if new.action = current_setting('test.fail_action', true) then raise exception 'AUDIT_INJECTED %', new.action; end if;
    return new;
  end $f$;
  create trigger t080_fail_audit before insert on public.audit_log for each row execute function public.t080_fail_audit();

  -- ---- Z0: the injector works at all, and a normal audit row with another action is not affected
  perform set_config('test.fail_action', 'atomicity.probe', true);
  ok := false;
  begin
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (o, u, 'atomicity.probe', 'probe', '1', 'probe');
  exception when others then ok := (sqlerrm like 'AUDIT_INJECTED%'); end;
  if not ok then raise exception 'FAIL Z0a: the injected trigger did not stop an audit row'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (o, u, 'atomicity.other', 'probe', '1', 'other');

  -- ======================================================== A1: approving a stock request
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rq := (public.inv_submit_request(w, 'atomicity test', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 4))) ->> 'id')::uuid;
  reset role;
  select status into st from public.inv_requests where id = rq;
  select count(*) into aud0 from public.audit_log where org_id = o;

  perform set_config('test.fail_action', 'inventory.request.approved', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_request(rq, 'approved'); exception when others then ok := (sqlerrm like 'AUDIT_INJECTED%'); end;
  reset role;
  if not ok then raise exception 'FAIL A1a: the approval succeeded although its audit row could not be written'; end if;
  if (select status from public.inv_requests where id = rq) is distinct from st then raise exception 'FAIL A1b: the request changed status without an audit row'; end if;
  if exists (select 1 from public.inv_requests r where r.id = rq and (r.decided_by is not null or r.decided_at is not null)) then
    raise exception 'FAIL A1c: a decision was recorded on the request without an audit row';
  end if;
  select count(*) into n from public.audit_log where org_id = o;
  if n <> aud0 then raise exception 'FAIL A1d: audit rows changed by a failed approval (% -> %)', aud0, n; end if;

  -- control: the same call works once the injector is off
  perform set_config('test.fail_action', '', true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  if (select status from public.inv_requests where id = rq) = st then raise exception 'FAIL A1e: the control approval did not change the status'; end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'inventory.request.approved' and entity_id = rq::text) then
    raise exception 'FAIL A1f: the control approval has no audit row';
  end if;

  -- ======================================================== A2: issuing the approved request (stock move + balance + ledger)
  select count(*) into moves0 from public.inv_stock_moves where org_id = o;
  select coalesce(sum(on_hand), 0) into bal0 from public.inv_stock_balances where org_id = o and item_id = i;
  select count(*) into ent0 from public.acc_entries where org_id = o;
  select count(*) into lines0 from public.acc_entry_lines where org_id = o;
  select status into st from public.inv_requests where id = rq;
  select count(*) into aud0 from public.audit_log where org_id = o;

  perform set_config('test.fail_action', 'inventory.stock.issued', true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_post_issue(rq); exception when others then ok := (sqlerrm like 'AUDIT_INJECTED%'); end;
  reset role;
  if not ok then raise exception 'FAIL A2a: the issue succeeded although its audit row could not be written'; end if;
  select count(*) into n from public.inv_stock_moves where org_id = o;
  if n <> moves0 then raise exception 'FAIL A2b: a stock move remains from a failed issue (% -> %)', moves0, n; end if;
  select coalesce(sum(on_hand), 0) into bal0 from public.inv_stock_balances where org_id = o and item_id = i;
  if bal0 <> 10 then raise exception 'FAIL A2c: the balance changed from a failed issue (%, expected 10)', bal0; end if;
  if (select status from public.inv_requests where id = rq) is distinct from st then raise exception 'FAIL A2d: the request status changed in a failed issue'; end if;
  select count(*) into n from public.acc_entries where org_id = o;
  if n <> ent0 then raise exception 'FAIL A2e: a ledger entry remains from a failed issue'; end if;
  select count(*) into n from public.acc_entry_lines where org_id = o;
  if n <> lines0 then raise exception 'FAIL A2f: ledger lines remain from a failed issue'; end if;
  select count(*) into n from public.audit_log where org_id = o;
  if n <> aud0 then raise exception 'FAIL A2g: audit rows changed by a failed issue'; end if;

  -- control
  perform set_config('test.fail_action', '', true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  select coalesce(sum(on_hand), 0) into bal0 from public.inv_stock_balances where org_id = o and item_id = i;
  if bal0 <> 6 then raise exception 'FAIL A2h: the control issue left % on hand, expected 6', bal0; end if;
  if (select count(*) from public.inv_stock_moves where org_id = o) <= moves0 then raise exception 'FAIL A2i: the control issue wrote no stock move'; end if;

  -- ======================================================== A3: receiving a purchase order (stock move + balance + order status + ledger)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 5, 'unitCostMinor', 2500))) ->> 'id')::uuid;
  reset role;
  select status into ost from public.pur_orders where id = po;
  select count(*) into moves0 from public.inv_stock_moves where org_id = o;
  select count(*) into ent0 from public.acc_entries where org_id = o;
  select count(*) into aud0 from public.audit_log where org_id = o;

  perform set_config('test.fail_action', 'purchasing.order.received', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.pur_receive_order(po); exception when others then ok := (sqlerrm like 'AUDIT_INJECTED%'); end;
  reset role;
  if not ok then raise exception 'FAIL A3a: the receipt succeeded although its audit row could not be written'; end if;
  if (select status from public.pur_orders where id = po) is distinct from ost then raise exception 'FAIL A3b: the order changed status in a failed receipt'; end if;
  if exists (select 1 from public.pur_order_lines where order_id = po and received_qty <> 0) then raise exception 'FAIL A3c: received quantities remain from a failed receipt'; end if;
  select count(*) into n from public.inv_stock_moves where org_id = o;
  if n <> moves0 then raise exception 'FAIL A3d: a stock move remains from a failed receipt (% -> %)', moves0, n; end if;
  select coalesce(sum(on_hand), 0) into bal0 from public.inv_stock_balances where org_id = o and item_id = i;
  if bal0 <> 6 then raise exception 'FAIL A3e: the balance changed from a failed receipt (%, expected 6)', bal0; end if;
  select count(*) into n from public.acc_entries where org_id = o;
  if n <> ent0 then raise exception 'FAIL A3f: a ledger entry remains from a failed receipt'; end if;
  select count(*) into n from public.audit_log where org_id = o;
  if n <> aud0 then raise exception 'FAIL A3g: audit rows changed by a failed receipt'; end if;

  -- control
  perform set_config('test.fail_action', '', true);
  set local role authenticated; perform public.pur_receive_order(po); reset role;
  select coalesce(sum(on_hand), 0) into bal0 from public.inv_stock_balances where org_id = o and item_id = i;
  if bal0 <> 11 then raise exception 'FAIL A3h: the control receipt left % on hand, expected 11', bal0; end if;
  if (select status from public.pur_orders where id = po) = ost then raise exception 'FAIL A3i: the control receipt did not change the order status'; end if;

  -- ======================================================== A4: posting a manual journal directly (accounting ledger)
  select count(*) into jr0 from public.acc_manual_journals where org_id = o;
  select count(*) into ent0 from public.acc_entries where org_id = o;
  select count(*) into lines0 from public.acc_entry_lines where org_id = o;
  select count(*) into aud0 from public.audit_log where org_id = o;

  perform set_config('test.fail_action', 'accounting.journal.posted_direct', true);
  set local role authenticated;
  ok := false;
  begin perform public.acc_save_journal(null, current_date, 'Atomicity journal', v_lines, 'manual', null, true); exception when others then ok := (sqlerrm like 'AUDIT_INJECTED%'); end;
  reset role;
  if not ok then raise exception 'FAIL A4a: the journal was posted although its audit row could not be written'; end if;
  select count(*) into n from public.acc_manual_journals where org_id = o;
  if n <> jr0 then raise exception 'FAIL A4b: a journal (draft or posted) remains from the failed posting (% -> %)', jr0, n; end if;
  select count(*) into n from public.acc_entries where org_id = o;
  if n <> ent0 then raise exception 'FAIL A4c: a ledger entry remains from the failed posting'; end if;
  select count(*) into n from public.acc_entry_lines where org_id = o;
  if n <> lines0 then raise exception 'FAIL A4d: ledger lines remain from the failed posting'; end if;
  select count(*) into n from public.audit_log where org_id = o;
  if n <> aud0 then raise exception 'FAIL A4e: audit rows (for example the draft''s) remain from the failed posting'; end if;

  -- control
  perform set_config('test.fail_action', '', true);
  set local role authenticated;
  perform public.acc_save_journal(null, current_date, 'Atomicity journal', v_lines, 'manual', null, true);
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  if (select count(*) from public.acc_manual_journals where org_id = o) <> jr0 + 1 or (select count(*) from public.acc_entries where org_id = o) <> ent0 + 1 then
    raise exception 'FAIL A4f: the control posting did not write one journal and one entry';
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'accounting.journal.posted_direct') then
    raise exception 'FAIL A4g: the control posting has no audit row';
  end if;

  -- ---- Z1: the audit chain of everything that did succeed is intact
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL Z1: audit chain broken (% rows)', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
