-- sql/tests/099_hr_app_link.sql
-- sql/102: HR & payroll app link, phase 1 (HR_APP_INTEGRATION_PLAN.md). Always rolls back. Needs sql/001-102.
-- Covers: H1 provider fields (https only, connection id, switching on); H2 Sync now (owners and admins, once a minute); H3 the sync
-- (pages, older copies ignored, tombstones, bad rows skipped, branch mapped by code, full read removes what is gone, result on the
-- card); H4 the directory (members: directory only; owners and admins: details and a suggested member); H5 linking (same company
-- only, one employee per member, members cannot); H6 mapping a branch; H7 the webhook (subscription saved, company found by our
-- connection id, replays, off = not found, connection.revoked switches off); H8 isolation; H9 no direct writes, no column, no
-- service functions for users; H10 audit rows.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; br uuid; brb uuid; run uuid; j jsonb; n bigint; ok boolean; v_conn text; e1 uuid; e2 uuid; r record; t text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'hr-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'hr-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'hr-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'hr-x@tests.invalid');
  o := public.bootstrap_organization('HR link A', 'hr-link-a', 'hr-o@tests.invalid');
  ob := public.bootstrap_organization('HR link B', 'hr-link-b', 'hr-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- company B: a branch of its own (used to prove A cannot map to it)
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  brb := public.core_save_branch(null, 'BRB', 'B branch');
  reset role;

  -- ---- H1: provider fields
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;
  br := public.core_save_branch(null, 'CAI-01', 'Cairo head office');
  ok := false; begin perform public.core_save_provider_fields('hr_app', '{"base_url":"http://hr.example.com"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL H1a: an http address was accepted'; end if;
  ok := false; begin perform public.core_save_provider_fields('hr_app', '{"base_url":"https://user:pw@hr.example.com"}'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL H1b: an address with a password was accepted'; end if;
  ok := false; begin perform public.core_save_integration('hr_app', true, 'live', '{}'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL H1c: switched on without details'; end if;
  j := public.core_save_provider_fields('hr_app', '{"base_url":"https://hr.example.com/","api_key":"hrk_test_key_123456789"}');
  if j -> 'savedFields' <> '["api_key", "base_url"]'::jsonb then raise exception 'FAIL H1d: saved fields %', j; end if;
  perform public.core_save_integration('hr_app', true, 'live', '{}');
  reset role;
  select settings ->> 'hr_connection_id', settings -> 'config' ->> 'base_url' into v_conn, t from public.core_integrations where org_id = o and kind = 'hr_app';
  if v_conn !~ '^hrc_[A-Za-z0-9]{24}$' then raise exception 'FAIL H1e: connection id %', v_conn; end if;
  if t <> 'https://hr.example.com' then raise exception 'FAIL H1f: base_url kept as %', t; end if;

  -- ---- H2: Sync now
  set local role authenticated;
  perform public.hr_request_sync();
  ok := false; begin perform public.hr_request_sync(); exception when others then ok := (sqlerrm = 'TOO_SOON'); end;
  if not ok then raise exception 'FAIL H2a: two syncs asked within a minute'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.hr_request_sync(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL H2b: a member asked for a sync'; end if;
  reset role;

  -- ---- H3: the sync (service role)
  select count(*) into n from public.hr__sync_due(20) d where d.org_id = o and d.full_read and d.credentials ->> 'api_key' = 'hrk_test_key_123456789';
  if n <> 1 then raise exception 'FAIL H3a: company not due, or no key'; end if;
  j := public.hr__begin_sync(o, true); run := (j ->> 'runId')::uuid;
  if public.hr__begin_sync(o, true) is not null then raise exception 'FAIL H3b: a second run started while one is going'; end if;
  select count(*) into n from public.hr__sync_due(20) d where d.org_id = o;
  if n <> 0 then raise exception 'FAIL H3c: due while running'; end if;
  j := public.hr__apply_units(o, run, 'branch', '[
    {"id":"br_cai01","code":"cai-01","name":"Cairo head office","name_ar":"المقر الرئيسي","active":true,"updated_at":"2026-11-18T12:00:00Z"},
    {"id":"br_alx","code":"ALX","name":"Alexandria","active":true,"updated_at":"2026-11-18T12:00:00Z"},
    {"id":"br_bad","name":"No date"}]');
  if (j ->> 'added')::int <> 2 or (j ->> 'skipped')::int <> 1 then raise exception 'FAIL H3d: branches %', j; end if;
  if (select core_branch_id from public.hr_units where org_id = o and external_id = 'br_cai01') is distinct from br then
    raise exception 'FAIL H3e: branch with the same code not mapped'; end if;
  perform public.hr__apply_units(o, run, 'department', '[{"id":"dep_fin","code":"FIN","name":"Finance","branch_id":"br_cai01","active":true,"updated_at":"2026-11-18T12:00:00Z"}]');
  j := public.hr__apply_employees(o, run, '[
    {"id":"emp_1","employee_number":"E-1","display_name":"Member Person","work_email":"HR-M@tests.invalid","job_title":"Accountant","branch_id":"br_cai01","department_id":"dep_fin","status":"active","hired_on":"2024-03-01","updated_at":"2026-11-19T08:00:00Z","salary":99999},
    {"id":"emp_2","display_name":"Second Person","manager_id":"emp_1","status":"on_leave","updated_at":"2026-11-19T08:00:00Z"},
    {"id":"emp_3","display_name":"Bad status","status":"fired","updated_at":"2026-11-19T08:00:00Z"},
    {"id":"emp_4","display_name":"Bad date","status":"active","hired_on":"not-a-date","updated_at":"2026-11-19T08:00:00Z"}]');
  if (j ->> 'added')::int <> 2 or (j ->> 'skipped')::int <> 2 then raise exception 'FAIL H3f: employees %', j; end if;
  -- an older copy never overwrites a newer one
  perform public.hr__apply_employees(o, run, '[{"id":"emp_1","display_name":"Old Name","status":"active","updated_at":"2026-11-01T00:00:00Z"}]');
  if (select display_name from public.hr_employees where org_id = o and external_id = 'emp_1') <> 'Member Person' then raise exception 'FAIL H3g: older copy won'; end if;
  if (select work_email from public.hr_employees where org_id = o and external_id = 'emp_1') <> 'hr-m@tests.invalid' then raise exception 'FAIL H3h: email not lower-cased'; end if;
  ok := false; begin perform public.hr__apply_employees(o, gen_random_uuid(), '[]'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL H3i: a page from another run was accepted'; end if;
  perform public.hr__finish_sync(o, run, 'ok', null, '{"employees":"2026-11-19T08:00:00Z"}', '{"added":5}', true);
  if (select last_status from public.core_integrations where org_id = o and kind = 'hr_app') <> 'sent' then raise exception 'FAIL H3j: card not updated'; end if;
  select count(*) into n from public.hr__sync_due(20) d where d.org_id = o;
  if n <> 0 then raise exception 'FAIL H3k: due again right after a run'; end if;
  -- a second full read that no longer lists br_alx and emp_2: both are removed; a tombstone removes emp_1
  run := (public.hr__begin_sync(o, true) ->> 'runId')::uuid;
  perform public.hr__apply_units(o, run, 'branch', '[{"id":"br_cai01","code":"CAI-01","name":"Cairo head office","active":true,"updated_at":"2026-11-18T12:00:00Z"}]');
  perform public.hr__apply_units(o, run, 'department', '[{"id":"dep_fin","name":"Finance","active":true,"updated_at":"2026-11-18T12:00:00Z"}]');
  perform public.hr__apply_employees(o, run, '[{"id":"emp_1","display_name":"Member Person","work_email":"hr-m@tests.invalid","status":"active","updated_at":"2026-11-19T08:00:00Z"}]');
  perform public.hr__finish_sync(o, run, 'ok', null, null, null, true);
  if (select deleted_at from public.hr_units where org_id = o and external_id = 'br_alx') is null then raise exception 'FAIL H3l: missing branch kept'; end if;
  if (select deleted_at from public.hr_employees where org_id = o and external_id = 'emp_2') is null then raise exception 'FAIL H3m: missing employee kept'; end if;
  if (select deleted_at from public.hr_employees where org_id = o and external_id = 'emp_1') is not null then raise exception 'FAIL H3n: listed employee removed'; end if;
  -- bring emp_2 back for the next checks (a newer copy undeletes)
  run := (public.hr__begin_sync(o, false) ->> 'runId')::uuid;
  perform public.hr__apply_employees(o, run, '[{"id":"emp_2","display_name":"Second Person","manager_id":"emp_1","status":"on_leave","updated_at":"2026-11-20T08:00:00Z"}]');
  perform public.hr__finish_sync(o, run, 'partial', 'stopped at the page limit', null, null, false);
  if (select deleted_at from public.hr_employees where org_id = o and external_id = 'emp_2') is not null then raise exception 'FAIL H3o: newer copy did not undelete'; end if;
  if (select last_error from public.core_integrations where org_id = o and kind = 'hr_app') is null then raise exception 'FAIL H3p: partial result not shown'; end if;
  select id into e1 from public.hr_employees where org_id = o and external_id = 'emp_1';
  select id into e2 from public.hr_employees where org_id = o and external_id = 'emp_2';

  -- ---- H4: the directory
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.hr_directory(null, null, null, null, 50, 0);
  if (j ->> 'total')::int <> 2 or (j ->> 'details')::boolean then raise exception 'FAIL H4a: member directory %', j; end if;
  if exists (select 1 from jsonb_array_elements(j -> 'rows') e where e ? 'workEmail' and e ->> 'workEmail' is not null) then raise exception 'FAIL H4b: member saw a work email'; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'rows') e where e ->> 'managerName' = 'Member Person' and e ->> 'departmentName' is null) then
    raise exception 'FAIL H4c: manager not resolved'; end if;
  select count(*) into n from public.hr_units where org_id = o and deleted_at is null;
  if n <> 2 then raise exception 'FAIL H4d: member sees % units', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  j := public.hr_directory('member', null, null, null, 50, 0);
  if (j ->> 'total')::int <> 1 or not (j ->> 'details')::boolean then raise exception 'FAIL H4e: admin search %', j; end if;
  if (j -> 'rows' -> 0 ->> 'workEmail') <> 'hr-m@tests.invalid' or (j -> 'rows' -> 0 ->> 'suggestedUserId')::uuid is distinct from m then
    raise exception 'FAIL H4f: admin details %', j -> 'rows' -> 0; end if;
  if (public.hr_directory(null, null, null, 'on_leave', 50, 0) ->> 'total')::int <> 1 then raise exception 'FAIL H4g: status filter'; end if;

  -- ---- H5: linking
  perform public.hr_link_employee(e1, m);
  reset role;
  if (select link_source from public.hr_employees where id = e1) is distinct from 'confirmed' then raise exception 'FAIL H5a: link source'; end if;
  set local role authenticated;
  ok := false; begin perform public.hr_link_employee(e2, m); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL H5b: one member linked to two employees'; end if;
  ok := false; begin perform public.hr_link_employee(e2, x); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL H5c: linked to a member of another company'; end if;
  perform public.hr_link_employee(e2, u);
  reset role;
  if (select link_source from public.hr_employees where id = e2) is distinct from 'manual' then raise exception 'FAIL H5d: manual link'; end if;
  set local role authenticated;
  perform public.hr_unlink_employee(e2);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.hr_link_employee(e2, m); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL H5e: a member linked an employee'; end if;
  ok := false; begin perform public.hr_map_branch((select id from public.hr_units where org_id = o and external_id = 'br_cai01'), null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL H5f: a member mapped a branch'; end if;

  -- ---- H6: mapping a branch
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.hr_map_branch((select id from public.hr_units where org_id = o and external_id = 'br_cai01'), brb); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL H6a: mapped to another company''s branch'; end if;
  perform public.hr_map_branch((select id from public.hr_units where org_id = o and external_id = 'br_cai01'), null);
  reset role;
  if (select core_branch_id from public.hr_units where org_id = o and external_id = 'br_cai01') is not null then raise exception 'FAIL H6b: map not cleared'; end if;

  -- ---- H7: the webhook
  if public.hr__accept_webhook(v_conn) ->> 'secret' is not null then raise exception 'FAIL H7a: secret before registration'; end if;
  perform public.hr__save_subscription(o, 'sub_1', 'whsec_test_5b1f0c2e9d8a4f7b');
  j := public.hr__accept_webhook(v_conn);
  if (j ->> 'orgId')::uuid is distinct from o or j ->> 'secret' <> 'whsec_test_5b1f0c2e9d8a4f7b' then raise exception 'FAIL H7b: webhook lookup %', j; end if;
  if public.hr__accept_webhook('hrc_AAAAAAAAAAAAAAAAAAAAAAAA') is not null then raise exception 'FAIL H7c: unknown connection found'; end if;
  if public.hr__accept_webhook('x'' or 1=1 --') is not null then raise exception 'FAIL H7d: odd connection found'; end if;
  if public.hr__record_webhook(o, 'evt_1', 'employee.updated') <> 'ok' then raise exception 'FAIL H7e: first event'; end if;
  if public.hr__record_webhook(o, 'evt_1', 'employee.updated') <> 'duplicate' then raise exception 'FAIL H7f: replay accepted'; end if;
  if (select requested_at from public.hr_sync_state where org_id = o) < now() - interval '1 second' then raise exception 'FAIL H7g: webhook did not ask for a read'; end if;
  -- a new key drops the registration and its secret
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.core_save_provider_fields('hr_app', '{"api_key":"hrk_rotated_key_987654321"}');
  reset role;
  if public.hr__accept_webhook(v_conn) ->> 'secret' is not null then raise exception 'FAIL H7h: old secret kept after a new key'; end if;
  if (select settings ? 'hr_subscription_id' from public.core_integrations where org_id = o and kind = 'hr_app') then raise exception 'FAIL H7i: old subscription kept'; end if;
  if (select settings ->> 'hr_connection_id' from public.core_integrations where org_id = o and kind = 'hr_app') <> v_conn then raise exception 'FAIL H7j: connection id changed'; end if;
  perform public.hr__save_subscription(o, 'sub_2', 'whsec_second_secret_123456');
  perform public.hr__record_webhook(o, 'evt_2', 'connection.revoked');
  if (select enabled from public.core_integrations where org_id = o and kind = 'hr_app') then raise exception 'FAIL H7k: revoked connection still on'; end if;
  if public.hr__accept_webhook(v_conn) is not null then raise exception 'FAIL H7l: switched-off company still found'; end if;

  -- ---- H8: isolation
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.hr_units where org_id = o;
  if n <> 0 then raise exception 'FAIL H8a: B reads A''s units'; end if;
  select count(*) into n from public.hr_employees where org_id = o;
  if n <> 0 then raise exception 'FAIL H8b: B reads A''s employees'; end if;
  select count(*) into n from public.hr_sync_state where org_id = o;
  if n <> 0 then raise exception 'FAIL H8c: B reads A''s sync state'; end if;
  if (public.hr_directory(null, null, null, null, 50, 0) ->> 'total')::int <> 0 then raise exception 'FAIL H8d: B''s directory shows A'; end if;
  ok := false; begin perform public.hr_link_employee(e2, x); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL H8e: B linked A''s employee'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  ok := false; begin perform public.hr_directory(null, null, null, null, 50, 0); exception when others then ok := (sqlerrm in ('NOT_A_MEMBER', 'FORBIDDEN')); end;
  if not ok then raise exception 'FAIL H8f: B read A''s directory by naming A'; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);

  -- ---- H9: no direct writes, no hidden column, no service functions
  ok := false; begin insert into public.hr_employees (org_id, external_id, display_name, status, source_updated_at) values (ob, 'z', 'Z', 'active', now()); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL H9a: direct insert allowed'; end if;
  ok := false; begin perform work_email from public.hr_employees limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL H9b: work_email readable directly'; end if;
  ok := false; begin perform public.hr__sync_due(5); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL H9c: users can list due companies (and keys)'; end if;
  ok := false; begin perform public.hr__accept_webhook(v_conn); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL H9d: users can read the signing secret'; end if;
  ok := false; begin perform 1 from public.hr_webhook_events limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL H9e: users read webhook events'; end if;
  reset role;

  -- ---- H10: audit rows
  select count(*) into n from public.audit_log where org_id = o and action in
    ('hr.sync.requested', 'hr.sync.finished', 'hr.employee.linked', 'hr.employee.unlinked', 'hr.branch.mapped', 'hr.webhook.registered', 'hr.disconnected');
  if n < 9 then raise exception 'FAIL H10a: only % audit rows', n; end if;
  if exists (select 1 from public.audit_log where org_id = o and (coalesce(after::text, '') ~ 'whsec_|hrk_' or summary ~ 'whsec_|hrk_')) then
    raise exception 'FAIL H10b: a secret reached the audit log'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
