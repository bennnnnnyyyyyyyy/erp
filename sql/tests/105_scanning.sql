-- sql/tests/105_scanning.sql
-- sql/108: scanning (phase 1d). Always rolls back. Needs sql/001-108.
-- Covers: A1 the four new AI kinds save their key (write-only, in the vault) and need the current notice (v3) to switch on; A2 the
-- reader choice: owners and admins only, only kinds that read documents, audited; A3 ai__provider_state shows all seven kinds and the
-- reader, service role only; A4 usage can be recorded for the new kinds; A5 another company cannot see or change it.
-- @@MORE@@

do $$
declare
  u uuid := gen_random_uuid();  -- owner of A
  a uuid := gen_random_uuid();  -- admin of A
  m uuid := gen_random_uuid();  -- member of A
  x uuid := gen_random_uuid();  -- owner of B
  o uuid; ob uuid;
  n bigint; ok boolean; j jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'sc-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'sc-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'sc-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'sc-x@tests.invalid');
  o := public.bootstrap_organization('Scanning A', 'scanning-a', 'sc-o@tests.invalid');
  ob := public.bootstrap_organization('Scanning B', 'scanning-b', 'sc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- ---- A1: new AI kinds
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.core__ai_notice_version() <> 'v3' then raise exception 'FAIL A1a: the notice is not v3'; end if;
  j := public.core_save_provider_fields('anthropic', '{"api_key": "sk-ant-TEST-111", "model": "claude-haiku-5-5"}');
  if not (j -> 'savedFields') ? 'api_key' then raise exception 'FAIL A1b: the Claude key was not saved'; end if;
  perform public.core_save_provider_fields('grok', '{"api_key": "xai-TEST-222"}');
  ok := false; begin perform public.core_save_integration('grok', true, 'live', '{}'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL A1c: Grok switched on without its model'; end if;
  ok := false; begin perform public.core_save_integration('anthropic', true, 'live', '{}'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL A1d: Claude switched on without the AI notice'; end if;
  ok := false; begin perform public.core_set_ai_consent(true, 'v2'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL A1e: consent to the old notice v2 accepted'; end if;
  perform public.core_set_ai_consent(true, 'v3');
  perform public.core_save_integration('anthropic', true, 'live', '{}');
  -- the key is not readable by users: settings show field names only
  select count(*) into n from public.core_integrations where org_id = o and kind = 'anthropic' and settings::text like '%sk-ant-TEST%';
  if n <> 0 then raise exception 'FAIL A1f: the key is readable in settings'; end if;

  -- ---- A2: the reader choice
  ok := false; begin perform public.core_set_ai_reader('elevenlabs'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL A2a: ElevenLabs chosen to read bills'; end if;
  perform public.core_set_ai_reader('anthropic');
  if (public.core_ai_status() ->> 'reader') is distinct from 'anthropic' then raise exception 'FAIL A2b: the reader is not shown'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.core_set_ai_reader('gemini');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_ai_reader('openai'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL A2c: a member chose the reader'; end if;
  ok := false; begin perform public.ai__provider_state(o); exception when others then ok := (sqlstate = '42501'); end;
  if not ok then raise exception 'FAIL A3a: a user read the AI state (keys)'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'core.ai.reader_changed';
  if n <> 2 then raise exception 'FAIL A2d: reader changes not audited (% rows)', n; end if;

  -- ---- A3: the server's view
  j := public.ai__provider_state(o);
  if (j ->> 'reader') is distinct from 'gemini' then raise exception 'FAIL A3b: reader %', j ->> 'reader'; end if;
  if not ((j -> 'providers') ?& array['openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter']) then
    raise exception 'FAIL A3c: kinds missing from the state';
  end if;
  if (j -> 'providers' -> 'anthropic' ->> 'enabled')::boolean is not true or (j -> 'providers' -> 'anthropic' -> 'credentials' ->> 'api_key') <> 'sk-ant-TEST-111' then
    raise exception 'FAIL A3d: Claude state %', j -> 'providers' -> 'anthropic';
  end if;

  -- ---- A4: usage for a new kind
  perform public.ai__record_usage(o, u, 'anthropic', 'bill_scan', 'claude-haiku-5-5', 900, 40, 0, 0, true, true);

  -- ---- A5: company B sees none of it
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.core_integrations where org_id = o;
  if n <> 0 then raise exception 'FAIL A5a: B sees A''s integrations'; end if;
  if (public.core_ai_status() ->> 'reader') is not null then raise exception 'FAIL A5b: B has A''s reader'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- @@MORE_BODY@@

  -- ---- Z: audit chain
  select count(*) into n from public.audit_verify(o);
  if n <> 0 then raise exception 'FAIL Z: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
