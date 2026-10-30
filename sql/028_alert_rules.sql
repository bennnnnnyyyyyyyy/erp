-- 028_alert_rules.sql
-- Slice T of documentation/plans/OWNER_INSIGHTS_PLAN.md section 6: alerts and triggers. New module `alerts`.
-- A RULE says: "when this happens, tell these people". Rule kinds (v1):
--   stock_below         available quantity of an item (or of every item) is at/below a number (default: the item's reorder level)
--   expiry_within       a batch with stock expires within N days (or has expired)
--   receivable_overdue  a customer invoice is still unpaid N days after its date
--   profit_negative     this month's profit so far (sales - cost of goods - expenses) is below zero
-- RECIPIENTS are a person, everyone with a role, or a TEAM (named group of users: Purchasing, Warehouse, Management by default).
-- A rule only makes MESSAGES (the existing outbox: retry, expiry, audit); a message never changes stock or approves anything.
-- Not spamming: a subject (an item, a batch, an invoice, a month) is told again only after the rule's repeat interval, or
-- sooner if it got clearly worse (stock fell further, the unpaid amount grew, the loss deepened) and at least one hour passed.
-- Evaluation is `alr_run`, called by the five-minute job (service role only). Channel is in-app today; WhatsApp/voice later.
-- Depends on sql/001-027. Rerun-safe. Then run sql/tests/024_alert_rules.sql.

begin;

create table if not exists public.alr_teams (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  name       text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index if not exists alr_teams_org_name_uq on public.alr_teams(org_id, lower(name));

create table if not exists public.alr_team_members (
  org_id   uuid not null references public.organizations(id),
  team_id  uuid not null,
  user_id  uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (org_id, team_id) references public.alr_teams(org_id, id)
);

create table if not exists public.alr_rules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  name         text not null check (length(trim(name)) between 1 and 120),
  kind         text not null check (kind in ('stock_below', 'expiry_within', 'receivable_overdue', 'profit_negative')),
  item_id      uuid,
  threshold    numeric(18,3),
  repeat_hours int not null default 24 check (repeat_hours between 1 and 720),
  enabled      boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, id),
  foreign key (org_id, item_id) references public.inv_items(org_id, id),
  check (item_id is null or kind = 'stock_below'),
  check (kind not in ('expiry_within', 'receivable_overdue') or (threshold is not null and threshold >= 0)),
  check (kind <> 'stock_below' or threshold is null or threshold >= 0)
);

create table if not exists public.alr_rule_recipients (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.organizations(id),
  rule_id uuid not null,
  team_id uuid,
  role    text check (role in ('owner', 'admin', 'member', 'viewer')),
  user_id uuid references auth.users(id),
  foreign key (org_id, rule_id) references public.alr_rules(org_id, id),
  foreign key (org_id, team_id) references public.alr_teams(org_id, id),
  check ((team_id is not null)::int + (role is not null)::int + (user_id is not null)::int = 1)
);

-- What was last told for each subject, so a rule does not repeat itself.
create table if not exists public.alr_firings (
  org_id        uuid not null references public.organizations(id),
  rule_id       uuid not null,
  subject       text not null,
  last_fired_at timestamptz not null default now(),
  last_value    numeric,
  times         int not null default 1,
  primary key (rule_id, subject),
  foreign key (org_id, rule_id) references public.alr_rules(org_id, id)
);

create index if not exists alr_rules_org_idx on public.alr_rules(org_id) where deleted_at is null;
create index if not exists alr_rule_recipients_rule_idx on public.alr_rule_recipients(org_id, rule_id);

alter table public.alr_teams enable row level security;
alter table public.alr_team_members enable row level security;
alter table public.alr_rules enable row level security;
alter table public.alr_rule_recipients enable row level security;
alter table public.alr_firings enable row level security;
revoke all on public.alr_teams, public.alr_team_members, public.alr_rules, public.alr_rule_recipients, public.alr_firings from anon, authenticated;
grant select on public.alr_teams, public.alr_team_members, public.alr_rules, public.alr_rule_recipients, public.alr_firings to authenticated;

-- owners and admins read the settings (rules decide who hears what: not for everyone)
do $$
declare t text;
begin
  foreach t in array array['alr_teams', 'alr_team_members', 'alr_rules', 'alr_rule_recipients', 'alr_firings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (exists (select 1 from public.memberships m where m.org_id = %I.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')))$p$, t || '_admin_read', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- settings functions (owner/admin, audited)

create or replace function public.alr_ensure_default_teams() returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); n int := 0; nm text;
begin
  foreach nm in array array['Purchasing', 'Warehouse', 'Management'] loop
    if not exists (select 1 from public.alr_teams where org_id = v_org and lower(name) = lower(nm)) then
      insert into public.alr_teams (org_id, name) values (v_org, nm); n := n + 1;
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.team.created', 'team', nm, nm);
    end if;
  end loop;
  return n;
end $$;

create or replace function public.alr_create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  insert into public.alr_teams (org_id, name) values (v_org, trim(p_name)) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.team.created', 'team', v_id::text, trim(p_name));
  return v_id;
exception when unique_violation then raise exception 'DUPLICATE';
end $$;

-- Replaces the members of a team. Only active members of the organization can be added.
create or replace function public.alr_set_team_members(p_team_id uuid, p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); t public.alr_teams%rowtype; u uuid;
begin
  select * into t from public.alr_teams where org_id = v_org and id = p_team_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  foreach u in array coalesce(p_user_ids, '{}') loop
    if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = u and m.disabled_at is null) then raise exception 'INVALID_INPUT'; end if;
  end loop;
  delete from public.alr_team_members where org_id = v_org and team_id = p_team_id;
  insert into public.alr_team_members (org_id, team_id, user_id) select v_org, p_team_id, x from (select distinct unnest(coalesce(p_user_ids, '{}')) as x) s;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'alerts.team.members_set', 'team', t.id::text, format('%s now has %s member(s)', t.name, coalesce(cardinality(p_user_ids), 0)));
end $$;

-- p_recipients: [{"type":"team","id":uuid} | {"type":"role","role":"admin"} | {"type":"user","id":uuid}], at least one
create or replace function public.alr__set_recipients(p_org uuid, p_rule uuid, p_recipients jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then raise exception 'INVALID_INPUT'; end if;
  delete from public.alr_rule_recipients where org_id = p_org and rule_id = p_rule;
  for e in select value from jsonb_array_elements(p_recipients) loop
    begin
      if e ->> 'type' = 'team' then
        if not exists (select 1 from public.alr_teams where org_id = p_org and id = (e ->> 'id')::uuid) then raise exception 'NOT_FOUND'; end if;
        insert into public.alr_rule_recipients (org_id, rule_id, team_id) values (p_org, p_rule, (e ->> 'id')::uuid);
      elsif e ->> 'type' = 'role' then
        insert into public.alr_rule_recipients (org_id, rule_id, role) values (p_org, p_rule, e ->> 'role');
      elsif e ->> 'type' = 'user' then
        if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (e ->> 'id')::uuid and m.disabled_at is null) then raise exception 'NOT_FOUND'; end if;
        insert into public.alr_rule_recipients (org_id, rule_id, user_id) values (p_org, p_rule, (e ->> 'id')::uuid);
      else
        raise exception 'INVALID_INPUT';
      end if;
    exception when invalid_text_representation or check_violation then raise exception 'INVALID_INPUT';
    end;
  end loop;
end $$;

create or replace function public.alr_create_rule(p_name text, p_kind text, p_item_id uuid, p_threshold numeric, p_repeat_hours int, p_recipients jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  if p_item_id is not null and not exists (select 1 from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.alr_rules (org_id, name, kind, item_id, threshold, repeat_hours, created_by)
    values (v_org, trim(p_name), p_kind, p_item_id, p_threshold, coalesce(p_repeat_hours, 24), auth.uid()) returning id into v_id;
  exception when check_violation then raise exception 'INVALID_INPUT';
  end;
  perform public.alr__set_recipients(v_org, v_id, p_recipients);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.rule.created', 'alert_rule', v_id::text, format('%s (%s)', trim(p_name), p_kind));
  return v_id;
end $$;

create or replace function public.alr_set_rule_recipients(p_rule_id uuid, p_recipients jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); r public.alr_rules%rowtype;
begin
  select * into r from public.alr_rules where org_id = v_org and id = p_rule_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.alr__set_recipients(v_org, p_rule_id, p_recipients);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.rule.recipients_set', 'alert_rule', r.id::text, r.name || ': recipients changed');
end $$;

create or replace function public.alr_set_rule_enabled(p_rule_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); r public.alr_rules%rowtype;
begin
  select * into r from public.alr_rules where org_id = v_org and id = p_rule_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.alr_rules set enabled = p_enabled where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), case when p_enabled then 'alerts.rule.enabled' else 'alerts.rule.disabled' end, 'alert_rule', r.id::text, r.name);
end $$;

-- A rule is never deleted, only retired (kept for the history).
create or replace function public.alr_retire_rule(p_rule_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); r public.alr_rules%rowtype;
begin
  select * into r from public.alr_rules where org_id = v_org and id = p_rule_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.alr_rules set enabled = false, deleted_at = now() where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (v_org, auth.uid(), 'alerts.rule.retired', 'alert_rule', r.id::text, r.name);
end $$;

-- "Send me a test": one message to the caller only, so they can see what the rule's alerts look like.
create or replace function public.alr_send_test(p_rule_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.mod__guard('alerts', array['owner', 'admin']); r public.alr_rules%rowtype; v_id uuid;
begin
  select * into r from public.alr_rules where org_id = v_org and id = p_rule_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_id := public.msg__enqueue(v_org, auth.uid(), 'alert', 'TEST: ' || r.name, 'This is a test of the rule "' || r.name || '". Nothing is wrong.', null, null, 'alr-test:' || r.id || ':' || gen_random_uuid());
  return v_id;
end $$;

-- ---------------------------------------------------------------- evaluation (service role, called by the five-minute job)

create or replace function public.alr__recipients(p_org uuid, p_rule uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct m.user_id from public.memberships m
   where m.org_id = p_org and m.disabled_at is null and (
     m.user_id in (select tm.user_id from public.alr_rule_recipients rr join public.alr_team_members tm on tm.team_id = rr.team_id where rr.org_id = p_org and rr.rule_id = p_rule)
     or m.role in (select rr.role from public.alr_rule_recipients rr where rr.org_id = p_org and rr.rule_id = p_rule and rr.role is not null)
     or m.user_id in (select rr.user_id from public.alr_rule_recipients rr where rr.org_id = p_org and rr.rule_id = p_rule and rr.user_id is not null));
$$;

create or replace function public.alr_run(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; c record; f public.alr_firings%rowtype; rcp record;
  v_lines text[]; v_n int; v_first text; v_title text; v_body text;
  v_fire boolean; v_worse boolean; v_sent int; n_rules int := 0; n_alerts int := 0; n_msgs int := 0; org_alerts int; v_org uuid;
  m0 date := date_trunc('month', current_date)::date; v_rev bigint; v_cogs bigint; v_exp bigint;
begin
  for v_org in
    select o.id from public.organizations o
     where o.deleted_at is null and (p_org is null or o.id = p_org)
       and exists (select 1 from public.org_modules mo where mo.org_id = o.id and mo.module_key = 'alerts' and mo.disabled_at is null)
  loop
    org_alerts := 0;
    for r in select * from public.alr_rules where alr_rules.org_id = v_org and enabled and deleted_at is null loop
      n_rules := n_rules + 1;

      v_lines := '{}'; v_n := 0; v_first := null;
      -- candidates: subject key, current value, whether a larger value is worse (or a smaller one), message text
      for c in
        select * from (
          select 'item:' || it.id as subject, coalesce(sum(b.on_hand - b.reserved), 0) as val, false as bigger_is_worse,
                 format('%s %s: %s available (alert level %s)', it.sku, it.name, coalesce(sum(b.on_hand - b.reserved), 0), coalesce(r.threshold, it.reorder_level)) as txt,
                 'Low stock: ' || it.sku as title
            from public.inv_items it left join public.inv_stock_balances b on b.org_id = it.org_id and b.item_id = it.id
           where r.kind = 'stock_below' and it.org_id = r.org_id and it.deleted_at is null and (r.item_id is null or it.id = r.item_id)
           group by it.id, it.sku, it.name, it.reorder_level
          having coalesce(r.threshold, it.reorder_level) is not null and coalesce(sum(b.on_hand - b.reserved), 0) <= coalesce(r.threshold, it.reorder_level)
          union all
          select 'batch:' || b.id, (b.expiry_date - current_date)::numeric, false,
                 format('%s %s batch %s: %s in stock, %s', it.sku, it.name, b.batch_no, sum(bb.qty),
                        case when b.expiry_date < current_date then 'EXPIRED ' || (current_date - b.expiry_date) || ' day(s) ago' else 'expires in ' || (b.expiry_date - current_date) || ' day(s)' end),
                 case when b.expiry_date < current_date then 'Expired stock: ' else 'Expiring stock: ' end || it.sku
            from public.inv_batches b join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id join public.inv_batch_balances bb on bb.org_id = b.org_id and bb.batch_id = b.id
           where r.kind = 'expiry_within' and b.org_id = r.org_id and b.expiry_date is not null and b.expiry_date <= current_date + r.threshold::int
           group by b.id, b.batch_no, b.expiry_date, it.sku, it.name having sum(bb.qty) > 0
          union all
          select 'invoice:' || t.id, t.remaining::numeric, true,
                 format('Invoice %s for %s is unpaid %s day(s) after its date: %s %s still owed', t.number, t.cname, current_date - t.invoice_date, round(t.remaining / 100.0, 2), t.currency),
                 'Overdue invoice ' || t.number
            from (select i.id, i.number, i.invoice_date, i.currency, cu.name as cname,
                         coalesce((select sum(round(il.qty * il.unit_price_minor)) from public.sal_invoice_lines il where il.org_id = i.org_id and il.invoice_id = i.id), 0)::bigint
                         - coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded'), 0)::bigint as remaining
                    from public.sal_invoices i join public.sal_customers cu on cu.org_id = i.org_id and cu.id = i.customer_id
                   where r.kind = 'receivable_overdue' and i.org_id = r.org_id and i.status = 'issued' and i.invoice_date < current_date - r.threshold::int) t
           where t.remaining > 0
        ) q
      loop
        select * into f from public.alr_firings where rule_id = r.id and subject = c.subject;
        v_worse := f.rule_id is not null and ((c.bigger_is_worse and c.val > f.last_value) or (not c.bigger_is_worse and r.kind = 'stock_below' and c.val < f.last_value));
        v_fire := f.rule_id is null or f.last_fired_at <= now() - make_interval(hours => r.repeat_hours) or (v_worse and f.last_fired_at <= now() - interval '1 hour');
        continue when not v_fire;
        -- everything that is due goes into ONE message per person (a digest), never one message per item or invoice
        v_n := v_n + 1;
        if v_n <= 10 then v_lines := v_lines || c.txt; end if;
        v_first := coalesce(v_first, c.title);
        insert into public.alr_firings (org_id, rule_id, subject, last_fired_at, last_value, times) values (r.org_id, r.id, c.subject, now(), c.val, 1)
        on conflict (rule_id, subject) do update set last_fired_at = now(), last_value = excluded.last_value, times = public.alr_firings.times + 1;
      end loop;
      if v_n > 0 then
        v_title := case when v_n = 1 then v_first
                        else case r.kind when 'stock_below' then 'Low stock: ' || v_n || ' items' when 'expiry_within' then 'Expiring stock: ' || v_n || ' batches' else 'Overdue invoices: ' || v_n end end;
        v_body := array_to_string(v_lines, E'\n') || case when v_n > 10 then E'\n...and ' || (v_n - 10) || ' more' else '' end;
        v_sent := 0;
        for rcp in select * from public.alr__recipients(r.org_id, r.id) loop
          if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', v_title, v_body, null, null, 'alr:' || r.id || ':' || floor(extract(epoch from clock_timestamp()))::bigint || ':' || rcp.user_id) is not null then v_sent := v_sent + 1; end if;
        end loop;
        n_alerts := n_alerts + v_n; org_alerts := org_alerts + v_n; n_msgs := n_msgs + v_sent;
      end if;

      -- profit so far this month (sales - cost of goods - expenses) below zero
      if r.kind = 'profit_negative' then
        select coalesce(sum(round(il.qty * il.unit_price_minor)), 0)::bigint into v_rev from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
         where i.org_id = r.org_id and i.status = 'issued' and i.invoice_date >= m0;
        select coalesce(sum(round(-mv.qty * coalesce(mv.unit_cost_minor, it.avg_cost_minor))), 0)::bigint into v_cogs from public.inv_stock_moves mv join public.inv_items it on it.org_id = mv.org_id and it.id = mv.item_id
         where mv.org_id = r.org_id and mv.kind = 'issue' and mv.posted_at >= m0 and mv.request_id in (select so.request_id from public.sal_orders so where so.org_id = r.org_id and so.request_id is not null);
        select coalesce(sum(e.amount_minor), 0)::bigint into v_exp from public.fin_expenses e where e.org_id = r.org_id and e.status = 'recorded' and e.expense_date >= m0;
        if v_rev - v_cogs - v_exp < 0 then
          select * into f from public.alr_firings where rule_id = r.id and subject = 'month:' || to_char(m0, 'YYYY-MM');
          v_worse := f.rule_id is not null and (v_rev - v_cogs - v_exp) < f.last_value;
          if f.rule_id is null or f.last_fired_at <= now() - make_interval(hours => r.repeat_hours) or (v_worse and f.last_fired_at <= now() - interval '1 hour') then
            v_sent := 0;
            for rcp in select * from public.alr__recipients(r.org_id, r.id) loop
              if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', 'Losing money this month',
                   format('This month so far: sales %s, cost of goods %s, expenses %s: a loss of %s %s.', round(v_rev / 100.0), round(v_cogs / 100.0), round(v_exp / 100.0), round(-(v_rev - v_cogs - v_exp) / 100.0),
                          (select default_currency from public.organizations where id = r.org_id)), null, null, 'alr:' || r.id || ':month:' || (coalesce(f.times, 0) + 1) || ':' || rcp.user_id) is not null then v_sent := v_sent + 1; end if;
            end loop;
            insert into public.alr_firings (org_id, rule_id, subject, last_fired_at, last_value, times) values (r.org_id, r.id, 'month:' || to_char(m0, 'YYYY-MM'), now(), v_rev - v_cogs - v_exp, 1)
            on conflict (rule_id, subject) do update set last_fired_at = now(), last_value = excluded.last_value, times = public.alr_firings.times + 1;
            n_alerts := n_alerts + 1; org_alerts := org_alerts + 1; n_msgs := n_msgs + v_sent;
          end if;
        end if;
      end if;
    end loop;

    if org_alerts > 0 then
      insert into public.audit_log (org_id, action, entity_type, summary, metadata)
      values (v_org, 'alerts.run', 'organization', format('Alert rules fired %s time(s)', org_alerts), jsonb_build_object('fired', org_alerts));
    end if;
  end loop;
  return jsonb_build_object('rules', n_rules, 'alerts', n_alerts, 'messages', n_msgs);
end $$;

revoke all on function public.alr__set_recipients(uuid, uuid, jsonb), public.alr__recipients(uuid, uuid), public.alr_run(uuid) from public, anon, authenticated;
grant execute on function public.alr_run(uuid) to service_role;
revoke all on function public.alr_ensure_default_teams(), public.alr_create_team(text), public.alr_set_team_members(uuid, uuid[]),
  public.alr_create_rule(text, text, uuid, numeric, int, jsonb), public.alr_set_rule_recipients(uuid, jsonb), public.alr_set_rule_enabled(uuid, boolean),
  public.alr_retire_rule(uuid), public.alr_send_test(uuid) from public, anon;
grant execute on function public.alr_ensure_default_teams(), public.alr_create_team(text), public.alr_set_team_members(uuid, uuid[]),
  public.alr_create_rule(text, text, uuid, numeric, int, jsonb), public.alr_set_rule_recipients(uuid, jsonb), public.alr_set_rule_enabled(uuid, boolean),
  public.alr_retire_rule(uuid), public.alr_send_test(uuid) to authenticated;

-- "All apps on" now includes alerts.
create or replace function public.core_enable_all_modules(p_org_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k text; n int := 0;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  foreach k in array array['inventory', 'tasks', 'messaging', 'purchasing', 'sales', 'finance', 'alerts'] loop
    if not exists (select 1 from public.org_modules where org_id = p_org_id and module_key = k and disabled_at is null) then
      insert into public.org_modules (org_id, module_key, enabled_at, disabled_at) values (p_org_id, k, now(), null)
      on conflict (org_id, module_key) do update set enabled_at = now(), disabled_at = null;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary) values (p_org_id, 'module.enabled', 'module', k, k || ' switched on (all apps on by default)');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

commit;

-- Verification (read-only): five tables with RLS (expect five rows); the evaluator is service-role only (expect false).
select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('alr_teams', 'alr_team_members', 'alr_rules', 'alr_rule_recipients', 'alr_firings') and relrowsecurity order by relname;
select has_function_privilege('authenticated', 'public.alr_run(uuid)', 'execute') as authenticated_can_run;
