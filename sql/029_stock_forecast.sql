-- 029_stock_forecast.sql
-- Slice P of documentation/plans/OWNER_INSIGHTS_PLAN.md section 7: "when is this going to run out", from the organization's OWN history.
-- Method (stated on screen too, simple and explainable, no machine learning):
--   usage per day = recency-weighted average of what was issued in the last 90 days: the latest 30 days count 50%, the 30 before 30%,
--                   the 30 before that 20%.
--   days of cover = available stock (on hand minus reserved) / usage per day.   runs out on = today + days of cover.
--   lead time     = average days from order to receipt of this item's purchases in the last 12 months (7 days if it was never bought).
--   suggested order = usage per day x (lead time + 7 safety days) - available - already on order (never below zero).
--   confidence    = 'good' with at least 8 issues spread over at least 60 days; 'thin' with less (treat the date as a guess);
--                   'none' when nothing was issued in 90 days (no forecast is shown).
-- Not covered: seasonality (needs 12+ months of history per item), promotions, supplier delays. Read-only; no costs involved, so
-- any member may read it. Depends on sql/001-028. Rerun-safe. Then run sql/tests/025_stock_forecast.sql.

begin;

create or replace function public.inv_forecast()
returns table (item_id uuid, sku text, name text, uom text, available numeric, daily_rate numeric, days_of_cover int, runs_out_on date,
               history_days int, issues_count int, confidence text, lead_days int, on_order numeric, suggested_order numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
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

revoke all on function public.inv_forecast() from public, anon;
grant execute on function public.inv_forecast() to authenticated;

commit;

-- Verification (read-only): callable by signed-in users, not anonymous (expect true, false).
select has_function_privilege('authenticated', 'public.inv_forecast()', 'execute') as authenticated_can, has_function_privilege('anon', 'public.inv_forecast()', 'execute') as anon_can;
