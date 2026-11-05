-- 047_accounting_switch_on.sql
-- Accounting phase 1, slice 3 (documentation/plans/ACCOUNTING_PLAN.md scope E; ADR-0004 draft §6): switching accounting on for a company.
--   * acc_uncosted_receipts(): old stock receipts with no cost (no cost on the move, no purchase order to take it from, none entered).
--   * acc_set_receipt_cost(move, cost, rationale): the owner or head accountant enters a documented cost for one of them (append-only,
--     audited; a zero cost needs a rationale). A cost is never invented from the current average (plan O3).
--   * acc_switch_on_preview(): what switching on would do: documents to post, uncosted receipts, missing roles.
--   * acc_switch_on(): OWNER ONLY (plan O6). In one transaction: seeds the default chart if the company has none, refuses while a role
--     is unset or a receipt is uncosted, turns the module on (the only path sql/045 allows), posts every existing document oldest
--     first with the same rules as live posting (marked as backfill), and audits the counts and totals. It cannot be run twice and
--     accounting cannot be switched off afterwards.
-- Depends on sql/001-046. Rerun-safe. Run the whole file, then sql/tests/042_accounting_switch_on.sql.

begin;

-- The roles every company needs before switching on (the 19 seeded by acc__seed_chart).
create or replace function public.acc__required_roles() returns text[]
language sql immutable as $$
  select array['inventory', 'receivables', 'cash', 'bank', 'card_clearing', 'cheque_in_clearing', 'cheque_out_clearing', 'other_clearing',
               'opening_balance', 'payables', 'grni', 'expense_payables', 'expense_default', 'stock_adjustment', 'internal_use',
               'price_variance', 'cogs', 'sales_revenue', 'sales_returns'];
$$;
revoke all on function public.acc__required_roles() from public, anon, authenticated;

-- Receipts with no cost from anywhere (internal; p_org explicit so switch-on and the list share one definition).
create or replace function public.acc__uncosted_receipts(p_org uuid) returns setof public.inv_stock_moves
language sql stable security definer set search_path = public as $$
  select m.* from public.inv_stock_moves m
   where m.org_id = p_org and m.kind = 'receipt' and m.unit_cost_minor is null
     and not exists (select 1 from public.acc_receipt_costs rc where rc.org_id = p_org and rc.stock_move_id = m.id)
     and not exists (select 1 from public.pur_orders o join public.pur_order_lines ol on ol.org_id = o.org_id and ol.order_id = o.id and ol.deleted_at is null
                      where o.org_id = p_org and (o.id = m.purchase_order_id or o.number = m.ref) and ol.item_id = m.item_id)
   order by m.posted_at, m.id;
$$;
revoke all on function public.acc__uncosted_receipts(uuid) from public, anon, authenticated;

-- For the setup screen: the uncosted receipts, with what the person needs to recognise them.
create or replace function public.acc_uncosted_receipts() returns table (move_id bigint, posted_at timestamptz, item_id uuid, sku text, item_name text,
  warehouse_id uuid, warehouse_name text, qty numeric, ref text, current_avg_cost_minor bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('read');
begin
  return query
    select m.id, m.posted_at, m.item_id, i.sku, i.name, m.warehouse_id, w.name, m.qty, m.ref, i.avg_cost_minor
      from public.acc__uncosted_receipts(v_org) m
      join public.inv_items i on i.org_id = m.org_id and i.id = m.item_id
      join public.inv_warehouses w on w.org_id = m.org_id and w.id = m.warehouse_id;
end $$;

-- Enter the documented cost of one uncosted receipt. Owner or head accountant. Append-only and audited. The current average is shown
-- on the screen for reference only; the person decides the cost.
create or replace function public.acc_set_receipt_cost(p_move_id bigint, p_unit_cost_minor bigint, p_rationale text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); mv public.inv_stock_moves; v_why text := nullif(trim(coalesce(p_rationale, '')), '');
begin
  if p_unit_cost_minor is null or p_unit_cost_minor < 0 then raise exception 'INVALID_INPUT' using detail = 'a cost of zero or more is required'; end if;
  if p_unit_cost_minor = 0 and v_why is null then raise exception 'INVALID_INPUT' using detail = 'a zero cost needs a reason'; end if;
  if v_why is not null and length(v_why) > 500 then raise exception 'INVALID_INPUT'; end if;
  select * into mv from public.acc__uncosted_receipts(v_org) m where m.id = p_move_id;
  if not found then
    if exists (select 1 from public.inv_stock_moves where org_id = v_org and id = p_move_id) then
      raise exception 'INVALID_STATE' using detail = 'this stock move is not an uncosted receipt';
    end if;
    raise exception 'NOT_FOUND';
  end if;
  insert into public.acc_receipt_costs (org_id, stock_move_id, unit_cost_minor, rationale, set_by) values (v_org, p_move_id, p_unit_cost_minor, v_why, auth.uid());
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.receipt_cost.set', 'stock_move', p_move_id::text,
          format('Cost %s entered for receipt %s (%s)', p_unit_cost_minor, p_move_id, coalesce(mv.ref, 'no reference')),
          jsonb_build_object('unit_cost_minor', p_unit_cost_minor, 'rationale', v_why, 'qty', mv.qty, 'item_id', mv.item_id));
  -- Accounting already on (a receipt made before it, costed later): post it now.
  if public.acc__enabled(v_org) then perform public.acc__post_move(v_org, p_move_id, true); end if;
end $$;

-- What switching on would post, and what still blocks it. Owner, admin (read) may look.
create or replace function public.acc_switch_on_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('read'); v_missing text[];
begin
  select coalesce(array_agg(r order by r), '{}') into v_missing from unnest(public.acc__required_roles()) r
   where not exists (select 1 from public.acc_account_roles ar where ar.org_id = v_org and ar.role_key = r);
  return jsonb_build_object(
    'accountingOn', public.acc__enabled(v_org),
    'chartAccounts', (select count(*) from public.acc_accounts where org_id = v_org and deleted_at is null),
    'missingRoles', to_jsonb(v_missing),
    'uncostedReceipts', (select count(*) from public.acc__uncosted_receipts(v_org)),
    'issuesWithoutCost', (select count(*) from public.inv_stock_moves where org_id = v_org and kind in ('issue', 'adjust') and unit_cost_minor is null),
    'documents', jsonb_build_object(
      'stockMoves', (select count(*) from public.inv_stock_moves where org_id = v_org and kind not in ('transfer_out', 'transfer_in')),
      'customerInvoices', (select count(*) from public.sal_invoices where org_id = v_org),
      'supplierInvoices', (select count(*) from public.pur_supplier_invoices where org_id = v_org),
      'expenses', (select count(*) from public.fin_expenses where org_id = v_org),
      'payments', (select count(*) from public.fin_payments where org_id = v_org),
      'approvedNotes', (select count(*) from public.sal_notes where org_id = v_org and status = 'approved')));
end $$;

-- Switch accounting on. Owner only. Everything in one transaction: if any document cannot post, nothing changes.
create or replace function public.acc_switch_on() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.acc__guard('owner'); v_seeded int; v_missing text[]; v_uncosted bigint; d record; n int := 0;
  v_entries bigint; v_dr bigint; v_cr bigint; v_started timestamptz := clock_timestamp(); v_ms int;
begin
  if public.acc__enabled(v_org) then raise exception 'INVALID_STATE' using detail = 'accounting is already on'; end if;
  v_seeded := public.acc__seed_chart(v_org);
  select coalesce(array_agg(r order by r), '{}') into v_missing from unnest(public.acc__required_roles()) r
   where not exists (select 1 from public.acc_account_roles ar where ar.org_id = v_org and ar.role_key = r);
  if cardinality(v_missing) > 0 then raise exception 'ACCOUNT_ROLE_MISSING' using detail = array_to_string(v_missing, ', '); end if;
  select count(*) into v_uncosted from public.acc__uncosted_receipts(v_org);
  if v_uncosted > 0 then raise exception 'UNCOSTED_RECEIPTS' using detail = format('%s old stock receipt(s) have no cost; enter their costs first', v_uncosted); end if;

  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key, enabled_at, enabled_by, disabled_at) values (v_org, 'accounting', now(), auth.uid(), null)
  on conflict (org_id, module_key) do update set enabled_at = now(), enabled_by = auth.uid(), disabled_at = null;
  perform set_config('acc.switch_on', '', true);

  -- Every existing document, oldest first (the order only affects entry numbers; each entry stands alone).
  for d in
    select * from (
      select m.posted_at as ts, 1 as ord, 'move' as k, m.id::text as id from public.inv_stock_moves m where m.org_id = v_org
      union all select i.created_at, 2, 'sal_invoice', i.id::text from public.sal_invoices i where i.org_id = v_org
      union all select i.voided_at, 3, 'sal_invoice_void', i.id::text from public.sal_invoices i where i.org_id = v_org and i.status = 'void'
      union all select s.created_at, 2, 'pur_invoice', s.id::text from public.pur_supplier_invoices s where s.org_id = v_org
      union all select e.created_at, 2, 'expense', e.id::text from public.fin_expenses e where e.org_id = v_org
      union all select e.voided_at, 3, 'expense_void', e.id::text from public.fin_expenses e where e.org_id = v_org and e.status = 'void'
      union all select p.created_at, 2, 'payment', p.id::text from public.fin_payments p where p.org_id = v_org
      union all select p.voided_at, 3, 'payment_void', p.id::text from public.fin_payments p where p.org_id = v_org and p.status = 'void'
      union all select n.decided_at, 2, 'note', n.id::text from public.sal_notes n where n.org_id = v_org and n.status = 'approved'
    ) x order by ts nulls first, ord, id
  loop
    case d.k
      when 'move' then perform public.acc__post_move(v_org, d.id::bigint, true);
      when 'sal_invoice' then perform public.acc__post_sal_invoice(v_org, d.id::uuid, true);
      when 'sal_invoice_void' then perform public.acc__post_sal_invoice_void(v_org, d.id::uuid, true);
      when 'pur_invoice' then perform public.acc__post_pur_invoice(v_org, d.id::uuid, true);
      when 'expense' then perform public.acc__post_expense(v_org, d.id::uuid, true);
      when 'expense_void' then perform public.acc__post_expense_void(v_org, d.id::uuid, true);
      when 'payment' then perform public.acc__post_payment(v_org, d.id::uuid, true);
      when 'payment_void' then perform public.acc__post_payment_void(v_org, d.id::uuid, true);
      when 'note' then perform public.acc__post_note(v_org, d.id::uuid, true);
    end case;
    n := n + 1;
  end loop;

  select count(*) into v_entries from public.acc_entries where org_id = v_org;
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_dr, v_cr from public.acc_entry_lines where org_id = v_org;
  if v_dr <> v_cr then raise exception 'UNBALANCED' using detail = format('backfill debits %s, credits %s', v_dr, v_cr); end if;
  v_ms := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.switched_on', 'organization', v_org::text,
          format('Accounting switched on: %s documents read, %s entries posted', n, v_entries),
          jsonb_build_object('documents', n, 'entries', v_entries, 'debits_minor', v_dr, 'credits_minor', v_cr, 'chart_seeded', v_seeded, 'ms', v_ms));
  return jsonb_build_object('documents', n, 'entries', v_entries, 'debitsMinor', v_dr, 'creditsMinor', v_cr, 'chartSeeded', v_seeded, 'ms', v_ms);
end $$;

-- ---------------------------------------------------------------- P17: a cost changed by hand revalues the stock on hand

-- inv_set_item_cost (sql/023) changes an item's average cost without a stock movement, which changes the value of the stock on hand.
-- With accounting on that change is posted: on hand x (new average - old average), between inventory and stock differences. Found
-- while timing the demo switch-on (the inventory account and the stock value had drifted apart). Old hand changes, from before
-- switch-on, are not backfilled: the quantity on hand at that moment is not recorded.
create or replace function public.acc__trg_cost_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_on_hand numeric; v_value bigint; v_cur text;
begin
  if new.source <> 'manual' or not public.acc__enabled(new.org_id) then return null; end if;
  select coalesce(sum(on_hand), 0) into v_on_hand from public.inv_stock_balances where org_id = new.org_id and item_id = new.item_id;
  v_value := round(v_on_hand * (new.avg_after_minor - new.avg_before_minor));
  if v_value = 0 then return null; end if;
  select o.default_currency into v_cur from public.organizations o where o.id = new.org_id;
  perform public.acc__post(new.org_id, public.acc__local_date(new.org_id, new.created_at), v_cur, 'cost_change', new.id::text, 'revalued',
    format('Cost changed by hand: %s on hand, %s to %s', v_on_hand, new.avg_before_minor, new.avg_after_minor),
    jsonb_build_array(
      jsonb_build_object('role', case when v_value > 0 then 'inventory' else 'stock_adjustment' end, 'debit', abs(v_value), 'itemId', new.item_id),
      jsonb_build_object('role', case when v_value > 0 then 'stock_adjustment' else 'inventory' end, 'credit', abs(v_value), 'itemId', new.item_id)));
  return null;
end $$;
revoke all on function public.acc__trg_cost_change() from public, anon, authenticated;
drop trigger if exists acc_post_cost_change on public.inv_cost_log;
create trigger acc_post_cost_change after insert on public.inv_cost_log for each row execute function public.acc__trg_cost_change();

revoke all on function public.acc_uncosted_receipts(), public.acc_set_receipt_cost(bigint, bigint, text), public.acc_switch_on_preview(), public.acc_switch_on() from public, anon;
grant execute on function public.acc_uncosted_receipts(), public.acc_set_receipt_cost(bigint, bigint, text), public.acc_switch_on_preview(), public.acc_switch_on() to authenticated;

commit;

-- Verification (read-only): functions open to signed-in users only; no company switched on by this file.
select has_function_privilege('authenticated', 'public.acc_switch_on()', 'execute') as users_can_switch_on,
       has_function_privilege('anon', 'public.acc_switch_on()', 'execute') as anon_can_switch_on,
       has_function_privilege('authenticated', 'public.acc__uncosted_receipts(uuid)', 'execute') as users_can_list_internal;
select count(*) as accounting_on from public.org_modules where module_key = 'accounting';
