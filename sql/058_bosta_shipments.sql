-- sql/058_bosta_shipments.sql
-- Bosta shipments from a sales order (documentation/planning/INTEGRATION_PROVIDER_CHOICES.md). Rerun-safe. Needs sql/001-057.
--
-- * sal_shipments: one row per delivery we create for an order (our reference, Bosta tracking number, status, cash on delivery amount).
-- * sal_shipment_events: every status update we accept, once per (shipment, state, time) so replays do nothing.
-- * Bosta's status webhook is unsigned; its only protection is a secret header we choose (the company's saved webhook secret). The
--   server checks that header, finds the company through our own reference, and calls sal__apply_shipment_status (service role).
-- * A courier update never changes stock or money. "Returned" is shown to a person, who starts a customer return through the normal
--   approval (sql/043). Cash on delivery settles through the normal payment screens.
-- * Simulated mode contacts nobody: an owner or admin can step a simulated shipment through its statuses to try the flow.

begin;

create table if not exists public.sal_shipments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  order_id       uuid not null,
  provider       text not null default 'bosta' check (provider in ('bosta')),
  reference      text not null check (reference ~ '^[A-Za-z0-9]{8,40}$'),
  tracking       text check (tracking is null or length(tracking) <= 80),
  status         text not null default 'pending' check (status in ('pending', 'created', 'picked_up', 'in_transit', 'delivered', 'returned', 'exception', 'cancelled', 'lost', 'failed')),
  state_code     int,
  cod_minor      bigint not null default 0 check (cod_minor >= 0),
  currency       char(3) not null check (currency ~ '^[A-Z]{3}$'),
  recipient_name text not null check (length(trim(recipient_name)) between 1 and 200),
  recipient_phone text not null check (length(trim(recipient_phone)) between 5 and 30),
  city           text not null check (length(trim(city)) between 1 and 100),
  address        text not null check (length(trim(address)) between 3 and 500),
  simulated      boolean not null default false,
  note           text,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, id),
  unique (provider, reference),
  foreign key (org_id, order_id) references public.sal_orders(org_id, id)
);
create index if not exists sal_shipments_order_idx on public.sal_shipments (org_id, order_id, created_at desc);

create table if not exists public.sal_shipment_events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id),
  shipment_id uuid not null,
  state_code  int not null,
  status      text not null,
  event_key   text not null check (length(event_key) between 1 and 160),
  created_at  timestamptz not null default now(),
  unique (shipment_id, event_key),
  foreign key (org_id, shipment_id) references public.sal_shipments(org_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['sal_shipments', 'sal_shipment_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (exists (select 1 from public.memberships m
      where m.org_id = %I.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null))$p$, t || '_member_read', t, t);
  end loop;
end $$;

-- Bosta state numbers (documented: 45 delivered, 46 returned, 47 exception, 49 cancelled, 100 lost; the earlier ones by name).
create or replace function public.sal__bosta_status(p_code int) returns text
language sql immutable as $$
  select case p_code when 10 then 'created' when 11 then 'created' when 20 then 'picked_up' when 21 then 'picked_up' when 24 then 'picked_up'
    when 30 then 'in_transit' when 41 then 'in_transit' when 45 then 'delivered' when 46 then 'returned' when 47 then 'exception'
    when 49 then 'cancelled' when 100 then 'lost' else 'in_transit' end;
$$;

-- Start a shipment for an order. The server then asks Bosta to create the delivery and saves the tracking number (or the failure).
create or replace function public.sal_create_shipment(p_order_id uuid, p_recipient_name text, p_recipient_phone text, p_city text, p_address text,
  p_cod_minor bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']); o public.sal_orders; v_int public.core_integrations; v_id uuid; v_ref text;
begin
  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'INVALID_STATE' using detail = 'the order is cancelled'; end if;
  select * into v_int from public.core_integrations where org_id = v_org and kind = 'bosta';
  if v_int.id is null or not v_int.enabled then raise exception 'INVALID_STATE' using detail = 'switch Bosta on in Settings > Integrations first'; end if;
  if coalesce(p_cod_minor, 0) < 0 then raise exception 'INVALID_INPUT'; end if;
  if exists (select 1 from public.sal_shipments where org_id = v_org and order_id = p_order_id and status in ('pending', 'created', 'picked_up', 'in_transit', 'delivered')) then
    raise exception 'INVALID_STATE' using detail = 'this order already has an open shipment; cancel it first';
  end if;
  v_ref := 'SH' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  insert into public.sal_shipments (org_id, order_id, reference, cod_minor, currency, recipient_name, recipient_phone, city, address, simulated, created_by, status)
  values (v_org, p_order_id, v_ref, coalesce(p_cod_minor, 0), o.currency, p_recipient_name, p_recipient_phone, p_city, p_address, v_int.mode = 'simulated', auth.uid(),
          case when v_int.mode = 'simulated' then 'created' else 'pending' end)
  returning id into v_id;
  if v_int.mode = 'simulated' then
    update public.sal_shipments set tracking = 'SIM-' || upper(substr(v_ref, 3, 8)) where id = v_id;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.shipment.created', 'sales_shipment', v_id::text,
          format('Bosta shipment for %s, cash on delivery %s minor units %s%s', o.number, coalesce(p_cod_minor, 0), o.currency, case when v_int.mode = 'simulated' then ' (simulated)' else '' end));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'simulated', v_int.mode = 'simulated', 'orderNumber', o.number, 'codMinor', coalesce(p_cod_minor, 0),
    'currency', o.currency, 'recipientName', p_recipient_name, 'recipientPhone', p_recipient_phone, 'city', p_city, 'address', p_address);
end $$;

create or replace function public.sal_shipment_set_tracking(p_shipment_id uuid, p_tracking text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
begin
  if p_tracking is null or length(p_tracking) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
  update public.sal_shipments set tracking = p_tracking, status = 'created', updated_at = now()
   where org_id = v_org and id = p_shipment_id and status = 'pending' and tracking is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.sal_shipment_fail(p_shipment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
begin
  update public.sal_shipments set status = 'failed', note = left(coalesce(p_reason, 'failed'), 300), updated_at = now()
   where org_id = v_org and id = p_shipment_id and status = 'pending';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Cancel here (before pickup). Real shipments are also cancelled in Bosta by the server; this only records our side.
create or replace function public.sal_cancel_shipment(p_shipment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
begin
  update public.sal_shipments set status = 'cancelled', updated_at = now()
   where org_id = v_org and id = p_shipment_id and status in ('pending', 'created');
  if not found then raise exception 'INVALID_STATE' using detail = 'only a shipment that has not been picked up can be cancelled'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.shipment.cancelled', 'sales_shipment', p_shipment_id::text, 'shipment cancelled');
end $$;

-- Apply one status update. Service role only; idempotent per (shipment, event key); never raises for an out-of-date update.
create or replace function public.sal__apply_shipment_status(p_reference text, p_state_code int, p_event_key text, p_cod_minor bigint default null, p_simulated boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sal_shipments; v_status text;
begin
  select * into s from public.sal_shipments where provider = 'bosta' and reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if s.simulated is distinct from coalesce(p_simulated, false) then return jsonb_build_object('result', 'mode_mismatch'); end if;
  if p_state_code is null or p_event_key is null or length(p_event_key) = 0 then return jsonb_build_object('result', 'invalid'); end if;
  v_status := public.sal__bosta_status(p_state_code);
  begin
    insert into public.sal_shipment_events (org_id, shipment_id, state_code, status, event_key) values (s.org_id, s.id, p_state_code, v_status, left(p_event_key, 160));
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate');
  end;
  -- a finished shipment is not reopened by a late or replayed update
  if s.status in ('delivered', 'returned', 'cancelled', 'lost') and v_status not in ('returned') then
    return jsonb_build_object('result', 'ignored', 'status', s.status);
  end if;
  update public.sal_shipments set status = v_status, state_code = p_state_code, updated_at = now() where id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (s.org_id, s.created_by, 'sales.shipment.status', 'sales_shipment', s.id::text, format('%s is now %s (Bosta state %s)', coalesce(s.tracking, s.reference), v_status, p_state_code));
  return jsonb_build_object('result', 'applied', 'status', v_status);
end $$;

-- Try the flow without Bosta: step a simulated shipment to its next status.
create or replace function public.sal_simulate_shipment_step(p_shipment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); s public.sal_shipments; v_code int;
begin
  select * into s from public.sal_shipments where org_id = v_org and id = p_shipment_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not s.simulated then raise exception 'INVALID_STATE' using detail = 'only a simulated shipment can be stepped by hand'; end if;
  v_code := case s.status when 'created' then 20 when 'picked_up' then 30 when 'in_transit' then 45 else null end;
  if v_code is null then raise exception 'INVALID_STATE' using detail = 'this shipment is already finished'; end if;
  return public.sal__apply_shipment_status(s.reference, v_code, 'SIM-' || v_code || '-' || replace(gen_random_uuid()::text, '-', ''), null, true);
end $$;

-- The server needs the company's Bosta keys right after a shipment is started (brand-new, real, still pending), and the webhook
-- secret to check an incoming update (found through our reference).
create or replace function public.sal__shipment_credentials(p_shipment_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('credentials', public.core__provider_credentials(s.org_id, 'bosta'))
    from public.sal_shipments s where s.id = p_shipment_id and s.status = 'pending' and s.tracking is null and not s.simulated and s.created_at > now() - interval '5 minutes';
$$;
create or replace function public.sal__shipment_callback_credentials(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('simulated', s.simulated, 'credentials', public.core__provider_credentials(s.org_id, 'bosta'))
    from public.sal_shipments s where s.provider = 'bosta' and s.reference = p_reference;
$$;

revoke all on function public.sal__bosta_status(int), public.sal__apply_shipment_status(text, int, text, bigint, boolean), public.sal__shipment_credentials(uuid),
  public.sal__shipment_callback_credentials(text) from public, anon, authenticated;
grant execute on function public.sal__apply_shipment_status(text, int, text, bigint, boolean), public.sal__shipment_credentials(uuid),
  public.sal__shipment_callback_credentials(text) to service_role;
revoke all on function public.sal_create_shipment(uuid, text, text, text, text, bigint), public.sal_shipment_set_tracking(uuid, text), public.sal_shipment_fail(uuid, text),
  public.sal_cancel_shipment(uuid), public.sal_simulate_shipment_step(uuid) from public, anon;
grant execute on function public.sal_create_shipment(uuid, text, text, text, text, bigint), public.sal_shipment_set_tracking(uuid, text), public.sal_shipment_fail(uuid, text),
  public.sal_cancel_shipment(uuid), public.sal_simulate_shipment_step(uuid) to authenticated;

commit;

-- Verification (read-only).
select relname, relrowsecurity from pg_class where relname in ('sal_shipments', 'sal_shipment_events') order by 1;
select has_function_privilege('authenticated', 'public.sal__apply_shipment_status(text, int, text, bigint, boolean)', 'execute') as users_apply,
       has_function_privilege('anon', 'public.sal_create_shipment(uuid, text, text, text, text, bigint)', 'execute') as anon_creates;
