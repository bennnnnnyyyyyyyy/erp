-- sql/061_ai_notice_version.sql
-- AI notice versioning and Ollama under the notice (repo audit 2026-11-06: finding 10, finding 11, N10). Rerun-safe. Needs sql/001-060.
--
-- * The current AI notice version lives here, in core__ai_notice_version() ('v2'); packages/shared AI_NOTICE_VERSION must match it.
--   Only consent to the current version counts. core_set_ai_consent refuses any other version (a Worker built for another notice
--   fails loudly instead of recording consent to text the owner never saw), keeps an existing consent to the same version, and
--   replaces a consent to an older version (old one withdrawn, both audited). Raising the version therefore switches AI off for every
--   company until its owner accepts again; the settings screen already asks for that when the versions differ.
-- * Ollama now needs the notice too. It was exempt as "the company's own AI", but the server only calls a public https host the company
--   typed, over the internet (aiProviders.ts assertSafeOllamaUrl), so company data does leave our servers. v2's text says so.
-- * Withdrawing consent switches OpenAI, ElevenLabs and Ollama off.
-- * The Ollama address must start with https:// when it is saved or changed. Existing rows are not touched, and a row with an old
--   address can still be switched off; the server refuses to call a non-https address anyway.
--
-- No data is changed by this migration: existing consent rows (all 'v1') simply stop counting, so AI is off until an owner re-accepts.

begin;

-- ---------------------------------------------------------------- the current notice

create or replace function public.core__ai_notice_version() returns text
language sql immutable as $$ select 'v2'::text $$;

-- True when the company's owner has accepted the CURRENT notice and not withdrawn it.
create or replace function public.core__ai_consent_current(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.core_ai_consent c
                  where c.org_id = p_org and c.withdrawn_at is null and c.notice_version = public.core__ai_notice_version());
$$;

-- ---------------------------------------------------------------- consent (owner only)

create or replace function public.core_set_ai_consent(p_accept boolean, p_notice_version text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner']);
  v_current text := public.core__ai_notice_version();
  v_version text := coalesce(p_notice_version, v_current);
  v_old public.core_ai_consent;
begin
  if p_accept is null or length(v_version) not between 1 and 20 then raise exception 'INVALID_INPUT'; end if;
  if p_accept then
    if v_version <> v_current then
      raise exception 'INVALID_INPUT' using detail = format('the current AI notice is %s; reload the page and read it again', v_current);
    end if;
    select * into v_old from public.core_ai_consent where org_id = v_org and withdrawn_at is null for update;
    if v_old.id is not null and v_old.notice_version = v_current then return; end if;   -- already accepted this version
    if v_old.id is not null then
      update public.core_ai_consent set withdrawn_by = auth.uid(), withdrawn_at = now() where id = v_old.id;
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
      values (v_org, auth.uid(), 'core.ai.consent_replaced', 'organization', v_org::text,
              format('AI data notice %s replaced by %s', v_old.notice_version, v_current));
    end if;
    insert into public.core_ai_consent (org_id, notice_version, accepted_by) values (v_org, v_current, auth.uid());
  else
    update public.core_ai_consent set withdrawn_by = auth.uid(), withdrawn_at = now() where org_id = v_org and withdrawn_at is null;
    update public.core_integrations set enabled = false, updated_by = auth.uid()
     where org_id = v_org and kind in ('openai', 'elevenlabs', 'ollama') and enabled;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when p_accept then 'core.ai.consent_given' else 'core.ai.consent_withdrawn' end, 'organization', v_org::text,
          case when p_accept then format('AI data notice %s accepted: company data may be sent to outside AI providers', v_current)
               else 'AI data notice withdrawn: AI providers switched off' end);
end $$;

-- ---------------------------------------------------------------- switching a provider on (sql/056's function; AI rule changed)

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
  -- 061: every AI provider, Ollama included, needs the owner's acceptance of the CURRENT notice.
  if p_kind in ('openai', 'elevenlabs', 'ollama') and p_enabled and not public.core__ai_consent_current(v_org) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the current AI data notice first';
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

-- ---------------------------------------------------------------- the server's view (sql/060's function; consent rule changed)

create or replace function public.ai__provider_state(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_consent boolean := public.core__ai_consent_current(p_org); r jsonb := '{}'::jsonb; k text; i public.core_integrations;
begin
  foreach k in array array['openai', 'elevenlabs', 'ollama'] loop
    select * into i from public.core_integrations where org_id = p_org and kind = k;
    r := r || jsonb_build_object(k, jsonb_build_object(
      'enabled', coalesce(i.enabled, false) and v_consent,
      'simulated', coalesce(i.mode, 'simulated') = 'simulated',
      'credentials', case when i.id is null then '{}'::jsonb else public.core__provider_credentials(p_org, k) end));
  end loop;
  return jsonb_build_object('consent', v_consent, 'providers', r);
end $$;

-- ---------------------------------------------------------------- Ollama address: https only (when saved or changed)

create or replace function public.core__check_ollama_url() returns trigger
language plpgsql set search_path = public as $$
declare v_new text := new.settings -> 'config' ->> 'base_url';
begin
  if new.kind = 'ollama' and v_new is not null
     and (tg_op = 'INSERT' or v_new is distinct from (old.settings -> 'config' ->> 'base_url'))
     and v_new !~ '^https://[^\s/]+' then
    raise exception 'INVALID_INPUT' using detail = 'the Ollama address must start with https://';
  end if;
  return new;
end $$;

drop trigger if exists core_integrations_ollama_url on public.core_integrations;
create trigger core_integrations_ollama_url before insert or update on public.core_integrations
  for each row execute function public.core__check_ollama_url();

-- ---------------------------------------------------------------- privileges

revoke all on function public.core__ai_consent_current(uuid), public.core__check_ollama_url() from public, anon, authenticated;
revoke all on function public.ai__provider_state(uuid) from public, anon, authenticated;
grant execute on function public.ai__provider_state(uuid) to service_role;
revoke all on function public.core_set_ai_consent(boolean, text), public.core_save_integration(text, boolean, text, text[]) from public, anon;
grant execute on function public.core_set_ai_consent(boolean, text), public.core_save_integration(text, boolean, text, text[]) to authenticated;

commit;

-- Verification (read-only).
select public.core__ai_notice_version() as current_notice;
select notice_version, count(*) as active_consents from public.core_ai_consent where withdrawn_at is null group by 1 order by 1;
select count(*) filter (where kind = 'ollama' and enabled) as ollama_on,
       count(*) filter (where kind = 'ollama' and coalesce(settings -> 'config' ->> 'base_url', '') !~ '^https://') as ollama_non_https
  from public.core_integrations;
select has_function_privilege('authenticated', 'public.core__ai_consent_current(uuid)', 'execute') as users_check_consent,
       has_function_privilege('authenticated', 'public.ai__provider_state(uuid)', 'execute') as users_read_state,
       has_function_privilege('anon', 'public.core_set_ai_consent(boolean, text)', 'execute') as anon_consents;
