-- sql/tests/051_provider_connections.sql
-- Provider connections and AI rules (sql/056). Always rolls back. Needs sql/001-056.
-- Covers: fields saved per provider (secret ones to Vault, plain ones to settings), unknown providers and fields refused, a field
-- replaced or removed on its own, secrets never readable by users nor in the audit log, live refused until required fields exist,
-- OpenAI and ElevenLabs refused until the owner accepts the AI notice, only the owner gives or withdraws consent, withdrawing switches
-- them off, usage logged and summed per month for the caps, members and other companies see nothing, no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; r jsonb; ok boolean; n bigint; v jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'pc-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'pc-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'pc-x@tests.invalid');
  o := public.bootstrap_organization('Providers Test A', 'providers-test-a', 'pc-o@tests.invalid');
  ob := public.bootstrap_organization('Providers Test B', 'providers-test-b', 'pc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- F1: saving fields
  ok := false; begin perform public.core_save_provider_fields('stripe', '{}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL F1a: unknown provider accepted'; end if;
  ok := false; begin perform public.core_save_provider_fields('paymob', '{"password": "x"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL F1b: unknown field accepted'; end if;
  r := public.core_save_provider_fields('paymob', '{"secret_key": "sk_test_AAA", "hmac_secret": "HMAC-111", "integration_ids": "4001,4002"}');
  if not (r -> 'savedFields') ? 'secret_key' or not (r -> 'savedFields') ? 'integration_ids' then raise exception 'FAIL F1c: saved fields %', r; end if;
  ok := false; begin perform public.core_save_integration('paymob', true, 'live', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL F1d: live without the public key'; end if;
  perform public.core_save_provider_fields('paymob', '{"public_key": "pk_test_BBB", "hmac_secret": "HMAC-222"}');
  perform public.core_save_integration('paymob', true, 'live', null);
  ok := false; begin perform public.core_save_provider_fields('shopify', '{"shop_domain": "evil.com"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL F1e: a bad shop domain accepted'; end if;

  -- ---- S1: secrets stay secret
  ok := false; begin perform public.core__provider_credentials(o, 'paymob'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S1a: a user read credentials'; end if;
  if (select settings -> 'config' ->> 'integration_ids' from public.core_integrations where org_id = o and kind = 'paymob') <> '4001,4002' then
    raise exception 'FAIL S1b: the plain setting is not readable';
  end if;
  if (select settings::text from public.core_integrations where org_id = o and kind = 'paymob') like '%sk_test%' then raise exception 'FAIL S1c: a secret in settings'; end if;
  reset role;
  v := public.core__provider_credentials(o, 'paymob');
  if v ->> 'secret_key' <> 'sk_test_AAA' or v ->> 'hmac_secret' <> 'HMAC-222' or v ->> 'integration_ids' <> '4001,4002' then raise exception 'FAIL S1d: the job reads %', v; end if;
  if exists (select 1 from public.audit_log where org_id = o and (summary like '%sk_test%' or coalesce(after::text, '') like '%HMAC-%')) then
    raise exception 'FAIL S1e: a secret in the audit log';
  end if;
  set local role authenticated;
  perform public.core_save_provider_fields('paymob', '{"secret_key": ""}');   -- remove one field
  reset role;
  if public.core__provider_credentials(o, 'paymob') ? 'secret_key' then raise exception 'FAIL S1f: a removed field is still there'; end if;
  set local role authenticated;

  -- ---- AI1: consent
  ok := false; begin perform public.core_save_integration('openai', true, 'simulated', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL AI1a: OpenAI switched on without consent'; end if;
  perform public.core_save_integration('ollama', true, 'simulated', null);   -- local AI needs no consent
  ok := false; begin perform public.core_set_ai_consent(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL AI1b: an admin gave the AI consent'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.core_set_ai_consent(true);
  perform public.core_save_integration('openai', true, 'simulated', null);
  perform public.core_set_ai_consent(false);
  if (select enabled from public.core_integrations where org_id = o and kind = 'openai') then raise exception 'FAIL AI1c: OpenAI still on after withdrawal'; end if;
  if not (select enabled from public.core_integrations where org_id = o and kind = 'ollama') then raise exception 'FAIL AI1d: withdrawal switched Ollama off'; end if;

  -- ---- AI2: usage and caps
  reset role;
  perform public.ai__record_usage(o, u, 'openai', 'assistant', 'gpt-5-nano', 1000, 200, 0, 1500, false, true);
  perform public.ai__record_usage(o, u, 'openai', 'assistant', 'gpt-5-nano', 1000, 200, 0, 2500, true, true);   -- the company's own key
  perform public.ai__record_usage(ob, x, 'elevenlabs', 'transcribe', null, 0, 0, 60, 3700, false, true);
  if public.ai__month_spend(o) <> 1500 then raise exception 'FAIL AI2a: company spend %', public.ai__month_spend(o); end if;
  if public.ai__month_spend(null) < 5200 then raise exception 'FAIL AI2b: total spend %', public.ai__month_spend(null); end if;
  set local role authenticated;
  if (public.core_ai_status() ->> 'monthCalls')::int <> 2 then raise exception 'FAIL AI2c: status %', public.core_ai_status(); end if;
  ok := false; begin insert into public.ai_usage (org_id, provider, feature) values (o, 'openai', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL AI2d: direct insert into the usage log'; end if;

  -- ---- I1: other companies
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ai_usage where org_id = o;
  if n <> 0 then raise exception 'FAIL I1a: another company sees % usage rows', n; end if;
  select count(*) into n from public.core_integrations where org_id = o;
  if n <> 0 then raise exception 'FAIL I1b: another company sees % integrations', n; end if;
  reset role;

  if has_function_privilege('anon', 'public.core_save_provider_fields(text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.ai__record_usage(uuid, uuid, text, text, text, int, int, numeric, bigint, boolean, boolean)', 'execute') then
    raise exception 'FAIL A1: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
