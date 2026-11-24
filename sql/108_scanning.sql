-- sql/108_scanning.sql
-- Scanning (phase 1d): documentation/plans/SCANNING_PLAN.md; build plan approved by Ben 23 Nov 2026.
-- Step 0, AI providers with the company's own key: four more AI kinds in core_integrations (gemini, anthropic = Claude, grok,
--   openrouter), each with its own key and model; ai__provider_state covers all of them and the company's chosen "reader" (the
--   provider that reads bills); core_set_ai_reader chooses it; the AI notice becomes v3 because it now names more providers.
-- core_integrations kind check, core__provider_fields (from sql/102), core_save_integration (from sql/102), ai__provider_state and
-- core__ai_notice_version (from sql/061) and core_ai_status (from sql/056) are recreated from their latest versions with only these
-- additions.
-- Depends on sql/001-107. Rerun-safe. Then run sql/tests/105_scanning.sql.

begin;

-- ---------------------------------------------------------------- step 0: AI providers

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in
  ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app',
   'gemini', 'anthropic', 'grok', 'openrouter'));

alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage add constraint ai_usage_provider_check check (provider in
  ('openai', 'elevenlabs', 'ollama', 'simulated', 'gemini', 'anthropic', 'grok', 'openrouter'));

-- sql/102's list plus the four new AI kinds. Their key is required: there is no shared key for them (Ben, 23 Nov).
-- Grok and OpenRouter have no sensible default model, so the model is required there.
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
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false),
    ('hr_app', 'base_url', false, true), ('hr_app', 'api_key', true, true),
    ('gemini', 'api_key', true, true), ('gemini', 'model', false, false),
    ('anthropic', 'api_key', true, true), ('anthropic', 'model', false, false),
    ('grok', 'api_key', true, true), ('grok', 'model', false, true),
    ('openrouter', 'api_key', true, true), ('openrouter', 'model', false, true)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;
revoke all on function public.core__provider_fields(text) from public, anon, authenticated;

-- sql/102's function with the four AI kinds in the list of kinds and in the AI consent check; nothing else changes.
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app',
                    'gemini', 'anthropic', 'grok', 'openrouter')
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
  if p_kind in ('openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter') and p_enabled and not public.core__ai_consent_current(v_org) then
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
revoke all on function public.core_save_integration(text, boolean, text, text[]) from public, anon;
grant execute on function public.core_save_integration(text, boolean, text, text[]) to authenticated;

-- The notice now names the new providers, so it asks the owner again (sql/061: only consent to the current version counts).
create or replace function public.core__ai_notice_version() returns text
language sql immutable as $$ select 'v3'::text $$;

-- The providers that can read a picture or a PDF of a bill (ElevenLabs is speech only).
create or replace function public.core__ai_reader_kinds() returns text[]
language sql immutable as $$ select array['openai', 'gemini', 'anthropic', 'grok', 'openrouter', 'ollama'] $$;

-- sql/061's function for all seven AI kinds, plus the company's chosen reader (organizations.settings.ai_reader; null = not chosen).
create or replace function public.ai__provider_state(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_consent boolean := public.core__ai_consent_current(p_org); r jsonb := '{}'::jsonb; k text; i public.core_integrations;
begin
  foreach k in array array['openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter'] loop
    select * into i from public.core_integrations where org_id = p_org and kind = k;
    r := r || jsonb_build_object(k, jsonb_build_object(
      'enabled', coalesce(i.enabled, false) and v_consent,
      'simulated', false,
      'credentials', case when i.id is null then '{}'::jsonb else public.core__provider_credentials(p_org, k) end));
  end loop;
  return jsonb_build_object('consent', v_consent, 'providers', r,
    'reader', (select nullif(o.settings ->> 'ai_reader', '') from public.organizations o where o.id = p_org));
end $$;
revoke all on function public.ai__provider_state(uuid) from public, anon, authenticated;
grant execute on function public.ai__provider_state(uuid) to service_role;

-- Owners and admins choose which provider reads bills (null clears the choice: then the first one that is on is used). Audited.
create or replace function public.core_set_ai_reader(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_old text; v_new text := nullif(trim(coalesce(p_kind, '')), '');
begin
  if v_new is not null and not (v_new = any (public.core__ai_reader_kinds())) then
    raise exception 'INVALID_INPUT' using detail = 'this provider cannot read bills';
  end if;
  select nullif(settings ->> 'ai_reader', '') into v_old from public.organizations where id = v_org for update;
  if v_old is not distinct from v_new then return; end if;
  update public.organizations
     set settings = case when v_new is null then settings - 'ai_reader' else settings || jsonb_build_object('ai_reader', v_new) end
   where id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.ai.reader_changed', 'organization', v_org::text,
          format('AI that reads bills: %s', coalesce(v_new, 'not chosen')),
          jsonb_build_object('ai_reader', v_old), jsonb_build_object('ai_reader', v_new));
end $$;
revoke all on function public.core_set_ai_reader(text) from public, anon;
grant execute on function public.core_set_ai_reader(text) to authenticated;

-- sql/056's function plus the chosen reader.
create or replace function public.core_ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); c public.core_ai_consent;
begin
  select * into c from public.core_ai_consent where org_id = v_org and withdrawn_at is null;
  return jsonb_build_object(
    'consent', case when c.id is null then null else jsonb_build_object('version', c.notice_version, 'acceptedBy', c.accepted_by, 'acceptedAt', c.accepted_at) end,
    'monthCalls', (select count(*) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())),
    'monthSpendMicroUsd', (select coalesce(sum(cost_micro_usd), 0) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())),
    'reader', (select nullif(o.settings ->> 'ai_reader', '') from public.organizations o where o.id = v_org));
end $$;
revoke all on function public.core_ai_status() from public, anon;
grant execute on function public.core_ai_status() to authenticated;

-- @@STEP1@@

commit;

-- Verification (read-only).
select public.core__ai_notice_version() as notice_version;
select array(select field from public.core__provider_fields('anthropic')) as claude_fields;
select has_function_privilege('authenticated', 'public.ai__provider_state(uuid)', 'execute') as users_read_ai_state;
select has_function_privilege('authenticated', 'public.core_set_ai_reader(text)', 'execute') as users_choose_reader;
