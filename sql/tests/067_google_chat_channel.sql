-- sql/tests/067_google_chat_channel.sql
-- Google Chat alert channel (sql/071). Always rolls back. Needs sql/001-071.
-- Covers: URL rules (must start with https://chat.googleapis.com/v1/spaces/; other hosts refused); live needs a saved URL; the URL is in
-- Vault and never readable by users (column, function) nor in the audit log; routing makes one company-wide post without a recipient;
-- delivery result recorded on the integration; test message; clearing removes the secret; members, other organizations and anonymous
-- users cannot read or use the channel.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; n bigint; ok boolean; v text; sid uuid; rec record;
  gurl text := 'https://chat.googleapis.com/v1/spaces/AAAAxyz/messages?key=KEYKEYKEY&token=TOKENTOKEN';
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'gc-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'gc-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'gc-x@tests.invalid');
  o := public.bootstrap_organization('Google Chat Test A', 'google-chat-test-a', 'gc-o@tests.invalid');
  ob := public.bootstrap_organization('Google Chat Test B', 'google-chat-test-b', 'gc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- G1: URL rules; live needs a URL
  ok := false; begin perform public.core_save_integration('google_chat', true, 'live', array['alert']); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL G1a: live Google Chat without a webhook URL'; end if;
  ok := false; begin perform public.core_set_integration_secret('google_chat', 'https://evil.example.com/v1/spaces/AAAA/messages?key=1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1b: a non-Google URL accepted'; end if;
  ok := false; begin perform public.core_set_integration_secret('google_chat', 'https://chat.googleapis.com/v1/other/AAAA/messages?key=1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1c: a Google URL outside /v1/spaces/ accepted'; end if;
  ok := false; begin perform public.core_set_integration_secret('google_chat', 'http://chat.googleapis.com/v1/spaces/AAAA/messages?key=1'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1d: a plain http URL accepted'; end if;
  ok := false; begin perform public.core_set_integration_secret('google_chat', 'https://chat.googleapis.com.evil.example/v1/spaces/AAAA/m'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1e: a look-alike host accepted'; end if;
  ok := false; begin perform public.core_set_integration_secret('slack', gurl); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL G1f: Slack accepted a Google Chat URL'; end if;
  v := public.core_set_integration_secret('google_chat', gurl);
  if v <> '…' || right(gurl, 6) then raise exception 'FAIL G1g: hint %', v; end if;
  perform public.core_save_integration('google_chat', true, 'live', array['approval_request', 'alert']);

  -- ---- S1: the URL is in Vault; users cannot read it or its id
  ok := false; begin select secret_id into sid from public.core_integrations where org_id = o and kind = 'google_chat'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S1a: a user read the secret id'; end if;
  ok := false; begin perform public.core__integration_secret(o, 'google_chat'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL S1b: a user read the secret through the internal function'; end if;
  select count(*) into n from public.core_integrations where org_id = o and kind = 'google_chat' and secret_hint = v;
  if n <> 1 then raise exception 'FAIL S1c: the hint is not shown'; end if;
  reset role;
  if public.core__integration_secret(o, 'google_chat') <> gurl then raise exception 'FAIL S1d: the job cannot read the stored URL'; end if;
  if exists (select 1 from public.core_integrations where org_id = o and kind = 'google_chat' and (secret_hint = gurl or settings::text like '%KEYKEYKEY%')) then
    raise exception 'FAIL S1e: the URL is in a plain column';
  end if;
  if exists (select 1 from public.audit_log where org_id = o and (summary like '%KEYKEYKEY%' or after::text like '%KEYKEYKEY%' or before::text like '%KEYKEYKEY%')) then
    raise exception 'FAIL S1f: the webhook URL leaked into the audit log';
  end if;

  -- ---- R1: routing. An approval request to two people: ONE Google Chat post, no recipient. An unchosen kind is not copied.
  perform public.msg__enqueue(o, u, 'approval_request', 'REQ-9 needs approval', 'body', 'stock_request', null, 'gc1:u');
  perform public.msg__enqueue(o, m, 'approval_request', 'REQ-9 needs approval', 'body', 'stock_request', null, 'gc1:m');
  perform public.msg__enqueue(o, u, 'info', 'FYI', 'body', null, null, 'gc2:u');
  select count(*) into n from public.msg_outbox where org_id = o and channel = 'google_chat';
  if n <> 1 then raise exception 'FAIL R1a: % Google Chat posts, expected 1', n; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and channel = 'google_chat' and (recipient_id is not null or kind = 'info')) then
    raise exception 'FAIL R1b: a channel post has a recipient, or an unchosen kind was copied';
  end if;

  -- ---- D1: delivery result recorded on the message and the integration
  select id into sid from public.msg_outbox where org_id = o and channel = 'google_chat';
  update public.msg_outbox set status = 'sending', attempts = 1 where id = sid;
  perform public.msg_complete_delivery(sid, false, 'Google Chat returned 404', 'google_chat-webhook');
  select last_status, last_error into rec from public.core_integrations where org_id = o and kind = 'google_chat';
  if rec.last_status <> 'failed' or rec.last_error <> 'Google Chat returned 404' then raise exception 'FAIL D1a: integration shows %', row_to_json(rec); end if;
  if (select delivered_via from public.msg_outbox where id = sid) <> 'google_chat-webhook' then raise exception 'FAIL D1b: delivered_via not set'; end if;
  if has_function_privilege('authenticated', 'public.msg_complete_delivery(uuid, boolean, text, text)', 'execute') then raise exception 'FAIL D1c: users complete deliveries'; end if;

  -- ---- T1: a test message goes to the company channel (no recipient); clearing removes the secret
  set local role authenticated;
  sid := public.core_test_integration('google_chat');
  reset role;
  if (select recipient_id from public.msg_outbox where id = sid) is not null or (select channel from public.msg_outbox where id = sid) <> 'google_chat' then
    raise exception 'FAIL T1a: the test message is not a company channel post';
  end if;
  select secret_id into sid from public.core_integrations where org_id = o and kind = 'google_chat';
  set local role authenticated;
  perform public.core_clear_integration_secret('google_chat');
  reset role;
  if exists (select 1 from vault.secrets where id = sid) then raise exception 'FAIL T1b: the secret is still in Vault'; end if;
  select mode, enabled into rec from public.core_integrations where org_id = o and kind = 'google_chat';
  if rec.mode <> 'live' or rec.enabled then raise exception 'FAIL T1c: still on after clearing (or not live)'; end if;

  -- ---- P1: members and other organizations (the URL is saved again first, as the owner)
  set local role authenticated;
  perform public.core_set_integration_secret('google_chat', gurl);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_save_integration('google_chat', false, 'live', null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1a: a member changed the channel'; end if;
  ok := false; begin perform public.core_set_integration_secret('google_chat', gurl); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1b: a member saved a URL'; end if;
  select count(*) into n from public.core_integrations where kind = 'google_chat';
  if n <> 0 then raise exception 'FAIL P1c: a member sees % integrations', n; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.core_integrations where org_id = o;
  if n <> 0 then raise exception 'FAIL P1d: another organization sees % integrations', n; end if;
  ok := false; begin perform public.core_test_integration('google_chat'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P1e: another organization used the channel'; end if;
  perform public.core_clear_integration_secret('google_chat');   -- its own (absent) channel: a no-op, never ours
  reset role;
  if public.core__integration_secret(o, 'google_chat') <> gurl then raise exception 'FAIL P1f: another organization removed our URL'; end if;
  if public.core__integration_secret(ob, 'google_chat') is not null then raise exception 'FAIL P1g: the other organization has a URL it never saved'; end if;

  -- ---- A1: anonymous users can call nothing
  if has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute')
     or has_function_privilege('anon', 'public.core_save_integration(text, boolean, text, text[])', 'execute')
     or has_function_privilege('anon', 'public.core_test_integration(text)', 'execute')
     or has_function_privilege('anon', 'public.core_clear_integration_secret(text)', 'execute')
     or has_function_privilege('anon', 'public.core__integration_secret(uuid, text)', 'execute')
     or has_table_privilege('anon', 'public.core_integrations', 'select') then
    raise exception 'FAIL A1: something is open to anonymous users';
  end if;
  set local role anon;
  ok := false; begin perform public.core_save_integration('google_chat', true, 'live', null); exception when others then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL A2: an anonymous user saved an integration'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
