-- sql/110_rpt_sales_forecast.sql
-- Reports & Insights, step 4 (documentation/plans/REPORTS_INSIGHTS_PLAN.md section 7.4, approved by Ben 24 Nov 2026): the sales
-- forecast, by product or by customer, for the whole company (Ben's answer Q5: not per branch yet). The same method as the stock
-- forecast (sql/029), on sales instead of stock issues. Plain statistics, written down so the screen can say it in plain words:
--   history   = issued sales invoice lines dated in the last 90 days (company time zone), minus approved credit notes decided in those
--               90 days (their quantity and net value). Value is the net amount (without VAT), per currency: never added across currencies.
--   rate/day  = weighted average: the latest 30 days count 50%, the 30 before 30%, the 30 before that 20%; divided by 30.
--   forecast  = rate/day x the horizon (30, 60 or 90 days), for quantity (by product only: a customer buys items in different units)
--               and for value (each currency).
--   trend     = 'up' when the latest 30 days are more than 10% above the oldest 30 (or the oldest 30 had nothing), 'down' when more than
--               10% below, else 'flat'. Products: on quantity. Customers: on value, in the currency they buy most in.
--   confidence = 'good' with at least 8 invoices over at least 60 days of history; else 'thin' (treat it as a guess). Products and
--               customers with no sales in 90 days are not listed (no forecast).
-- Not covered: weekly and seasonal patterns (need 12+ months), price changes, promotions. Read-only, nothing audited (like sql/029).
-- Who: everyone in the company who may read sales invoices (owners, admins, members, viewers), with the sales module on.
-- Rerun-safe. Needs sql/001-109. Then run sql/tests/107_rpt_sales_forecast.sql. Ends with read-only checks.

begin;

create or replace function public.rpt_sales_forecast(p_by text default 'item', p_horizon int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c       record;
  v_tz    text;
  v_today date;
begin
  select * into c from public.rpt__caller();
  if p_by is null or p_by not in ('item', 'customer') then raise exception 'INVALID_INPUT' using detail = 'by item or by customer'; end if;
  if p_horizon is null or p_horizon not in (30, 60, 90) then raise exception 'INVALID_INPUT' using detail = 'the next 30, 60 or 90 days'; end if;
  if not exists (select 1 from public.org_modules m where m.org_id = c.org and m.module_key = 'sales' and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = c.org), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  return (
    with lines as (
      -- issued invoices in the last 90 days
      select case when p_by = 'item' then ol.item_id else i.customer_id end as subj, i.currency::text as cur, i.invoice_date as d,
             i.id as inv, l.qty, l.net_minor
        from public.sal_invoice_lines l
        join public.sal_invoices i on i.org_id = l.org_id and i.id = l.invoice_id
        join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
       where l.org_id = c.org and i.status = 'issued' and i.invoice_date > v_today - 90 and i.invoice_date <= v_today
      union all
      -- approved credit notes decided in the last 90 days: taken off
      select case when p_by = 'item' then ol.item_id else i.customer_id end, n.currency::text, (n.decided_at at time zone v_tz)::date,
             null::uuid, -nl.qty, -nl.net_minor
        from public.sal_note_lines nl
        join public.sal_notes n on n.org_id = nl.org_id and n.id = nl.note_id
        join public.sal_invoice_lines l on l.org_id = nl.org_id and l.id = nl.invoice_line_id
        join public.sal_invoices i on i.org_id = l.org_id and i.id = l.invoice_id
        join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
       where nl.org_id = c.org and n.kind = 'credit' and n.status = 'approved' and n.decided_at is not null
         and (n.decided_at at time zone v_tz)::date > v_today - 90 and (n.decided_at at time zone v_tz)::date <= v_today
    ), banded as (
      select l.*, case when l.d > v_today - 30 then 1 when l.d > v_today - 60 then 2 else 3 end as band from lines l
    ), per_subject as (
      select b.subj,
             sum(b.qty) filter (where b.band = 1) as q1, sum(b.qty) filter (where b.band = 2) as q2, sum(b.qty) filter (where b.band = 3) as q3,
             count(distinct b.inv) as invoices,
             v_today - min(b.d) filter (where b.inv is not null) as history_days
        from banded b group by b.subj
      having count(b.inv) > 0
    ), per_cur as (
      select b.subj, b.cur,
             coalesce(sum(b.net_minor) filter (where b.band = 1), 0) as v1, coalesce(sum(b.net_minor) filter (where b.band = 2), 0) as v2,
             coalesce(sum(b.net_minor) filter (where b.band = 3), 0) as v3, coalesce(sum(b.net_minor), 0) as vt
        from banded b group by b.subj, b.cur
    ), main_cur as (
      select distinct on (pc.subj) pc.subj, pc.v1, pc.v3 from per_cur pc order by pc.subj, pc.vt desc, pc.cur
    ), calc as (
      select s.subj, coalesce(s.q1, 0) as q1, coalesce(s.q2, 0) as q2, coalesce(s.q3, 0) as q3, s.invoices, coalesce(s.history_days, 0) as history_days,
             (0.5 * coalesce(s.q1, 0) + 0.3 * coalesce(s.q2, 0) + 0.2 * coalesce(s.q3, 0)) / 30.0 as qrate,
             case when p_by = 'item' then coalesce(s.q1, 0) else mc.v1 end as t1,
             case when p_by = 'item' then coalesce(s.q3, 0) else mc.v3 end as t3
        from per_subject s left join main_cur mc on mc.subj = s.subj
    ), rows as (
      select k.*,
             case when k.t1 > 0 and k.t3 <= 0 then 'up'
                  when k.t1 > k.t3 * 1.1 then 'up'
                  when k.t1 < k.t3 * 0.9 then 'down'
                  else 'flat' end as trend,
             case when k.invoices >= 8 and k.history_days >= 60 then 'good' else 'thin' end as confidence
        from calc k
    )
    select jsonb_build_object(
      'asOf', v_today, 'by', p_by, 'horizon', p_horizon,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', r.subj,
        'code', case when p_by = 'item' then it.sku else cu.code end,
        'name', case when p_by = 'item' then it.name else cu.name end,
        'nameAr', case when p_by = 'item' then it.name_ar end,
        'uom', case when p_by = 'item' then it.uom end,
        'qtyLast30', case when p_by = 'item' then r.q1 end,
        'qtyPrev30', case when p_by = 'item' then r.q2 end,
        'qtyOldest30', case when p_by = 'item' then r.q3 end,
        'dailyQty', case when p_by = 'item' then round(r.qrate, 4) end,
        'forecastQty', case when p_by = 'item' then round(greatest(r.qrate, 0) * p_horizon, 3) end,
        'invoices', r.invoices, 'historyDays', r.history_days, 'trend', r.trend, 'confidence', r.confidence,
        'values', (select jsonb_agg(jsonb_build_object(
                            'currency', pc.cur, 'last30Minor', pc.v1, 'prev30Minor', pc.v2, 'oldest30Minor', pc.v3,
                            'dailyMinor', round((0.5 * pc.v1 + 0.3 * pc.v2 + 0.2 * pc.v3) / 30.0),
                            'forecastMinor', greatest(round((0.5 * pc.v1 + 0.3 * pc.v2 + 0.2 * pc.v3) / 30.0 * p_horizon), 0))
                          order by pc.vt desc, pc.cur)
                     from per_cur pc where pc.subj = r.subj))
        order by (select max(pc.vt) from per_cur pc where pc.subj = r.subj) desc nulls last, r.subj), '[]'::jsonb))
      from rows r
      left join public.inv_items it on p_by = 'item' and it.org_id = c.org and it.id = r.subj
      left join public.sal_customers cu on p_by = 'customer' and cu.org_id = c.org and cu.id = r.subj
  );
end $$;
revoke all on function public.rpt_sales_forecast(text, int) from public, anon;
grant execute on function public.rpt_sales_forecast(text, int) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Signed-in users may call it, anonymous may not (expect true, false).
select has_function_privilege('authenticated', 'public.rpt_sales_forecast(text,int)', 'execute') as users_run,
       has_function_privilege('anon', 'public.rpt_sales_forecast(text,int)', 'execute') as anon_runs;
