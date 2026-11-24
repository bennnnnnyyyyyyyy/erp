-- sql/tests/108_rpt_report_alerts.sql
-- "Alert me when" on a saved report (sql/111). Always rolls back. Needs sql/001-111.
-- Covers: C1 an owner makes a rule on a company report (audited); C2 refusals: a total the report does not have, money without a
-- currency, a private report, no period on a dated source, an unknown comparison, a member making a rule; C3 a recipient who may not see
-- the report's data is refused (on making the rule and on changing its recipients); F1 the five-minute job (alr_run) tells the
-- recipients when the total is past the limit, linked to the rule (sql/104); F2 not again at once; F3 a rule whose limit is not passed
-- says nothing; F4 money is compared in the rule's currency only; F5 a recipient who lost the right to the data is skipped at send time;
-- F6 a deleted report stops its rule without breaking the others; F7 the existing alert kinds still run; I1 another company cannot make
-- a rule on this company's report; N1 users cannot run the job.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; cat uuid; e2 uuid; rexp uuid; rstock uuid; rpriv uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; ok boolean; n int; j jsonb;
  dexp jsonb := '{"source": "expenses", "groupBy": ["category"], "totals": [{"column": "amount", "fn": "sum"}, {"column": "category", "fn": "count"}], "period": {"from": "2026-01-01", "to": "2026-01-31"}}';
  dstock jsonb := '{"source": "stock_on_hand", "groupBy": ["warehouse"], "totals": [{"column": "available", "fn": "sum"}]}';
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ra-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'ra-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'ra-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'ra-x@tests.invalid');
  o := public.bootstrap_organization('Report alerts A', 'report-alerts-a', 'ra-o@tests.invalid');
  ob := public.bootstrap_organization('Report alerts B', 'report-alerts-b', 'ra-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  perform public.inv_create_item('RA-1', 'Cream', null, 'piece', 30, w);
  cat := public.fin_create_category('Rent');
  perform public.fin_record_expense(current_date, cat, 5000);
  e2 := (public.fin_record_expense(current_date, cat, 2000) ->> 'id')::uuid;
  rexp := public.rpt_save_report(null, 'Expenses this month', null, dexp, 'company');
  rstock := public.rpt_save_report(null, 'Stock', null, dstock, 'company');
  rpriv := public.rpt_save_report(null, 'Mine', null, dexp, 'private');

  -- C1: expenses this month above EGP 60.00 (6000 minor), told to owners
  r1 := public.alr_create_report_rule('Spending high', rexp, 'sum_amount', 'above', 6000, 'EGP', 'this_month', 24, '[{"type": "role", "role": "owner"}]');
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'alerts.rule.created' and entity_id = r1::text and summary like '%report_value%') then
    raise exception 'FAIL C1: not audited';
  end if;
  set local role authenticated;

  -- C2: refusals
  foreach j in array array[
      jsonb_build_object('report', rexp, 'total', 'sum_net', 'cur', 'EGP', 'period', 'this_month', 'cmp', 'above'),
      jsonb_build_object('report', rexp, 'total', 'sum_amount', 'cur', null, 'period', 'this_month', 'cmp', 'above'),
      jsonb_build_object('report', rexp, 'total', 'count_category', 'cur', 'EGP', 'period', 'this_month', 'cmp', 'above'),
      jsonb_build_object('report', rpriv, 'total', 'sum_amount', 'cur', 'EGP', 'period', 'this_month', 'cmp', 'above'),
      jsonb_build_object('report', rexp, 'total', 'sum_amount', 'cur', 'EGP', 'period', null, 'cmp', 'above'),
      jsonb_build_object('report', rexp, 'total', 'sum_amount', 'cur', 'EGP', 'period', 'forever', 'cmp', 'above'),
      jsonb_build_object('report', rexp, 'total', 'sum_amount', 'cur', 'EGP', 'period', 'this_month', 'cmp', 'equal'),
      jsonb_build_object('report', rstock, 'total', 'sum_available', 'cur', null, 'period', 'this_month', 'cmp', 'above')]
  loop
    ok := false;
    begin
      perform public.alr_create_report_rule('Bad', (j ->> 'report')::uuid, j ->> 'total', j ->> 'cmp', 1, j ->> 'cur', j ->> 'period', 24, '[{"type": "role", "role": "owner"}]');
    exception when others then ok := (sqlerrm = 'INVALID_INPUT');
    end;
    if not ok then raise exception 'FAIL C2: accepted %', j; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.alr_create_report_rule('Member', rstock, 'sum_available', 'above', 1, null, null, 24, '[{"type": "role", "role": "owner"}]');
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C2b: a member made an alert rule'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- C3: a member may not see expenses, so may not be told about them
  ok := false; begin perform public.alr_create_report_rule('Leak', rexp, 'sum_amount', 'above', 1, 'EGP', 'this_month', 24, '[{"type": "role", "role": "member"}]');
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C3a: a member was made a recipient of a money report alert'; end if;
  ok := false; begin perform public.alr_set_rule_recipients(r1, jsonb_build_array(jsonb_build_object('type', 'user', 'id', m)));
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C3b: a member was added as a recipient later'; end if;
  -- stock is open to members: allowed
  r2 := public.alr_create_report_rule('Lots of stock', rstock, 'sum_available', 'above', 10, null, null, 24, '[{"type": "role", "role": "member"}]');
  -- not passed: below 1000 minor (7000 is not below)
  r3 := public.alr_create_report_rule('Spending low', rexp, 'sum_amount', 'below', 1000, 'EGP', 'this_month', 24, '[{"type": "role", "role": "owner"}]');
  -- USD: nothing spent in USD, so a USD "above" rule says nothing
  r4 := public.alr_create_report_rule('Spending USD', rexp, 'sum_amount', 'above', 1, 'USD', 'this_month', 24,
                                      jsonb_build_array(jsonb_build_object('type', 'user', 'id', a), jsonb_build_object('type', 'role', 'role', 'owner')));

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.alr_create_report_rule('Spy', rexp, 'sum_amount', 'above', 1, 'EGP', 'this_month', 24, '[{"type": "role", "role": "owner"}]');
  exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1: another company made a rule on this company''s report'; end if;

  -- N1: users cannot run the job
  ok := false; begin perform public.alr_run(o); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL N1: a user ran the alert job'; end if;

  -- F1: the job (service role)
  reset role;
  j := public.alr_run(o);
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and entity_id = r1;
  if n <> 1 or not exists (select 1 from public.msg_outbox where org_id = o and entity_id = r1 and recipient_id = u and entity_type = 'alert:report_value'
                                                            and body like '%70.00 EGP%above your limit of 60.00 EGP%') then
    raise exception 'FAIL F1: % messages for the spending rule; %', n, (select string_agg(body, ' | ') from public.msg_outbox where org_id = o and entity_id = r1);
  end if;
  select count(*) into n from public.msg_outbox where org_id = o and kind = 'alert' and entity_id = r2;
  if n <> 1 or not exists (select 1 from public.msg_outbox where org_id = o and entity_id = r2 and recipient_id = m) then raise exception 'FAIL F1b: stock rule told % people', n; end if;
  if (j ->> 'alerts')::int < 2 then raise exception 'FAIL F1c: job result %', j; end if;

  -- F2: not again at once; F3: the "below" rule said nothing; F4: the USD rule said nothing
  perform public.alr_run(o);
  if (select count(*) from public.msg_outbox where org_id = o and entity_id = r1) <> 1 then raise exception 'FAIL F2: told again at once'; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and entity_id = r3) then raise exception 'FAIL F3: a limit not passed was told'; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and entity_id = r4) then raise exception 'FAIL F4: EGP spending counted in USD'; end if;

  -- F4b and F5: one expense moved to USD; the admin recipient is now only a member, so is skipped; the owner is told
  update public.fin_expenses set currency = 'USD' where id = e2;
  update public.memberships set role = 'member' where org_id = o and user_id = a;
  perform public.alr_run(o);
  if not exists (select 1 from public.msg_outbox where org_id = o and entity_id = r4 and recipient_id = u and body like '%20.00 USD%') then raise exception 'FAIL F4b: USD not told'; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and entity_id = r4 and recipient_id = a) then raise exception 'FAIL F5: a person who may no longer see the data was told'; end if;

  -- F6: a deleted report stops its rule; the job still runs
  update public.rpt_reports set deleted_at = now() where id = rstock;
  update public.alr_firings set last_fired_at = now() - interval '2 days' where rule_id = r2;
  j := public.alr_run(o);
  if (select count(*) from public.msg_outbox where org_id = o and entity_id = r2) <> 1 then raise exception 'FAIL F6: a deleted report still alerts'; end if;

  -- F7: the existing kinds still run through alr_run (a low stock rule)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  r3 := public.alr_create_rule('Low cream', 'stock_below', null, 100, 24, '[{"type": "role", "role": "owner"}]');
  reset role;
  perform public.alr_run(o);
  if not exists (select 1 from public.msg_outbox where org_id = o and entity_id = r3 and entity_type = 'alert:stock_below') then raise exception 'FAIL F7: the existing alerts stopped'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
