-- sql/tests/028_signup.sql
-- Sign-up: a confirmed user creates a company and becomes its owner with every app on, language, currency and time zone set, the
-- tutorial flag on and an audit trail; unconfirmed email, anonymous, bad input and the 3-company limit are refused; same name gets a
-- different slug; it cannot be used to join someone else's company; the tutorial flag can be turned off by an owner but not by a
-- member; no other table is touched for other companies. Always rolls back. Needs sql/001-032.

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  o1 uuid; o2 uuid; o3 uuid; ob uuid; s record; n bigint; ok boolean; r boolean; slug1 text; slug2 text; others bigint;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (a, 'authenticated', 'authenticated', 'su-a@tests.invalid', now()),
    (b, 'authenticated', 'authenticated', 'su-b@tests.invalid', null),          -- never confirmed their email
    (c, 'authenticated', 'authenticated', 'su-c@tests.invalid', now());
  select count(*) into others from public.organizations;

  -- S1: a confirmed user creates a company
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  o1 := public.core_create_organization('Nile Cosmetics', 'ar', 'egp', 'Africa/Cairo');
  reset role;
  select * into s from public.organizations where id = o1;
  if s.name <> 'Nile Cosmetics' or s.default_currency <> 'EGP' or s.timezone <> 'Africa/Cairo' then raise exception 'FAIL S1a: settings % % %', s.name, s.default_currency, s.timezone; end if;
  if s.settings ->> 'language' <> 'ar' or (s.settings ->> 'show_tutorial')::boolean is not true then raise exception 'FAIL S1b: settings %', s.settings; end if;
  select count(*) into n from public.memberships where org_id = o1 and user_id = a and role = 'owner' and disabled_at is null; if n <> 1 then raise exception 'FAIL S1c: owner membership %', n; end if;
  select count(*) into n from public.org_modules where org_id = o1 and disabled_at is null and module_key in ('inventory', 'tasks', 'messaging', 'purchasing', 'sales', 'finance', 'alerts');
  if n <> 7 then raise exception 'FAIL S1d: % of 7 apps on', n; end if;
  select count(*) into n from public.audit_log where org_id = o1 and action in ('organization.created', 'organization.setup'); if n <> 2 then raise exception 'FAIL S1e: audit entries %', n; end if;
  select count(*) into n from public.memberships where org_id = o1; if n <> 1 then raise exception 'FAIL S1f: % members', n; end if;
  select count(*) into n from public.audit_verify(o1); if n <> 0 then raise exception 'FAIL S1g: audit chain broken'; end if;
  slug1 := s.slug;
  if slug1 <> 'nile-cosmetics' then raise exception 'FAIL S1h: slug %', slug1; end if;

  -- S2: the same name again gets a different slug; the 4th company is refused (limit 3)
  set local role authenticated;
  o2 := public.core_create_organization('Nile Cosmetics');
  o3 := public.core_create_organization('Nile Cosmetics', 'en', 'USD', 'UTC');
  ok := false; begin perform public.core_create_organization('One too many'); exception when others then ok := (sqlerrm = 'LIMIT_REACHED'); end;
  reset role;
  if not ok then raise exception 'FAIL S2a: the fourth company was created'; end if;
  select slug into slug2 from public.organizations where id = o2;
  if slug2 = slug1 or slug2 not like 'nile-cosmetics-%' then raise exception 'FAIL S2b: slug % for the second company', slug2; end if;
  select default_currency into slug2 from public.organizations where id = o3; if slug2 <> 'USD' then raise exception 'FAIL S2c: currency %', slug2; end if;

  -- S3: unconfirmed email, anonymous, bad input
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_create_organization('Ghost Co'); exception when others then ok := (sqlerrm = 'EMAIL_NOT_CONFIRMED'); end;
  reset role;
  if not ok then raise exception 'FAIL S3a: an unconfirmed email created a company'; end if;
  set local role anon;
  ok := false; begin perform public.core_create_organization('Anon Co'); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL S3b: anonymous could create a company'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_create_organization('X'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3c: a 1-letter name was accepted'; end if;
  ok := false; begin perform public.core_create_organization('Good Name', 'fr'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3d: language fr accepted'; end if;
  ok := false; begin perform public.core_create_organization('Good Name', 'en', 'EG'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3e: a 2-letter currency was accepted'; end if;
  ok := false; begin perform public.core_create_organization('Good Name', 'en', 'EGP', 'Mars/Olympus'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3f: an unknown time zone was accepted'; end if;
  -- names with only symbols still produce a usable slug
  ob := public.core_create_organization('!!! ***');
  reset role;
  select slug into slug2 from public.organizations where id = ob; if slug2 not like 'company%' then raise exception 'FAIL S3g: slug % for a symbol-only name', slug2; end if;

  -- S4: no side effects on other companies: nothing else was created for anyone else, and c owns only their own company
  select count(*) into n from public.memberships where user_id = c and org_id <> ob; if n <> 0 then raise exception 'FAIL S4a: user c joined other companies'; end if;
  select count(*) into n from public.organizations; if n <> others + 4 then raise exception 'FAIL S4b: % companies were added (expected 4)', n - others; end if;

  -- S5: the tutorial flag: owner turns it off and on, a no-op is silent, a member cannot, other companies unaffected
  perform set_config('request.headers', json_build_object('x-org-id', o1)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated; r := public.core_set_tutorial(false); r := public.core_set_tutorial(false); reset role;
  select (settings ->> 'show_tutorial')::boolean into r from public.organizations where id = o1; if r is not false then raise exception 'FAIL S5a: flag still on'; end if;
  select count(*) into n from public.audit_log where org_id = o1 and action = 'organization.tutorial_changed'; if n <> 1 then raise exception 'FAIL S5b: audit entries %', n; end if;
  select (settings ->> 'show_tutorial')::boolean into r from public.organizations where id = o2; if r is not true then raise exception 'FAIL S5c: another company lost its flag'; end if;
  insert into public.memberships (org_id, user_id, role) values (o1, c, 'member');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_tutorial(true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  reset role;
  if not ok then raise exception 'FAIL S5d: a member changed the tutorial flag'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
