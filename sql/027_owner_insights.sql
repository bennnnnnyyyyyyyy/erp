-- 027_owner_insights.sql
-- Slice H of documentation/plans/OWNER_INSIGHTS_PLAN.md: the numbers behind the owner home page, computed in the database,
-- read-only, owner/admin only (money is hidden from everyone else).
--
-- Definitions (written on screen too, so nobody is misled; this is a MANAGEMENT view, not statutory accounts, no VAT):
--   revenue          = issued customer invoices by invoice date (void ones excluded)
--   cost of goods    = quantity issued for sales orders x the item's average cost at the time of the issue
--   expenses         = recorded (not void) expenses by expense date
--   net profit       = revenue - cost of goods - expenses
--   owed to me       = issued invoices - payments received; overdue = unpaid part of invoices older than 30 days
--   I owe            = supplier invoices - payments made, plus recorded expenses - payments made for them
--   stock value      = on hand x average cost
-- Depends on sql/001-026. Rerun-safe. Then run sql/tests/023_owner_insights.sql.

begin;

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
                 (select coalesce(sum(round(il.qty * il.unit_price_minor)), 0) from public.sal_invoice_lines il where il.org_id = i.org_id and il.invoice_id = i.id)::bigint as total,
                 (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded')::bigint as paid
            from public.sal_invoices i where i.org_id = v_org and i.status = 'issued') t;

  -- money I owe: supplier invoices and recorded expenses, less what was paid
  select coalesce(sum(t.total - t.paid), 0) into v_owe from (
    select (select coalesce(sum(round(l.qty * l.unit_cost_minor)), 0) from public.pur_supplier_invoice_lines l where l.org_id = i.org_id and l.invoice_id = i.id)::bigint as total,
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
     where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= current_date - 90 group by it.sku, it.name order by rev desc limit 5) t;

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

-- Verification (read-only): callable by signed-in users only (expect true, false).
select has_function_privilege('authenticated', 'public.insights_home()', 'execute') as authenticated_can, has_function_privilege('anon', 'public.insights_home()', 'execute') as anon_can;
