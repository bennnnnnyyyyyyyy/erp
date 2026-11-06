-- sql/060_ai_state.sql
-- AI and voice (documentation/planning/INTEGRATION_PROVIDER_CHOICES.md; Ben: USD 100 a month, customer consent, Ollama as the own-AI
-- alternative). Rerun-safe. Needs sql/001-059 (really 056).
--
-- One service-role function: ai__provider_state(org) tells the server, for one company, whether the AI notice is currently accepted and
-- which of openai / elevenlabs / ollama are switched on (mode, settings and saved credentials). The server picks the provider, checks
-- the monthly caps with ai__month_spend, makes the call and records it with ai__record_usage (all from sql/056).
-- Consent is checked here as well as when switching a provider on: if it was withdrawn, OpenAI and ElevenLabs show as off.

begin;

create or replace function public.ai__provider_state(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_consent boolean; r jsonb := '{}'::jsonb; k text; i public.core_integrations;
begin
  select exists (select 1 from public.core_ai_consent where org_id = p_org and withdrawn_at is null) into v_consent;
  foreach k in array array['openai', 'elevenlabs', 'ollama'] loop
    select * into i from public.core_integrations where org_id = p_org and kind = k;
    r := r || jsonb_build_object(k, jsonb_build_object(
      'enabled', coalesce(i.enabled, false) and (k = 'ollama' or v_consent),
      'simulated', coalesce(i.mode, 'simulated') = 'simulated',
      'credentials', case when i.id is null then '{}'::jsonb else public.core__provider_credentials(p_org, k) end));
  end loop;
  return jsonb_build_object('consent', v_consent, 'providers', r);
end $$;

revoke all on function public.ai__provider_state(uuid) from public, anon, authenticated;
grant execute on function public.ai__provider_state(uuid) to service_role;

commit;

-- Verification (read-only).
select has_function_privilege('authenticated', 'public.ai__provider_state(uuid)', 'execute') as users_read_state;
