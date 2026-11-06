-- sql/053_integrations_wave1.sql
-- Integrations, wave 1 (documentation/plans/INTEGRATIONS_PLAN.md §3, §5): per-company integration settings with secrets in Supabase
-- Vault, email and Slack/Teams delivery through the existing outbox, and daily exchange rates. Rerun-safe. Needs sql/001-052.
--
-- * core_integrations: one row per company and kind ('email', 'slack', 'teams'), mode 'simulated' (default: answers like the real
--   thing, sends nothing) or 'live', enabled, settings (which message kinds go out on it), a masked hint of the secret, and the last
--   delivery result. A secret (a Slack or Teams webhook URL) is stored in Vault (encrypted); only its id is kept here, and users can
--   neither read the secret nor its id. Only the delivery job (service role) reads it, through core__integration_secret.
-- * Routing: when an in-app message is queued, a copy goes to email (per person) and/or to the company's Slack or Teams channel, for
--   the message kinds the company chose. Channel posts are company-wide, so they carry no recipient and are de-duplicated per
--   transaction and subject (an alert to five people is one channel post). Email uses our sending account (a Worker secret), so a
--   company only switches it on.
-- * msg_outbox: channels 'slack' and 'teams' added; recipient_id may be empty only for those; delivered_via records how a message
--   was delivered ('simulated', 'resend', 'slack-webhook', …) through msg_complete_delivery (service role).
-- * core_fx_rates: daily rates against USD from a public source (Frankfurter), saved by the scheduled job; core_fx_rate gives any
--   pair on or before a date by crossing through USD. This is shared public reference data, not a company's business data, so it has
--   no org_id (the one exception to that rule; documented in the plan). Read-only to signed-in users.

begin;

-- ---------------------------------------------------------------- integrations

create table if not exists public.core_integrations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  kind             text not null check (kind in ('email', 'slack', 'teams')),
  mode             text not null default 'simulated' check (mode in ('simulated', 'live')),
  enabled          boolean not null default false,
  settings         jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  secret_id        uuid,
  secret_hint      text check (secret_hint is null or length(secret_hint) <= 40),
  last_status      text check (last_status in ('sent', 'failed')),
  last_error       text check (last_error is null or length(last_error) <= 500),
  last_delivery_at timestamptz,
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, kind),
  unique (org_id, id)
);
drop trigger if exists core_integrations_updated_at on public.core_integrations;
create trigger core_integrations_updated_at before update on public.core_integrations for each row execute function public.set_updated_at();

-- Owners and admins read their company's settings; never the secret id (column grant).
alter table public.core_integrations enable row level security;
revoke all on public.core_integrations from anon, authenticated;
grant select (id, org_id, kind, mode, enabled, settings, secret_hint, last_status, last_error, last_delivery_at, updated_by, created_at, updated_at)
  on public.core_integrations to authenticated;
drop policy if exists core_integrations_admin_read on public.core_integrations;
create policy core_integrations_admin_read on public.core_integrations for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = core_integrations.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- The message kinds a company may route to an integration (the outbox kinds people care about outside the app).
create or replace function public.core__integration_kinds() returns text[]
language sql immutable as $$ select array['approval_request', 'decision', 'task_assigned', 'reminder', 'escalation', 'alert', 'info'] $$;

-- Switch an integration on or off, choose its mode and which message kinds it carries. Owner or admin. Live Slack or Teams needs a
-- saved webhook URL first.
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[];
begin
  if p_kind not in ('email', 'slack', 'teams') or p_enabled is null or p_mode not in ('simulated', 'live') then raise exception 'INVALID_INPUT'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_mode = 'live' and p_kind in ('slack', 'teams') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching to live';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, p_mode, p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = excluded.mode, enabled = excluded.enabled,
    settings = public.core_integrations.settings || excluded.settings, updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s, %s', p_kind, case when p_enabled then 'on' else 'off' end, p_mode),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'mode', r.mode, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'mode', p_mode, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;

-- Save or replace a webhook URL (write-only: it can never be read back; the screen shows only a hint). Owner or admin.
create or replace function public.core_set_integration_secret(p_kind text, p_secret text) returns text
language plpgsql security definer set search_path = public, vault as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_secret text := trim(coalesce(p_secret, ''));
  v_hint text; v_sid uuid;
begin
  if p_kind not in ('slack', 'teams') then raise exception 'INVALID_INPUT' using detail = 'only Slack and Teams take a webhook URL'; end if;
  if length(v_secret) not between 20 and 2000 or v_secret !~ '^https://[^\s/]+/\S+$' then
    raise exception 'INVALID_INPUT' using detail = 'paste the full https webhook URL';
  end if;
  if p_kind = 'slack' and v_secret !~ '^https://hooks\.slack(-gov)?\.com/' then
    raise exception 'INVALID_INPUT' using detail = 'a Slack webhook URL starts with https://hooks.slack.com/';
  end if;
  v_hint := '…' || right(v_secret, 6);
  insert into public.core_integrations (org_id, kind, updated_by) values (v_org, p_kind, auth.uid())
  on conflict (org_id, kind) do nothing;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if r.secret_id is null then
    v_sid := vault.create_secret(v_secret, format('erp-%s-%s', p_kind, v_org), format('%s webhook URL for organization %s', p_kind, v_org));
  else
    perform vault.update_secret(r.secret_id, v_secret);
    v_sid := r.secret_id;
  end if;
  update public.core_integrations set secret_id = v_sid, secret_hint = v_hint, updated_by = auth.uid(), last_status = null, last_error = null where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.integration.secret_set', 'integration', r.id::text, format('%s webhook URL saved (%s)', p_kind, v_hint),
          jsonb_build_object('hint', v_hint));   -- never the secret itself
  return v_hint;
end $$;

-- Remove a webhook URL (also switches the integration back to simulated and off). Owner or admin.
create or replace function public.core_clear_integration_secret(p_kind text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if not found or r.secret_id is null then return; end if;
  delete from vault.secrets where id = r.secret_id;
  update public.core_integrations set secret_id = null, secret_hint = null, mode = 'simulated', enabled = false, updated_by = auth.uid() where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.secret_cleared', 'integration', r.id::text, format('%s webhook URL removed', p_kind));
end $$;

-- For the delivery job only (service role): the decrypted secret of one company's integration.
create or replace function public.core__integration_secret(p_org uuid, p_kind text) returns text
language sql stable security definer set search_path = public, vault as $$
  select d.decrypted_secret from public.core_integrations i join vault.decrypted_secrets d on d.id = i.secret_id
   where i.org_id = p_org and i.kind = p_kind;
$$;

-- For the delivery job only (service role): the email address of a message's recipient, if they are still an active member of the
-- message's company (a disabled or removed person gets nothing).
create or replace function public.msg__recipient_email(p_outbox_id uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text from public.msg_outbox o
    join public.memberships m on m.org_id = o.org_id and m.user_id = o.recipient_id and m.disabled_at is null
    join auth.users u on u.id = o.recipient_id
   where o.id = p_outbox_id;
$$;

-- Send a test through an integration, to the caller (email) or the company channel (Slack, Teams). Owner or admin.
create or replace function public.core_test_integration(p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind;
  if not found then raise exception 'NOT_FOUND' using detail = 'save the integration first'; end if;
  insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, idempotency_key, max_attempts)
  values (v_org, case when p_kind = 'email' then auth.uid() end, p_kind, 'info', 'Test message from the ERP',
          format('This is a test of the %s integration (%s mode). Nothing is wrong.', p_kind, r.mode),
          format('integration-test:%s:%s', p_kind, gen_random_uuid()), 1)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.tested', 'integration', r.id::text, format('%s test message queued', p_kind));
  return v_id;
end $$;

-- ---------------------------------------------------------------- the outbox learns the new channels

alter table public.msg_outbox drop constraint if exists msg_outbox_channel_check;
alter table public.msg_outbox add constraint msg_outbox_channel_check check (channel in ('in_app', 'fake', 'email', 'whatsapp', 'voice', 'slack', 'teams'));
alter table public.msg_outbox alter column recipient_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'msg_outbox_recipient_unless_channel_post') then
    alter table public.msg_outbox add constraint msg_outbox_recipient_unless_channel_post check (recipient_id is not null or channel in ('slack', 'teams'));
  end if;
end $$;
alter table public.msg_outbox add column if not exists delivered_via text check (delivered_via is null or length(delivered_via) <= 40);

-- When an in-app message is queued, copy it to the company's switched-on integrations for that message kind. Same transaction.
create or replace function public.msg__route_integrations() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  if new.channel <> 'in_app' then return null; end if;
  for i in select kind, settings from public.core_integrations where org_id = new.org_id and enabled loop
    continue when not coalesce((i.settings -> 'kinds') ? new.kind, false);
    if i.kind = 'email' then
      insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, expires_at)
      values (new.org_id, new.recipient_id, 'email', new.kind, new.subject, new.body, new.entity_type, new.entity_id, new.idempotency_key || ':email', new.expires_at)
      on conflict (org_id, idempotency_key) do nothing;
    else
      -- one channel post per subject per transaction, however many people the message went to
      insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, expires_at)
      values (new.org_id, null, i.kind, new.kind, new.subject, new.body, new.entity_type, new.entity_id,
              format('chan:%s:%s:%s:%s', i.kind, new.kind, md5(new.subject || coalesce(new.entity_id::text, '')), txid_current()), new.expires_at)
      on conflict (org_id, idempotency_key) do nothing;
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.msg__route_integrations() from public, anon, authenticated;
drop trigger if exists msg_route_integrations on public.msg_outbox;
create trigger msg_route_integrations after insert on public.msg_outbox for each row execute function public.msg__route_integrations();

-- The delivery job's result, with how it was delivered; also kept on the integration so the settings screen shows the last outcome.
create or replace function public.msg_complete_delivery(p_id uuid, p_ok boolean, p_error text default null, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.msg_outbox;
begin
  perform public.msg_complete(p_id, p_ok, p_error);
  update public.msg_outbox set delivered_via = left(p_via, 40) where id = p_id returning * into m;
  if m.channel in ('email', 'slack', 'teams') then
    update public.core_integrations set last_status = case when p_ok then 'sent' else 'failed' end,
      last_error = case when p_ok then null else left(p_error, 500) end, last_delivery_at = now()
     where org_id = m.org_id and kind = m.channel;
  end if;
end $$;

-- ---------------------------------------------------------------- exchange rates (shared reference data)

create table if not exists public.core_fx_rates (
  rate_date   date not null,
  base        char(3) not null check (base ~ '^[A-Z]{3}$'),
  quote       char(3) not null check (quote ~ '^[A-Z]{3}$'),
  rate        numeric(24, 10) not null check (rate > 0),
  source      text not null check (length(source) between 1 and 40),
  fetched_at  timestamptz not null default now(),
  primary key (rate_date, base, quote, source)
);
create index if not exists core_fx_rates_pair_idx on public.core_fx_rates (base, quote, rate_date desc);
alter table public.core_fx_rates enable row level security;
revoke all on public.core_fx_rates from anon, authenticated;
grant select on public.core_fx_rates to authenticated;
drop policy if exists core_fx_rates_read on public.core_fx_rates;
create policy core_fx_rates_read on public.core_fx_rates for select to authenticated using (true);

-- For the scheduled job only: one day's rates from one source, {"EGP": 48.9, "EUR": 0.92, ...} against p_base. Safe to repeat.
create or replace function public.core__save_fx_rates(p_date date, p_base text, p_rates jsonb, p_source text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if p_date is null or p_base !~ '^[A-Z]{3}$' or jsonb_typeof(p_rates) <> 'object' or length(coalesce(p_source, '')) not between 1 and 40 then
    raise exception 'INVALID_INPUT';
  end if;
  for r in select key, value from jsonb_each(p_rates) loop
    continue when r.key !~ '^[A-Z]{3}$' or jsonb_typeof(r.value) <> 'number' or (r.value::text)::numeric <= 0 or r.key = p_base;
    insert into public.core_fx_rates (rate_date, base, quote, rate, source) values (p_date, p_base, r.key, (r.value::text)::numeric, p_source)
    on conflict (rate_date, base, quote, source) do update set rate = excluded.rate, fetched_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- The rate to convert 1 unit of p_from into p_to, on the latest date on or before p_on, through USD (the stored base).
create or replace function public.core_fx_rate(p_on date, p_from text, p_to text)
returns table (rate numeric, rate_date date, source text)
language plpgsql stable security definer set search_path = public as $$
declare v_from text := upper(trim(coalesce(p_from, ''))); v_to text := upper(trim(coalesce(p_to, '')));
  f public.core_fx_rates; t public.core_fx_rates; rf numeric := 1; rt numeric := 1;
begin
  if p_on is null or v_from !~ '^[A-Z]{3}$' or v_to !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT'; end if;
  if v_from = v_to then return query select 1::numeric, p_on, 'same currency'::text; return; end if;
  if v_from <> 'USD' then
    select * into f from public.core_fx_rates x where x.base = 'USD' and x.quote = v_from and x.rate_date <= p_on order by x.rate_date desc, x.source limit 1;
    if not found then return; end if;   -- no rate known: an empty answer, never a guess
    rf := f.rate;
  end if;
  if v_to <> 'USD' then
    select * into t from public.core_fx_rates x where x.base = 'USD' and x.quote = v_to and x.rate_date <= p_on order by x.rate_date desc, x.source limit 1;
    if not found then return; end if;
    rt := t.rate;
  end if;
  -- the older of the two dates is the date the cross rate is good for
  return query select round(rt / rf, 10), least(coalesce(f.rate_date, t.rate_date), coalesce(t.rate_date, f.rate_date)), coalesce(t.source, f.source);
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.core__integration_kinds(), public.core__integration_secret(uuid, text), public.msg_complete_delivery(uuid, boolean, text, text),
  public.msg__recipient_email(uuid),
  public.core__save_fx_rates(date, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.core_save_integration(text, boolean, text, text[]), public.core_set_integration_secret(text, text),
  public.core_clear_integration_secret(text), public.core_test_integration(text), public.core_fx_rate(date, text, text) from public, anon;
grant execute on function public.core_save_integration(text, boolean, text, text[]), public.core_set_integration_secret(text, text),
  public.core_clear_integration_secret(text), public.core_test_integration(text), public.core_fx_rate(date, text, text) to authenticated;
grant execute on function public.core__integration_secret(uuid, text), public.msg_complete_delivery(uuid, boolean, text, text),
  public.core__save_fx_rates(date, text, jsonb, text), public.msg__recipient_email(uuid) to service_role;

commit;

-- Verification (read-only): RLS on, users cannot read the secret id or call the internal functions, new channels allowed.
select relname, relrowsecurity from pg_class where relname in ('core_integrations', 'core_fx_rates') order by 1;
select has_column_privilege('authenticated', 'public.core_integrations', 'secret_id', 'select') as users_see_secret_id,
       has_function_privilege('authenticated', 'public.core__integration_secret(uuid, text)', 'execute') as users_read_secrets,
       has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute') as anon_sets_secrets,
       has_function_privilege('service_role', 'public.core__integration_secret(uuid, text)', 'execute') as job_reads_secrets;
select pg_get_constraintdef(oid) as channels from pg_constraint where conname = 'msg_outbox_channel_check';
