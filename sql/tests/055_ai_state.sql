-- sql/tests/055_ai_state.sql
-- AI provider state for the server (sql/060, consent rule changed by sql/061). Always rolls back. Needs sql/001-061.
-- Covers: nothing on by default; OpenAI and Ollama show on only while the CURRENT AI notice is accepted (withdrawal turns them off in
-- the state even if a row were left on); saved credentials reach the server only; users cannot call it.

do $$
declare
  u uuid := gen_random_uuid(); o uuid; s jsonb; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'ais-o@tests.invalid');
  o := public.bootstrap_organization('AI State Test', 'ai-state-test', 'ais-o@tests.invalid');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  s := public.ai__provider_state(o);
  if (s -> 'providers' -> 'openai' ->> 'enabled')::boolean or (s -> 'providers' -> 'ollama' ->> 'enabled')::boolean then raise exception 'FAIL A1: something is on by default: %', s; end if;

  set local role authenticated;
  perform public.core_save_provider_fields('ollama', '{"base_url": "https://ai.example.com", "model": "qwen2.5:7b", "api_key": "ollama-key-1"}');
  perform public.core_save_provider_fields('openai', '{"api_key": "sk-own-1", "model": "gpt-test"}');
  perform public.core_set_ai_consent(true);
  perform public.core_save_integration('ollama', true, 'live', null);
  perform public.core_save_integration('openai', true, 'simulated', null);
  ok := false; begin perform public.ai__provider_state(o); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL A2: a user read the AI state'; end if;
  reset role;

  s := public.ai__provider_state(o);
  if not (s ->> 'consent')::boolean or not (s -> 'providers' -> 'openai' ->> 'enabled')::boolean or not (s -> 'providers' -> 'openai' ->> 'simulated')::boolean then raise exception 'FAIL A3: openai state %', s; end if;
  if s -> 'providers' -> 'openai' -> 'credentials' ->> 'api_key' <> 'sk-own-1' or s -> 'providers' -> 'ollama' -> 'credentials' ->> 'base_url' <> 'https://ai.example.com' then raise exception 'FAIL A4: credentials %', s; end if;
  if (s -> 'providers' -> 'ollama' ->> 'simulated')::boolean then raise exception 'FAIL A5: ollama should be live'; end if;

  -- consent withdrawn: OpenAI and Ollama are off in the state even though their rows were left on
  update public.core_ai_consent set withdrawn_at = now() where org_id = o and withdrawn_at is null;
  s := public.ai__provider_state(o);
  if (s ->> 'consent')::boolean or (s -> 'providers' -> 'openai' ->> 'enabled')::boolean then raise exception 'FAIL A6: openai still on after withdrawal: %', s; end if;
  if (s -> 'providers' -> 'ollama' ->> 'enabled')::boolean then raise exception 'FAIL A7: ollama on without consent (sql/061)'; end if;

  if has_function_privilege('authenticated', 'public.ai__provider_state(uuid)', 'execute') or has_function_privilege('anon', 'public.ai__provider_state(uuid)', 'execute') then
    raise exception 'FAIL A8: the function is open';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
