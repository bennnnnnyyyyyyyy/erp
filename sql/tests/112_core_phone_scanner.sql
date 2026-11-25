-- sql/tests/112_core_phone_scanner.sql
-- The phone as a barcode scanner (sql/115). Always rolls back. Needs sql/001-115.
-- Covers: S1 start (audited, the code is returned once and only its hash kept); S2 refusals (unknown form, a viewer); J1 the same
-- person's phone joins and scans; J2 another person of the same company, and a person of another company, cannot join, scan or poll;
-- P1 the computer polls new scans after a given id; R1 bad barcodes and more than 5 a second refused; E1 an expired or ended session
-- refuses scans; E2 a new start ends the person's old session; W1 direct writes refused; V1 people read only their own sessions.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; s jsonb; s2 jsonb; j jsonb; code text; sid uuid; ok boolean; n int;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ps-u@tests.invalid'), (m, 'authenticated', 'authenticated', 'ps-m@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'ps-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'ps-x@tests.invalid');
  o := public.bootstrap_organization('Phone scan A', 'phone-scan-a', 'ps-u@tests.invalid');
  ob := public.bootstrap_organization('Phone scan B', 'phone-scan-b', 'ps-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member'), (o, v, 'viewer'), (ob, u, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- S1
  s := public.core_scan_start('sales_order');
  code := s ->> 'code'; sid := (s ->> 'sessionId')::uuid;
  if code !~ '^[0-9a-f]{64}$' then raise exception 'FAIL S1a: code %', code; end if;
  if exists (select 1 from public.core_scan_sessions where code_hash = code) then raise exception 'FAIL S1b: the code itself is stored'; end if;
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'core.scanner.started' and entity_id = sid::text) then raise exception 'FAIL S1c: not audited'; end if;
  set local role authenticated;

  -- S2
  ok := false; begin perform public.core_scan_start('invoice'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S2a: an unknown form was accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_scan_start('sales_order'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S2b: a viewer started the scanner'; end if;

  -- J1: the same person's phone
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  j := public.core_scan_join(code);
  if (j ->> 'form') <> 'sales_order' or (j ->> 'sessionId')::uuid <> sid then raise exception 'FAIL J1a: join %', j; end if;
  perform public.core_scan_add(code, '6221234567890');
  perform public.core_scan_add(code, ' RS-1 ');

  -- J2: another person of the same company; the same person in another company; another company's person
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_scan_join(code); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL J2a: a colleague joined'; end if;
  ok := false; begin perform public.core_scan_add(code, '123'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL J2b: a colleague scanned'; end if;
  ok := false; begin perform public.core_scan_poll(sid, 0); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL J2c: a colleague polled'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  ok := false; begin perform public.core_scan_add(code, '123'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL J2d: the same person scanned into the session from another company'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_scan_join(code); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL J2e: another company joined'; end if;
  if exists (select 1 from public.core_scan_sessions) or exists (select 1 from public.core_scan_events) then raise exception 'FAIL V1a: another company reads sessions'; end if;

  -- P1: the computer polls
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  j := public.core_scan_poll(sid, 0);
  if not (j ->> 'open')::boolean or jsonb_array_length(j -> 'scans') <> 2 or (j -> 'scans' -> 1 ->> 'barcode') <> 'RS-1' then raise exception 'FAIL P1a: poll %', j; end if;
  j := public.core_scan_poll(sid, (j -> 'scans' -> 0 ->> 'id')::bigint);
  if jsonb_array_length(j -> 'scans') <> 1 then raise exception 'FAIL P1b: poll after the first gave %', j; end if;

  -- R1: bad barcodes and too many at once
  ok := false; begin perform public.core_scan_add(code, ''); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1a: an empty barcode was accepted'; end if;
  ok := false; begin perform public.core_scan_add(code, repeat('9', 65)); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1b: a 65-character barcode was accepted'; end if;
  ok := false; begin perform public.core_scan_add(code, E'12\n34'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1c: a line break was accepted'; end if;
  perform public.core_scan_add(code, '1'); perform public.core_scan_add(code, '2'); perform public.core_scan_add(code, '3');
  ok := false; begin perform public.core_scan_add(code, '4'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL R1d: more than 5 scans in a second were accepted'; end if;

  -- W1: direct writes
  ok := false; begin insert into public.core_scan_events (org_id, session_id, barcode) values (o, sid, 'x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL W1: a direct insert worked'; end if;

  -- V1: a colleague reads none of it
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.core_scan_sessions) or exists (select 1 from public.core_scan_events) then raise exception 'FAIL V1b: a colleague reads my sessions'; end if;

  -- E2: a new start ends the old session; E1: an ended or expired session refuses scans
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  s2 := public.core_scan_start('purchase_order');
  ok := false; begin perform public.core_scan_add(code, '5'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL E2: the old session still takes scans'; end if;
  if (public.core_scan_poll(sid, 0) ->> 'open')::boolean then raise exception 'FAIL E2b: the old session still says open'; end if;
  reset role;
  update public.core_scan_sessions set expires_at = now() - interval '1 second' where id = (s2 ->> 'sessionId')::uuid;
  set local role authenticated;
  ok := false; begin perform public.core_scan_add(s2 ->> 'code', '5'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL E1a: an expired session took a scan'; end if;
  perform public.core_scan_end((s2 ->> 'sessionId')::uuid);
  reset role;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'core.scanner.ended' and entity_id = s2 ->> 'sessionId') then raise exception 'FAIL E1b: end not audited'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
