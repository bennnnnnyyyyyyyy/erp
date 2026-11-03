-- sql/tests/033_org_tour.sql
-- The per-organization guided-tour switch. Always rolls back. Needs sql/001-032 and sql/039.
-- Covers: off by default, who may switch it, the change and its audit row, no audit row for a no-op, the tutorial flag untouched,
-- validation, one company never affecting another, no anonymous use.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin, org A
  uc uuid := gen_random_uuid();  -- member, org A
  ud uuid := gen_random_uuid();  -- viewer, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  oa uuid; ob uuid;
  v text; n bigint; ok boolean; r boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'tr-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'tr-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'tr-c@tests.invalid'), (ud, 'authenticated', 'authenticated', 'tr-d@tests.invalid'),
    (ue, 'authenticated', 'authenticated', 'tr-e@tests.invalid');
  oa := public.bootstrap_organization('Tour Test A', 'tour-test-a', 'tr-a@tests.invalid');
  ob := public.bootstrap_organization('Tour Test B', 'tour-test-b', 'tr-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member'), (oa, ud, 'viewer');
  -- the tutorial flag is on for A, so we can prove the tour switch leaves it alone
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"show_tutorial": true}'::jsonb where id = oa;

  -- ---- S1: off by default
  select settings ->> 'show_tour' into v from public.organizations where id = oa;
  if v is not null then raise exception 'FAIL S1a: show_tour is % before anyone set it, expected unset', v; end if;

  -- ---- S2: who may switch it
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_tour(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2a: a member switched the tour on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_tour(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2b: a viewer switched the tour on'; end if;

  -- ---- S3: an admin switches it on and off, with audit
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  r := public.core_set_tour(true);
  if r is not true then raise exception 'FAIL S3a: core_set_tour(true) returned %', r; end if;
  reset role;
  select settings ->> 'show_tour' into v from public.organizations where id = oa;
  if v is distinct from 'true' then raise exception 'FAIL S3b: show_tour is %, expected true', v; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'organization.tour_changed' and actor_user_id = ub and summary = 'Guided tour switched on';
  if n <> 1 then raise exception 'FAIL S3c: % audit row(s) for switching on, expected 1', n; end if;
  select settings ->> 'show_tutorial' into v from public.organizations where id = oa;
  if v is distinct from 'true' then raise exception 'FAIL S3d: switching the tour changed show_tutorial to %', v; end if;
  set local role authenticated;
  perform public.core_set_tour(true);   -- no change: no second audit row
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'organization.tour_changed';
  if n <> 1 then raise exception 'FAIL S3e: a no-op change wrote an audit row (% rows)', n; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform public.core_set_tour(false);   -- the owner may too
  reset role;
  select settings ->> 'show_tour' into v from public.organizations where id = oa;
  if v is distinct from 'false' then raise exception 'FAIL S3f: show_tour is %, expected false', v; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'organization.tour_changed' and summary = 'Guided tour switched off' and actor_user_id = ua;
  if n <> 1 then raise exception 'FAIL S3g: % audit row(s) for switching off, expected 1', n; end if;

  -- ---- S4: validation
  set local role authenticated;
  ok := false; begin perform public.core_set_tour(null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S4a: null was accepted'; end if;

  -- ---- S5: one company never affects another
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform public.core_set_tour(true);
  reset role;
  select settings ->> 'show_tour' into v from public.organizations where id = ob;
  if v is distinct from 'true' then raise exception 'FAIL S5a: org B show_tour is %, expected true', v; end if;
  select settings ->> 'show_tour' into v from public.organizations where id = oa;
  if v is distinct from 'false' then raise exception 'FAIL S5b: switching org B changed org A to %', v; end if;
  set local role authenticated;
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);   -- B's owner pointing at A
  ok := false; begin perform public.core_set_tour(true); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL S5c: a person outside org A switched its tour'; end if;

  -- ---- S6: no anonymous use
  reset role;
  if has_function_privilege('anon', 'public.core_set_tour(boolean)', 'execute') then raise exception 'FAIL S6a: the anonymous role can run core_set_tour'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
