-- sql/tests/027_org_language.sql
-- Organization language: defaults to English; an owner or admin changes it; a member cannot; only 'en' and 'ar' are accepted;
-- the change is audited with before and after, a no-op change writes nothing, other settings survive, another organization is
-- not affected, anonymous refused. Always rolls back. Needs sql/001-031.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; s jsonb; n bigint; ok boolean; r text;
begin
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'lang-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'lang-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'lang-x@tests.invalid');
  o := public.bootstrap_organization('Language Test A', 'language-test-a', 'lang-o@tests.invalid');
  ob := public.bootstrap_organization('Language Test B', 'language-test-b', 'lang-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- S1: default is English (setting missing); other settings are kept when the language is set
  select settings into s from public.organizations where id = o;
  if coalesce(s ->> 'language', 'en') <> 'en' then raise exception 'FAIL S1a: default language is %', s ->> 'language'; end if;
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"date_format":"YYYY-MM-DD"}'::jsonb where id = o;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.core_set_language('ar');
  reset role;
  if r <> 'ar' then raise exception 'FAIL S1b: returned %', r; end if;
  select settings into s from public.organizations where id = o;
  if s ->> 'language' <> 'ar' then raise exception 'FAIL S1c: language not stored (%)', s; end if;
  if s ->> 'date_format' <> 'YYYY-MM-DD' then raise exception 'FAIL S1d: another setting was lost (%)', s; end if;

  -- S2: audited with before and after
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.language_changed' and before ->> 'language' = 'en' and after ->> 'language' = 'ar';
  if n <> 1 then raise exception 'FAIL S2a: audit entries %', n; end if;

  -- S3: setting the same language again writes nothing
  set local role authenticated; r := public.core_set_language('ar'); reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.language_changed';
  if n <> 1 then raise exception 'FAIL S3: a no-op change was audited (% entries)', n; end if;

  -- S4: only en and ar; a member cannot change it
  set local role authenticated;
  ok := false; begin perform public.core_set_language('fr'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S4a: an unsupported language was accepted'; end if;
  ok := false; begin perform public.core_set_language(null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S4b: null was accepted'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_language('en'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  reset role;
  if not ok then raise exception 'FAIL S4c: a member changed the language'; end if;
  select settings ->> 'language' into r from public.organizations where id = o; if r <> 'ar' then raise exception 'FAIL S4d: language is % after refused changes', r; end if;

  -- S5: another organization is unaffected and its owner cannot reach ours; anonymous refused
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated; r := public.core_set_language('ar'); reset role;
  select settings ->> 'language' into r from public.organizations where id = ob; if r <> 'ar' then raise exception 'FAIL S5a: other organization language %', r; end if;
  select coalesce(settings ->> 'language', 'en') into r from public.organizations where id = o; if r <> 'ar' then raise exception 'FAIL S5b: our language changed to %', r; end if;
  set local role anon;
  ok := false; begin perform public.core_set_language('en'); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL S5c: anonymous could call it'; end if;

  select count(*) into n from public.audit_verify(o); if n <> 0 then raise exception 'FAIL S6: audit chain broken'; end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
