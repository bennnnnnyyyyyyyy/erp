-- sql/tests/012_org_people.sql
-- X7: any member sees names of their own organization's active members, and nothing else: no email, no other organization,
-- no disabled people, not callable without an organization or by anonymous. Always rolls back. Needs sql/001-016.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner of A, has a full name
  ub uuid := gen_random_uuid();  -- member of A, no name (falls back to email prefix)
  ud uuid := gen_random_uuid();  -- disabled member of A
  uo uuid := gen_random_uuid();  -- owner of B
  oa uuid; ob uuid;
  n int; nm text;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (ua, 'authenticated', 'authenticated', 'ppl-a@tests.invalid', '{"full_name":"Alice Aardvark"}'::jsonb),
    (ub, 'authenticated', 'authenticated', 'ppl-b@tests.invalid', '{}'::jsonb),
    (ud, 'authenticated', 'authenticated', 'ppl-d@tests.invalid', '{}'::jsonb),
    (uo, 'authenticated', 'authenticated', 'ppl-o@tests.invalid', '{}'::jsonb);
  oa := public.bootstrap_organization('People Test A', 'ppl-test-a', 'ppl-a@tests.invalid');
  ob := public.bootstrap_organization('People Test B', 'ppl-test-b', 'ppl-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'member');
  insert into public.memberships (org_id, user_id, role, disabled_at) values (oa, ud, 'member', now());

  -- ---- S1: a plain member sees the two active people of their own organization, by name
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  select count(*) into n from public.core_org_people();
  if n <> 2 then raise exception 'FAIL S1a: expected 2 people, got %', n; end if;
  select name into nm from public.core_org_people() where user_id = ua;
  if nm is distinct from 'Alice Aardvark' then raise exception 'FAIL S1b: full name not used (got %)', nm; end if;
  select name into nm from public.core_org_people() where user_id = ub;
  if nm is distinct from 'ppl-b' then raise exception 'FAIL S1c: email prefix fallback not used (got %)', nm; end if;
  select count(*) into n from public.core_org_people() where user_id = ud;
  if n <> 0 then raise exception 'FAIL S1d: a disabled member was listed'; end if;
  select count(*) into n from public.core_org_people() where user_id = uo;
  if n <> 0 then raise exception 'FAIL S1e: a person of another organization was listed'; end if;
  reset role;

  -- ---- S2: asking for another organization is refused
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  ok := false;
  begin perform * from public.core_org_people(); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL S2a: listed people of an organization the caller is not in'; end if;
  reset role;

  -- ---- S3: no organization header is refused; anonymous cannot call it
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  ok := false;
  begin perform * from public.core_org_people(); exception when others then ok := (sqlerrm = 'ORG_REQUIRED'); end;
  if not ok then raise exception 'FAIL S3a: worked without an organization header'; end if;
  reset role;
  set local role anon;
  ok := false;
  begin perform * from public.core_org_people(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S3b: anonymous could call it'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
