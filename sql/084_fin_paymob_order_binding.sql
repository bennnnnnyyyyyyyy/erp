-- sql/084_fin_paymob_order_binding.sql
-- Audit finding 2 (documentation/planning/2026-11-11-audit-response.md): Paymob signs a fixed list of fields, and our reference
-- (merchant_order_id) is not one of them, so it must not decide which link is paid. The signed field order.id is. When the link's
-- address is created the server saves Paymob's own order id on the link; at settlement the signed order id must equal it, otherwise the
-- link goes to 'review' and nothing is recorded. Links created before this migration have no saved id and behave as before.
-- Needs sql/001-083. Rerun-safe. Field names (where Paymob returns the order id; order.id in the callback) must be confirmed with a
-- real Paymob test transaction before a company goes live.

begin;

alter table public.fin_payment_links add column if not exists provider_order_id text check (provider_order_id is null or length(provider_order_id) between 1 and 120);

-- Service role only: save Paymob's order id once, on a link that is still new.
create or replace function public.fin__link_set_provider_order(p_link_id uuid, p_order_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_order_id is null or length(p_order_id) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
  update public.fin_payment_links set provider_order_id = p_order_id
   where id = p_link_id and provider = 'paymob' and status = 'pending' and provider_order_id is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Recreated from sql/057 (the latest definition; 082 did not change it) with one more argument and the check above.
drop function if exists public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean);
create or replace function public.fin__settle_payment_link(p_provider text, p_ref text, p_txn text, p_amount_minor bigint, p_currency text,
  p_success boolean, p_simulated boolean default false, p_order_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.fin_payment_links; i public.sal_invoices; v_due bigint; v_no text; v_pay uuid; v_result text;
begin
  select * into l from public.fin_payment_links where provider = p_provider and provider_ref = p_ref for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if p_txn is null or length(p_txn) = 0 then return jsonb_build_object('result', 'invalid'); end if;
  if l.simulated is distinct from coalesce(p_simulated, false) then return jsonb_build_object('result', 'mode_mismatch'); end if;

  begin
    insert into public.fin_payment_link_events (org_id, link_id, provider, txn_id, success, amount_minor, result) values (l.org_id, l.id, p_provider, p_txn, p_success, p_amount_minor, 'received');
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate');
  end;

  if l.status = 'paid' then v_result := 'already_paid';
  -- sql/084: a link that has Paymob's order id saved only settles for a callback whose signed order id is the same one. Links made
  -- before 084 have none saved and keep the old behaviour.
  elsif l.provider_order_id is not null and p_order_id is distinct from l.provider_order_id then
    if l.status = 'pending' then
      update public.fin_payment_links set status = 'review', provider_txn = p_txn,
        review_reason = 'the signed provider order id does not match the one saved for this link' where id = l.id;
    end if;
    v_result := 'review';
  elsif not p_success then
    if l.status = 'pending' then update public.fin_payment_links set status = 'failed', provider_txn = p_txn, review_reason = 'the provider reported the payment as failed' where id = l.id; end if;
    v_result := 'failed';
  elsif p_amount_minor is distinct from l.amount_minor or upper(coalesce(p_currency, '')) <> l.currency then
    update public.fin_payment_links set status = 'review', provider_txn = p_txn,
      review_reason = format('paid %s %s but the link was for %s %s', p_amount_minor, p_currency, l.amount_minor, l.currency) where id = l.id;
    v_result := 'review';
  else
    begin
      select * into i from public.sal_invoices where org_id = l.org_id and id = l.invoice_id for update;
      if i.status <> 'issued' then raise exception 'the invoice is no longer open'; end if;
      v_due := public.fin__invoice_outstanding(l.org_id, l.invoice_id);
      if l.amount_minor > v_due then raise exception 'the invoice was paid another way in the meantime'; end if;
      v_no := public.fin__next(l.org_id, 'payment', 'PAY-');
      insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, note, created_by)
      values (l.org_id, v_no, 'in', l.amount_minor, l.currency, (now() at time zone 'utc')::date, 'card', l.invoice_id,
              format('%s payment link %s%s', initcap(p_provider), l.provider_ref, case when l.simulated then ' (SIMULATED: no real money)' else '' end), l.created_by)
      returning id into v_pay;
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
      values (l.org_id, l.created_by, 'finance.payment.recorded', 'finance_payment', v_pay::text,
              format('%s received: %s minor units %s by %s link %s (provider transaction %s)', v_no, l.amount_minor, l.currency, p_provider, l.provider_ref, p_txn));
      update public.fin_payment_links set status = 'paid', paid_at = now(), provider_txn = p_txn, payment_id = v_pay, review_reason = null where id = l.id;
      v_result := 'paid';
    exception when others then
      update public.fin_payment_links set status = 'review', provider_txn = p_txn, review_reason = left(sqlerrm, 300) where id = l.id;
      v_result := 'review';
    end;
  end if;

  update public.fin_payment_link_events set result = v_result where provider = p_provider and txn_id = p_txn;
  if v_result in ('review', 'paid') then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (l.org_id, l.created_by, 'finance.payment_link.' || v_result, 'finance_payment_link', l.id::text, format('%s callback %s: %s', p_provider, p_txn, v_result));
  end if;
  return jsonb_build_object('result', v_result, 'linkId', l.id);
end $$;

revoke all on function public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text),
  public.fin__link_set_provider_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text),
  public.fin__link_set_provider_order(uuid, text) to service_role;

commit;

-- Verification (read-only). Expect: users_settle false, anon_set false, service_settle true, old_overload 0.
select has_function_privilege('authenticated', 'public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text)', 'execute') as users_settle,
       has_function_privilege('anon', 'public.fin__link_set_provider_order(uuid, text)', 'execute') as anon_set,
       has_function_privilege('service_role', 'public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean, text)', 'execute') as service_settle,
       (select count(*) from pg_proc where proname = 'fin__settle_payment_link' and pronargs = 7) as old_overload;
