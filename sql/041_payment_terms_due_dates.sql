-- 041_payment_terms_due_dates.sql
-- S2 of documentation/plans/SUPERFIX_WORKFLOW_PLAN.md: payment terms and due dates.
--   * Customers and suppliers get payment_terms_days (null = the organization default, settings.default_payment_terms_days, default 0).
--   * Customer invoices and supplier invoices get due_date, set on insert from the terms (invoice_date + days) by a BEFORE trigger, so
--     sal_create_invoice and pur_record_supplier_invoice keep their signatures. A due date before the invoice date is refused.
--   * Existing invoices are backfilled the same way.
--   * The 'receivable_overdue' alert now counts from the due date. With the default 0-day terms the due date equals the invoice date,
--     so every existing rule behaves exactly as before. alr_run below is sql/030's version with only that change.
-- Depends on sql/001-040. Rerun-safe. Run the whole file, then sql/tests/036_due_dates.sql.

begin;

alter table public.sal_customers add column if not exists payment_terms_days int;
alter table public.pur_suppliers add column if not exists payment_terms_days int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_customers_terms_chk') then
    alter table public.sal_customers add constraint sal_customers_terms_chk check (payment_terms_days is null or payment_terms_days between 0 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_suppliers_terms_chk') then
    alter table public.pur_suppliers add constraint pur_suppliers_terms_chk check (payment_terms_days is null or payment_terms_days between 0 and 365);
  end if;
end $$;

alter table public.sal_invoices add column if not exists due_date date;
alter table public.pur_supplier_invoices add column if not exists due_date date;

-- The terms in force for a party: its own, else the organization default, else 0.
create or replace function public.core__terms_days(p_org uuid, p_party_days int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(p_party_days, (select nullif(o.settings ->> 'default_payment_terms_days', '')::int from public.organizations o where o.id = p_org), 0)
$$;
revoke all on function public.core__terms_days(uuid, int) from public, anon, authenticated;

-- Backfill (only rows still without a due date, so a rerun changes nothing). The lock-date trigger (sql/040) does not fire on this:
-- neither the status nor the invoice date changes.
update public.sal_invoices i
   set due_date = i.invoice_date + public.core__terms_days(i.org_id, c.payment_terms_days)
  from public.sal_customers c
 where i.due_date is null and c.org_id = i.org_id and c.id = i.customer_id;
update public.pur_supplier_invoices i
   set due_date = i.invoice_date + public.core__terms_days(i.org_id, s.payment_terms_days)
  from public.pur_suppliers s
 where i.due_date is null and s.org_id = i.org_id and s.id = i.supplier_id;

alter table public.sal_invoices alter column due_date set not null;
alter table public.pur_supplier_invoices alter column due_date set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_invoices_due_chk') then
    alter table public.sal_invoices add constraint sal_invoices_due_chk check (due_date >= invoice_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoices_due_chk') then
    alter table public.pur_supplier_invoices add constraint pur_supplier_invoices_due_chk check (due_date >= invoice_date);
  end if;
end $$;

-- Sets due_date on insert when the writer did not; refuses one before the invoice date with a reason code (the check constraint is the
-- backstop).
create or replace function public.core__due_date_default() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  -- An invoice whose date moves keeps its terms: the due date moves by the same number of days (unless the writer set a new one).
  if tg_op = 'UPDATE' then
    if new.invoice_date is distinct from old.invoice_date and new.due_date is not distinct from old.due_date then
      new.due_date := old.due_date + (new.invoice_date - old.invoice_date);
    end if;
    if new.due_date < new.invoice_date then raise exception 'DUE_BEFORE_INVOICE'; end if;
    return new;
  end if;
  if new.due_date is null then
    if tg_table_name = 'sal_invoices' then
      select c.payment_terms_days into v_days from public.sal_customers c where c.org_id = new.org_id and c.id = new.customer_id;
    else
      select s.payment_terms_days into v_days from public.pur_suppliers s where s.org_id = new.org_id and s.id = new.supplier_id;
    end if;
    new.due_date := new.invoice_date + public.core__terms_days(new.org_id, v_days);
  elsif new.due_date < new.invoice_date then
    raise exception 'DUE_BEFORE_INVOICE';
  end if;
  return new;
end $$;
revoke all on function public.core__due_date_default() from public, anon, authenticated;

drop trigger if exists sal_invoices_due_date on public.sal_invoices;
create trigger sal_invoices_due_date before insert or update of invoice_date, due_date on public.sal_invoices for each row execute function public.core__due_date_default();
drop trigger if exists pur_supplier_invoices_due_date on public.pur_supplier_invoices;
create trigger pur_supplier_invoices_due_date before insert or update of invoice_date, due_date on public.pur_supplier_invoices for each row execute function public.core__due_date_default();

-- Organization default terms. Owners and admins. Audited.
create or replace function public.core_set_default_payment_terms(p_days int) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_before int;
begin
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'INVALID_INPUT'; end if;
  select coalesce(nullif(o.settings ->> 'default_payment_terms_days', '')::int, 0) into v_before from public.organizations o where o.id = v_org;
  if v_before = p_days then return p_days; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('default_payment_terms_days', p_days) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.payment_terms_changed', 'organization', v_org::text, format('Default payment terms set to %s day(s)', p_days),
          jsonb_build_object('days', v_before), jsonb_build_object('days', p_days));
  return p_days;
end $$;

-- A customer's own terms (null = organization default). Owners and admins. Audited.
create or replace function public.sal_set_customer_terms(p_customer_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_before int;
begin
  if p_days is not null and (p_days < 0 or p_days > 365) then raise exception 'INVALID_INPUT'; end if;
  select c.payment_terms_days into v_before from public.sal_customers c where c.org_id = v_org and c.id = p_customer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_before is not distinct from p_days then return; end if;
  update public.sal_customers set payment_terms_days = p_days where org_id = v_org and id = p_customer_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer_terms_changed', 'sal_customer', p_customer_id::text,
          case when p_days is null then 'Payment terms: company default' else format('Payment terms: %s day(s)', p_days) end,
          jsonb_build_object('days', v_before), jsonb_build_object('days', p_days));
end $$;

-- A supplier's own terms. Owners and admins. Audited.
create or replace function public.pur_set_supplier_terms(p_supplier_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); v_before int;
begin
  if p_days is not null and (p_days < 0 or p_days > 365) then raise exception 'INVALID_INPUT'; end if;
  select s.payment_terms_days into v_before from public.pur_suppliers s where s.org_id = v_org and s.id = p_supplier_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_before is not distinct from p_days then return; end if;
  update public.pur_suppliers set payment_terms_days = p_days where org_id = v_org and id = p_supplier_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'purchasing.supplier_terms_changed', 'pur_supplier', p_supplier_id::text,
          case when p_days is null then 'Payment terms: company default' else format('Payment terms: %s day(s)', p_days) end,
          jsonb_build_object('days', v_before), jsonb_build_object('days', p_days));
end $$;

revoke all on function public.core_set_default_payment_terms(int), public.sal_set_customer_terms(uuid, int), public.pur_set_supplier_terms(uuid, int) from public, anon;
grant execute on function public.core_set_default_payment_terms(int), public.sal_set_customer_terms(uuid, int), public.pur_set_supplier_terms(uuid, int) to authenticated;

-- The evaluator: sql/030's alr_run, with 'receivable_overdue' counted from the due date (three lines changed, marked in the worklog).
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
                 format('Invoice %s for %s is unpaid %s day(s) after its due date %s: %s %s still owed', t.number, t.cname, current_date - t.due_date, t.due_date, round(t.remaining / 100.0, 2), t.currency),
                 'Overdue invoice ' || t.number
            from (select i.id, i.number, i.invoice_date, i.due_date, i.currency, cu.name as cname,
                         coalesce((select sum(round(il.qty * il.unit_price_minor)) from public.sal_invoice_lines il where il.org_id = i.org_id and il.invoice_id = i.id), 0)::bigint
                         - coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded'), 0)::bigint as remaining
                    from public.sal_invoices i join public.sal_customers cu on cu.org_id = i.org_id and cu.id = i.customer_id
                   where r.kind = 'receivable_overdue' and i.org_id = r.org_id and i.status = 'issued' and i.due_date < current_date - r.threshold::int) t
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

-- Verification (read-only): no invoice without a due date; both triggers present; setters callable by users, not anonymous.
select (select count(*) from public.sal_invoices where due_date is null) as customer_invoices_without_due,
       (select count(*) from public.pur_supplier_invoices where due_date is null) as supplier_invoices_without_due,
       (select count(*) from pg_trigger where not tgisinternal and tgname in ('sal_invoices_due_date', 'pur_supplier_invoices_due_date')) as due_triggers;
select has_function_privilege('authenticated', 'public.sal_set_customer_terms(uuid, integer)', 'execute') as users_can_set_terms,
       has_function_privilege('anon', 'public.sal_set_customer_terms(uuid, integer)', 'execute') as anon_can_set_terms;
