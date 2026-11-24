-- sql/tests/106_rpt_reports.sql
-- Reports & Insights step 2: the report builder and saved reports (sql/109). Always rolls back. Needs sql/001-109.
-- Covers: S1 each role gets only its sources (a member no money sources; the ledger only with accounting on); C1 a definition that is
-- not on the fixed list is refused (unknown source, column, setting, operator, function; a column name with SQL in it; a bad date; no
-- period; more than 3 years; a limit above 5,000; grouped without a total; sorting by a hidden column); F1 a member cannot run a money
-- source, a switched-off module is refused; R1 rows come back for the company, a filter value with quotes is only a value; R2 group by
-- with a total; T1 money totals are one line per currency; T2 more rows than the limit gives `truncated`; P1 saved reports: who may save
-- company and private reports, who sees them, names used once; A1 save, change and delete are audited; I1 another company sees, runs
-- and changes nothing of this company; G1 no direct writes; N1 no anonymous use; D1 "all apps on" includes reports.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; it uuid; it2 uuid; cat uuid; e2 uuid; rc uuid; rp uuid; ok boolean; n int; r jsonb; d jsonb;
  v_from text := to_char(current_date - 30, 'YYYY-MM-DD'); v_to text := to_char(current_date + 1, 'YYYY-MM-DD');
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'rp-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'rp-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'rp-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'rp-x@tests.invalid');
  o := public.bootstrap_organization('Reports A', 'reports-a', 'rp-o@tests.invalid');
  ob := public.bootstrap_organization('Reports B', 'reports-b', 'rp-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- D1
  if not exists (select 1 from public.org_modules where org_id = o and module_key = 'reports' and disabled_at is null) then
    raise exception 'FAIL D1: all apps on did not switch on reports';
  end if;

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  w := public.inv_create_warehouse('MAIN', 'Main', null);
  it := public.inv_create_item('RP-1', 'Cream', null, 'piece', 100, w);
  it2 := public.inv_create_item('RP-2', 'Soap', null, 'piece', 40, w);
  cat := public.fin_create_category('Rent');
  perform public.fin_record_expense(current_date, cat, 5000);
  e2 := (public.fin_record_expense(current_date, cat, 2000) ->> 'id')::uuid;

  -- S1: the owner gets 8 sources (no ledger: accounting is off); a member and a viewer get the 5 that are not money
  select count(*) into n from jsonb_array_elements(public.rpt_sources());
  if n <> 8 then raise exception 'FAIL S1a: owner has % sources, expected 8', n; end if;
  if exists (select 1 from jsonb_array_elements(public.rpt_sources()) s where s ->> 'key' = 'ledger_lines') then raise exception 'FAIL S1b: ledger offered with accounting off'; end if;
  if exists (select 1 from jsonb_array_elements(public.rpt_sources()) s, jsonb_array_elements(s -> 'columns') c where c ->> 'key' ~ 'expr|cost_minor') then
    raise exception 'FAIL S1c: sources show SQL or hidden costs';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if (select string_agg(s ->> 'key', ',' order by s ->> 'key') from jsonb_array_elements(public.rpt_sources()) s) <> 'purchase_lines,sales_lines,sales_orders,stock_moves,stock_on_hand' then
    raise exception 'FAIL S1d: member sources are %', (select string_agg(s ->> 'key', ',' order by s ->> 'key') from jsonb_array_elements(public.rpt_sources()) s);
  end if;

  -- F1: a member cannot run expenses
  ok := false; begin perform public.rpt_run(jsonb_build_object('source', 'expenses', 'columns', '["amount"]'::jsonb, 'period', jsonb_build_object('from', v_from, 'to', v_to)));
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL F1a: a member ran a money report'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.rpt_run(jsonb_build_object('source', 'ledger_lines', 'columns', '["debit"]'::jsonb, 'period', jsonb_build_object('from', v_from, 'to', v_to)));
  exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL F1b: the ledger ran with accounting off'; end if;

  -- C1: refusals
  d := jsonb_build_object('source', 'stock_moves', 'columns', '["item", "qty"]'::jsonb, 'period', jsonb_build_object('from', v_from, 'to', v_to));
  perform public.rpt_run(d);  -- the valid one runs
  foreach r in array array[
      jsonb_set(d, '{source}', '"nope"'),
      jsonb_set(d, '{columns}', '["item", "qty; drop table public.rpt_reports"]'),
      jsonb_set(d, '{columns}', '["unit_cost_minor"]'),
      d || '{"sql": "select 1"}',
      d || '{"filters": [{"column": "qty", "op": "contains", "value": "1"}]}',
      d || '{"filters": [{"column": "item", "op": "like", "value": "a"}]}',
      d || '{"filters": [{"column": "move_date", "op": "eq", "value": "2026-02-30"}]}',
      d || '{"filters": [{"column": "qty", "op": "eq", "value": "1 or 1=1"}]}',
      d - 'period',
      d || '{"period": {"from": "2020-01-01", "to": "2026-01-01"}}',
      d || '{"limit": 6000}',
      d || '{"groupBy": ["item"]}',
      d || '{"totals": [{"column": "item", "fn": "sum"}]}',
      d || '{"totals": [{"column": "qty", "fn": "pg_sleep"}]}',
      d || '{"sort": [{"column": "warehouse", "dir": "asc"}]}',
      d || '{"sort": [{"column": "qty", "dir": "sideways"}]}',
      d || '{"chart": {"type": "bar", "x": "item", "y": "warehouse"}}',
      '["not an object"]'::jsonb]
  loop
    ok := false; begin perform public.rpt_run(r); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
    if not ok then raise exception 'FAIL C1: accepted %', r; end if;
  end loop;

  -- R1: both receipt moves come back; a value with quotes is only a value
  r := public.rpt_run(d);
  if jsonb_array_length(r -> 'rows') <> 2 or r -> 'truncated' <> 'false' then raise exception 'FAIL R1a: %', r; end if;
  if (r -> 'columns' -> 0 ->> 'key') <> 'item' or (r -> 'columns' -> 1 ->> 'type') <> 'number' then raise exception 'FAIL R1b: columns %', r -> 'columns'; end if;
  r := public.rpt_run(d || jsonb_build_object('filters', jsonb_build_array(jsonb_build_object('column', 'item', 'op', 'contains', 'value', 'x'' or ''1''=''1'))));
  if jsonb_array_length(r -> 'rows') <> 0 then raise exception 'FAIL R1c: a quoted value matched rows'; end if;
  r := public.rpt_run(d || '{"filters": [{"column": "item", "op": "in", "value": ["Soap"]}, {"column": "qty", "op": "gte", "value": 40}]}');
  if jsonb_array_length(r -> 'rows') <> 1 or (r -> 'rows' -> 0 ->> 0) <> 'Soap' then raise exception 'FAIL R1d: %', r; end if;

  -- R2: group by warehouse with a total and a count
  r := public.rpt_run('{"source": "stock_on_hand", "groupBy": ["warehouse"], "totals": [{"column": "available", "fn": "sum"}, {"column": "item", "fn": "count"}], "sort": [{"column": "sum_available", "dir": "desc"}]}');
  if jsonb_array_length(r -> 'rows') <> 1 or (r -> 'rows' -> 0 ->> 1)::numeric <> 140 or (r -> 'rows' -> 0 ->> 2)::int <> 2 then raise exception 'FAIL R2a: %', r; end if;
  if (r -> 'totalRows' -> 0 -> 'values' ->> 0)::numeric <> 140 then raise exception 'FAIL R2b: total %', r -> 'totalRows'; end if;

  -- T1: one expense moved to another currency: the total is two lines, never one sum
  reset role;
  update public.fin_expenses set currency = 'USD' where id = e2;
  set local role authenticated;
  r := public.rpt_run(jsonb_build_object('source', 'expenses', 'columns', '["category", "amount"]'::jsonb, 'totals', '[{"column": "amount", "fn": "sum"}]'::jsonb,
                                         'period', jsonb_build_object('from', v_from, 'to', v_to)));
  if jsonb_array_length(r -> 'totalRows') <> 2 then raise exception 'FAIL T1a: totals %', r -> 'totalRows'; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'totalRows') t where t ->> 'currency' = 'USD' and (t -> 'values' ->> 0)::bigint = 2000)
     or not exists (select 1 from jsonb_array_elements(r -> 'totalRows') t where t ->> 'currency' <> 'USD' and (t -> 'values' ->> 0)::bigint = 5000) then
    raise exception 'FAIL T1b: totals %', r -> 'totalRows';
  end if;
  if (r -> 'columns' -> 2 ->> 'key') <> 'currency' then raise exception 'FAIL T1c: no currency column with money'; end if;
  r := public.rpt_run(jsonb_build_object('source', 'expenses', 'groupBy', '["category"]'::jsonb, 'totals', '[{"column": "amount", "fn": "sum"}]'::jsonb,
                                         'period', jsonb_build_object('from', v_from, 'to', v_to)));
  if jsonb_array_length(r -> 'rows') <> 2 then raise exception 'FAIL T1d: grouped money not split by currency: %', r -> 'rows'; end if;

  -- T2: limit 1 of 2 rows
  r := public.rpt_run(d || '{"limit": 1}');
  if jsonb_array_length(r -> 'rows') <> 1 or r -> 'truncated' <> 'true' then raise exception 'FAIL T2: %', r; end if;

  -- P1: saved reports
  rc := public.rpt_save_report(null, 'Stock moves', 'All moves', d, 'company');
  ok := false; begin perform public.rpt_save_report(null, ' stock MOVES ', null, d, 'private'); exception when others then ok := (sqlerrm = 'DUPLICATE_NAME'); end;
  if not ok then raise exception 'FAIL P1a: a name used twice'; end if;
  ok := false; begin perform public.rpt_save_report(null, 'Bad', null, d - 'period', 'company'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL P1b: a bad definition saved'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.rpt_save_report(null, 'Mine', null, d, 'company'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1c: a member saved a company report'; end if;
  rp := public.rpt_save_report(null, 'Mine', null, d, 'private');
  ok := false; begin perform public.rpt_save_report(rc, 'Changed', null, d, 'company'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1d: a member changed a company report'; end if;
  if (select count(*) from public.rpt_reports where id in (rc, rp)) <> 2 then raise exception 'FAIL P1e: a member does not see the company report and their own'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.rpt_save_report(null, 'Viewer', null, d, 'private'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1f: a viewer saved a report'; end if;
  if exists (select 1 from public.rpt_reports where id = rp) then raise exception 'FAIL P1g: a viewer sees a member''s private report'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.rpt_reports where id = rp) then raise exception 'FAIL P1h: the owner sees a member''s private report'; end if;
  ok := false; begin perform public.rpt_delete_report(rp); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P1i: the owner deleted a member''s private report'; end if;
  perform public.rpt_save_report(rc, 'Stock moves this month', 'All moves', d, 'company');
  perform public.rpt_delete_report(rc);
  if exists (select 1 from public.rpt_reports where id = rc and deleted_at is null) then raise exception 'FAIL P1j: not deleted'; end if;
  rc := public.rpt_save_report(null, 'Stock moves', null, d, 'company', 'stock_moves_month');  -- the name is free again after delete

  -- G1: no direct writes
  ok := false; begin insert into public.rpt_reports (org_id, name, definition, visibility, owner_id) values (o, 'Direct', d, 'company', u); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL G1a: a direct insert worked'; end if;
  ok := false; begin update public.rpt_reports set name = 'Direct' where id = rc; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL G1b: a direct update worked'; end if;

  -- A1: audited
  reset role;
  select count(*) into n from public.audit_log where org_id = o and entity_type = 'report' and action in ('reports.report.created', 'reports.report.changed', 'reports.report.deleted');
  if n <> 5 then raise exception 'FAIL A1: % audit rows, expected 5 (3 created, 1 changed, 1 deleted)', n; end if;
  if (select template_key from public.rpt_reports where id = rc) <> 'stock_moves_month' then raise exception 'FAIL A1b: template key not kept'; end if;
  set local role authenticated;

  -- I1: the other company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.rpt_reports where org_id = o) then raise exception 'FAIL I1a: another company reads the reports'; end if;
  r := public.rpt_run(d);
  if jsonb_array_length(r -> 'rows') <> 0 then raise exception 'FAIL I1b: another company ran a report on this company''s rows'; end if;
  ok := false; begin perform public.rpt_delete_report(rc); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1c: another company deleted a report'; end if;
  ok := false; begin perform public.rpt_save_report(rc, 'Taken', null, d, 'company'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1d: another company changed a report'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  ok := false; begin perform public.rpt_run(d); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL I1e: a person ran a report for a company they are not in'; end if;

  -- Q1: every source runs with all its columns, every total that fits, and grouped by each text or date column (so every SQL
  -- expression in the catalogue is compiled at least once). Accounting is switched on directly for this check only.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting') on conflict (org_id, module_key) do update set disabled_at = null;
  perform set_config('acc.switch_on', '', true);
  set local role authenticated;
  for r in select s from jsonb_array_elements(public.rpt_sources()) s loop
    d := jsonb_build_object('source', r ->> 'key',
           'columns', (select jsonb_agg(c -> 'key') from jsonb_array_elements(r -> 'columns') c),
           'totals', (select jsonb_agg(jsonb_build_object('column', c ->> 'key', 'fn', case when c ->> 'type' in ('number', 'money') then 'sum' else 'count' end))
                        from (select c from jsonb_array_elements(r -> 'columns') c limit 5) z));
    if r ->> 'period' is not null then d := d || jsonb_build_object('period', jsonb_build_object('from', v_from, 'to', v_to)); end if;
    perform public.rpt_run(d);
    for d in select (d - 'columns') || jsonb_build_object('groupBy', jsonb_build_array(c -> 'key'))
               from jsonb_array_elements(r -> 'columns') c where c ->> 'type' in ('text', 'date') loop
      perform public.rpt_run(d);
    end loop;
  end loop;
  if jsonb_array_length(public.rpt_sources()) <> 9 then raise exception 'FAIL Q1: % sources with accounting on, expected 9', jsonb_array_length(public.rpt_sources()); end if;

  -- N1: no anonymous use
  reset role;
  set local role anon;
  ok := false; begin perform public.rpt_run(d); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL N1: anonymous ran a report'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
