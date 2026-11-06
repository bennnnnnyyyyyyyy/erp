-- sql/052_statements.sql
-- Phase 2, slice 3 (documentation/plans/TREASURY_PLAN.md §2 S1, §3.4): statements of account (كشف حساب). Read-only. Rerun-safe.
-- Needs sql/001-051.
--
-- * acc_party_statement(type, id, from, to, currency): a customer's or supplier's lines on the receivables / payables control
--   accounts (the accounts the `receivables` and `payables` roles point at): what they owe or are owed, not their sales or purchases.
--   An opening row (balance before `from`), then each line with a running balance, oldest first. Debit positive. Owners and admins
--   (and the head accountant), as the ledger.
-- * inv_item_statement(item, from, to, warehouse): an item's stock moves with running quantity and value. Value = quantity × the
--   move's unit cost (receipts: the cost entered, or the receipt cost set at switch-on); a move with no known cost shows no value and
--   is flagged. Works with accounting off. Owners and admins only (costs are hidden from members, sql/023).

begin;

create or replace function public.acc_party_statement(p_party_type text, p_party_id uuid, p_from date, p_to date, p_currency text default null)
returns table (line_id bigint, entry_id uuid, entry_number text, entry_date date, source_type text, source_id text, event text, memo text,
               account_code text, debit_minor bigint, credit_minor bigint, balance_minor bigint, is_opening boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.acc__guard('read'); v_cur text; v_accounts uuid[]; v_open bigint;
begin
  if p_party_type not in ('customer', 'supplier') or p_party_id is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'a customer or supplier and a period with an end on or after its start are required';
  end if;
  if (p_party_type = 'customer' and not exists (select 1 from public.sal_customers where org_id = v_org and id = p_party_id))
     or (p_party_type = 'supplier' and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = p_party_id)) then
    raise exception 'NOT_FOUND';
  end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  select array_agg(r.account_id) into v_accounts from public.acc_account_roles r
   where r.org_id = v_org and r.role_key = case p_party_type when 'customer' then 'receivables' else 'payables' end;
  v_accounts := coalesce(v_accounts, '{}');

  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint into v_open
    from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
   where l.org_id = v_org and l.party_type = p_party_type and l.party_id = p_party_id and l.account_id = any (v_accounts)
     and e.currency = v_cur and e.entry_date < p_from;

  return query
    select null::bigint as r_line_id, null::uuid as r_entry_id, null::text as r_entry_number, p_from as r_entry_date, null::text as r_source_type,
           null::text as r_source_id, null::text as r_event, 'Opening balance'::text as r_memo, null::text as r_code,
           0::bigint as r_debit, 0::bigint as r_credit, v_open as r_balance, true as r_is_opening
    union all
    select x.id, x.entry_id, x.number, x.entry_date, x.source_type, x.source_id, x.event, coalesce(x.line_memo, x.entry_memo), x.code,
           x.debit_minor, x.credit_minor,
           (v_open + sum(x.debit_minor - x.credit_minor) over (order by x.entry_date, x.number, x.id))::bigint, false
      from (select l.id, l.entry_id, e.number, e.entry_date, e.source_type, e.source_id, e.event, l.memo as line_memo, e.memo as entry_memo,
                   a.code, l.debit_minor, l.credit_minor
              from public.acc_entry_lines l
              join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
              join public.acc_accounts a on a.org_id = l.org_id and a.id = l.account_id
             where l.org_id = v_org and l.party_type = p_party_type and l.party_id = p_party_id and l.account_id = any (v_accounts)
               and e.currency = v_cur and e.entry_date between p_from and p_to) x
     order by r_is_opening desc, r_entry_date, r_entry_number, r_line_id;
end $$;

create or replace function public.inv_item_statement(p_item_id uuid, p_from date, p_to date, p_warehouse_id uuid default null)
returns table (move_id bigint, move_date date, kind text, ref text, warehouse_id uuid, qty_in numeric, qty_out numeric, unit_cost_minor bigint,
               value_minor bigint, cost_known boolean, balance_qty numeric, balance_value_minor bigint, is_opening boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_open_qty numeric; v_open_value bigint;
begin
  if p_item_id is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'an item and a period with an end on or after its start are required';
  end if;
  if not exists (select 1 from public.inv_items where org_id = v_org and id = p_item_id) then raise exception 'NOT_FOUND'; end if;
  if p_warehouse_id is not null and not exists (select 1 from public.inv_warehouses where org_id = v_org and id = p_warehouse_id) then raise exception 'NOT_FOUND'; end if;

  return query
    with moves as (
      select m.id, public.acc__local_date(v_org, m.posted_at) as d, m.kind, m.ref, m.warehouse_id, m.qty,
             coalesce(m.unit_cost_minor, rc.unit_cost_minor) as cost
        from public.inv_stock_moves m
        left join public.acc_receipt_costs rc on rc.org_id = m.org_id and rc.stock_move_id = m.id
       where m.org_id = v_org and m.item_id = p_item_id and (p_warehouse_id is null or m.warehouse_id = p_warehouse_id)
         -- across the whole company a transfer moves nothing; per warehouse it is a real in or out
         and (p_warehouse_id is not null or m.kind not in ('transfer_out', 'transfer_in'))
    ), valued as (
      select mv.*, case when mv.cost is null then null else round(mv.qty * mv.cost)::bigint end as val from moves mv
    ), opening as (
      select coalesce(sum(v.qty), 0) as q, coalesce(sum(v.val), 0)::bigint as val from valued v where v.d < p_from
    )
    select null::bigint as r_id, p_from as r_date, 'opening'::text as r_kind, null::text as r_ref, null::uuid as r_wh, null::numeric as r_in,
           null::numeric as r_out, null::bigint as r_cost, null::bigint as r_value, true as r_known, op.q as r_bal_qty, op.val as r_bal_value,
           true as r_is_opening
      from opening op
    union all
    select v.id, v.d, v.kind, v.ref, v.warehouse_id, case when v.qty > 0 then v.qty end, case when v.qty < 0 then -v.qty end, v.cost, v.val,
           v.cost is not null,
           (select q from opening) + sum(v.qty) over (order by v.d, v.id),
           ((select val from opening) + sum(coalesce(v.val, 0)) over (order by v.d, v.id))::bigint,
           false
      from valued v where v.d between p_from and p_to
     order by r_is_opening desc, r_date, r_id;
end $$;

revoke all on function public.acc_party_statement(text, uuid, date, date, text), public.inv_item_statement(uuid, date, date, uuid) from public, anon;
grant execute on function public.acc_party_statement(text, uuid, date, date, text), public.inv_item_statement(uuid, date, date, uuid) to authenticated;

commit;

-- Verification (read-only): both functions exist and are closed to anonymous callers.
select has_function_privilege('authenticated', 'public.acc_party_statement(text, uuid, date, date, text)', 'execute') as users_can_read_party,
       has_function_privilege('anon', 'public.acc_party_statement(text, uuid, date, date, text)', 'execute') as anon_can_read_party,
       has_function_privilege('anon', 'public.inv_item_statement(uuid, date, date, uuid)', 'execute') as anon_can_read_item;
