-- sql/tests/049_telegram.sql
-- Telegram channel (sql/054). Always rolls back. Needs sql/001-054.
-- Covers: a link code is single-use, hashed, expires, and only the newest works; linking records a verified chat; one chat per person
-- per company; relinking replaces the old chat; a disabled member cannot link; routing copies only to people who linked, only chosen
-- kinds; the job finds the chat only while the person is active; the test message needs your own link; users cannot complete links
-- or read codes; other companies see nothing; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; c1 text; c2 text; r jsonb; n bigint; ok boolean; sid uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'tg-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'tg-a@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'tg-x@tests.invalid');
  o := public.bootstrap_organization('Telegram Test A', 'telegram-test-a', 'tg-o@tests.invalid');
  ob := public.bootstrap_organization('Telegram Test B', 'telegram-test-b', 'tg-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- L1: codes are single-use; only the newest works; stored hashed
  c1 := public.msg_telegram_link_start();
  c2 := public.msg_telegram_link_start();
  if c1 !~ '^[0-9a-f]{36}$' then raise exception 'FAIL L1a: code format %', c1; end if;
  ok := false; begin perform count(*) from public.msg_link_codes; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL L1b: users can read link codes'; end if;
  ok := false; begin perform public.msg__telegram_link_complete(c2, '12345'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL L1c: a user completed a link without Telegram'; end if;
  reset role;
  if exists (select 1 from public.msg_link_codes where code_hash = c2) then raise exception 'FAIL L1d: a code stored in plain text'; end if;
  r := public.msg__telegram_link_complete(c1, '12345');
  if (r ->> 'ok')::boolean then raise exception 'FAIL L1e: a replaced code still worked'; end if;
  r := public.msg__telegram_link_complete(c2, '12345');
  if not (r ->> 'ok')::boolean or r ->> 'org' <> 'Telegram Test A' then raise exception 'FAIL L1f: link failed %', r; end if;
  r := public.msg__telegram_link_complete(c2, '12345');
  if (r ->> 'ok')::boolean then raise exception 'FAIL L1g: a code worked twice'; end if;
  if not exists (select 1 from public.msg_identities where org_id = o and user_id = u and channel = 'telegram' and address = '12345' and status = 'verified') then
    raise exception 'FAIL L1h: no verified Telegram identity';
  end if;

  -- ---- L2: expiry; one chat per person; relinking replaces
  set local role authenticated;
  c1 := public.msg_telegram_link_start();
  reset role;
  update public.msg_link_codes set expires_at = now() - interval '1 second' where org_id = o and user_id = u and used_at is null;
  if (public.msg__telegram_link_complete(c1, '999') ->> 'reason') <> 'expired' then raise exception 'FAIL L2a: an expired code worked'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  c1 := public.msg_telegram_link_start();
  reset role;
  if (public.msg__telegram_link_complete(c1, '12345') ->> 'reason') <> 'taken' then raise exception 'FAIL L2b: two people linked one chat'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  c1 := public.msg_telegram_link_start();
  reset role;
  perform public.msg__telegram_link_complete(c1, '67890');
  select count(*) into n from public.msg_identities where org_id = o and user_id = u and channel = 'telegram' and status = 'verified';
  if n <> 1 or not exists (select 1 from public.msg_identities where org_id = o and user_id = u and channel = 'telegram' and status = 'verified' and address = '67890') then
    raise exception 'FAIL L2c: relinking did not replace the old chat';
  end if;
  ok := false; begin insert into public.msg_identities (org_id, user_id, channel, address, status) values (o, u, 'telegram', 'abc', 'pending'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL L2d: a non-numeric chat id accepted'; end if;

  -- ---- L3: a disabled member cannot link
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  c1 := public.msg_telegram_link_start();
  reset role;
  update public.memberships set disabled_at = now() where org_id = o and user_id = a;
  if (public.msg__telegram_link_complete(c1, '555') ->> 'reason') <> 'not_member' then raise exception 'FAIL L3: a disabled member linked'; end if;
  update public.memberships set disabled_at = null where org_id = o and user_id = a;

  -- ---- R1: routing only to people who linked, only chosen kinds; the job finds the chat
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.core_save_integration('telegram', true, 'live', array['approval_request']);
  reset role;
  perform public.msg__enqueue(o, u, 'approval_request', 'REQ-9 needs approval', 'b', null, null, 'tg:u');
  perform public.msg__enqueue(o, a, 'approval_request', 'REQ-9 needs approval', 'b', null, null, 'tg:a');   -- a never linked
  perform public.msg__enqueue(o, u, 'info', 'FYI', 'b', null, null, 'tg:info');
  select count(*) into n from public.msg_outbox where org_id = o and channel = 'telegram';
  if n <> 1 then raise exception 'FAIL R1a: % Telegram copies, expected 1', n; end if;
  select id into sid from public.msg_outbox where org_id = o and channel = 'telegram';
  if public.msg__recipient_telegram(sid) <> '67890' then raise exception 'FAIL R1b: the job cannot find the chat'; end if;
  update public.memberships set disabled_at = now() where org_id = o and user_id = u;
  if public.msg__recipient_telegram(sid) is not null then raise exception 'FAIL R1c: a disabled member still gets Telegram'; end if;
  update public.memberships set disabled_at = null where org_id = o and user_id = u;

  -- ---- T1: the test message needs your own link
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  reset role;
  update public.memberships set role = 'admin' where org_id = o and user_id = a;
  set local role authenticated;
  ok := false; begin perform public.core_test_integration('telegram'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T1: a test went to someone who never linked Telegram'; end if;

  -- ---- I1: another company sees nothing
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.msg_identities where org_id = o;
  if n <> 0 then raise exception 'FAIL I1: another company sees % identities', n; end if;
  reset role;

  if has_function_privilege('anon', 'public.msg_telegram_link_start()', 'execute')
     or has_function_privilege('authenticated', 'public.msg__recipient_telegram(uuid)', 'execute') then
    raise exception 'FAIL A1: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
