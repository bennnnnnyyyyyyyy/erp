-- sql/056_provider_connections.sql
-- Integrations, all chosen providers (documentation/planning/INTEGRATION_PROVIDER_CHOICES.md, Ben 6 Nov): connection settings for
-- Paymob, Fawry, Bosta, Shopify, OpenAI, ElevenLabs and Ollama next to email, Slack, Teams and Telegram (sql/053-054), plus the AI
-- rules Ben set: customer consent before any data goes to an outside AI provider, a monthly spending cap (USD 100 to start), every
-- AI call logged with its cost, and Ollama (the company's own local AI) as the alternative. Rerun-safe. Needs sql/001-055.
--
-- * Credentials: one JSON bundle per company and provider in Supabase Vault (write-only; a field can be replaced on its own). Users
--   see only which fields are saved (settings.saved_fields), never a value. Only the server jobs (service role) read them.
-- * Plain settings (shop domain, merchant code, Ollama address, model names): settings.config, readable by owners and admins.
-- * Every provider starts "simulated": answers like the real one, sends and charges nothing. "Live" needs its required fields.
-- * AI: core_ai_consent (who accepted which notice, when; can be withdrawn); ai_usage (one row per call: provider, feature, tokens or
--   seconds, cost in micro-USD, who); ai__month_spend(org or all) for the caps. Ollama costs nothing and needs no consent.

begin;

-- ---------------------------------------------------------------- more providers

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in
  ('email', 'slack', 'teams', 'telegram', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama'));

-- Fields per provider: secret ones go to Vault, plain ones to settings.config; "required" ones are needed before going live.
create or replace function public.core__provider_fields(p_kind text)
returns table (field text, is_secret boolean, required boolean)
language sql immutable as $$
  select v.field, v.is_secret, v.required from (values
    ('paymob', 'secret_key', true, true), ('paymob', 'public_key', true, true), ('paymob', 'hmac_secret', true, true),
    ('paymob', 'integration_ids', false, true),
    ('fawry', 'merchant_code', false, true), ('fawry', 'secure_key', true, true),
    ('bosta', 'api_key', true, true), ('bosta', 'webhook_secret', true, true),
    ('shopify', 'shop_domain', false, true), ('shopify', 'access_token', true, true), ('shopify', 'webhook_secret', true, true),
    ('openai', 'api_key', true, false), ('openai', 'model', false, false),
    ('elevenlabs', 'api_key', true, false),
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;

-- Save provider fields (owner or admin). Secret fields are merged into the Vault bundle (an empty value removes that field); plain
-- fields into settings.config. Never returns a secret.
create or replace function public.core_save_provider_fields(p_kind text, p_values jsonb) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; f record; k text; v text;
  v_bundle jsonb := '{}'::jsonb; v_config jsonb; v_saved text[]; v_sid uuid;
begin
  if not exists (select 1 from public.core__provider_fields(p_kind)) or jsonb_typeof(p_values) <> 'object' then
    raise exception 'INVALID_INPUT' using detail = 'unknown provider';
  end if;
  for k in select jsonb_object_keys(p_values) loop
    if not exists (select 1 from public.core__provider_fields(p_kind) x where x.field = k) then raise exception 'INVALID_INPUT' using detail = format('unknown field %s', k); end if;
    if jsonb_typeof(p_values -> k) <> 'string' or length(p_values ->> k) > 4000 then raise exception 'INVALID_INPUT' using detail = format('%s must be text', k); end if;
  end loop;
  if p_kind = 'ollama' and coalesce(p_values ->> 'base_url', 'https://x') !~ '^https?://[^\s]+$' then raise exception 'INVALID_INPUT' using detail = 'base_url must start with http:// or https://'; end if;
  if p_kind = 'shopify' and p_values ? 'shop_domain' and p_values ->> 'shop_domain' !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'INVALID_INPUT' using detail = 'shop_domain looks like your-store.myshopify.com';
  end if;

  insert into public.core_integrations (org_id, kind, updated_by) values (v_org, p_kind, auth.uid()) on conflict (org_id, kind) do nothing;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if r.secret_id is not null then
    select coalesce(nullif(d.decrypted_secret, '')::jsonb, '{}'::jsonb) into v_bundle from vault.decrypted_secrets d where d.id = r.secret_id;
  end if;
  v_config := coalesce(r.settings -> 'config', '{}'::jsonb);
  for f in select * from public.core__provider_fields(p_kind) loop
    continue when not (p_values ? f.field);
    v := trim(p_values ->> f.field);
    if f.is_secret then
      v_bundle := case when v = '' then v_bundle - f.field else v_bundle || jsonb_build_object(f.field, v) end;
    else
      v_config := case when v = '' then v_config - f.field else v_config || jsonb_build_object(f.field, v) end;
    end if;
  end loop;
  if r.secret_id is null then
    if v_bundle <> '{}'::jsonb then
      v_sid := vault.create_secret(v_bundle::text, format('erp-%s-%s', p_kind, v_org), format('%s credentials for organization %s', p_kind, v_org));
    end if;
  else
    perform vault.update_secret(r.secret_id, v_bundle::text);
    v_sid := r.secret_id;
  end if;
  select coalesce(array_agg(x order by x), '{}') into v_saved from (select jsonb_object_keys(v_bundle) x union select jsonb_object_keys(v_config)) s;
  update public.core_integrations
     set secret_id = v_sid, secret_hint = case when v_bundle = '{}'::jsonb then null else 'saved' end,
         settings = jsonb_set(jsonb_set(settings, '{config}', v_config), '{saved_fields}', to_jsonb(v_saved)),
         updated_by = auth.uid(), last_status = null, last_error = null
   where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.integration.fields_saved', 'integration', r.id::text, format('%s settings saved (%s)', p_kind, array_to_string(v_saved, ', ')),
          jsonb_build_object('saved_fields', to_jsonb(v_saved)));   -- field names only, never values
  return jsonb_build_object('kind', p_kind, 'savedFields', to_jsonb(v_saved));
end $$;

-- For the server jobs only: the provider's secret bundle merged with its plain settings.
create or replace function public.core__provider_credentials(p_org uuid, p_kind text) returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select coalesce(i.settings -> 'config', '{}'::jsonb) || coalesce((select nullif(d.decrypted_secret, '')::jsonb from vault.decrypted_secrets d where d.id = i.secret_id), '{}'::jsonb)
    from public.core_integrations i where i.org_id = p_org and i.kind = p_kind;
$$;

-- sql/054's core_save_integration, for every provider. Live needs the provider's required fields (Slack/Teams: the URL).
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama')
     or p_enabled is null or p_mode not in ('simulated', 'live') then raise exception 'INVALID_INPUT'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_mode = 'live' and p_kind in ('slack', 'teams') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching to live';
  end if;
  if p_mode = 'live' then
    select array_agg(f.field) into v_missing from public.core__provider_fields(p_kind) f
     where f.required and not coalesce((r.settings -> 'saved_fields') ? f.field, false);
    if v_missing is not null then raise exception 'INVALID_STATE' using detail = format('save %s before switching to live', array_to_string(v_missing, ', ')); end if;
  end if;
  if p_kind in ('openai', 'elevenlabs') and p_enabled and not exists (select 1 from public.core_ai_consent where org_id = v_org and withdrawn_at is null) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the AI data notice first';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, p_mode, p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = excluded.mode, enabled = excluded.enabled,
    settings = public.core_integrations.settings || jsonb_build_object('kinds', to_jsonb(v_kinds)), updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s, %s', p_kind, case when p_enabled then 'on' else 'off' end, p_mode),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'mode', r.mode, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'mode', p_mode, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- AI consent, usage and caps

create table if not exists public.core_ai_consent (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  notice_version text not null check (length(notice_version) between 1 and 20),
  accepted_by   uuid not null references auth.users(id),
  accepted_at   timestamptz not null default now(),
  withdrawn_by  uuid references auth.users(id),
  withdrawn_at  timestamptz
);
create unique index if not exists core_ai_consent_active_uq on public.core_ai_consent (org_id) where withdrawn_at is null;
alter table public.core_ai_consent enable row level security;
revoke all on public.core_ai_consent from anon, authenticated;
grant select on public.core_ai_consent to authenticated;
drop policy if exists core_ai_consent_admin_read on public.core_ai_consent;
create policy core_ai_consent_admin_read on public.core_ai_consent for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = core_ai_consent.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- The owner accepts (or withdraws) the notice that the company's data may be sent to an outside AI provider. Withdrawing switches
-- OpenAI and ElevenLabs off at once.
create or replace function public.core_set_ai_consent(p_accept boolean, p_notice_version text default 'v1') returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']);
begin
  if p_accept is null or length(coalesce(p_notice_version, '')) not between 1 and 20 then raise exception 'INVALID_INPUT'; end if;
  if p_accept then
    if exists (select 1 from public.core_ai_consent where org_id = v_org and withdrawn_at is null) then return; end if;
    insert into public.core_ai_consent (org_id, notice_version, accepted_by) values (v_org, p_notice_version, auth.uid());
  else
    update public.core_ai_consent set withdrawn_by = auth.uid(), withdrawn_at = now() where org_id = v_org and withdrawn_at is null;
    update public.core_integrations set enabled = false, updated_by = auth.uid() where org_id = v_org and kind in ('openai', 'elevenlabs') and enabled;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when p_accept then 'core.ai.consent_given' else 'core.ai.consent_withdrawn' end, 'organization', v_org::text,
          case when p_accept then format('AI data notice %s accepted: company data may be sent to outside AI providers', p_notice_version)
               else 'AI data notice withdrawn: outside AI providers switched off' end);
end $$;

create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations(id),
  user_id        uuid references auth.users(id),
  provider       text not null check (provider in ('openai', 'elevenlabs', 'ollama', 'simulated')),
  feature        text not null check (length(feature) between 1 and 40),
  model          text check (model is null or length(model) <= 80),
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  audio_seconds  numeric(10, 2) not null default 0 check (audio_seconds >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  own_key        boolean not null default false,
  ok             boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_org_month_idx on public.ai_usage (org_id, created_at desc);
create index if not exists ai_usage_month_idx on public.ai_usage (created_at desc) where not own_key;
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists ai_usage_admin_read on public.ai_usage;
create policy ai_usage_admin_read on public.ai_usage for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = ai_usage.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- For the server only: record one AI call (append-only log).
create or replace function public.ai__record_usage(p_org uuid, p_user uuid, p_provider text, p_feature text, p_model text, p_in int, p_out int,
  p_seconds numeric, p_cost_micro bigint, p_own_key boolean, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.ai_usage (org_id, user_id, provider, feature, model, input_tokens, output_tokens, audio_seconds, cost_micro_usd, own_key, ok)
  values (p_org, p_user, p_provider, p_feature, p_model, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0),
          greatest(coalesce(p_seconds, 0), 0), greatest(coalesce(p_cost_micro, 0), 0), coalesce(p_own_key, false), coalesce(p_ok, true));
$$;

-- For the server only: this calendar month's spend (micro-USD) on OUR keys: one company (p_org) or everyone (null).
create or replace function public.ai__month_spend(p_org uuid default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_micro_usd), 0)::bigint from public.ai_usage
   where not own_key and created_at >= date_trunc('month', now()) and (p_org is null or org_id = p_org);
$$;

-- For owners and admins: the company's AI state (consent, this month's calls and spend).
create or replace function public.core_ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); c public.core_ai_consent;
begin
  select * into c from public.core_ai_consent where org_id = v_org and withdrawn_at is null;
  return jsonb_build_object(
    'consent', case when c.id is null then null else jsonb_build_object('version', c.notice_version, 'acceptedBy', c.accepted_by, 'acceptedAt', c.accepted_at) end,
    'monthCalls', (select count(*) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())),
    'monthSpendMicroUsd', (select coalesce(sum(cost_micro_usd), 0) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())));
end $$;

revoke all on function public.core__provider_fields(text), public.core__provider_credentials(uuid, text), public.ai__record_usage(uuid, uuid, text, text, text, int, int, numeric, bigint, boolean, boolean),
  public.ai__month_spend(uuid) from public, anon, authenticated;
grant execute on function public.core__provider_credentials(uuid, text), public.ai__record_usage(uuid, uuid, text, text, text, int, int, numeric, bigint, boolean, boolean),
  public.ai__month_spend(uuid) to service_role;
revoke all on function public.core_save_provider_fields(text, jsonb), public.core_save_integration(text, boolean, text, text[]), public.core_set_ai_consent(boolean, text),
  public.core_ai_status() from public, anon;
grant execute on function public.core_save_provider_fields(text, jsonb), public.core_save_integration(text, boolean, text, text[]), public.core_set_ai_consent(boolean, text),
  public.core_ai_status() to authenticated;

commit;

-- Verification (read-only).
select relname, relrowsecurity from pg_class where relname in ('core_ai_consent', 'ai_usage') order by 1;
select has_function_privilege('authenticated', 'public.core__provider_credentials(uuid, text)', 'execute') as users_read_credentials,
       has_function_privilege('anon', 'public.core_save_provider_fields(text, jsonb)', 'execute') as anon_saves_fields;
