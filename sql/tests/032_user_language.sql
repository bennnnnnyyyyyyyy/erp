-- sql/tests/032_user_language.sql
-- A person's language saved on the account. Always rolls back. Needs sql/001 and sql/038.
-- Covers: saving, changing and clearing, validation, a person seeing only their own row, no direct writes, no anonymous use,
-- no sign-in no save.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  s text; n bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'ul-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'ul-b@tests.invalid');

  -- ---- S1: a person saves, changes and clears their language
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.user_preferences;
  if n <> 0 then raise exception 'FAIL S1a: % preference row(s) before anyone saved one', n; end if;
  perform public.core_set_my_language('ar');
  select language into s from public.user_preferences where user_id = ua;
  if s is distinct from 'ar' then raise exception 'FAIL S1b: language is %, expected ar', s; end if;
  perform public.core_set_my_language('en');
  perform public.core_set_my_language('en');   -- saving the same value again is fine
  select language into s from public.user_preferences where user_id = ua;
  if s is distinct from 'en' then raise exception 'FAIL S1c: language is %, expected en', s; end if;
  perform public.core_set_my_language(null);   -- clear: follow the company default
  select count(*), max(language) into n, s from public.user_preferences where user_id = ua;
  if n <> 1 or s is not null then raise exception 'FAIL S1d: after clearing there are % row(s) with language %, expected 1 row with none', n, s; end if;
  perform public.core_set_my_language();       -- the argument defaults to null
  perform public.core_set_my_language('ar');

  -- ---- S2: validation
  ok := false; begin perform public.core_set_my_language('fr'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2a: an unsupported language was accepted'; end if;
  ok := false; begin perform public.core_set_my_language(''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2b: an empty language was accepted'; end if;
  select language into s from public.user_preferences where user_id = ua;
  if s is distinct from 'ar' then raise exception 'FAIL S2c: a refused change altered the saved language to %', s; end if;

  -- ---- S3: nobody else sees it, and each person has their own
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from public.user_preferences;
  if n <> 0 then raise exception 'FAIL S3a: another person can read % preference row(s)', n; end if;
  perform public.core_set_my_language('en');
  select count(*), max(language) into n, s from public.user_preferences;
  if n <> 1 or s <> 'en' then raise exception 'FAIL S3b: person B sees % row(s) with language %, expected only their own (en)', n, s; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select count(*), max(language) into n, s from public.user_preferences;
  if n <> 1 or s <> 'ar' then raise exception 'FAIL S3c: person A sees % row(s) with language %, expected only their own (ar)', n, s; end if;

  -- ---- S4: no direct writes, no anonymous use, no sign-in no save
  ok := false; begin insert into public.user_preferences (user_id, language) values (ub, 'ar'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S4a: a direct insert into user_preferences was allowed'; end if;
  ok := false; begin update public.user_preferences set language = 'en'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S4b: a direct update of user_preferences was allowed'; end if;
  reset role;
  if has_function_privilege('anon', 'public.core_set_my_language(text)', 'execute') then raise exception 'FAIL S4c: the anonymous role can run core_set_my_language'; end if;
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  ok := false; begin perform public.core_set_my_language('ar'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S4d: a call with no signed-in person saved a language'; end if;

  reset role;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
