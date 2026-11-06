-- sql/057_payment_links.sql
-- "Pay now" links on sales invoices through Paymob or Fawry (documentation/planning/INTEGRATION_PROVIDER_CHOICES.md). Rerun-safe.
-- Needs sql/001-056.
--
-- * fin_payment_links: one row per link we create (provider, our reference, amount, status). Written only by the functions below.
-- * fin_payment_link_events: every provider callback we accept, once per provider transaction (replays do nothing).
-- * The provider's signed callback is the source of truth, never the browser redirect. The server verifies the signature, then calls
--   fin__settle_payment_link (service role only), which checks the amount, currency and invoice again and records the payment in
--   the same transaction as the audit row. A payment that cannot be applied (invoice already paid, voided, period locked, amount
--   differs) is kept as status 'review' for a person; nothing is guessed.
-- * Card and wallet money posts to the card-clearing account until the gateway pays out (sql/051 P13').
-- * Simulated links never contact a provider and can be "paid" by an owner or admin to try the flow; they record a payment whose
--   note says so, exactly like a person recording a card payment by hand.

begin;

create table if not exists public.fin_payment_links (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  invoice_id       uuid not null,
  provider         text not null check (provider in ('paymob', 'fawry')),
  provider_ref     text not null check (provider_ref ~ '^[A-Za-z0-9]{8,40}$'),
  amount_minor     bigint not null check (amount_minor > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status           text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'review')),
  simulated        boolean not null default false,
  url              text check (url is null or length(url) <= 2000),
  provider_txn     text,
  review_reason    text,
  payment_id       uuid,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  paid_at          timestamptz,
  unique (org_id, id),
  unique (provider, provider_ref),
  foreign key (org_id, invoice_id) references public.sal_invoices(org_id, id),
  foreign key (org_id, payment_id) references public.fin_payments(org_id, id)
);
create index if not exists fin_payment_links_invoice_idx on public.fin_payment_links (org_id, invoice_id, created_at desc);

create table if not exists public.fin_payment_link_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id),
  link_id      uuid not null,
  provider     text not null,
  txn_id       text not null check (length(txn_id) between 1 and 120),
  success      boolean not null,
  amount_minor bigint,
  result       text not null,
  created_at   timestamptz not null default now(),
  unique (provider, txn_id),
  foreign key (org_id, link_id) references public.fin_payment_links(org_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['fin_payment_links', 'fin_payment_link_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (exists (select 1 from public.memberships m
      where m.org_id = %I.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')))$p$,
      t || '_admin_read', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers

create or replace function public.fin__invoice_outstanding(p_org uuid, p_invoice uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(round(l.qty * l.unit_price_minor)) from public.sal_invoice_lines l where l.org_id = p_org and l.invoice_id = p_invoice), 0)::bigint
       - coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = p_org and p.customer_invoice_id = p_invoice and p.status = 'recorded'), 0)::bigint;
$$;

-- ---------------------------------------------------------------- functions for signed-in owners and admins

-- Start a link for an issued invoice. Amount defaults to what is still owed. The provider must be switched on; its mode (simulated
-- or live) is copied onto the link. The server then asks the provider for the address and saves it with fin_payment_link_set_url.
create or replace function public.fin_create_payment_link(p_invoice_id uuid, p_provider text, p_amount_minor bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.fin__guard(); i public.sal_invoices; v_due bigint; v_amount bigint; v_int public.core_integrations; v_id uuid; v_ref text;
begin
  if p_provider not in ('paymob', 'fawry') then raise exception 'INVALID_INPUT'; end if;
  select * into i from public.sal_invoices where org_id = v_org and id = p_invoice_id and status = 'issued' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_int from public.core_integrations where org_id = v_org and kind = p_provider;
  if v_int.id is null or not v_int.enabled then raise exception 'INVALID_STATE' using detail = 'switch the provider on in Settings > Integrations first'; end if;
  v_due := public.fin__invoice_outstanding(v_org, p_invoice_id);
  v_amount := coalesce(p_amount_minor, v_due);
  if v_due <= 0 then raise exception 'INVALID_STATE' using detail = 'the invoice is already paid'; end if;
  if v_amount <= 0 or v_amount > v_due then raise exception 'INVALID_INPUT' using detail = 'the amount must be more than zero and no more than what is owed'; end if;
  -- one open link per invoice and provider: cancel the older pending one so two cannot both be paid
  update public.fin_payment_links set status = 'cancelled' where org_id = v_org and invoice_id = p_invoice_id and provider = p_provider and status = 'pending';
  v_ref := 'ERP' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  insert into public.fin_payment_links (org_id, invoice_id, provider, provider_ref, amount_minor, currency, simulated, created_by)
  values (v_org, p_invoice_id, p_provider, v_ref, v_amount, i.currency, v_int.mode = 'simulated', auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment_link.created', 'finance_payment_link', v_id::text,
          format('%s link for invoice %s: %s minor units %s%s', p_provider, i.number, v_amount, i.currency, case when v_int.mode = 'simulated' then ' (simulated)' else '' end));
  return jsonb_build_object('id', v_id, 'providerRef', v_ref, 'simulated', v_int.mode = 'simulated', 'amountMinor', v_amount, 'currency', i.currency, 'invoiceNumber', i.number);
end $$;

-- Save where the customer pays: an https address (Paymob) and/or the provider's own reference to quote (Fawry reference number).
create or replace function public.fin_payment_link_set_url(p_link_id uuid, p_url text, p_provider_txn text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard();
begin
  if (p_url is null and p_provider_txn is null) or (p_url is not null and (p_url !~ '^https://[^\s]+$' or length(p_url) > 2000))
     or (p_provider_txn is not null and length(p_provider_txn) > 120) then raise exception 'INVALID_INPUT'; end if;
  update public.fin_payment_links set url = p_url, provider_txn = coalesce(p_provider_txn, provider_txn)
   where org_id = v_org and id = p_link_id and status = 'pending' and url is null and provider_txn is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- The provider refused or could not be reached: the link is failed and says why (no secrets in the text).
create or replace function public.fin_payment_link_fail(p_link_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard();
begin
  update public.fin_payment_links set status = 'failed', review_reason = left(coalesce(p_reason, 'failed'), 300)
   where org_id = v_org and id = p_link_id and status = 'pending';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.fin_cancel_payment_link(p_link_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard();
begin
  update public.fin_payment_links set status = 'cancelled' where org_id = v_org and id = p_link_id and status = 'pending';
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment_link.cancelled', 'finance_payment_link', p_link_id::text, 'payment link cancelled');
end $$;

-- ---------------------------------------------------------------- settling (service role only)

-- Called by the server after it has verified the provider's signature. Idempotent on (provider, txn). Never raises for a business
-- problem: it records 'review' so the provider is answered quickly and a person decides.
create or replace function public.fin__settle_payment_link(p_provider text, p_ref text, p_txn text, p_amount_minor bigint, p_currency text,
  p_success boolean, p_simulated boolean default false) returns jsonb
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

-- A simulated link can be "paid" by an owner or admin to try the whole flow. Real links cannot.
create or replace function public.fin_simulate_pay_link(p_link_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); l public.fin_payment_links;
begin
  select * into l from public.fin_payment_links where org_id = v_org and id = p_link_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not l.simulated or l.status <> 'pending' then raise exception 'INVALID_STATE' using detail = 'only a pending simulated link can be paid this way'; end if;
  return public.fin__settle_payment_link(l.provider, l.provider_ref, 'SIM-' || replace(gen_random_uuid()::text, '-', ''), l.amount_minor, l.currency, true, true);
end $$;

-- The server needs the provider's keys right after a link is created (to ask the provider for the address). Only for a link that is
-- still brand new and has no address, so this cannot be used to read keys later.
create or replace function public.fin__link_credentials(p_link_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('link', to_jsonb(l), 'credentials', public.core__provider_credentials(l.org_id, l.provider))
    from public.fin_payment_links l
   where l.id = p_link_id and l.status = 'pending' and l.url is null and l.provider_txn is null and not l.simulated and l.created_at > now() - interval '5 minutes';
$$;

-- The server finds the company and keys for a callback by our reference (before the signature can be checked).
create or replace function public.fin__callback_credentials(p_provider text, p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('simulated', l.simulated, 'credentials', public.core__provider_credentials(l.org_id, l.provider))
    from public.fin_payment_links l where l.provider = p_provider and l.provider_ref = p_ref;
$$;

revoke all on function public.fin__invoice_outstanding(uuid, uuid), public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean),
  public.fin__link_credentials(uuid), public.fin__callback_credentials(text, text) from public, anon, authenticated;
grant execute on function public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean), public.fin__link_credentials(uuid),
  public.fin__callback_credentials(text, text) to service_role;
revoke all on function public.fin_create_payment_link(uuid, text, bigint), public.fin_payment_link_set_url(uuid, text, text), public.fin_payment_link_fail(uuid, text),
  public.fin_cancel_payment_link(uuid), public.fin_simulate_pay_link(uuid) from public, anon;
grant execute on function public.fin_create_payment_link(uuid, text, bigint), public.fin_payment_link_set_url(uuid, text, text), public.fin_payment_link_fail(uuid, text),
  public.fin_cancel_payment_link(uuid), public.fin_simulate_pay_link(uuid) to authenticated;

commit;

-- Verification (read-only).
select relname, relrowsecurity from pg_class where relname in ('fin_payment_links', 'fin_payment_link_events') order by 1;
select has_function_privilege('authenticated', 'public.fin__settle_payment_link(text, text, text, bigint, text, boolean, boolean)', 'execute') as users_settle,
       has_function_privilege('anon', 'public.fin_create_payment_link(uuid, text, bigint)', 'execute') as anon_creates;
