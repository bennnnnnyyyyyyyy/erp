-- sql/112_rpt_schedules.sql
-- Reports & Insights, step 6 (documentation/plans/REPORTS_INSIGHTS_PLAN.md sections 3.3 and 7.6): scheduled reports, plus five small
-- fixes from the 25 Nov 2026 audits.
-- 1. rpt_schedules: a saved COMPANY report sent daily, weekly (ISO weekday 1 = Monday) or monthly (day 1-28), at an hour in the company's
--    time zone, for a rolling period (yesterday, the last 7 days, last week, this month, last month; none for a snapshot report such as
--    stock on hand). Recipients like alerts (people, roles or alert teams), in rpt_schedule_recipients. Company members only (Q3).
--    Owners and admins read them (row level security), and change them only through rpt_save_schedule, rpt_set_schedule_enabled and
--    rpt_delete_schedule (soft delete), each audited before and after. A recipient who may not open the report's data is refused,
--    the same rule as report alerts (sql/111). next_run_at is computed by the database on every change and after every send.
-- 2. rpt_run_schedules (the five-minute job, service role only): for each schedule that is due, runs the report with the maker's role
--    (which must still allow it), and queues one message per recipient who may still see the data: the report name, the period, the
--    totals, the first 5 rows, and the report as the message's target (the bell opens it). Each send is audited. A schedule whose report
--    or maker is gone is switched off (audited); a failure is audited and the schedule tries again at its next time, not every 5 minutes.
-- 3. Report alerts (sql/111 rpt__alert_run) now target the report itself (entity 'report'), so members open it from the bell too
--    (before, the bell had to read alr_rules, which only owners and admins may read). Existing report-alert messages are moved over.
-- 4. The chasing job (msg_run_chasing, last defined in sql/013) no longer sends its own "Low stock: <code> <name>" message: the alert
--    engine's low stock rule (sql/028) already does, so people got it twice. The result keeps "low_stock": 0.
-- 5. A stock shortage names the item: "<code> <name>: 3 available, 8 requested" (inv_submit_request sql/006, inv_submit_transfer sql/034).
-- 6. A credit or debit note's print data carries its invoice's id (sal__doc_print_data, sql/103), so the print page can go back to it.
-- 7. The home card "Top products" (insights_home, sql/094) counts the same 90 days as the ready-made "Top 20 products": today and the
--    89 days before it, in the company's time zone. It counted 91 days by the server's date, so on 24 Nov 2026 one invoice of 26 Aug
--    (EGP 81,259.20 of sunscreen) was in the card and not in the report (712,192 against 630,933).
-- Copied functions are the latest versions (checked 25 Nov 2026) with only the change named above.
-- Rerun-safe. Needs sql/001-111. Then run sql/tests/109_rpt_schedules.sql and sql/tests/092_column_grants.sql. Ends with read-only checks.

begin;

-- ---------------------------------------------------------------- 1. the tables

create table if not exists public.rpt_schedules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  report_id    uuid not null,
  frequency    text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday      int check (weekday between 1 and 7),
  month_day    int check (month_day between 1 and 28),
  send_hour    int not null check (send_hour between 0 and 23),
  period       text check (period is null or period in ('yesterday', 'last_7_days', 'last_week', 'this_month', 'last_month')),
  enabled      boolean not null default true,
  next_run_at  timestamptz,
  last_sent_at timestamptz,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, id),
  foreign key (org_id, report_id) references public.rpt_reports(org_id, id),
  check ((frequency = 'weekly') = (weekday is not null)),
  check ((frequency = 'monthly') = (month_day is not null))
);
create index if not exists rpt_schedules_org_idx on public.rpt_schedules(org_id, report_id) where deleted_at is null;
create index if not exists rpt_schedules_due_idx on public.rpt_schedules(next_run_at) where enabled and deleted_at is null;

create table if not exists public.rpt_schedule_recipients (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  schedule_id uuid not null,
  team_id     uuid,
  role        text check (role in ('owner', 'admin', 'member', 'viewer')),
  user_id     uuid references auth.users(id),
  foreign key (org_id, schedule_id) references public.rpt_schedules(org_id, id),
  foreign key (org_id, team_id) references public.alr_teams(org_id, id),
  check ((team_id is not null)::int + (role is not null)::int + (user_id is not null)::int = 1)
);
create index if not exists rpt_schedule_recipients_idx on public.rpt_schedule_recipients(org_id, schedule_id);

alter table public.rpt_schedules enable row level security;
alter table public.rpt_schedule_recipients enable row level security;
revoke all on public.rpt_schedules, public.rpt_schedule_recipients from anon, authenticated;
grant select on public.rpt_schedules, public.rpt_schedule_recipients to authenticated;
-- owners and admins read them (who gets which numbers is a setting, not for everyone; same as alert rules)
drop policy if exists rpt_schedules_admin_read on public.rpt_schedules;
create policy rpt_schedules_admin_read on public.rpt_schedules for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = rpt_schedules.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));
drop policy if exists rpt_schedule_recipients_admin_read on public.rpt_schedule_recipients;
create policy rpt_schedule_recipients_admin_read on public.rpt_schedule_recipients for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = rpt_schedule_recipients.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));

-- ---------------------------------------------------------------- helpers

-- The first send time after p_after: the hour on a matching day, in the time zone.
create or replace function public.rpt__schedule_next(p_frequency text, p_weekday int, p_month_day int, p_hour int, p_tz text, p_after timestamptz)
returns timestamptz
language plpgsql stable set search_path = public as $$
declare
  d date := (p_after at time zone p_tz)::date;
  c timestamptz;
begin
  for i in 0..62 loop
    c := ((d + i) + make_time(p_hour, 0, 0)) at time zone p_tz;
    if c > p_after and (p_frequency = 'daily'
                        or (p_frequency = 'weekly' and extract(isodow from d + i)::int = p_weekday)
                        or (p_frequency = 'monthly' and extract(day from d + i)::int = p_month_day)) then
      return c;
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.rpt__schedule_next(text, int, int, int, text, timestamptz) from public, anon, authenticated;

-- The dates a schedule's period covers when it is sent at p_at, in the company's time zone. Whole days before the send day, except
-- "this month", which runs to the send day.
create or replace function public.rpt__schedule_dates(p_org uuid, p_period text, p_at timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select (p_at at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC'))::date as d)
  select case p_period
    when 'yesterday' then jsonb_build_object('from', t.d - 1, 'to', t.d - 1)
    when 'last_7_days' then jsonb_build_object('from', t.d - 7, 'to', t.d - 1)
    when 'last_week' then jsonb_build_object('from', date_trunc('week', t.d)::date - 7, 'to', date_trunc('week', t.d)::date - 1)
    when 'this_month' then jsonb_build_object('from', date_trunc('month', t.d)::date, 'to', t.d)
    when 'last_month' then jsonb_build_object('from', (date_trunc('month', t.d) - interval '1 month')::date, 'to', date_trunc('month', t.d)::date - 1)
  end from t
$$;
revoke all on function public.rpt__schedule_dates(uuid, text, timestamptz) from public, anon, authenticated;

-- The report's definition as a schedule runs it: its own columns, totals and order, the schedule's period, the first 5 rows.
create or replace function public.rpt__schedule_definition(p_def jsonb, p_org uuid, p_period text, p_at timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select (p_def - 'period' - 'chart' - 'limit')
         || jsonb_build_object('limit', 5)
         || case when p_period is null then '{}'::jsonb else jsonb_build_object('period', public.rpt__schedule_dates(p_org, p_period, p_at)) end
$$;
revoke all on function public.rpt__schedule_definition(jsonb, uuid, text, timestamptz) from public, anon, authenticated;

-- p_recipients: [{"type":"team","id":uuid} | {"type":"role","role":"admin"} | {"type":"user","id":uuid}], at least one (sql/028's shape)
create or replace function public.rpt__set_schedule_recipients(p_org uuid, p_schedule uuid, p_recipients jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'choose who gets the report';
  end if;
  if jsonb_array_length(p_recipients) > 50 then raise exception 'INVALID_INPUT' using detail = 'at most 50 recipients'; end if;
  delete from public.rpt_schedule_recipients where org_id = p_org and schedule_id = p_schedule;
  for e in select value from jsonb_array_elements(p_recipients) loop
    begin
      if e ->> 'type' = 'team' then
        if not exists (select 1 from public.alr_teams where org_id = p_org and id = (e ->> 'id')::uuid) then raise exception 'NOT_FOUND'; end if;
        insert into public.rpt_schedule_recipients (org_id, schedule_id, team_id) values (p_org, p_schedule, (e ->> 'id')::uuid);
      elsif e ->> 'type' = 'role' then
        insert into public.rpt_schedule_recipients (org_id, schedule_id, role) values (p_org, p_schedule, e ->> 'role');
      elsif e ->> 'type' = 'user' then
        if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (e ->> 'id')::uuid and m.disabled_at is null) then raise exception 'NOT_FOUND'; end if;
        insert into public.rpt_schedule_recipients (org_id, schedule_id, user_id) values (p_org, p_schedule, (e ->> 'id')::uuid);
      else
        raise exception 'INVALID_INPUT';
      end if;
    exception when invalid_text_representation or check_violation then raise exception 'INVALID_INPUT';
    end;
  end loop;
end $$;
revoke all on function public.rpt__set_schedule_recipients(uuid, uuid, jsonb) from public, anon, authenticated;

-- The active members a schedule reaches (before the "may see the data" check).
create or replace function public.rpt__schedule_recipients(p_org uuid, p_schedule uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct m.user_id from public.memberships m
   where m.org_id = p_org and m.disabled_at is null and (
     m.user_id in (select tm.user_id from public.rpt_schedule_recipients rr join public.alr_team_members tm on tm.org_id = rr.org_id and tm.team_id = rr.team_id
                    where rr.org_id = p_org and rr.schedule_id = p_schedule)
     or m.role in (select rr.role from public.rpt_schedule_recipients rr where rr.org_id = p_org and rr.schedule_id = p_schedule and rr.role is not null)
     or m.user_id in (select rr.user_id from public.rpt_schedule_recipients rr where rr.org_id = p_org and rr.schedule_id = p_schedule and rr.user_id is not null));
$$;
revoke all on function public.rpt__schedule_recipients(uuid, uuid) from public, anon, authenticated;

-- A value as the message shows it: money in major units with its currency, numbers without trailing zeros, the rest as text.
create or replace function public.rpt__show_value(p_type text, p_value jsonb, p_currency text) returns text
language sql immutable as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then '-'
    when p_type = 'money' then to_char(round((p_value #>> '{}')::numeric / 100.0, 2), 'FM999,999,999,999,990.00') || coalesce(' ' || p_currency, '')
    when p_type = 'number' then trim(to_char((p_value #>> '{}')::numeric, 'FM999,999,999,999,990.###'), '.')
    else left(p_value #>> '{}', 80)
  end
$$;
revoke all on function public.rpt__show_value(text, jsonb, text) from public, anon, authenticated;

-- The message text for one send: the period, the totals (one line per currency) and the first 5 rows.
create or replace function public.rpt__schedule_text(p_dates jsonb, p_res jsonb) returns text
language plpgsql immutable as $$
declare
  v_cols  jsonb := coalesce(p_res -> 'columns', '[]');
  v_cur_i int;
  v_out   text := '';
  v_line  text;
  l       jsonb;
  r       jsonb;
  n       int := 0;
begin
  if p_dates is not null then
    v_out := 'Period: ' || case when p_dates ->> 'from' = p_dates ->> 'to' then p_dates ->> 'from' else (p_dates ->> 'from') || ' to ' || (p_dates ->> 'to') end || E'\n';
  end if;
  -- totals
  for l in select x from jsonb_array_elements(coalesce(p_res -> 'totalRows', '[]')) x loop
    select string_agg(replace(t ->> 'key', '_', ' of ') || ': ' || public.rpt__show_value(t ->> 'type', l -> 'values' -> (k - 1)::int, l ->> 'currency'), '; ' order by k)
      into v_line from jsonb_array_elements(coalesce(p_res -> 'totals', '[]')) with ordinality z(t, k);
    if v_line is not null then v_out := v_out || 'Totals: ' || v_line || E'\n'; end if;
  end loop;
  -- the first 5 rows
  select (k - 1)::int into v_cur_i from jsonb_array_elements(v_cols) with ordinality z(c, k) where c ->> 'type' = 'currency' limit 1;
  for r in select x from jsonb_array_elements(coalesce(p_res -> 'rows', '[]')) x loop
    n := n + 1;
    exit when n > 5;
    if n = 1 then v_out := v_out || 'First rows:' || E'\n'; end if;
    select string_agg(public.rpt__show_value(c ->> 'type', r -> (k - 1)::int, case when v_cur_i is null then null else r ->> v_cur_i end), ' | ' order by k)
      into v_line from jsonb_array_elements(v_cols) with ordinality z(c, k) where c ->> 'type' <> 'currency';
    v_out := v_out || n || '. ' || coalesce(v_line, '') || E'\n';
  end loop;
  if n = 0 then v_out := v_out || 'No rows for this period.' || E'\n'; end if;
  return v_out || 'Open the full report in Reports & Insights.';
end $$;
revoke all on function public.rpt__schedule_text(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. making and changing a schedule (owners and admins, audited)

-- p_id null makes a new one. The report must be a live company report the caller may run with the schedule's period, and every
-- recipient must be someone who may open that report's data.
create or replace function public.rpt_save_schedule(p_id uuid, p_report_id uuid, p_frequency text, p_weekday int, p_month_day int,
                                                    p_send_hour int, p_period text, p_recipients jsonb, p_enabled boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.mod__guard('reports', array['owner', 'admin']);
  v_role    text;
  v_tz      text;
  rp        public.rpt_reports;
  s         public.rpt_schedules;
  v_src     jsonb;
  v_next    timestamptz;
  v_id      uuid;
  v_blocked int;
  v_before  jsonb;
begin
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = v_org;
  select * into rp from public.rpt_reports r where r.org_id = v_org and r.id = p_report_id and r.deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'report not found'; end if;
  if rp.visibility <> 'company' then raise exception 'INVALID_INPUT' using detail = 'only company reports can be sent on a schedule'; end if;
  if p_frequency is null or p_frequency not in ('daily', 'weekly', 'monthly') then raise exception 'INVALID_INPUT' using detail = 'daily, weekly or monthly'; end if;
  if p_frequency = 'weekly' and (p_weekday is null or p_weekday not between 1 and 7) then raise exception 'INVALID_INPUT' using detail = 'choose the day of the week'; end if;
  if p_frequency = 'monthly' and (p_month_day is null or p_month_day not between 1 and 28) then raise exception 'INVALID_INPUT' using detail = 'choose a day of the month from 1 to 28'; end if;
  if p_send_hour is null or p_send_hour not between 0 and 23 then raise exception 'INVALID_INPUT' using detail = 'choose the hour, 0 to 23'; end if;
  if p_period is not null and p_period not in ('yesterday', 'last_7_days', 'last_week', 'this_month', 'last_month') then
    raise exception 'INVALID_INPUT' using detail = 'unknown period';
  end if;
  v_src := public.rpt__catalog() -> (rp.definition ->> 'source');
  if (v_src ->> 'periodRequired')::boolean and p_period is null then raise exception 'INVALID_INPUT' using detail = 'choose the period the report covers'; end if;
  if v_src ->> 'period' is null and p_period is not null then raise exception 'INVALID_INPUT' using detail = 'this report has no period'; end if;
  -- the caller must be able to run it, with the schedule's period
  perform public.rpt__check(public.rpt__schedule_definition(rp.definition, v_org, p_period, now()), v_org, v_role);
  v_next := case when coalesce(p_enabled, true)
                 then public.rpt__schedule_next(p_frequency, case when p_frequency = 'weekly' then p_weekday end,
                                                case when p_frequency = 'monthly' then p_month_day end, p_send_hour, v_tz, now()) end;

  if p_id is null then
    insert into public.rpt_schedules (org_id, report_id, frequency, weekday, month_day, send_hour, period, enabled, next_run_at, created_by)
    values (v_org, rp.id, p_frequency, case when p_frequency = 'weekly' then p_weekday end, case when p_frequency = 'monthly' then p_month_day end,
            p_send_hour, p_period, coalesce(p_enabled, true), v_next, auth.uid())
    returning id into v_id;
  else
    select * into s from public.rpt_schedules x where x.org_id = v_org and x.id = p_id and x.deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_before := jsonb_build_object('report_id', s.report_id, 'frequency', s.frequency, 'weekday', s.weekday, 'month_day', s.month_day,
                                   'send_hour', s.send_hour, 'period', s.period, 'enabled', s.enabled,
                                   'recipients', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('team', rr.team_id, 'role', rr.role, 'user', rr.user_id))), '[]')
                                                    from public.rpt_schedule_recipients rr where rr.org_id = v_org and rr.schedule_id = s.id));
    update public.rpt_schedules x
       set report_id = rp.id, frequency = p_frequency, weekday = case when p_frequency = 'weekly' then p_weekday end,
           month_day = case when p_frequency = 'monthly' then p_month_day end, send_hour = p_send_hour, period = p_period,
           enabled = coalesce(p_enabled, true), next_run_at = v_next, updated_at = now()
     where x.id = s.id;
    v_id := s.id;
  end if;
  perform public.rpt__set_schedule_recipients(v_org, v_id, p_recipients);
  select count(*)::int into v_blocked from public.rpt__schedule_recipients(v_org, v_id) x
    join public.memberships m on m.org_id = v_org and m.user_id = x.user_id and m.disabled_at is null
   where not (m.role = any (array(select jsonb_array_elements_text(v_src -> 'roles'))));
  if v_blocked > 0 then raise exception 'FORBIDDEN' using detail = 'some recipients may not see this report''s data'; end if;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), case when p_id is null then 'reports.schedule.created' else 'reports.schedule.changed' end, 'report_schedule', v_id::text,
          format('Schedule for report "%s": %s at %s:00%s', rp.name, p_frequency, p_send_hour, coalesce(', ' || p_period, '')),
          v_before,
          jsonb_build_object('report_id', rp.id, 'frequency', p_frequency, 'weekday', p_weekday, 'month_day', p_month_day, 'send_hour', p_send_hour,
                             'period', p_period, 'enabled', coalesce(p_enabled, true), 'recipients', p_recipients));
  return v_id;
end $$;
revoke all on function public.rpt_save_schedule(uuid, uuid, text, int, int, int, text, jsonb, boolean) from public, anon;
grant execute on function public.rpt_save_schedule(uuid, uuid, text, int, int, int, text, jsonb, boolean) to authenticated;

-- Pause or resume. Resuming computes the next send time from now (no catch-up of the sends that were paused).
create or replace function public.rpt_set_schedule_enabled(p_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.mod__guard('reports', array['owner', 'admin']);
  s     public.rpt_schedules;
  v_tz  text;
begin
  if p_enabled is null then raise exception 'INVALID_INPUT'; end if;
  select * into s from public.rpt_schedules x where x.org_id = v_org and x.id = p_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = v_org;
  update public.rpt_schedules x
     set enabled = p_enabled, updated_at = now(),
         next_run_at = case when p_enabled then public.rpt__schedule_next(s.frequency, s.weekday, s.month_day, s.send_hour, v_tz, now()) end
   where x.id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), case when p_enabled then 'reports.schedule.resumed' else 'reports.schedule.paused' end, 'report_schedule', s.id::text,
          format('Schedule for report "%s" %s', (select r.name from public.rpt_reports r where r.org_id = v_org and r.id = s.report_id),
                 case when p_enabled then 'resumed' else 'paused' end),
          jsonb_build_object('enabled', s.enabled), jsonb_build_object('enabled', p_enabled));
end $$;
revoke all on function public.rpt_set_schedule_enabled(uuid, boolean) from public, anon;
grant execute on function public.rpt_set_schedule_enabled(uuid, boolean) to authenticated;

-- Delete (soft). Audited.
create or replace function public.rpt_delete_schedule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.mod__guard('reports', array['owner', 'admin']);
  s     public.rpt_schedules;
begin
  select * into s from public.rpt_schedules x where x.org_id = v_org and x.id = p_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.rpt_schedules x set enabled = false, next_run_at = null, deleted_at = now(), updated_at = now() where x.id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'reports.schedule.deleted', 'report_schedule', s.id::text,
          format('Schedule for report "%s" deleted', (select r.name from public.rpt_reports r where r.org_id = v_org and r.id = s.report_id)),
          jsonb_build_object('report_id', s.report_id, 'frequency', s.frequency, 'weekday', s.weekday, 'month_day', s.month_day,
                             'send_hour', s.send_hour, 'period', s.period, 'enabled', s.enabled));
end $$;
revoke all on function public.rpt_delete_schedule(uuid) from public, anon;
grant execute on function public.rpt_delete_schedule(uuid) to authenticated;

-- The company's schedules for the screen (owners and admins), with the report's name and the recipients.
create or replace function public.rpt_schedule_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('reports', array['owner', 'admin']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'reportId', s.report_id, 'reportName', r.name, 'reportDeleted', r.deleted_at is not null,
             'frequency', s.frequency, 'weekday', s.weekday, 'monthDay', s.month_day, 'sendHour', s.send_hour, 'period', s.period,
             'enabled', s.enabled, 'nextRunAt', s.next_run_at, 'lastSentAt', s.last_sent_at, 'createdAt', s.created_at,
             'recipients', (select coalesce(jsonb_agg(case when rr.team_id is not null then jsonb_build_object('type', 'team', 'id', rr.team_id)
                                                           when rr.role is not null then jsonb_build_object('type', 'role', 'role', rr.role)
                                                           else jsonb_build_object('type', 'user', 'id', rr.user_id) end), '[]')
                              from public.rpt_schedule_recipients rr where rr.org_id = v_org and rr.schedule_id = s.id))
           order by r.name, s.created_at)
      from public.rpt_schedules s join public.rpt_reports r on r.org_id = s.org_id and r.id = s.report_id
     where s.org_id = v_org and s.deleted_at is null), '[]'::jsonb);
end $$;
revoke all on function public.rpt_schedule_list() from public, anon;
grant execute on function public.rpt_schedule_list() to authenticated;

-- ---------------------------------------------------------------- 3. sending (the five-minute job, service role only)

create or replace function public.rpt_run_schedules(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s       record;
  rp      public.rpt_reports;
  rcp     record;
  v_role  text;
  v_tz    text;
  v_def   jsonb;
  v_src   jsonb;
  v_res   jsonb;
  v_dates jsonb;
  v_body  text;
  v_next  timestamptz;
  v_stop  text;
  v_err   text;
  v_sent  int;
  n_runs  int := 0;
  n_msgs  int := 0;
begin
  for s in
    select x.* from public.rpt_schedules x join public.organizations o on o.id = x.org_id and o.deleted_at is null
     where x.enabled and x.deleted_at is null and x.next_run_at <= now() and (p_org is null or x.org_id = p_org)
       and exists (select 1 from public.org_modules mo where mo.org_id = x.org_id and mo.module_key = 'reports' and mo.disabled_at is null)
     order by x.next_run_at
     for update of x skip locked
  loop
    v_stop := null; v_err := null; v_sent := 0;
    select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = s.org_id;
    v_next := public.rpt__schedule_next(s.frequency, s.weekday, s.month_day, s.send_hour, v_tz, now());
    select * into rp from public.rpt_reports x where x.org_id = s.org_id and x.id = s.report_id and x.deleted_at is null and x.visibility = 'company';
    if not found then v_stop := 'the report was deleted or made private'; end if;
    -- the maker must still be an active member (a person who left stops their schedules)
    select m.role into v_role from public.memberships m where m.org_id = s.org_id and m.user_id = s.created_by and m.disabled_at is null;
    if v_stop is null and v_role is null then v_stop := 'the person who made it is no longer a member'; end if;

    if v_stop is not null then
      update public.rpt_schedules x set enabled = false, next_run_at = null, updated_at = now() where x.id = s.id;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
      values (s.org_id, 'reports.schedule.stopped', 'report_schedule', s.id::text, 'Scheduled report switched off: ' || v_stop, jsonb_build_object('reason', v_stop));
      continue;
    end if;

    begin
      v_def := public.rpt__schedule_definition(rp.definition, s.org_id, s.period, now());
      v_dates := v_def -> 'period';
      v_src := public.rpt__check(v_def, s.org_id, v_role);
      v_res := public.rpt__execute(v_def, v_src, s.org_id);
      v_body := public.rpt__schedule_text(v_dates, v_res);
      for rcp in
        select x.user_id from public.rpt__schedule_recipients(s.org_id, s.id) x
          join public.memberships m on m.org_id = s.org_id and m.user_id = x.user_id and m.disabled_at is null
         where m.role = any (array(select jsonb_array_elements_text(v_src -> 'roles')))
      loop
        if public.msg__enqueue(s.org_id, rcp.user_id, 'info', 'Report: ' || rp.name, v_body, 'report', rp.id,
             'rpt-sched:' || s.id || ':' || floor(extract(epoch from s.next_run_at))::bigint || ':' || rcp.user_id) is not null then
          v_sent := v_sent + 1;
        end if;
      end loop;
    exception when others then
      -- one broken schedule (for example a report whose source was switched off) must not stop the others
      v_err := sqlerrm;
    end;

    update public.rpt_schedules x set next_run_at = v_next, last_sent_at = case when v_err is null then now() else x.last_sent_at end where x.id = s.id;
    if v_err is null then
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
      values (s.org_id, 'reports.schedule.sent', 'report_schedule', s.id::text, format('Scheduled report "%s" sent to %s people', rp.name, v_sent),
              jsonb_build_object('messages', v_sent, 'period', v_dates));
      n_runs := n_runs + 1;
      n_msgs := n_msgs + v_sent;
    else
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
      values (s.org_id, 'reports.schedule.failed', 'report_schedule', s.id::text, format('Scheduled report "%s" not sent: %s', rp.name, v_err),
              jsonb_build_object('error', v_err));
    end if;
  end loop;
  return jsonb_build_object('schedules', n_runs, 'messages', n_msgs);
end $$;
revoke all on function public.rpt_run_schedules(uuid) from public, anon, authenticated;
grant execute on function public.rpt_run_schedules(uuid) to service_role;

-- ---------------------------------------------------------------- 4. report alerts open the report (sql/111 rpt__alert_run, one change:
-- the message's target is the report, not empty; sql/104's trigger only fills an empty target, so it leaves these alone)

create or replace function public.rpt__alert_run(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  rp      public.rpt_reports;
  f       public.alr_firings%rowtype;
  rcp     record;
  v_role  text;
  v_src   jsonb;
  v_def   jsonb;
  v_res   jsonb;
  v_idx   int;
  v_val   numeric;
  v_type  text;
  v_hit   boolean;
  v_worse boolean;
  v_sent  int;
  v_shown text;
  v_limit text;
  v_subj  text;
  n_alerts int := 0;
  n_msgs  int := 0;
begin
  for r in
    select a.* from public.alr_rules a join public.organizations o on o.id = a.org_id and o.deleted_at is null
     where a.kind = 'report_value' and a.enabled and a.deleted_at is null and (p_org is null or a.org_id = p_org)
       and exists (select 1 from public.org_modules mo where mo.org_id = a.org_id and mo.module_key = 'alerts' and mo.disabled_at is null)
       and exists (select 1 from public.org_modules mo where mo.org_id = a.org_id and mo.module_key = 'reports' and mo.disabled_at is null)
  loop
    begin
      select * into rp from public.rpt_reports x where x.org_id = r.org_id and x.id = r.report_id and x.deleted_at is null and x.visibility = 'company';
      continue when not found;
      -- the maker's role must still allow the report (a person who left or lost the role stops their rules)
      select m.role into v_role from public.memberships m where m.org_id = r.org_id and m.user_id = r.created_by and m.disabled_at is null;
      continue when v_role is null;
      v_def := public.rpt__alert_definition(rp.definition, r.org_id, r.report_period);
      v_src := public.rpt__check(v_def, r.org_id, v_role);
      v_res := public.rpt__execute(v_def, v_src, r.org_id);
      select n - 1, t ->> 'type' into v_idx, v_type from jsonb_array_elements(v_res -> 'totals') with ordinality z(t, n) where t ->> 'key' = r.report_total;
      continue when v_idx is null;
      -- money: the line of the rule's currency. Anything else may still be split by currency (when the report also has a money total):
      -- sums and counts add up, min and max take the lowest and highest, an average is taken from the first line.
      if v_type = 'money' then
        select (l -> 'values' ->> v_idx)::numeric into v_val from jsonb_array_elements(v_res -> 'totalRows') l where l ->> 'currency' = r.currency::text;
      else
        select case split_part(r.report_total, '_', 1)
                 when 'min' then min((l -> 'values' ->> v_idx)::numeric)
                 when 'max' then max((l -> 'values' ->> v_idx)::numeric)
                 when 'avg' then (array_agg((l -> 'values' ->> v_idx)::numeric))[1]
                 else sum((l -> 'values' ->> v_idx)::numeric) end
          into v_val from jsonb_array_elements(v_res -> 'totalRows') l;
      end if;
      -- nothing matched: a sum or count is 0; any other total has no value to compare
      if v_val is null and split_part(r.report_total, '_', 1) in ('sum', 'count') then v_val := 0; end if;
      continue when v_val is null;
      v_hit := case r.compare when 'above' then v_val > r.threshold else v_val < r.threshold end;
      continue when not v_hit;

      v_subj := 'report:' || coalesce(r.report_period, 'now') || ':' || coalesce(r.currency, '');
      select * into f from public.alr_firings where rule_id = r.id and subject = v_subj;
      v_worse := f.rule_id is not null and case r.compare when 'above' then v_val > f.last_value else v_val < f.last_value end;
      continue when not (f.rule_id is null or f.last_fired_at <= now() - make_interval(hours => r.repeat_hours) or (v_worse and f.last_fired_at <= now() - interval '1 hour'));

      v_shown := case when v_type = 'money' then to_char(round(v_val / 100.0, 2), 'FM999,999,999,990.00') || ' ' || r.currency else trim(to_char(v_val, 'FM999,999,999,990.###')) end;
      v_limit := case when v_type = 'money' then to_char(round(r.threshold / 100.0, 2), 'FM999,999,999,990.00') || ' ' || r.currency else trim(to_char(r.threshold, 'FM999,999,999,990.###')) end;
      v_sent := 0;
      for rcp in
        select x.user_id from public.alr__recipients(r.org_id, r.id) x
          join public.memberships m on m.org_id = r.org_id and m.user_id = x.user_id and m.disabled_at is null
         where m.role = any (array(select jsonb_array_elements_text(v_src -> 'roles')))
      loop
        if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', r.name,
             format('Report "%s"%s: %s is %s, %s your limit of %s.', rp.name,
                    case r.report_period when 'today' then ' (today)' when 'last_7' then ' (last 7 days)' when 'this_month' then ' (this month)' when 'last_30' then ' (last 30 days)' else '' end,
                    replace(r.report_total, '_', ' of '), v_shown, case r.compare when 'above' then 'above' else 'below' end, v_limit),
             'report', rp.id, 'alr:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000000)::bigint || ':' || rcp.user_id) is not null then
          v_sent := v_sent + 1;
        end if;
      end loop;
      insert into public.alr_firings (org_id, rule_id, subject, last_fired_at, last_value, times) values (r.org_id, r.id, v_subj, now(), v_val, 1)
      on conflict (rule_id, subject) do update set last_fired_at = now(), last_value = excluded.last_value, times = public.alr_firings.times + 1;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
      values (r.org_id, 'alerts.run', 'alert_rule', r.id::text, format('Report alert "%s" fired: %s', r.name, v_shown), jsonb_build_object('fired', 1, 'messages', v_sent));
      n_alerts := n_alerts + 1;
      n_msgs := n_msgs + v_sent;
    exception when others then
      -- one broken rule (for example a report whose source was switched off) must not stop the others
      raise warning 'report alert % skipped: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('alerts', n_alerts, 'messages', n_msgs);
end $$;
revoke all on function public.rpt__alert_run(uuid) from public, anon, authenticated;

-- Report-alert messages already sent: their target becomes the report (it was the alert rule, which members may not read).
update public.msg_outbox o set entity_type = 'report', entity_id = r.report_id
  from public.alr_rules r
 where o.entity_type = 'alert:report_value' and r.org_id = o.org_id and r.id = o.entity_id and r.report_id is not null;
update public.msg_notifications n set entity_type = 'report', entity_id = r.report_id
  from public.alr_rules r
 where n.entity_type = 'alert:report_value' and r.org_id = n.org_id and r.id = n.entity_id and r.report_id is not null;

-- ---------------------------------------------------------------- 5. the chasing job without its own low stock message
-- (sql/013 msg_run_chasing, the low stock loop removed: the alert engine's stock_below rule sends it). "low_stock" stays, always 0.

create or replace function public.msg_run_chasing(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o     record;
  rq    record;
  tk    record;
  m     record;
  rem   int;
  esc   int;
  v     uuid;
  n_rem int := 0;
  n_esc int := 0;
  n_low int := 0;
begin
  for o in
    select og.id, og.settings from public.organizations og
    where og.deleted_at is null and (p_org is null or og.id = p_org)
      and exists (select 1 from public.org_modules mo where mo.org_id = og.id and mo.module_key = 'messaging' and mo.disabled_at is null)
  loop
    rem := coalesce((o.settings #>> '{chasing,reminder_after_minutes}')::int, 30);
    esc := coalesce((o.settings #>> '{chasing,escalate_after_minutes}')::int, 120);

    for rq in select r.id, r.number, r.requester_id, r.created_at from public.inv_requests r
              where r.org_id = o.id and r.status = 'submitted' and r.created_at <= now() - rem * interval '1 minute' loop
      for m in select u.user_id from public.msg__managers(o.id) u where u.user_id <> rq.requester_id loop
        v := public.msg__enqueue(o.id, m.user_id, 'reminder', format('Reminder: %s is still waiting for approval', rq.number),
               'Please approve or reject it.', 'stock_request', rq.id, format('request:%s:reminder:%s', rq.id, m.user_id));
        if v is not null then
          n_rem := n_rem + 1;
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
          values (o.id, 'messaging.reminder.queued', 'stock_request', rq.id::text, format('Reminder queued for %s', rq.number));
        end if;
      end loop;
      if rq.created_at <= now() - esc * interval '1 minute' then
        for m in select u.user_id from public.msg__managers(o.id, array['owner']) u where u.user_id <> rq.requester_id loop
          v := public.msg__enqueue(o.id, m.user_id, 'escalation', format('Escalation: %s has had no decision', rq.number),
                 'Nobody has answered yet. Please decide or reassign.', 'stock_request', rq.id, format('request:%s:escalation:%s', rq.id, m.user_id));
          if v is not null then
            n_esc := n_esc + 1;
            insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
            values (o.id, 'messaging.escalation.queued', 'stock_request', rq.id::text, format('Escalation queued for %s', rq.number));
          end if;
        end loop;
      end if;
    end loop;

    for tk in select t.id, t.title, t.assignee_id, t.created_by, t.due_at from public.tsk_tasks t
              where t.org_id = o.id and t.status in ('open', 'in_progress') and t.due_at is not null and t.due_at <= now() loop
      v := public.msg__enqueue(o.id, tk.assignee_id, 'reminder', format('Overdue: %s', tk.title), 'This task is past its due time.', 'task', tk.id, format('task:%s:overdue:%s', tk.id, tk.assignee_id));
      if v is not null then
        n_rem := n_rem + 1;
        insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
        values (o.id, 'messaging.reminder.queued', 'task', tk.id::text, format('Overdue reminder queued for task "%s"', tk.title));
      end if;
      if tk.due_at <= now() - esc * interval '1 minute' and tk.created_by <> tk.assignee_id then
        v := public.msg__enqueue(o.id, tk.created_by, 'escalation', format('Escalation: task "%s" is still not done', tk.title), 'It is well past its due time.', 'task', tk.id, format('task:%s:overdue_escalation:%s', tk.id, tk.created_by));
        if v is not null then
          n_esc := n_esc + 1;
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
          values (o.id, 'messaging.escalation.queued', 'task', tk.id::text, format('Overdue escalation queued for task "%s"', tk.title));
        end if;
      end if;
    end loop;

  end loop;
  return jsonb_build_object('reminders', n_rem, 'escalations', n_esc, 'low_stock', n_low);
end $$;
revoke all on function public.msg_run_chasing(uuid) from public, anon, authenticated;
grant execute on function public.msg_run_chasing(uuid) to service_role;

-- ---------------------------------------------------------------- 6. a stock shortage names the item
-- (sql/006 inv_submit_request and sql/034 inv_submit_transfer, only the INSUFFICIENT_AVAILABLE detail changed)

create or replace function public.inv_submit_request(p_warehouse_id uuid, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id     uuid := gen_random_uuid();
  v_number text;
  r        record;
  b        record;
  v_names  text := '';
begin
  if not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown warehouse';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'add at least one line';
  end if;

  v_number := public.inv__next_number(v_org);
  insert into public.inv_requests (id, org_id, number, requester_id, warehouse_id, reason)
  values (v_id, v_org, v_number, auth.uid(), p_warehouse_id, coalesce(trim(p_reason), ''));

  -- Same item twice is summed. Rows are locked in item order so two requests cannot deadlock.
  for r in
    select (e ->> 'itemId')::uuid as item_id, sum((e ->> 'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero'; end if;
    if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = r.item_id and i.deleted_at is null) then
      raise exception 'INVALID_INPUT' using detail = 'unknown item';
    end if;
    select s.on_hand, s.reserved into b from public.inv_stock_balances s
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_warehouse_id for update;
    if not found or b.on_hand - b.reserved < r.qty then
      raise exception 'INSUFFICIENT_AVAILABLE' using detail = format('%s: %s available, %s requested',
        (select i.sku || ' ' || i.name from public.inv_items i where i.org_id = v_org and i.id = r.item_id), coalesce(b.on_hand - b.reserved, 0), r.qty);
    end if;
    update public.inv_stock_balances s set reserved = s.reserved + r.qty
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_warehouse_id;
    insert into public.inv_request_lines (org_id, request_id, item_id, qty) values (v_org, v_id, r.item_id, r.qty);
    v_names := v_names || case when v_names = '' then '' else ', ' end || r.qty::text || ' x ' || (select i.name from public.inv_items i where i.org_id = v_org and i.id = r.item_id);
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.request.submitted', 'stock_request', v_id::text, format('%s submitted: %s', v_number, v_names));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

create or replace function public.inv_submit_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_id     uuid := gen_random_uuid();
  v_number text;
  r        record;
  b        record;
  it       public.inv_items%rowtype;
  wt       public.inv_warehouses%rowtype;
  v_names  text := '';
begin
  if p_from_warehouse_id is null or p_to_warehouse_id is null or p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'INVALID_INPUT' using detail = 'choose two different warehouses';
  end if;
  if not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_from_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown source warehouse';
  end if;
  select * into wt from public.inv_warehouses w where w.org_id = v_org and w.id = p_to_warehouse_id and w.deleted_at is null;
  if not found then raise exception 'INVALID_INPUT' using detail = 'unknown destination warehouse'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'add at least one line';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'INVALID_INPUT' using detail = 'the reason is too long'; end if;

  v_number := public.inv__next_transfer_number(v_org);
  insert into public.inv_transfers (id, org_id, number, requester_id, from_warehouse_id, to_warehouse_id, reason)
  values (v_id, v_org, v_number, auth.uid(), p_from_warehouse_id, p_to_warehouse_id, coalesce(trim(p_reason), ''));

  -- Same item twice is summed. Rows are locked in item order so two transfers cannot deadlock.
  for r in
    select (e ->> 'itemId')::uuid as item_id, sum((e ->> 'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero'; end if;
    select * into it from public.inv_items i where i.org_id = v_org and i.id = r.item_id and i.deleted_at is null;
    if not found then raise exception 'INVALID_INPUT' using detail = 'unknown item'; end if;
    -- An item that needs a storage condition may only go to a warehouse that has exactly that condition. A destination with NO condition
    -- set is refused as well (it cannot be shown to satisfy the requirement). An item with no condition may go to any warehouse.
    if it.storage_condition_id is not null and wt.storage_condition_id is distinct from it.storage_condition_id then
      raise exception 'STORAGE_MISMATCH' using detail = case
        when wt.storage_condition_id is null then format('%s needs a storage condition and the destination warehouse has none set', it.sku)
        else format('%s needs a different storage condition than the destination warehouse', it.sku) end;
    end if;
    select s.on_hand, s.reserved into b from public.inv_stock_balances s
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_from_warehouse_id for update;
    if not found or b.on_hand - b.reserved < r.qty then
      raise exception 'INSUFFICIENT_AVAILABLE' using detail = format('%s %s: %s available, %s requested', it.sku, it.name, coalesce(b.on_hand - b.reserved, 0), r.qty);
    end if;
    update public.inv_stock_balances s set reserved = s.reserved + r.qty
    where s.org_id = v_org and s.item_id = r.item_id and s.warehouse_id = p_from_warehouse_id;
    insert into public.inv_transfer_lines (org_id, transfer_id, item_id, qty) values (v_org, v_id, r.item_id, r.qty);
    v_names := v_names || case when v_names = '' then '' else ', ' end || r.qty::text || ' x ' || it.name;
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.transfer.submitted', 'stock_transfer', v_id::text,
          format('%s submitted: %s, %s to %s', v_number, v_names,
                 (select w.name from public.inv_warehouses w where w.org_id = v_org and w.id = p_from_warehouse_id), wt.name));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- ---------------------------------------------------------------- 7. a note's print data carries its invoice's id
-- (sql/103 sal__doc_print_data, one key added to the note's document: invoiceId)

create or replace function public.sal__doc_print_data(p_org uuid, p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc      jsonb;
  v_lines    jsonb;
  v_customer uuid;
  v_incl     boolean;
  v_company  jsonb;
  v_settings jsonb;
  v_cust     jsonb;
  v_net      bigint;
  v_tax      bigint;
begin
  if p_type = 'invoice' then
    select jsonb_build_object('type', 'invoice', 'kind', 'invoice', 'id', i.id, 'number', i.number, 'status', i.status, 'date', i.invoice_date,
             'dueDate', i.due_date, 'currency', i.currency, 'netMinor', i.net_minor, 'taxMinor', i.tax_minor, 'grossMinor', i.gross_minor,
             'issuedAt', i.created_at, 'orderNumber', o.number, 'invoiceNumber', null, 'reason', null),
           i.customer_id
      into v_doc, v_customer
      from public.sal_invoices i left join public.sal_orders o on o.org_id = i.org_id and o.id = i.order_id
     where i.org_id = p_org and i.id = p_id;
    if v_doc is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom, 'qty', l.qty, 'unit', ol.unit, 'unitFactor', ol.unit_factor,
             'unitPriceMinor', l.unit_price_minor, 'priceIncludesVat', l.price_includes_vat, 'taxRate', l.tax_rate,
             'netMinor', l.net_minor, 'taxMinor', l.tax_minor, 'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', it.eta_item_type, 'etaItemCode', it.eta_item_code, 'etaUnitCode', it.eta_unit_code) order by l.created_at, l.id), '[]'::jsonb)
      into v_lines
      from public.sal_invoice_lines l
      join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
      join public.inv_items it on it.org_id = l.org_id and it.id = ol.item_id
      left join public.tax_rates t on t.org_id = l.org_id and t.id = l.tax_rate_id
     where l.org_id = p_org and l.invoice_id = p_id;

  elsif p_type = 'note' then
    select jsonb_build_object('type', 'note', 'kind', n.kind, 'id', n.id, 'number', n.number, 'status', n.status,
             'date', public.acc__local_date(p_org, coalesce(n.decided_at, n.created_at)), 'dueDate', null, 'currency', n.currency,
             'netMinor', n.net_minor, 'taxMinor', n.tax_minor, 'grossMinor', n.gross_minor, 'issuedAt', coalesce(n.decided_at, n.created_at),
             'orderNumber', null, 'invoiceId', i.id, 'invoiceNumber', i.number, 'invoiceDate', i.invoice_date, 'reason', n.reason),
           n.customer_id
      into v_doc, v_customer
      from public.sal_notes n join public.sal_invoices i on i.org_id = n.org_id and i.id = n.invoice_id
     where n.org_id = p_org and n.id = p_id;
    if v_doc is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom, 'qty', nl.qty, 'unit', null, 'unitFactor', null,
             'unitPriceMinor', nl.unit_price_minor, 'priceIncludesVat', nl.price_includes_vat, 'taxRate', nl.tax_rate,
             'netMinor', nl.net_minor, 'taxMinor', nl.tax_minor, 'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', it.eta_item_type, 'etaItemCode', it.eta_item_code, 'etaUnitCode', it.eta_unit_code) order by nl.created_at, nl.id), '[]'::jsonb)
      into v_lines
      from public.sal_note_lines nl
      join public.sal_invoice_lines il on il.org_id = nl.org_id and il.id = nl.invoice_line_id
      join public.sal_order_lines ol on ol.org_id = il.org_id and ol.id = il.order_line_id
      join public.inv_items it on it.org_id = il.org_id and it.id = ol.item_id
      left join public.tax_rates t on t.org_id = nl.org_id and t.id = nl.tax_rate_id
     where nl.org_id = p_org and nl.note_id = p_id;

  elsif p_type = 'draft' then
    select jsonb_build_object('type', 'draft', 'kind', 'invoice', 'id', d.id, 'number', null, 'status', d.status, 'date', d.invoice_date,
             'dueDate', null, 'currency', d.currency, 'issuedAt', null, 'orderNumber', o.number, 'invoiceNumber', null, 'reason', null,
             'invoiceId', d.invoice_id),
           d.customer_id
      into v_doc, v_customer
      from public.sal_invoice_drafts d left join public.sal_orders o on o.org_id = d.org_id and o.id = d.order_id
     where d.org_id = p_org and d.id = p_id and d.deleted_at is null;
    if v_doc is null then return null; end if;
    -- Amounts as issue would make them (sql/093's line maths), from the order line's price and today's VAT choice.
    select coalesce((s.settings ->> 'vat_registered')::boolean, false) and coalesce((s.settings ->> 'prices_include_vat')::boolean, false)
      into v_incl from public.organizations s where s.id = p_org;
    with x as (
      select dl.created_at, dl.id, it.id as item_id, it.sku, it.name, it.uom, dl.qty, ol.unit, ol.unit_factor, ol.unit_price_minor,
             rr.rate_id, coalesce(rr.rate, 0) as rate, it.eta_item_type, it.eta_item_code, it.eta_unit_code
        from public.sal_invoice_draft_lines dl
        join public.sal_order_lines ol on ol.org_id = dl.org_id and ol.id = dl.order_line_id
        join public.inv_items it on it.org_id = dl.org_id and it.id = ol.item_id
        left join lateral public.sal__draft_line_rate(p_org, it.id, dl.tax_choice) rr on true
       where dl.org_id = p_org and dl.draft_id = p_id
    ), y as (
      select x.*,
             case when v_incl then round(round(x.qty * x.unit_price_minor) * 100 / (100 + x.rate))::bigint
                  else round(x.qty * x.unit_price_minor)::bigint end as net_minor,
             round(x.qty * x.unit_price_minor)::bigint as gross_if_incl
        from x
    ), z as (
      select y.*, case when v_incl then y.gross_if_incl - y.net_minor else round(y.net_minor * y.rate / 100)::bigint end as tax_minor from y
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', z.item_id, 'sku', z.sku, 'name', z.name, 'uom', z.uom, 'qty', z.qty, 'unit', z.unit, 'unitFactor', z.unit_factor,
             'unitPriceMinor', z.unit_price_minor, 'priceIncludesVat', v_incl, 'taxRate', z.rate, 'netMinor', z.net_minor, 'taxMinor', z.tax_minor,
             'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', z.eta_item_type, 'etaItemCode', z.eta_item_code, 'etaUnitCode', z.eta_unit_code) order by z.created_at, z.id), '[]'::jsonb),
           coalesce(sum(z.net_minor), 0), coalesce(sum(z.tax_minor), 0)
      into v_lines, v_net, v_tax
      from z left join public.tax_rates t on t.org_id = p_org and t.id = z.rate_id;
    v_doc := v_doc || jsonb_build_object('netMinor', v_net, 'taxMinor', v_tax, 'grossMinor', v_net + v_tax);
  else
    raise exception 'INVALID_INPUT';
  end if;

  select jsonb_build_object('name', c.name, 'contact', c.contact, 'city', c.city, 'phone', c.phone, 'code', c.code,
           'taxIdType', c.tax_id_type, 'taxId', c.tax_id, 'country', c.country, 'governate', c.governate, 'regionCity', c.region_city,
           'street', c.street, 'buildingNumber', c.building_number)
    into v_cust from public.sal_customers c where c.org_id = p_org and c.id = v_customer;

  select jsonb_build_object('name', g.name, 'legalName', tp.legal_name, 'taxNumber', tp.registration_number, 'activityCode', tp.activity_code,
           'vatRegistered', coalesce((g.settings ->> 'vat_registered')::boolean, false),
           'branch', (select jsonb_build_object('code', b.branch_code, 'name', b.name, 'country', b.country, 'governate', b.governate,
                              'regionCity', b.region_city, 'street', b.street, 'buildingNumber', b.building_number, 'postalCode', b.postal_code)
                        from public.tax_branches b where b.org_id = g.id and b.deleted_at is null order by b.branch_code limit 1))
    into v_company from public.organizations g left join public.tax_profiles tp on tp.org_id = g.id where g.id = p_org;

  select jsonb_build_object('logo', s.logo, 'letterhead', s.letterhead, 'marginTopMm', s.margin_top_mm, 'marginBottomMm', s.margin_bottom_mm,
           'headerText', s.header_text, 'footerText', s.footer_text, 'bankDetails', s.bank_details, 'paymentTerms', s.payment_terms,
           'language', s.language, 'digits', s.digits, 'layout', s.layout)
    into v_settings from public.core_doc_settings s where s.org_id = p_org;

  return jsonb_build_object('document', v_doc, 'lines', v_lines, 'customer', v_cust, 'company', v_company,
           'settings', coalesce(v_settings, jsonb_build_object('logo', null, 'letterhead', null, 'marginTopMm', 40, 'marginBottomMm', 30,
             'headerText', null, 'footerText', null, 'bankDetails', null, 'paymentTerms', null, 'language', 'ar', 'digits', 'latn', 'layout', 'simple')));
end $$;
revoke all on function public.sal__doc_print_data(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 8. the home card "Top products" counts the same 90 days as the report
-- (sql/094 insights_home, one change: invoices from 89 days before today in the company's time zone, not "current_date - 90", which
-- counted 91 days by the server's date; the ready-made "Top 20 products" counts today and the 89 days before it).

create or replace function public.insights_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid := public.require_org_role(array['owner', 'admin']);
  v_cur  text;
  m0     date := date_trunc('month', current_date)::date;
  v_months jsonb; v_owed bigint; v_overdue bigint; v_owe bigint; v_stock bigint; v_low int; v_exp jsonb; v_dec jsonb; v_top jsonb; v_sup jsonb; v_single int;
begin
  select default_currency into v_cur from public.organizations where id = v_org;

  -- last 12 months, oldest first
  select jsonb_agg(jsonb_build_object('month', to_char(x.ms, 'YYYY-MM'), 'revenue', x.rev, 'cogs', x.cogs, 'expenses', x.exp, 'net', x.rev - x.cogs - x.exp) order by x.ms)
    into v_months
    from (
      select s.ms,
        coalesce((select sum(round(il.qty * il.unit_price_minor)) from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
                   where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= s.ms and i.invoice_date < (s.ms + interval '1 month')::date), 0)::bigint as rev,
        coalesce((select sum(round(-m.qty * coalesce(m.unit_cost_minor, it.avg_cost_minor))) from public.inv_stock_moves m join public.inv_items it on it.org_id = m.org_id and it.id = m.item_id
                   where m.org_id = v_org and m.kind = 'issue' and m.posted_at >= s.ms and m.posted_at < (s.ms + interval '1 month')
                     and m.request_id in (select so.request_id from public.sal_orders so where so.org_id = v_org and so.request_id is not null)), 0)::bigint as cogs,
        coalesce((select sum(e.amount_minor) from public.fin_expenses e where e.org_id = v_org and e.status = 'recorded' and e.expense_date >= s.ms and e.expense_date < (s.ms + interval '1 month')::date), 0)::bigint as exp
      from (select (m0 - make_interval(months => k))::date as ms from generate_series(0, 11) k) s
    ) x;

  -- money owed to me, and the overdue part
  select coalesce(sum(t.total - t.paid), 0), coalesce(sum(t.total - t.paid) filter (where t.invoice_date < current_date - 30), 0)
    into v_owed, v_overdue
    from (select i.invoice_date,
                 public.sal__invoice_due(i.org_id, i.id) as total,
                 (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded')::bigint as paid
            from public.sal_invoices i where i.org_id = v_org and i.status = 'issued') t;

  -- money I owe: supplier invoices and recorded expenses, less what was paid
  select coalesce(sum(t.total - t.paid), 0) into v_owe from (
    select public.pur__bill_due(i.org_id, i.id) as total,
           (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = i.org_id and p.supplier_invoice_id = i.id and p.status = 'recorded')::bigint as paid
      from public.pur_supplier_invoices i where i.org_id = v_org
    union all
    select e.amount_minor, (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = e.org_id and p.expense_id = e.id and p.status = 'recorded')::bigint
      from public.fin_expenses e where e.org_id = v_org and e.status = 'recorded') t;

  select coalesce(round(sum(b.on_hand * it.avg_cost_minor)), 0)::bigint into v_stock
    from public.inv_stock_balances b join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id where b.org_id = v_org and it.deleted_at is null;

  select count(*) into v_low from (
    select it.id from public.inv_items it left join public.inv_stock_balances b on b.org_id = it.org_id and b.item_id = it.id
     where it.org_id = v_org and it.deleted_at is null and it.reorder_level is not null
     group by it.id, it.reorder_level having coalesce(sum(b.on_hand - b.reserved), 0) <= it.reorder_level) z;

  -- stock that expires: batches, quantity and value at cost, by window (quarantined stock is counted too: it still sits there)
  select jsonb_build_object(
      'expired',  jsonb_build_object('batches', count(*) filter (where d < 0),               'valueMinor', coalesce(sum(val) filter (where d < 0), 0)::bigint),
      'in30',     jsonb_build_object('batches', count(*) filter (where d between 0 and 30),  'valueMinor', coalesce(sum(val) filter (where d between 0 and 30), 0)::bigint),
      'in60',     jsonb_build_object('batches', count(*) filter (where d between 31 and 60), 'valueMinor', coalesce(sum(val) filter (where d between 31 and 60), 0)::bigint),
      'in90',     jsonb_build_object('batches', count(*) filter (where d between 61 and 90), 'valueMinor', coalesce(sum(val) filter (where d between 61 and 90), 0)::bigint))
    into v_exp
    from (select (b.expiry_date - current_date) as d, round(sum(bb.qty * it.avg_cost_minor))::bigint as val
            from public.inv_batch_balances bb join public.inv_batches b on b.org_id = bb.org_id and b.id = bb.batch_id join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id
           where bb.org_id = v_org and bb.qty > 0 and b.expiry_date is not null and b.expiry_date <= current_date + 90 group by b.id, b.expiry_date) z;

  select jsonb_build_object('submitted', count(*) filter (where status = 'submitted'), 'approvedNotIssued', count(*) filter (where status = 'approved'),
                            'oldestSubmittedHours', coalesce(round(extract(epoch from (now() - min(created_at) filter (where status = 'submitted'))) / 3600), 0))
    into v_dec from public.inv_requests where org_id = v_org and status in ('submitted', 'approved');

  -- best sellers, last 90 days
  select coalesce(jsonb_agg(jsonb_build_object('sku', t.sku, 'name', t.name, 'revenue', t.rev) order by t.rev desc), '[]'::jsonb) into v_top from (
    select it.sku, it.name, sum(round(il.qty * il.unit_price_minor))::bigint as rev
      from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
      join public.sal_order_lines ol on ol.org_id = il.org_id and ol.id = il.order_line_id join public.inv_items it on it.org_id = ol.org_id and it.id = ol.item_id
     where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= public.acc__local_date(v_org, now()) - 89 group by it.sku, it.name order by rev desc limit 5) t;

  -- who we depend on: purchases of the last 12 months by supplier, and items bought from only one supplier
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'valueMinor', t.val, 'sharePercent', round(100.0 * t.val / nullif(t.tot, 0), 1)) order by t.val desc), '[]'::jsonb) into v_sup from (
    select s.name, sum(round(pl.qty * pl.unit_cost_minor))::bigint as val, sum(sum(round(pl.qty * pl.unit_cost_minor))) over ()::bigint as tot
      from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id join public.pur_suppliers s on s.org_id = po.org_id and s.id = po.supplier_id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by s.name order by val desc limit 3) t;
  select count(*) into v_single from (
    select pl.item_id from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by pl.item_id having count(distinct po.supplier_id) = 1) z;

  return jsonb_build_object(
    'currency', v_cur, 'asOf', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'months', coalesce(v_months, '[]'::jsonb),
    'owedToMeMinor', v_owed, 'overdueMinor', v_overdue, 'iOweMinor', v_owe, 'stockValueMinor', v_stock, 'itemsLow', v_low,
    'expiry', v_exp, 'decisions', v_dec, 'topProducts', v_top, 'topSuppliers', v_sup, 'singleSourceItems', v_single);
end $$;
revoke all on function public.insights_home() from public, anon;
grant execute on function public.insights_home() to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: true, true, true, false, false, true, false, 0.
select exists (select 1 from pg_class where relname = 'rpt_schedules' and relrowsecurity) as schedules_rls,
       has_function_privilege('authenticated', 'public.rpt_save_schedule(uuid,uuid,text,int,int,int,text,jsonb,boolean)', 'execute') as users_save,
       has_function_privilege('service_role', 'public.rpt_run_schedules(uuid)', 'execute') as job_runs,
       has_function_privilege('authenticated', 'public.rpt_run_schedules(uuid)', 'execute') as users_run_job,
       has_table_privilege('authenticated', 'public.rpt_schedules', 'insert') as users_insert,
       has_table_privilege('authenticated', 'public.rpt_schedules', 'select') as users_select,
       has_function_privilege('anon', 'public.rpt_schedule_list()', 'execute') as anon_list,
       (select count(*) from public.msg_notifications where entity_type = 'alert:report_value') as old_report_alert_targets;
