-- sql/111_rpt_report_alerts.sql
-- Reports & Insights, step 5 (documentation/plans/REPORTS_INSIGHTS_PLAN.md section 7.5): "alert me when this number goes above or
-- below X", as a new kind of alert rule (`report_value`) in the existing alert engine (sql/028): same recipients, teams, "do not repeat"
-- rules, outbox and audit.
-- 1. alr_rules gets: report_id (a saved COMPANY report, sql/109), report_total (one of the report's totals, '<fn>_<column>'), compare
--    ('above' or 'below'), currency (for a money total: which currency's line is compared), report_period (the rolling period the report
--    is run for: 'today', 'last_7', 'this_month', 'last_30'; none for a snapshot such as stock on hand). threshold is the limit, in minor
--    units for money (like every amount we store).
-- 2. alr_create_report_rule: owners and admins, alerts and reports switched on. The report must be one the maker may run, and every
--    recipient must be someone who may open that report's data: the database refuses the rule otherwise, so a number never reaches
--    someone who may not see it. alr_set_rule_recipients gets the same check for these rules. Audited.
-- 3. rpt__alert_run: runs each rule's report for its company (with the maker's role, which must still allow it), reads the total over all
--    matching rows, and when it is above or below the limit queues one message for each recipient who may still see the data. It uses
--    alr_firings like the other kinds: told again after the rule's repeat interval, or sooner (at least one hour) when the number got
--    further past the limit. The messages carry the 'alr:<rule>' key, so sql/104 links them to the rule.
-- 4. alr_run (the five-minute job's entry point) now also runs rpt__alert_run. The existing evaluator is kept unchanged under the name
--    alr__run_core. NOTE for later migrations: change alr__run_core, not alr_run, or report alerts stop.
-- Rerun-safe. Needs sql/001-110 (alerts 028-104, reports 109). Then run sql/tests/108_rpt_report_alerts.sql and sql/tests/092. Ends
-- with read-only checks.

begin;

-- ---------------------------------------------------------------- 1. the rule's report settings

alter table public.alr_rules add column if not exists report_id uuid;
alter table public.alr_rules add column if not exists report_total text;
alter table public.alr_rules add column if not exists compare text;
alter table public.alr_rules add column if not exists currency char(3);
alter table public.alr_rules add column if not exists report_period text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'alr_rules_report_fk') then
    alter table public.alr_rules add constraint alr_rules_report_fk foreign key (org_id, report_id) references public.rpt_reports(org_id, id);
  end if;
end $$;
alter table public.alr_rules drop constraint if exists alr_rules_kind_chk;
alter table public.alr_rules add constraint alr_rules_kind_chk
  check (kind in ('stock_below', 'expiry_within', 'receivable_overdue', 'profit_negative', 'forecast_stockout', 'report_value'));
alter table public.alr_rules drop constraint if exists alr_rules_report_chk;
alter table public.alr_rules add constraint alr_rules_report_chk check (
  (kind = 'report_value') = (report_id is not null)
  and (kind <> 'report_value' or (report_total ~ '^(sum|count|avg|min|max)_[a-z][a-z0-9_]{0,60}$' and compare in ('above', 'below') and threshold is not null
       and (currency is null or currency ~ '^[A-Z]{3}$') and (report_period is null or report_period in ('today', 'last_7', 'this_month', 'last_30')))));
create index if not exists alr_rules_report_idx on public.alr_rules(org_id, report_id) where report_id is not null;

-- ---------------------------------------------------------------- helpers

-- The dates of a rolling period in the company's time zone.
create or replace function public.rpt__period_dates(p_org uuid, p_period text) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC'))::date as d)
  select case p_period
    when 'today' then jsonb_build_object('from', t.d, 'to', t.d)
    when 'last_7' then jsonb_build_object('from', t.d - 6, 'to', t.d)
    when 'this_month' then jsonb_build_object('from', date_trunc('month', t.d)::date, 'to', t.d)
    when 'last_30' then jsonb_build_object('from', t.d - 29, 'to', t.d)
  end from t
$$;
revoke all on function public.rpt__period_dates(uuid, text) from public, anon, authenticated;

-- The report's definition as the rule runs it: the rolling period, one row (only the totals are read).
create or replace function public.rpt__alert_definition(p_def jsonb, p_org uuid, p_period text) returns jsonb
language sql stable security definer set search_path = public as $$
  select (p_def - 'period' - 'sort' - 'chart' - 'limit')
         || jsonb_build_object('limit', 1)
         || case when p_period is null then '{}'::jsonb else jsonb_build_object('period', public.rpt__period_dates(p_org, p_period)) end
$$;
revoke all on function public.rpt__alert_definition(jsonb, uuid, text) from public, anon, authenticated;

-- Members of this company who would get the rule's alerts but may not open the report's data (their role is not in the source's list).
create or replace function public.rpt__alert_blocked(p_org uuid, p_rule uuid, p_src jsonb) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.alr__recipients(p_org, p_rule) x
    join public.memberships m on m.org_id = p_org and m.user_id = x.user_id and m.disabled_at is null
   where not (m.role = any (array(select jsonb_array_elements_text(p_src -> 'roles'))))
$$;
revoke all on function public.rpt__alert_blocked(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. making a rule (owners and admins, audited)

create or replace function public.alr_create_report_rule(p_name text, p_report_id uuid, p_total text, p_compare text, p_threshold numeric,
                                                         p_currency text, p_period text, p_repeat_hours int, p_recipients jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.mod__guard('alerts', array['owner', 'admin']);
  v_role text;
  rp     public.rpt_reports;
  v_src  jsonb;
  v_def  jsonb;
  v_type text;
  v_id   uuid;
begin
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'give the alert a name'; end if;
  select * into rp from public.rpt_reports r where r.org_id = v_org and r.id = p_report_id and r.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if rp.visibility <> 'company' then raise exception 'INVALID_INPUT' using detail = 'alerts are made on company reports'; end if;
  -- the report must still be one the maker may run, with the rule's period
  v_src := public.rpt__catalog() -> (rp.definition ->> 'source');
  if p_period is not null and p_period not in ('today', 'last_7', 'this_month', 'last_30') then raise exception 'INVALID_INPUT' using detail = 'unknown period'; end if;
  if (v_src ->> 'periodRequired')::boolean and p_period is null then raise exception 'INVALID_INPUT' using detail = 'choose the period the report is checked for'; end if;
  if v_src ->> 'period' is null and p_period is not null then raise exception 'INVALID_INPUT' using detail = 'this report has no period'; end if;
  v_def := public.rpt__alert_definition(rp.definition, v_org, p_period);
  perform public.rpt__check(v_def, v_org, v_role);
  -- the total must be one of the report's totals
  if not exists (select 1 from jsonb_array_elements(coalesce(rp.definition -> 'totals', '[]')) t where (t ->> 'fn') || '_' || (t ->> 'column') = p_total) then
    raise exception 'INVALID_INPUT' using detail = 'choose one of the report''s totals';
  end if;
  select case when t ->> 'fn' = 'count' then 'number' else public.rpt__col_type(v_src, t ->> 'column') end into v_type
    from jsonb_array_elements(rp.definition -> 'totals') t where (t ->> 'fn') || '_' || (t ->> 'column') = p_total limit 1;
  if v_type = 'money' and (p_currency is null or p_currency !~ '^[A-Z]{3}$') then raise exception 'INVALID_INPUT' using detail = 'choose the currency of the limit'; end if;
  if v_type <> 'money' and p_currency is not null then raise exception 'INVALID_INPUT' using detail = 'only an amount has a currency'; end if;
  if p_threshold is null then raise exception 'INVALID_INPUT' using detail = 'give the limit'; end if;
  begin
    insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by, report_id, report_total, compare, currency, report_period)
    values (v_org, trim(p_name), 'report_value', p_threshold, coalesce(p_repeat_hours, 24), auth.uid(), rp.id, p_total, p_compare, p_currency, p_period)
    returning id into v_id;
  exception when check_violation then raise exception 'INVALID_INPUT';
  end;
  perform public.alr__set_recipients(v_org, v_id, p_recipients);
  if public.rpt__alert_blocked(v_org, v_id, v_src) > 0 then
    raise exception 'FORBIDDEN' using detail = 'some recipients may not see this report''s data';
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'alerts.rule.created', 'alert_rule', v_id::text,
          format('%s (report_value: "%s" %s %s %s)', trim(p_name), rp.name, p_total, p_compare, p_threshold),
          jsonb_build_object('report_id', rp.id, 'total', p_total, 'compare', p_compare, 'threshold', p_threshold, 'currency', p_currency,
                             'period', p_period, 'repeat_hours', coalesce(p_repeat_hours, 24), 'recipients', p_recipients));
  return v_id;
end $$;
revoke all on function public.alr_create_report_rule(text, uuid, text, text, numeric, text, text, int, jsonb) from public, anon;
grant execute on function public.alr_create_report_rule(text, uuid, text, text, numeric, text, text, int, jsonb) to authenticated;

-- sql/028's alr_set_rule_recipients, with the recipient check for report rules.
create or replace function public.alr_set_rule_recipients(p_rule_id uuid, p_recipients jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); r public.alr_rules%rowtype; v_src jsonb;
begin
  select * into r from public.alr_rules where org_id = v_org and id = p_rule_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.alr__set_recipients(v_org, p_rule_id, p_recipients);
  if r.kind = 'report_value' then
    v_src := public.rpt__catalog() -> (select rp.definition ->> 'source' from public.rpt_reports rp where rp.org_id = v_org and rp.id = r.report_id);
    if v_src is null or public.rpt__alert_blocked(v_org, r.id, v_src) > 0 then
      raise exception 'FORBIDDEN' using detail = 'some recipients may not see this report''s data';
    end if;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.rule.recipients_set', 'alert_rule', r.id::text, r.name || ': recipients changed');
end $$;

-- ---------------------------------------------------------------- 3. checking the rules (the five-minute job)

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
             null, null, 'alr:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000000)::bigint || ':' || rcp.user_id) is not null then
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

-- ---------------------------------------------------------------- 4. the job's entry point runs both

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'alr__run_core') then
    alter function public.alr_run(uuid) rename to alr__run_core;
  end if;
end $$;
revoke all on function public.alr__run_core(uuid) from public, anon, authenticated;

create or replace function public.alr_run(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; b jsonb;
begin
  a := public.alr__run_core(p_org);
  b := public.rpt__alert_run(p_org);
  return a || jsonb_build_object('alerts', coalesce((a ->> 'alerts')::int, 0) + (b ->> 'alerts')::int,
                                 'messages', coalesce((a ->> 'messages')::int, 0) + (b ->> 'messages')::int);
end $$;
revoke all on function public.alr_run(uuid) from public, anon, authenticated;
grant execute on function public.alr_run(uuid) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: true, true, false, false, true, false.
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'alr_rules' and column_name = 'report_id') as has_report_id,
       has_function_privilege('authenticated', 'public.alr_create_report_rule(text,uuid,text,text,numeric,text,text,int,jsonb)', 'execute') as users_create,
       has_function_privilege('authenticated', 'public.alr_run(uuid)', 'execute') as users_run_job,
       has_function_privilege('authenticated', 'public.rpt__alert_run(uuid)', 'execute') as users_run_report_alerts,
       has_function_privilege('service_role', 'public.alr_run(uuid)', 'execute') as job_runs,
       has_function_privilege('anon', 'public.alr_create_report_rule(text,uuid,text,text,numeric,text,text,int,jsonb)', 'execute') as anon_create;
