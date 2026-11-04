-- 040_lock_date.sql
-- S1 of documentation/plans/SUPERFIX_WORKFLOW_PLAN.md: a lock date for closed periods. Once an owner sets it, nothing dated on or before
-- it can be created or voided: customer invoices (invoice_date), supplier invoices (invoice_date), expenses (expense_date) and payments
-- (paid_on). Stock is always posted at now() (plan decision D1), so the ledger cannot fall into a locked period and needs no check.
-- Nobody is exempt (D3): to correct a closed month the owner moves the lock date back, and that is audited.
-- The check is a BEFORE trigger on each dated table, so every function that writes them (today's and future ones) is covered in the
-- same transaction, without rewriting those functions. The setting lives in organizations.settings ('lock_date', ISO date) like the
-- other org switches.
-- Depends on sql/001-039. Rerun-safe. Run the whole file, then sql/tests/035_lock_date.sql.

begin;

-- Raises PERIOD_LOCKED when p_date is on or before the organization's lock date. No lock date set = everything open.
create or replace function public.core__assert_open(p_org uuid, p_date date) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_lock date;
begin
  if p_date is null then return; end if;
  select nullif(o.settings ->> 'lock_date', '')::date into v_lock from public.organizations o where o.id = p_org;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'PERIOD_LOCKED' using detail = format('%s is on or before the lock date %s', p_date, v_lock);
  end if;
end $$;
revoke all on function public.core__assert_open(uuid, date) from public, anon, authenticated;

-- Owner only. p_date null removes the lock. Returns the new lock date. Audited with the old and new value.
create or replace function public.core_set_lock_date(p_date date) returns date
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']); v_before date;
begin
  if p_date is not null and p_date > current_date then raise exception 'INVALID_INPUT' using detail = 'The lock date cannot be in the future'; end if;
  select nullif(o.settings ->> 'lock_date', '')::date into v_before from public.organizations o where o.id = v_org;
  if v_before is not distinct from p_date then return p_date; end if;
  update public.organizations o
     set settings = case when p_date is null then coalesce(o.settings, '{}'::jsonb) - 'lock_date'
                         else coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('lock_date', p_date::text) end
   where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.lock_date_changed', 'organization', v_org::text,
          case when p_date is null then 'Lock date removed' else 'Lock date set to ' || p_date::text end,
          jsonb_build_object('lock_date', v_before), jsonb_build_object('lock_date', p_date));
  return p_date;
end $$;
revoke all on function public.core_set_lock_date(date) from public, anon;
grant execute on function public.core_set_lock_date(date) to authenticated;

-- One trigger function for the four tables. TG_ARGV[0] names the date column. On insert the new row's date is checked; on an update
-- that voids the row, the original date is checked (voiding changes the closed period's figures).
create or replace function public.core__lock_date_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_new date; v_old date;
begin
  v_new := (to_jsonb(new) ->> tg_argv[0])::date;
  if tg_op = 'INSERT' then
    perform public.core__assert_open(new.org_id, v_new);
  else
    v_old := (to_jsonb(old) ->> tg_argv[0])::date;
    if (to_jsonb(new) ->> 'status') is distinct from (to_jsonb(old) ->> 'status') or v_new is distinct from v_old then
      perform public.core__assert_open(old.org_id, v_old);
      perform public.core__assert_open(new.org_id, v_new);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.core__lock_date_guard() from public, anon, authenticated;

drop trigger if exists sal_invoices_lock_date on public.sal_invoices;
create trigger sal_invoices_lock_date before insert or update on public.sal_invoices
  for each row execute function public.core__lock_date_guard('invoice_date');
drop trigger if exists pur_supplier_invoices_lock_date on public.pur_supplier_invoices;
create trigger pur_supplier_invoices_lock_date before insert or update on public.pur_supplier_invoices
  for each row execute function public.core__lock_date_guard('invoice_date');
drop trigger if exists fin_expenses_lock_date on public.fin_expenses;
create trigger fin_expenses_lock_date before insert or update on public.fin_expenses
  for each row execute function public.core__lock_date_guard('expense_date');
drop trigger if exists fin_payments_lock_date on public.fin_payments;
create trigger fin_payments_lock_date before insert or update on public.fin_payments
  for each row execute function public.core__lock_date_guard('paid_on');

commit;

-- Verification (read-only): four triggers present; owners' function callable by signed-in users, not by anonymous; helper closed.
select count(*) as lock_triggers from pg_trigger where tgname in
  ('sal_invoices_lock_date', 'pur_supplier_invoices_lock_date', 'fin_expenses_lock_date', 'fin_payments_lock_date') and not tgisinternal;
select has_function_privilege('authenticated', 'public.core_set_lock_date(date)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.core_set_lock_date(date)', 'execute') as anon_can_set,
       has_function_privilege('authenticated', 'public.core__assert_open(uuid, date)', 'execute') as helper_open_to_users;
