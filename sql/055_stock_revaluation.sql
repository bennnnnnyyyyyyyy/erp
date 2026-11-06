-- sql/055_stock_revaluation.sql
-- Revalue stock to average cost. Rerun-safe. Needs sql/001-054.
--
-- Why: an item's stock value in the books should equal quantity on hand × average cost. It can drift when costs were set outside the
-- normal receipt flow: imported history, or sample data written directly (the demo company is EGP 582,100.60 above quantity × average
-- cost, because its seed issued stock at a flat cost while receipts rose). Entries are never edited, so the correction is one new
-- entry, item by item: the difference between the books and quantity × average cost, against the stock-adjustment account.
--
-- * acc_stock_value_check(): per item, quantity on hand, average cost, value in the books (the inventory account's lines for that
--   item), the value at average cost, and the difference. Read: owner, admin, head accountant.
-- * acc_revalue_stock(p_date, p_note): posts that one entry (source 'stock_revaluation', event 'revalued'), and writes one cost-log row
--   per item (source 'revaluation', with the value) so the item statement shows the correction. Owner or head accountant (as the
--   chart). Needs accounting on. Lock date applies. Items whose difference is under one minor unit are left alone.
-- * inv_item_statement (sql/052) now shows revaluation rows as value-only lines.

begin;

alter table public.inv_cost_log drop constraint if exists inv_cost_log_source_check;
alter table public.inv_cost_log add constraint inv_cost_log_source_check
  check (source in ('purchase_receipt', 'manual', 'customer_return', 'manual_receipt', 'revaluation'));
alter table public.inv_cost_log add column if not exists value_minor bigint;
alter table public.inv_cost_log add column if not exists entry_id uuid;

create or replace function public.acc__stock_value_rows(p_org uuid)
returns table (item_id uuid, sku text, item_name text, on_hand numeric, avg_cost_minor bigint, book_minor bigint, target_minor bigint, difference_minor bigint)
language sql stable security definer set search_path = public as $$
  with inv as (select public.acc__role_account(p_org, 'inventory') as acct),
  oh as (select b.item_id, sum(b.on_hand) as q from public.inv_stock_balances b where b.org_id = p_org group by b.item_id),
  bk as (select l.item_id, sum(l.debit_minor - l.credit_minor)::bigint as v
           from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
          where l.org_id = p_org and l.account_id = (select acct from inv) and l.item_id is not null
            and e.currency = (select default_currency from public.organizations where id = p_org)
          group by l.item_id)
  select i.id, i.sku, i.name, coalesce(oh.q, 0), i.avg_cost_minor, coalesce(bk.v, 0),
         round(coalesce(oh.q, 0) * coalesce(i.avg_cost_minor, 0))::bigint,
         (round(coalesce(oh.q, 0) * coalesce(i.avg_cost_minor, 0)) - coalesce(bk.v, 0))::bigint
    from public.inv_items i left join oh on oh.item_id = i.id left join bk on bk.item_id = i.id
   where i.org_id = p_org and (oh.q is not null or bk.v is not null)
   order by i.sku;
$$;
revoke all on function public.acc__stock_value_rows(uuid) from public, anon, authenticated;

create or replace function public.acc_stock_value_check()
returns table (item_id uuid, sku text, item_name text, on_hand numeric, avg_cost_minor bigint, book_minor bigint, target_minor bigint, difference_minor bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('read');
begin
  return query select * from public.acc__stock_value_rows(v_org);
end $$;

create or replace function public.acc_revalue_stock(p_date date, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.acc__guard('chart'); v_cur text; r record; v_lines jsonb := '[]'::jsonb; v_net bigint := 0; n int := 0;
  v_entry uuid; v_key text := gen_random_uuid()::text; v_note text := trim(coalesce(p_note, ''));
begin
  if not public.acc__enabled(v_org) then raise exception 'MODULE_DISABLED' using detail = 'switch accounting on first'; end if;
  if p_date is null or length(v_note) not between 1 and 300 then raise exception 'INVALID_INPUT' using detail = 'a date and a reason are required'; end if;
  perform public.core__assert_open(v_org, p_date);
  select default_currency into v_cur from public.organizations where id = v_org;
  for r in select * from public.acc__stock_value_rows(v_org) where abs(difference_minor) >= 1 loop
    v_lines := v_lines || jsonb_build_object('role', 'inventory', 'itemId', r.item_id,
      case when r.difference_minor > 0 then 'debit' else 'credit' end, abs(r.difference_minor),
      'memo', format('%s: %s on hand at %s, books %s', r.sku, r.on_hand, r.avg_cost_minor, r.book_minor));
    v_net := v_net + r.difference_minor;
    n := n + 1;
  end loop;
  if n = 0 then return jsonb_build_object('items', 0, 'netMinor', 0, 'entryId', null); end if;
  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_object('role', 'stock_adjustment', case when v_net > 0 then 'credit' else 'debit' end, abs(v_net),
      'memo', 'Stock revaluation to average cost');
  end if;
  v_entry := public.acc__post(v_org, p_date, v_cur, 'stock_revaluation', v_key, 'revalued', 'Stock revaluation to average cost: ' || v_note, v_lines);
  -- record each item's correction for the item statement (from the entry just posted, so the numbers are exactly what was booked)
  insert into public.inv_cost_log (org_id, item_id, source, ref, qty, unit_cost_minor, avg_before_minor, avg_after_minor, created_by, value_minor, entry_id, created_at)
  select v_org, l.item_id, 'revaluation', left(v_note, 120), coalesce((select sum(b.on_hand) from public.inv_stock_balances b where b.org_id = v_org and b.item_id = l.item_id), 0),
         coalesce(i.avg_cost_minor, 0), coalesce(i.avg_cost_minor, 0), coalesce(i.avg_cost_minor, 0), auth.uid(), (l.debit_minor - l.credit_minor), v_entry,
         (p_date::timestamp + time '23:59') at time zone coalesce((select timezone from public.organizations where id = v_org), 'UTC')
    from public.acc_entry_lines l join public.inv_items i on i.org_id = l.org_id and i.id = l.item_id
   where l.org_id = v_org and l.entry_id = v_entry and l.item_id is not null;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.stock.revalued', 'organization', v_org::text,
          format('Stock revalued to average cost on %s: %s items, net %s %s (%s)', p_date, n, v_net, v_cur, v_note),
          jsonb_build_object('entry_id', v_entry, 'items', n, 'net_minor', v_net, 'date', p_date));
  return jsonb_build_object('items', n, 'netMinor', v_net, 'entryId', v_entry);
end $$;

-- inv_item_statement (sql/052) with revaluation rows: value only, no quantity.
create or replace function public.inv_item_statement(p_item_id uuid, p_from date, p_to date, p_warehouse_id uuid default null)
returns table (move_id bigint, move_date date, kind text, ref text, warehouse_id uuid, qty_in numeric, qty_out numeric, unit_cost_minor bigint,
               value_minor bigint, cost_known boolean, balance_qty numeric, balance_value_minor bigint, is_opening boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.require_org_role(array['owner', 'admin']);
begin
  if p_item_id is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'an item and a period with an end on or after its start are required';
  end if;
  if not exists (select 1 from public.inv_items where org_id = v_org and id = p_item_id) then raise exception 'NOT_FOUND'; end if;
  if p_warehouse_id is not null and not exists (select 1 from public.inv_warehouses where org_id = v_org and id = p_warehouse_id) then raise exception 'NOT_FOUND'; end if;

  return query
    with moves as (
      select m.id, public.acc__local_date(v_org, m.posted_at) as d, m.kind, m.ref, m.warehouse_id, m.qty,
             coalesce(m.unit_cost_minor, rc.unit_cost_minor) as cost, null::bigint as fixed_value, 0 as ord
        from public.inv_stock_moves m
        left join public.acc_receipt_costs rc on rc.org_id = m.org_id and rc.stock_move_id = m.id
       where m.org_id = v_org and m.item_id = p_item_id and (p_warehouse_id is null or m.warehouse_id = p_warehouse_id)
         and (p_warehouse_id is not null or m.kind not in ('transfer_out', 'transfer_in'))
      union all
      -- revaluations are company-wide (no warehouse), so they show only on the whole-company statement
      select c.id, public.acc__local_date(v_org, c.created_at), 'revaluation', c.ref, null::uuid, 0::numeric, null::bigint, c.value_minor, 1
        from public.inv_cost_log c
       where c.org_id = v_org and c.item_id = p_item_id and c.source = 'revaluation' and p_warehouse_id is null
    ), valued as (
      select mv.*, case when mv.fixed_value is not null then mv.fixed_value when mv.cost is null then null else round(mv.qty * mv.cost)::bigint end as val from moves mv
    ), opening as (
      select coalesce(sum(v.qty), 0) as q, coalesce(sum(v.val), 0)::bigint as val from valued v where v.d < p_from
    )
    select null::bigint as r_id, p_from as r_date, 'opening'::text as r_kind, null::text as r_ref, null::uuid as r_wh, null::numeric as r_in,
           null::numeric as r_out, null::bigint as r_cost, null::bigint as r_value, true as r_known, op.q as r_bal_qty, op.val as r_bal_value,
           true as r_is_opening
      from opening op
    union all
    select v.id, v.d, v.kind, v.ref, v.warehouse_id, case when v.qty > 0 then v.qty end, case when v.qty < 0 then -v.qty end,
           case when v.fixed_value is null then v.cost end, v.val, v.val is not null,
           (select q from opening) + sum(v.qty) over (order by v.d, v.ord, v.id),
           ((select val from opening) + sum(coalesce(v.val, 0)) over (order by v.d, v.ord, v.id))::bigint,
           false
      from valued v where v.d between p_from and p_to
     order by r_is_opening desc, r_date, r_id;
end $$;

revoke all on function public.acc_stock_value_check(), public.acc_revalue_stock(date, text) from public, anon;
grant execute on function public.acc_stock_value_check(), public.acc_revalue_stock(date, text) to authenticated;
revoke all on function public.inv_item_statement(uuid, date, date, uuid) from public, anon;
grant execute on function public.inv_item_statement(uuid, date, date, uuid) to authenticated;

commit;

-- Verification (read-only).
select has_function_privilege('anon', 'public.acc_revalue_stock(date, text)', 'execute') as anon_can_revalue,
       has_function_privilege('authenticated', 'public.acc__stock_value_rows(uuid)', 'execute') as users_call_internal;
