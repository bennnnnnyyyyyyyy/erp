-- sql/tests/109_rpt_schedules.sql
-- Scheduled reports and the small fixes of sql/112. Always rolls back. Needs sql/001-112.
-- Covers: T1 the next send time (daily, weekly, monthly; the hour in the time zone) and the period dates; C1 an owner makes a schedule
-- (audited, next send computed); C2 refusals (private report, bad frequency, weekday, month day, hour, period, a dated report without a
-- period, a snapshot report with one, no recipients, a member making one); C3 a recipient who may not see the report's data is refused;
-- C4 direct writes are refused; R1 members and other companies cannot read schedules; I1 another company cannot make, pause or delete
-- one; J1 the job sends a due schedule (name, period, totals, first rows, the report as target), audited, next time moved on; J2 not
-- again before the next time; J3 a recipient who lost the right is skipped; J4 a paused schedule is not sent, resuming computes a new
-- time; J5 a deleted report switches its schedule off (audited) without stopping the others; J6 deleting a schedule (audited);
-- N1 users cannot run the job; S1 a stock shortage names the item; P1 a note's print data carries its invoice's id; H1 the home card
-- "Top products" counts the same 90 days as the ready-made report.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; it uuid; cat uuid; rexp uuid; rstock uuid; rpriv uuid; s1 uuid; s2 uuid; s3 uuid; ok boolean; n int; j jsonb; v_detail text;
  t timestamptz := '2026-11-25 10:00:00+00';  -- a Wednesday
  dexp jsonb := '{"source": "expenses", "groupBy": ["category"], "totals": [{"column": "amount", "fn": "sum"}, {"column": "category", "fn": "count"}], "period": {"from": "2026-01-01", "to": "2026-01-31"}}';
  dstock jsonb := '{"source": "stock_on_hand", "groupBy": ["warehouse"], "totals": [{"column": "available", "fn": "sum"}]}';
  owners jsonb := '[{"type": "role", "role": "owner"}]';
begin
  -- T1: the next send time and the period dates
  if public.rpt__schedule_next('daily', null, null, 8, 'UTC', t) <> '2026-11-26 08:00:00+00' then raise exception 'FAIL T1a: daily'; end if;
  if public.rpt__schedule_next('daily', null, null, 11, 'UTC', t) <> '2026-11-25 11:00:00+00' then raise exception 'FAIL T1b: later the same day'; end if;
  if public.rpt__schedule_next('weekly', 1, null, 8, 'UTC', t) <> '2026-11-30 08:00:00+00' then raise exception 'FAIL T1c: weekly Monday'; end if;
  if public.rpt__schedule_next('weekly', 3, null, 10, 'UTC', t) <> '2026-12-02 10:00:00+00' then raise exception 'FAIL T1d: not the same moment again'; end if;
  if public.rpt__schedule_next('monthly', null, 1, 8, 'UTC', t) <> '2026-12-01 08:00:00+00' then raise exception 'FAIL T1e: monthly'; end if;
  if public.rpt__schedule_next('daily', null, null, 8, 'Africa/Cairo', t) <> '2026-11-26 06:00:00+00' then raise exception 'FAIL T1f: 08:00 in Cairo is 06:00 UTC in November'; end if;

  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'rs-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'rs-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'rs-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'rs-x@tests.invalid');
  o := public.bootstrap_organization('Report schedules A', 'report-schedules-a', 'rs-o@tests.invalid');
  ob := public.bootstrap_organization('Report schedules B', 'report-schedules-b', 'rs-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  update public.organizations set timezone = 'UTC' where id = o;

  j := public.rpt__schedule_dates(o, 'last_week', t);
  if j <> '{"from": "2026-11-16", "to": "2026-11-22"}'::jsonb then raise exception 'FAIL T1g: last week %', j; end if;
  j := public.rpt__schedule_dates(o, 'last_month', t);
  if j <> '{"from": "2026-10-01", "to": "2026-10-31"}'::jsonb then raise exception 'FAIL T1h: last month %', j; end if;
  j := public.rpt__schedule_dates(o, 'last_7_days', t);
  if j <> '{"from": "2026-11-18", "to": "2026-11-24"}'::jsonb then raise exception 'FAIL T1i: last 7 days %', j; end if;

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  it := public.inv_create_item('RS-1', 'Cream', null, 'piece', 30, w);
  cat := public.fin_create_category('Rent');
  perform public.fin_record_expense(current_date, cat, 5000);
  perform public.fin_record_expense(current_date, cat, 2000);
  rexp := public.rpt_save_report(null, 'Expenses', null, dexp, 'company');
  rstock := public.rpt_save_report(null, 'Stock', null, dstock, 'company');
  rpriv := public.rpt_save_report(null, 'Mine', null, dexp, 'private');

  -- C1: every Monday at 08:00, this month's expenses, to the owners
  s1 := public.rpt_save_schedule(null, rexp, 'weekly', 1, null, 8, 'this_month', owners);
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'reports.schedule.created' and entity_id = s1::text) then raise exception 'FAIL C1a: not audited'; end if;
  if (select extract(isodow from next_run_at at time zone 'UTC') || ':' || extract(hour from next_run_at at time zone 'UTC') from public.rpt_schedules where id = s1) <> '1:8'
     or (select next_run_at from public.rpt_schedules where id = s1) <= now() then
    raise exception 'FAIL C1b: next send %', (select next_run_at from public.rpt_schedules where id = s1);
  end if;
  set local role authenticated;

  -- C2: refusals
  foreach j in array array[
      jsonb_build_object('r', rpriv, 'f', 'daily', 'wd', null, 'md', null, 'h', 8, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'hourly', 'wd', null, 'md', null, 'h', 8, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'weekly', 'wd', null, 'md', null, 'h', 8, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'weekly', 'wd', 8, 'md', null, 'h', 8, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'monthly', 'wd', null, 'md', 29, 'h', 8, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'daily', 'wd', null, 'md', null, 'h', 24, 'p', 'yesterday'),
      jsonb_build_object('r', rexp, 'f', 'daily', 'wd', null, 'md', null, 'h', 8, 'p', 'forever'),
      jsonb_build_object('r', rexp, 'f', 'daily', 'wd', null, 'md', null, 'h', 8, 'p', null),
      jsonb_build_object('r', rstock, 'f', 'daily', 'wd', null, 'md', null, 'h', 8, 'p', 'yesterday')]
  loop
    ok := false;
    begin
      perform public.rpt_save_schedule(null, (j ->> 'r')::uuid, j ->> 'f', (j ->> 'wd')::int, (j ->> 'md')::int, (j ->> 'h')::int, j ->> 'p', owners);
    exception when others then ok := (sqlerrm = 'INVALID_INPUT');
    end;
    if not ok then raise exception 'FAIL C2: accepted %', j; end if;
  end loop;
  ok := false; begin perform public.rpt_save_schedule(null, rexp, 'daily', null, null, 8, 'yesterday', '[]'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C2b: no recipients accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.rpt_save_schedule(null, rstock, 'daily', null, null, 8, null, owners); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C2c: a member made a schedule'; end if;
  -- R1: a member reads no schedules
  if exists (select 1 from public.rpt_schedules) or exists (select 1 from public.rpt_schedule_recipients) then raise exception 'FAIL R1a: a member reads schedules'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- C3: a member may not see expenses, so may not get them; stock is open to members
  ok := false; begin perform public.rpt_save_schedule(null, rexp, 'daily', null, null, 8, 'yesterday', jsonb_build_array(jsonb_build_object('type', 'user', 'id', m)));
  exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C3a: a member was made a recipient of an expenses report'; end if;
  s2 := public.rpt_save_schedule(null, rstock, 'daily', null, null, 7, null, '[{"type": "role", "role": "member"}]');
  s3 := public.rpt_save_schedule(null, rexp, 'daily', null, null, 9, 'this_month',
                                 jsonb_build_array(jsonb_build_object('type', 'user', 'id', a), jsonb_build_object('type', 'role', 'role', 'owner')));
  -- changing a schedule: audited with before and after
  perform public.rpt_save_schedule(s1, rexp, 'monthly', null, 1, 8, 'this_month', owners);
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'reports.schedule.changed' and entity_id = s1::text and before ->> 'frequency' = 'weekly' and after ->> 'frequency' = 'monthly') then
    raise exception 'FAIL C3b: the change was not audited before and after';
  end if;
  if (select weekday from public.rpt_schedules where id = s1) is not null then raise exception 'FAIL C3c: the old weekday stayed'; end if;
  set local role authenticated;

  -- C4: direct writes are refused
  ok := false; begin insert into public.rpt_schedules (org_id, report_id, frequency, send_hour, created_by) values (o, rstock, 'daily', 1, u); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL C4a: a direct insert worked'; end if;
  ok := false; begin update public.rpt_schedules set enabled = false; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL C4b: a direct update worked'; end if;
  if (select count(*) from public.rpt_schedules) <> 3 then raise exception 'FAIL C4c: the owner does not read the 3 schedules'; end if;
  if jsonb_array_length(public.rpt_schedule_list()) <> 3 then raise exception 'FAIL C4d: the list does not show 3'; end if;

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.rpt_save_schedule(null, rexp, 'daily', null, null, 8, 'yesterday', owners); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1a: another company made a schedule on this company''s report'; end if;
  ok := false; begin perform public.rpt_set_schedule_enabled(s1, false); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1b: another company paused a schedule'; end if;
  ok := false; begin perform public.rpt_delete_schedule(s1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1c: another company deleted a schedule'; end if;
  if exists (select 1 from public.rpt_schedules) or jsonb_array_length(public.rpt_schedule_list()) <> 0 then raise exception 'FAIL R1b: another company reads the schedules'; end if;

  -- N1: users cannot run the job
  ok := false; begin perform public.rpt_run_schedules(o); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL N1: a user ran the schedule job'; end if;
  reset role;

  -- J1: s3 is due (to the admin and the owner)
  update public.rpt_schedules set next_run_at = now() - interval '1 minute' where id = s3;
  j := public.rpt_run_schedules(o);
  if (j ->> 'schedules')::int <> 1 or (j ->> 'messages')::int <> 2 then raise exception 'FAIL J1a: job result %', j; end if;
  if not exists (select 1 from public.msg_outbox where org_id = o and recipient_id = u and entity_type = 'report' and entity_id = rexp and subject = 'Report: Expenses'
                   and body like 'Period: %' and body like '%sum of amount: 70.00 EGP; count of category: 2%' and body like '%1. Rent | 70.00 EGP | 2%') then
    raise exception 'FAIL J1b: message %', (select string_agg(body, ' || ') from public.msg_outbox where org_id = o and entity_id = rexp);
  end if;
  if (select next_run_at from public.rpt_schedules where id = s3) <= now() or (select last_sent_at from public.rpt_schedules where id = s3) is null then raise exception 'FAIL J1c: times not moved on'; end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'reports.schedule.sent' and entity_id = s3::text and (metadata ->> 'messages')::int = 2) then raise exception 'FAIL J1d: send not audited'; end if;

  -- J2: not again before its time
  j := public.rpt_run_schedules(o);
  if (j ->> 'schedules')::int <> 0 then raise exception 'FAIL J2: sent again at once: %', j; end if;

  -- J3: the admin is now only a member, so may no longer see expenses: skipped; the owner still gets it
  update public.memberships set role = 'member' where org_id = o and user_id = a;
  update public.rpt_schedules set next_run_at = now() - interval '2 minutes' where id = s3;  -- a new send time (now() is fixed in one transaction)
  j := public.rpt_run_schedules(o);
  if (j ->> 'messages')::int <> 1 then raise exception 'FAIL J3: % messages (expected only the owner)', j ->> 'messages'; end if;
  update public.memberships set role = 'admin' where org_id = o and user_id = a;

  -- J4: paused is not sent; resuming computes a new time
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rpt_set_schedule_enabled(s2, false);
  reset role;
  update public.rpt_schedules set next_run_at = now() - interval '1 minute' where id = s2;
  j := public.rpt_run_schedules(o);
  if (j ->> 'schedules')::int <> 0 then raise exception 'FAIL J4a: a paused schedule was sent'; end if;
  set local role authenticated;
  perform public.rpt_set_schedule_enabled(s2, true);
  reset role;
  if (select next_run_at from public.rpt_schedules where id = s2) <= now() then raise exception 'FAIL J4b: resuming did not compute a new time'; end if;
  if (select count(*) from public.audit_log where org_id = o and entity_id = s2::text and action in ('reports.schedule.paused', 'reports.schedule.resumed')) <> 2 then raise exception 'FAIL J4c: pause and resume not audited'; end if;

  -- J5: a deleted report switches its schedule off; the other due schedule is still sent
  update public.rpt_reports set deleted_at = now() where id = rstock;
  update public.rpt_schedules set next_run_at = now() - interval '3 minutes' where id in (s2, s3);  -- s3: yet another send time
  j := public.rpt_run_schedules(o);
  if (j ->> 'schedules')::int <> 1 then raise exception 'FAIL J5a: the other schedule was not sent: %', j; end if;
  if (select enabled from public.rpt_schedules where id = s2) or not exists (select 1 from public.audit_log where org_id = o and action = 'reports.schedule.stopped' and entity_id = s2::text) then
    raise exception 'FAIL J5b: the schedule of a deleted report was not switched off';
  end if;

  -- J6: delete (soft), audited
  set local role authenticated;
  perform public.rpt_delete_schedule(s1);
  if jsonb_array_length(public.rpt_schedule_list()) <> 2 then raise exception 'FAIL J6a: a deleted schedule is still listed'; end if;
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'reports.schedule.deleted' and entity_id = s1::text) then raise exception 'FAIL J6b: delete not audited'; end if;

  -- S1: a stock shortage names the item
  set local role authenticated;
  ok := false;
  begin perform public.inv_submit_request(w, 'too much', jsonb_build_array(jsonb_build_object('itemId', it, 'qty', 80)));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    ok := sqlerrm = 'INSUFFICIENT_AVAILABLE' and v_detail like 'RS-1 Cream: % available, 80 requested';
  end;
  reset role;
  if not ok then raise exception 'FAIL S1: the shortage does not name the item (%)', v_detail; end if;

  -- P1: a note's print data carries its invoice's id (the document part of sal__doc_print_data)
  if position('''invoiceId'', i.id, ''invoiceNumber'', i.number' in pg_get_functiondef('public.sal__doc_print_data(uuid,text,uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL P1: the note print data has no invoiceId';
  end if;

  -- H1: the home card "Top products" counts the same 90 days as the ready-made report (today and the 89 days before, company time)
  if position('acc__local_date(v_org, now()) - 89' in pg_get_functiondef('public.insights_home()'::regprocedure)) = 0 then
    raise exception 'FAIL H1: the home card still counts 91 days';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
