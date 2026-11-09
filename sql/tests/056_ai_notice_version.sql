-- sql/tests/056_ai_notice_version.sql
-- AI notice versioning and the Ollama address rule (sql/061). Always rolls back. Needs sql/001-061.
-- Covers: consent to an older notice does not count; accepting the current notice replaces it (old withdrawn, both audited); accepting
-- the same version twice keeps one row; a request for any other version is refused; an http Ollama address is refused when saved or
-- changed, but a row holding an old address can still be switched off.

do $$
declare
  u uuid := gen_random_uuid(); o uuid; ok boolean; n int; cur text := public.core__ai_notice_version();
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'anv-o@tests.invalid');
  o := public.bootstrap_organization('AI Notice Test', 'ai-notice-test', 'anv-o@tests.invalid');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  if cur is null or cur = 'v1' then raise exception 'FAIL V0: current notice is %', cur; end if;

  -- An owner who accepted the old notice (v1), before this migration.
  insert into public.core_ai_consent (org_id, notice_version, accepted_by) values (o, 'v1', u);
  if public.core__ai_consent_current(o) then raise exception 'FAIL V1: consent to v1 counts as current'; end if;
  if (public.ai__provider_state(o) ->> 'consent')::boolean then raise exception 'FAIL V2: the server sees v1 consent as current'; end if;

  set local role authenticated;
  ok := false; begin perform public.core_save_integration('openai', true, 'simulated', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL V3: OpenAI switched on with only v1 consent'; end if;

  ok := false; begin perform public.core_set_ai_consent(true, 'v1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL V4: consent to an old notice version accepted'; end if;

  perform public.core_set_ai_consent(true, cur);
  perform public.core_set_ai_consent(true);   -- same version again: no second row
  reset role;
  select count(*) into n from public.core_ai_consent where org_id = o and withdrawn_at is null;
  if n <> 1 then raise exception 'FAIL V5: % active consents', n; end if;
  if (select notice_version from public.core_ai_consent where org_id = o and withdrawn_at is null) <> cur then raise exception 'FAIL V6: active consent is not current'; end if;
  if not exists (select 1 from public.core_ai_consent where org_id = o and notice_version = 'v1' and withdrawn_at is not null) then
    raise exception 'FAIL V7: the v1 consent was not withdrawn';
  end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'core.ai.consent_replaced') then raise exception 'FAIL V8: replacement not audited'; end if;
  if not public.core__ai_consent_current(o) then raise exception 'FAIL V9: current consent not seen'; end if;

  -- Ollama address
  set local role authenticated;
  ok := false; begin perform public.core_save_provider_fields('ollama', '{"base_url": "http://ai.example.com", "model": "m"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL U1: an http Ollama address saved'; end if;
  ok := false; begin perform public.core_save_provider_fields('ollama', '{"base_url": "https://", "model": "m"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL U1b: an Ollama address with no host saved'; end if;
  perform public.core_save_provider_fields('ollama', '{"base_url": "https://server.example.com", "model": "m"}');   -- a host starting with s (reviewer's 9 Nov question)
  perform public.core_save_provider_fields('ollama', '{"base_url": "https://ai.example.com", "model": "m"}');
  perform public.core_save_integration('ollama', true, 'live', null);
  reset role;
  -- A row saved before 061 with an http address can still be switched off.
  alter table public.core_integrations disable trigger core_integrations_ollama_url;
  update public.core_integrations set settings = jsonb_set(settings, '{config,base_url}', '"http://old.example.com"') where org_id = o and kind = 'ollama';
  alter table public.core_integrations enable trigger core_integrations_ollama_url;
  set local role authenticated;
  perform public.core_save_integration('ollama', false, 'live', null);
  reset role;
  if (select enabled from public.core_integrations where org_id = o and kind = 'ollama') then raise exception 'FAIL U2: could not switch off an old http row'; end if;

  if has_function_privilege('authenticated', 'public.core__ai_consent_current(uuid)', 'execute') then raise exception 'FAIL P1: consent check open to users'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
