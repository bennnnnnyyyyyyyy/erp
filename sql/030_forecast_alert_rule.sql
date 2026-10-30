-- 030_forecast_alert_rule.sql
-- Adds the rule kind `forecast_stockout` to the alerts app (sql/028): "tell these people when an item has fewer than N days of stock
-- left", using the forecast from sql/029 (so it carries the same confidence: a rule on thin history says so in the message).
-- The evaluator runs without a signed-in user, so the forecast is split into an internal function `inv__forecast_for(org)`
-- (no caller check, not callable by users) and the public `inv_forecast()` becomes a thin wrapper with the usual guard.
-- Depends on sql/001-029. Rerun-safe. Then run sql/tests/026_forecast_alert_rule.sql.

begin;

create or replace function public.inv__forecast_for(v_org uuid)
returns table (item_id uuid, sku text, name text, uom text, available numeric, daily_rate numeric, days_of_cover int, runs_out_on date, history_days int, issues_count int, confidence text, lead_days int, on_order numeric, suggested_order numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with usage as (
    select m.item_id,
           sum(-m.qty) filter (where m.posted_at >= now() - interval '30 days') as p1,
           sum(-m.qty) filter (where m.posted_at < now() - interval '30 days' and m.posted_at >= now() - interval '60 days') as p2,
           sum(-m.qty) filter (where m.posted_at < now() - interval '60 days') as p3,
           count(*) as n, min(m.posted_at)::date as first_at
      from public.inv_stock_moves m
     where m.org_id = v_org and m.kind = 'issue' and m.posted_at >= now() - interval '90 days'
     group by m.item_id),
  stock as (
    select b.item_id, sum(b.on_hand - b.reserved) as avail from public.inv_stock_balances b where b.org_id = v_org group by b.item_id),
  lead as (
    select pl.item_id, round(avg(extract(epoch from (po.received_at - po.created_at)) / 86400))::int as days
      from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by pl.item_id),
  ordered as (
    select pl.item_id, sum(pl.qty) as qty from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'ordered' group by pl.item_id),
  calc as (
    select it.id, it.sku, it.name, it.uom, coalesce(s.avail, 0) as avail,
           (0.5 * coalesce(u.p1, 0) + 0.3 * coalesce(u.p2, 0) + 0.2 * coalesce(u.p3, 0)) / 30.0 as rate,
           coalesce(u.n, 0)::int as n, coalesce(current_date - u.first_at, 0)::int as hist,
           coalesce(l.days, 7)::int as lead, coalesce(o.qty, 0) as ord
      from public.inv_items it left join usage u on u.item_id = it.id left join stock s on s.item_id = it.id left join lead l on l.item_id = it.id left join ordered o on o.item_id = it.id
     where it.org_id = v_org and it.deleted_at is null)
  select c.id, c.sku, c.name, c.uom, c.avail, round(c.rate, 4),
         case when c.rate > 0 then least(floor(greatest(c.avail, 0) / c.rate), 3650)::int end,
         case when c.rate > 0 then current_date + least(floor(greatest(c.avail, 0) / c.rate), 3650)::int end,
         c.hist, c.n,
         case when c.rate <= 0 then 'none' when c.n >= 8 and c.hist >= 60 then 'good' else 'thin' end,
         c.lead, c.ord,
         case when c.rate > 0 then greatest(0, ceil(c.rate * (c.lead + 7) - c.avail - c.ord)) end
    from calc c
   order by case when c.rate > 0 then floor(greatest(c.avail, 0) / c.rate) end nulls last, c.sku;

end $$;

create or replace function public.inv_forecast()
returns table (item_id uuid, sku text, name text, uom text, available numeric, daily_rate numeric, days_of_cover int, runs_out_on date, history_days int, issues_count int, confidence text, lead_days int, on_order numeric, suggested_order numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
begin
  return query select * from public.inv__forecast_for(v_org) f order by f.days_of_cover nulls last, f.sku;
end $$;

revoke all on function public.inv__forecast_for(uuid) from public, anon, authenticated;
revoke all on function public.inv_forecast() from public, anon;
grant execute on function public.inv_forecast() to authenticated;

-- the rule table accepts the new kind (and a day count, and an optional item, for it)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.alr_rules'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%expiry_within%' or pg_get_constraintdef(oid) like '%item_id IS NULL%') loop
    execute format('alter table public.alr_rules drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.alr_rules add constraint alr_rules_kind_chk check (kind in ('stock_below', 'expiry_within', 'receivable_overdue', 'profit_negative', 'forecast_stockout'));
alter table public.alr_rules add constraint alr_rules_item_chk check (item_id is null or kind in ('stock_below', 'forecast_stockout'));
alter table public.alr_rules add constraint alr_rules_days_chk check (kind not in ('expiry_within', 'receivable_overdue', 'forecast_stockout') or (threshold is not null and threshold >= 0));

-- the evaluator with the new rule kind
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
          union all
          select 'fc:' || fc.item_id, fc.days_of_cover::numeric, false,
                 format('%s %s: about %s day(s) left (runs out around %s); %s available, using %s a day; %s%s',
                        fc.sku, fc.name, fc.days_of_cover, fc.runs_out_on, fc.available, fc.daily_rate,
                        case fc.confidence when 'good' then 'solid history' else 'THIN history, treat as a guess' end,
                        case when coalesce(fc.suggested_order, 0) > 0 then '; suggested order ' || fc.suggested_order else '' end),
                 'Running out soon: ' || fc.sku
            from public.inv__forecast_for(r.org_id) fc
           where r.kind = 'forecast_stockout' and fc.confidence <> 'none' and fc.days_of_cover <= r.threshold::int and (r.item_id is null or fc.item_id = r.item_id)
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
                        else case r.kind when 'stock_below' then 'Low stock: ' || v_n || ' items' when 'expiry_within' then 'Expiring stock: ' || v_n || ' batches' when 'forecast_stockout' then 'Running out soon: ' || v_n || ' items' else 'Overdue invoices: ' || v_n end end;
        v_body := array_to_string(v_lines, E'\n') || case when v_n > 10 then E'\n...and ' || (v_n - 10) || ' more' else '' end;
        v_sent := 0;
        for rcp in select * from public.alr__recipients(r.org_id, r.id) loop
          if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', v_title, v_body, null, null, 'alr:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000000)::bigint || ':' || rcp.user_id) is not null then v_sent := v_sent + 1; end if;
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

commit;

-- Verification (read-only): expect the evaluator is service-role only (false) and the forecast still callable by users (true).
select has_function_privilege('authenticated', 'public.alr_run(uuid)', 'execute') as users_can_run_evaluator, has_function_privilege('authenticated', 'public.inv_forecast()', 'execute') as users_can_read_forecast;