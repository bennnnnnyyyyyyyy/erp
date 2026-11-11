-- sql/082_core_integrations_live.sql
-- No more test mode (Ben, 9-11 Nov 2026: "i dont want this stupid test mode on anything"; plan:
-- https://claude.ai/artifact/Bhoasn4YNGrEb4jsWQJtZi). Rerun-safe. Needs sql/001-081.
--
-- Until now every integration had a mode, 'simulated' (the default: answers like the real provider, sends and charges nothing) or 'live'.
-- From here an integration is only off or on, and "on" always means the real provider:
--   * core_integrations.mode is always 'live' (column kept so older code and records still read; the check allows only 'live').
--     Rows that were on in test mode stay on only if their details are saved; otherwise they are switched off. Each changed row is audited.
--   * core_save_integration: switching ON needs the details (Slack, Teams, Google Chat: the webhook URL; providers: their required fields;
--     AI: the owner's acceptance of the current notice, as before). p_mode is kept for callers; 'simulated' is refused.
--     Email and Telegram need our own server keys, which the API checks (the database cannot see Worker secrets).
--   * core_clear_integration_secret: no longer writes 'simulated' (it switches the integration off, as before).
--   * core_test_integration: the test message no longer names a mode.
--   * Dropped: fin_simulate_pay_link, sal_simulate_shipment_step, sal_shopify_test_order (the "try it without the provider" buttons).
--     The simulated columns on payment links, shipments and Shopify orders stay as history (live has none, 11 Nov 2026).
--   * core_record_integration_check (new): saves the result of "Check connection" (a real call made by the API) on the integration,
--     owner or admin only, audited.
--   * Shopify fields (sql/059's list): client_id required, access_token optional (Shopify's 2026 app rules; see below).
--   * ETA e-invoicing: a company chooses PreProd (ETA's own test system) or production; our simulated mode is no longer a choice.
--     Profiles in 'simulated' move to 'preprod' (audited). Production stays refused until a real signer exists (sql/036).
-- Functions that compare mode = 'simulated' (sql/057-059: starting a link, a shipment, a Shopify callback) need no change: the
-- comparison is now always false, so they always take the real path.

begin;

-- ---------------------------------------------------------------- Shopify's 2026 app rules (sql/059's field list)
-- Since 1 Jan 2026 a new Shopify custom app has no permanent Admin API token (shpat_): it has a client ID and a client secret, and the
-- server exchanges them for a token that lasts 24 hours. The client secret also signs the webhooks, so it stays in 'webhook_secret'
-- (the callback reads that name). 'access_token' becomes optional: only apps made before 2026 still have one.
create or replace function public.core__provider_fields(p_kind text)
returns table (field text, is_secret boolean, required boolean)
language sql immutable as $$
  select v.field, v.is_secret, v.required from (values
    ('paymob', 'secret_key', true, true), ('paymob', 'public_key', true, true), ('paymob', 'hmac_secret', true, true),
    ('paymob', 'integration_ids', false, true),
    ('fawry', 'merchant_code', false, true), ('fawry', 'secure_key', true, true),
    ('bosta', 'api_key', true, true), ('bosta', 'webhook_secret', true, true),
    ('shopify', 'shop_domain', false, true), ('shopify', 'client_id', false, true), ('shopify', 'webhook_secret', true, true),
    ('shopify', 'access_token', true, false), ('shopify', 'warehouse_code', false, false),
    ('openai', 'api_key', true, false), ('openai', 'model', false, false),
    ('elevenlabs', 'api_key', true, false),
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;
revoke all on function public.core__provider_fields(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- integrations: rows, default, check

-- Audit first (it needs the old values), then change. A row stays on only if what switching on now requires is saved.
with old as (
  select i.id, i.org_id, i.kind, i.mode, i.enabled,
         i.enabled and not (
           (i.kind in ('slack', 'teams', 'google_chat') and i.secret_id is null)
           or exists (select 1 from public.core__provider_fields(i.kind) f
                       where f.required and not coalesce((i.settings -> 'saved_fields') ? f.field, false))
         ) as keep_on
    from public.core_integrations i
   where i.mode <> 'live'
)
insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
select o.org_id, null, 'core.integration.changed', 'integration', o.id::text,
       format('%s: test mode removed (sql/082)%s', o.kind, case when o.enabled and not o.keep_on then '; switched off until its details are saved' else '' end),
       jsonb_build_object('enabled', o.enabled, 'mode', o.mode),
       jsonb_build_object('enabled', o.keep_on, 'mode', 'live')
  from old o;

update public.core_integrations i
   set mode = 'live',
       enabled = i.enabled and not (
         (i.kind in ('slack', 'teams', 'google_chat') and i.secret_id is null)
         or exists (select 1 from public.core__provider_fields(i.kind) f
                     where f.required and not coalesce((i.settings -> 'saved_fields') ? f.field, false))
       )
 where i.mode <> 'live';

alter table public.core_integrations alter column mode set default 'live';
alter table public.core_integrations drop constraint if exists core_integrations_mode_check;
alter table public.core_integrations add constraint core_integrations_mode_check check (mode = 'live');

-- ---------------------------------------------------------------- switching on (sql/071's function; on needs the details)

create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama')
     or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_mode, 'live') <> 'live' then raise exception 'INVALID_INPUT' using detail = 'test mode was removed; an integration is either off or on'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_enabled and p_kind in ('slack', 'teams', 'google_chat') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching it on';
  end if;
  if p_enabled then
    select array_agg(f.field) into v_missing from public.core__provider_fields(p_kind) f
     where f.required and not coalesce((r.settings -> 'saved_fields') ? f.field, false);
    if v_missing is not null then raise exception 'INVALID_STATE' using detail = format('save %s before switching it on', array_to_string(v_missing, ', ')); end if;
  end if;
  -- 061: every AI provider, Ollama included, needs the owner's acceptance of the CURRENT notice.
  if p_kind in ('openai', 'elevenlabs', 'ollama') and p_enabled and not public.core__ai_consent_current(v_org) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the current AI data notice first';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, 'live', p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = 'live', enabled = excluded.enabled,
    settings = public.core_integrations.settings || jsonb_build_object('kinds', to_jsonb(v_kinds)), updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s', p_kind, case when p_enabled then 'on' else 'off' end),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- removing a webhook URL (sql/053's function; no 'simulated')

create or replace function public.core_clear_integration_secret(p_kind text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if not found or r.secret_id is null then return; end if;
  delete from vault.secrets where id = r.secret_id;
  update public.core_integrations set secret_id = null, secret_hint = null, enabled = false, updated_by = auth.uid() where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.secret_cleared', 'integration', r.id::text, format('%s webhook URL removed; switched off', p_kind));
end $$;

-- ---------------------------------------------------------------- the queued test message (sql/054's function; no mode in the text)

create or replace function public.core_test_integration(p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind;
  if not found then raise exception 'NOT_FOUND' using detail = 'save the integration first'; end if;
  if p_kind = 'telegram' and not exists (select 1 from public.msg_identities i where i.org_id = v_org and i.user_id = auth.uid()
                                          and i.channel = 'telegram' and i.status = 'verified') then
    raise exception 'INVALID_STATE' using detail = 'link your own Telegram first (Messages → Connect)';
  end if;
  insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, idempotency_key, max_attempts)
  values (v_org, case when p_kind in ('email', 'telegram') then auth.uid() end, p_kind, 'info', 'Test message from the ERP',
          format('This is a test of the %s integration. If you can read it, the connection works.', p_kind),
          format('integration-test:%s:%s', p_kind, gen_random_uuid()), 1)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.tested', 'integration', r.id::text, format('%s test message queued', p_kind));
  return v_id;
end $$;

-- ---------------------------------------------------------------- "Check connection": the result of a real call to the provider
-- The API makes one harmless real call with the saved details (apps/api/src/lib/integrationChecks.ts) and records what happened here,
-- with the caller's own sign-in: owner or admin, their own company only, audited. The text is the provider's short answer, never a key.
create or replace function public.core_record_integration_check(p_kind text, p_ok boolean, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations;
begin
  if p_ok is null or length(coalesce(p_message, '')) > 300 then raise exception 'INVALID_INPUT'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'save the integration first'; end if;
  update public.core_integrations
     set last_status = case when p_ok then 'sent' else 'failed' end,
         last_error = case when p_ok then null else nullif(trim(p_message), '') end,
         last_delivery_at = now()
   where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.checked', 'integration', r.id::text,
          format('%s connection check: %s%s', p_kind, case when p_ok then 'worked' else 'failed' end,
                 case when coalesce(trim(p_message), '') = '' then '' else ': ' || left(trim(p_message), 200) end));
end $$;
revoke all on function public.core_record_integration_check(text, boolean, text) from public, anon;
grant execute on function public.core_record_integration_check(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- the "try it without the provider" functions

drop function if exists public.fin_simulate_pay_link(uuid);
drop function if exists public.sal_simulate_shipment_step(uuid);
drop function if exists public.sal_shopify_test_order();

-- ---------------------------------------------------------------- ETA: PreProd or production only

insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
select t.org_id, null, 'einvoicing.profile.mode_changed', 'tax_profile', t.org_id::text,
       'ETA mode preprod (was simulated): test mode removed (sql/082)'
  from public.tax_profiles t where t.eta_mode = 'simulated';
update public.tax_profiles set eta_mode = 'preprod' where eta_mode = 'simulated';

alter table public.tax_profiles alter column eta_mode set default 'preprod';
alter table public.tax_profiles drop constraint if exists tax_profiles_eta_mode_check;
alter table public.tax_profiles add constraint tax_profiles_eta_mode_check check (eta_mode in ('preprod', 'production'));

-- sql/036's function: default 'preprod'; 'simulated' refused; production still refused until a real signer exists.
create or replace function public.eta_save_profile(p_registration_number text, p_legal_name text, p_activity_code text, p_mode text default 'preprod') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  v_old public.tax_profiles;
begin
  if p_mode is null or p_mode not in ('preprod', 'production') then raise exception 'INVALID_INPUT' using detail = 'mode must be preprod or production'; end if;
  if p_mode = 'production' then
    raise exception 'PRODUCTION_NOT_READY' using detail = 'production needs stored ETA credentials and a real signer, which are not set up yet';
  end if;
  if coalesce(trim(p_registration_number), '') !~ '^[0-9A-Za-z-]{3,30}$' then raise exception 'INVALID_INPUT' using detail = 'the registration number is not valid'; end if;
  if coalesce(trim(p_activity_code), '') !~ '^[0-9]{3,10}$' then raise exception 'INVALID_INPUT' using detail = 'the activity code is not valid'; end if;
  if length(trim(coalesce(p_legal_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'the legal name is missing'; end if;
  select * into v_old from public.tax_profiles where org_id = v_org for update;
  insert into public.tax_profiles (org_id, registration_number, legal_name, activity_code, eta_mode, updated_by)
  values (v_org, trim(p_registration_number), trim(p_legal_name), trim(p_activity_code), p_mode, auth.uid())
  on conflict (org_id) do update set registration_number = excluded.registration_number, legal_name = excluded.legal_name,
    activity_code = excluded.activity_code, eta_mode = excluded.eta_mode, updated_by = excluded.updated_by;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(),
          case when v_old.eta_mode is not null and v_old.eta_mode <> p_mode then 'einvoicing.profile.mode_changed' else 'einvoicing.profile.saved' end,
          'tax_profile', v_org::text,
          format('Registration %s, activity %s, ETA mode %s%s', trim(p_registration_number), trim(p_activity_code), p_mode,
                 case when v_old.eta_mode is not null and v_old.eta_mode <> p_mode then format(' (was %s)', v_old.eta_mode) else '' end));
end $$;

commit;

-- Verification (read-only). Expect: simulated_rows 0, on_without_details 0, mode_default 'live'::text, sim_functions 0,
-- eta_simulated 0, eta_default 'preprod'::text.
select (select count(*) from public.core_integrations where mode <> 'live') as simulated_rows,
       (select count(*) from public.core_integrations i where i.enabled and (
          (i.kind in ('slack', 'teams', 'google_chat') and i.secret_id is null)
          or exists (select 1 from public.core__provider_fields(i.kind) f
                      where f.required and not coalesce((i.settings -> 'saved_fields') ? f.field, false)))) as on_without_details,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'core_integrations' and column_name = 'mode') as mode_default,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('fin_simulate_pay_link', 'sal_simulate_shipment_step', 'sal_shopify_test_order')) as sim_functions,
       (select count(*) from public.tax_profiles where eta_mode = 'simulated') as eta_simulated,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'tax_profiles' and column_name = 'eta_mode') as eta_default;
