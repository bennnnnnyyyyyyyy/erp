-- sql/106_inv_low_stock_popup.sql
-- Phase 1a, the low stock pop-up (documentation/plans/LOW_STOCK_POPUP_BUILD_PLAN.md, approved by Ben 23 Nov 2026).
-- 1. Company work week (organizations.settings.work_week: workdays 0 = Sunday .. 6, start and end time). Set by owners and admins in
--    the setup steps and Settings, audited. "Remind me: tomorrow" = the next workday at the start time (Ben, 23 Nov).
-- 2. inv_items.max_level: the level a reorder fills stock up to (optional). Its read grant is in this migration (inv_items uses
--    column grants; test 092 guards it). Set by owners and admins, audited, like the reorder level (sql/013).
-- 3. inv_stock_alert_states: each person's "Remind me" and "Don't show again" for an item. Personal settings: no audit row (Ben,
--    23 Nov). A person reads only their own rows; writes go through the functions below.
-- 4. inv_low_stock_popup(): the low items for the caller, with a suggested quantity and the item's last supplier. Only people who can
--    reorder (owners and admins make purchase orders; members make stock requests); viewers get nothing. A mute stops when the item's
--    available quantity reaches zero.
-- Rerun-safe. Needs sql/001-105 (inv__guard 006, forecast 064, supplier prices 097). Ends with read-only checks.
-- Run the whole file, then sql/tests/103_low_stock_popup.sql and sql/tests/092_column_grants.sql.

begin;

-- ---------------------------------------------------------------- 1. work week

create or replace function public.core__work_week(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(o.settings -> 'work_week', '{"days":[0,1,2,3,4],"start":"09:00","end":"17:00"}'::jsonb)
    from public.organizations o where o.id = p_org;
$$;
revoke all on function public.core__work_week(uuid) from public, anon, authenticated;

create or replace function public.core_set_work_week(p_days int[], p_start text, p_end text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.require_org_role(array['owner', 'admin']);
  v_days   int[];
  v_before jsonb;
  v_after  jsonb;
begin
  select array_agg(distinct d order by d) into v_days from unnest(coalesce(p_days, '{}')) d;
  if v_days is null or exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
    raise exception 'INVALID_INPUT' using detail = 'choose at least one workday (0 = Sunday to 6 = Saturday)';
  end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_start >= p_end then
    raise exception 'INVALID_INPUT' using detail = 'start and end are times like 09:00, and the start is before the end';
  end if;
  v_before := public.core__work_week(v_org);
  v_after := jsonb_build_object('days', to_jsonb(v_days), 'start', p_start, 'end', p_end);
  update public.organizations o set settings = o.settings || jsonb_build_object('work_week', v_after) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.work_week_changed', 'organization', v_org::text,
          format('Work week set: days %s, %s to %s', array_to_string(v_days, ','), p_start, p_end), v_before, v_after);
  return v_after;
end $$;
revoke all on function public.core_set_work_week(int[], text, text) from public, anon;
grant execute on function public.core_set_work_week(int[], text, text) to authenticated;

-- The next workday start after p_from, at least p_min_days later (company time zone). p_week: the first workday of next week instead.
create or replace function public.core__next_work_start(p_org uuid, p_from timestamptz, p_min_days int, p_week boolean default false)
returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  v_ww    jsonb := public.core__work_week(p_org);
  v_tz    text := coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC');
  v_today date := (p_from at time zone v_tz)::date;
  v_days  int[] := array(select jsonb_array_elements_text(v_ww -> 'days')::int);
  v_first int;
  d       date;
begin
  if coalesce(array_length(v_days, 1), 0) = 0 then v_days := array[0, 1, 2, 3, 4]; end if;
  select min(x) into v_first from unnest(v_days) x;
  for i in greatest(p_min_days, 1)..14 loop
    d := v_today + i;
    if (p_week and extract(dow from d)::int = v_first) or (not p_week and extract(dow from d)::int = any (v_days)) then
      return (d + (v_ww ->> 'start')::time) at time zone v_tz;
    end if;
  end loop;
  return p_from + interval '1 day';
end $$;
revoke all on function public.core__next_work_start(uuid, timestamptz, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. maximum level

alter table public.inv_items add column if not exists max_level numeric(18, 3);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inv_items_max_level_check') then
    alter table public.inv_items add constraint inv_items_max_level_check check (max_level is null or max_level >= 0);
  end if;
end $$;
grant select (max_level) on public.inv_items to authenticated;

create or replace function public.inv_set_max_level(p_item_id uuid, p_level numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  i     public.inv_items;
begin
  if p_level is not null and p_level < 0 then raise exception 'INVALID_INPUT'; end if;
  select * into i from public.inv_items x where x.org_id = v_org and x.id = p_item_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.max_level is not distinct from p_level then return; end if;
  update public.inv_items x set max_level = p_level where x.id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.max_level.set', 'item', i.id::text,
          case when p_level is null then format('Maximum level of %s removed', i.sku) else format('Maximum level of %s set to %s', i.sku, p_level) end,
          jsonb_build_object('max_level', i.max_level), jsonb_build_object('max_level', p_level));
end $$;
revoke all on function public.inv_set_max_level(uuid, numeric) from public, anon;
grant execute on function public.inv_set_max_level(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------- 3. each person's snooze and mute

create table if not exists public.inv_stock_alert_states (
  org_id        uuid not null references public.organizations(id),
  user_id       uuid not null references auth.users(id),
  item_id       uuid not null,
  snoozed_until timestamptz,
  muted_at      timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (org_id, user_id, item_id),
  foreign key (org_id, item_id) references public.inv_items(org_id, id)
);
alter table public.inv_stock_alert_states enable row level security;
revoke all on public.inv_stock_alert_states from anon, authenticated;
grant select on public.inv_stock_alert_states to authenticated;
drop policy if exists inv_stock_alert_states_own_read on public.inv_stock_alert_states;
create policy inv_stock_alert_states_own_read on public.inv_stock_alert_states for select to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.memberships m where m.org_id = inv_stock_alert_states.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null));

-- "Remind me": 'hour' (one hour from now), 'tomorrow' (the next workday at the start time), 'week' (the first workday of next week).
create or replace function public.inv_snooze_low_stock(p_item_id uuid, p_for text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_until timestamptz;
begin
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  v_until := case p_for
    when 'hour' then now() + interval '1 hour'
    when 'tomorrow' then public.core__next_work_start(v_org, now(), 1)
    when 'week' then public.core__next_work_start(v_org, now(), 1, true)
  end;
  if v_until is null then raise exception 'INVALID_INPUT' using detail = 'for is hour, tomorrow or week'; end if;
  insert into public.inv_stock_alert_states (org_id, user_id, item_id, snoozed_until)
  values (v_org, auth.uid(), p_item_id, v_until)
  on conflict (org_id, user_id, item_id) do update set snoozed_until = excluded.snoozed_until, updated_at = now();
  return v_until;
end $$;
revoke all on function public.inv_snooze_low_stock(uuid, text) from public, anon;
grant execute on function public.inv_snooze_low_stock(uuid, text) to authenticated;

-- "Don't show again" (p_on true), or show it again (false).
create or replace function public.inv_mute_low_stock(p_item_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
begin
  if not exists (select 1 from public.inv_items i where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  insert into public.inv_stock_alert_states (org_id, user_id, item_id, muted_at)
  values (v_org, auth.uid(), p_item_id, case when p_on then now() end)
  on conflict (org_id, user_id, item_id) do update set muted_at = case when p_on then now() end, updated_at = now();
end $$;
revoke all on function public.inv_mute_low_stock(uuid, boolean) from public, anon;
grant execute on function public.inv_mute_low_stock(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4. the pop-up list

-- Suggested quantity: up to the maximum level when set, else the forecast's suggestion, else reorder level x 2 - available; minus what
-- is already on order; never below 0.
create or replace function public.inv_low_stock_popup()
returns table (item_id uuid, sku text, name text, name_ar text, uom text, available numeric, reorder_level numeric, max_level numeric,
               on_order numeric, suggested_qty numeric, supplier_id uuid, supplier_name text, last_cost_minor bigint, currency text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
begin
  return query
  with stock as (
    select i.id, i.sku, i.name, i.name_ar, i.uom, i.reorder_level, i.max_level,
           coalesce((select sum(b.on_hand - b.reserved) from public.inv_stock_balances b where b.org_id = i.org_id and b.item_id = i.id), 0)::numeric as avail
      from public.inv_items i
     where i.org_id = v_org and i.deleted_at is null and i.reorder_level is not null
  ), low as (
    select s.* from stock s
     where s.avail <= s.reorder_level
       and not exists (select 1 from public.inv_stock_alert_states st
                        where st.org_id = v_org and st.user_id = auth.uid() and st.item_id = s.id
                          and ((st.snoozed_until is not null and st.snoozed_until > now()) or (st.muted_at is not null and s.avail > 0)))
  ), fc as (
    select f.item_id, f.on_order, f.suggested_order from public.inv__forecast_for(v_org) f
  ), sup as (
    select distinct on (p.item_id) p.item_id, p.supplier_id, p.last_cost_minor, p.currency::text as currency
      from public.pur_supplier_prices p where p.org_id = v_org order by p.item_id, p.recorded_at desc
  )
  select l.id, l.sku, l.name, l.name_ar, l.uom, l.avail, l.reorder_level, l.max_level,
         coalesce(fc.on_order, 0),
         greatest(0, case when l.max_level is not null then l.max_level - l.avail - coalesce(fc.on_order, 0)
                          when coalesce(fc.suggested_order, 0) > 0 then fc.suggested_order
                          else l.reorder_level * 2 - l.avail - coalesce(fc.on_order, 0) end),
         sup.supplier_id, ps.name, sup.last_cost_minor, sup.currency
    from low l
    left join fc on fc.item_id = l.id
    left join sup on sup.item_id = l.id
    left join public.pur_suppliers ps on ps.org_id = v_org and ps.id = sup.supplier_id
   order by l.avail - l.reorder_level, l.sku;
end $$;
revoke all on function public.inv_low_stock_popup() from public, anon;
grant execute on function public.inv_low_stock_popup() to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
select
  (select relrowsecurity from pg_class where oid = 'public.inv_stock_alert_states'::regclass) as states_rls_on,
  has_table_privilege('authenticated', 'public.inv_stock_alert_states', 'INSERT') as users_insert_states,
  has_column_privilege('authenticated', 'public.inv_items', 'max_level', 'SELECT') as users_read_max_level,
  has_function_privilege('anon', 'public.inv_low_stock_popup()', 'execute') as anon_reads_popup,
  has_function_privilege('authenticated', 'public.core__next_work_start(uuid, timestamptz, int, boolean)', 'execute') as users_call_helper;
