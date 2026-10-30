-- sql/tests/004_identity_binding.sql
-- S2: phone-number identity binding. Always rolls back. Pass = error text "ALL TESTS PASSED"; "FAIL S<n>" names the check.
-- Needs sql/001-008.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner
  uc uuid := gen_random_uuid();  -- member
  ud uuid := gen_random_uuid();  -- viewer
  ue uuid := gen_random_uuid();  -- member, same organization, used for "number already in use"
  uf uuid := gen_random_uuid();  -- owner of an organization with messaging off
  oa uuid;
  of_ uuid;
  idn uuid;
  idn2 uuid;
  msg uuid;
  code text;
  n bigint;
  st text;
  ok boolean;
  res boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'idn-a@tests.invalid'), (uc, 'authenticated', 'authenticated', 'idn-c@tests.invalid'),
    (ud, 'authenticated', 'authenticated', 'idn-d@tests.invalid'), (ue, 'authenticated', 'authenticated', 'idn-e@tests.invalid'),
    (uf, 'authenticated', 'authenticated', 'idn-f@tests.invalid');
  oa := public.bootstrap_organization('Identity Test A', 'idn-test-a', 'idn-a@tests.invalid');
  of_ := public.bootstrap_organization('Identity Test F', 'idn-test-f', 'idn-f@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, uc, 'member'), (oa, ud, 'viewer'), (oa, ue, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'messaging');

  -- ---- S1: start sends a code through the outbox; nobody signed in can read the code
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  idn := public.msg_identity_start('whatsapp', '+20 100 123 4567');
  reset role;
  select o.id, substring(o.secret_body from '[0-9]{6}') into msg, code from public.msg_outbox o where o.entity_id = idn and o.kind = 'verification';
  if msg is null or code is null then raise exception 'FAIL S1a: no verification message with a code was queued'; end if;
  select count(*) into n from public.msg_outbox where id = msg and channel = 'whatsapp' and recipient_id = uc and max_attempts = 2 and expires_at <= now() + interval '10 minutes 5 seconds';
  if n <> 1 then raise exception 'FAIL S1b: the code message has the wrong channel, recipient, tries or expiry'; end if;
  select count(*) into n from public.msg_outbox where id = msg and (body ~ '[0-9]{6}' or subject ~ '[0-9]{6}');
  if n <> 0 then raise exception 'FAIL S1c: the code is visible in the readable part of the message'; end if;
  select count(*) into n from public.msg_identities where id = idn and code_hash ~ '^[0-9a-f]{64}$' and position(code in code_hash) = 0 and status = 'pending';
  if n <> 1 then raise exception 'FAIL S1d: the code is not stored as a hash'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform o.secret_body from public.msg_outbox o; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S1e: an owner could read the secret part of a message'; end if;
  ok := false;
  begin perform i.code_hash from public.msg_identities i; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S1f: someone could read a code hash'; end if;
  select count(*) into n from public.msg_outbox where id = msg;
  if n <> 1 then raise exception 'FAIL S1g: an owner cannot see that the message exists (delivery status)'; end if;
  select count(*) into n from public.msg_identities;
  if n <> 0 then raise exception 'FAIL S1h: an owner reads someone else''s number'; end if;
  reset role;

  -- ---- S2: wrong code, then right code
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.msg_identity_confirm(idn, '000000');
  if code = '000000' then res := public.msg_identity_confirm(idn, '111111'); end if;
  if res then raise exception 'FAIL S2a: a wrong code verified the number'; end if;
  reset role;
  select count(*) into n from public.msg_identities where id = idn and status = 'pending' and attempts = 1;
  if n <> 1 then raise exception 'FAIL S2b: the wrong try was not counted'; end if;
  set local role authenticated;
  if not public.msg_identity_confirm(idn, code) then raise exception 'FAIL S2c: the right code did not verify'; end if;
  reset role;
  select status into st from public.msg_identities where id = idn;
  if st <> 'verified' then raise exception 'FAIL S2d: identity is %, expected verified', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action in ('messaging.identity.started', 'messaging.identity.failed', 'messaging.identity.verified');
  if n <> 3 then raise exception 'FAIL S2e: expected 3 identity audit rows, found %', n; end if;
  select count(*) into n from public.audit_log where org_id = oa and action like 'messaging.identity.%' and summary like '%+20%';
  if n <> 0 then raise exception 'FAIL S2f: a whole phone number is in the audit log'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action like 'messaging.identity.%' and summary like '%***567%';
  if n < 1 then raise exception 'FAIL S2g: the masked number is not in the audit log'; end if;

  -- ---- S3: the secret part is wiped once the message has an outcome (sent)
  perform public.msg_claim_due(100);
  perform public.msg_complete(msg, true);
  select count(*) into n from public.msg_outbox where id = msg and secret_body is null;
  if n <> 1 then raise exception 'FAIL S3: the code stayed in the outbox after delivery'; end if;

  -- ---- S4: five wrong tries revoke the attempt
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  idn2 := public.msg_identity_start('whatsapp', '+201009998877');
  for i in 1..5 loop res := public.msg_identity_confirm(idn2, 'x' || i); end loop;
  reset role;
  select status into st from public.msg_identities where id = idn2;
  if st <> 'revoked' then raise exception 'FAIL S4a: after 5 wrong tries the attempt is %, expected revoked', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.msg_identity_confirm(idn2, 'whatever') then raise exception 'FAIL S4b: a revoked attempt verified'; end if;
  reset role;

  -- ---- S5: an expired code does not verify
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  idn2 := public.msg_identity_start('whatsapp', '+201009998877');
  reset role;
  select substring(o.secret_body from '[0-9]{6}') into code from public.msg_outbox o where o.entity_id = idn2 and o.kind = 'verification';
  update public.msg_identities set code_expires_at = now() - interval '1 minute' where id = idn2;
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.msg_identity_confirm(idn2, code) then raise exception 'FAIL S5: an expired code verified the number'; end if;
  reset role;

  -- ---- S6: a number verified by one person cannot be claimed by another; invalid numbers and roles are refused
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_identity_start('whatsapp', '+201001234567'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S6a: a number already verified for someone else was accepted'; end if;
  ok := false;
  begin perform public.msg_identity_start('whatsapp', '0100 123'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S6b: a malformed number was accepted'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_identity_start('whatsapp', '+201005550000'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S6c: a viewer started a verification'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uf, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', of_)::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_identity_start('whatsapp', '+201005550001'); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL S6d: verification worked with the messaging module off'; end if;
  reset role;

  -- ---- S7: a new verified number replaces the old one
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  idn2 := public.msg_identity_start('whatsapp', '+201112223344');
  reset role;
  select substring(o.secret_body from '[0-9]{6}') into code from public.msg_outbox o where o.entity_id = idn2 and o.kind = 'verification';
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.msg_identity_confirm(idn2, code) then raise exception 'FAIL S7a: the second number did not verify'; end if;
  reset role;
  select count(*) into n from public.msg_identities where user_id = uc and status = 'verified';
  if n <> 1 then raise exception 'FAIL S7b: expected exactly one verified number, found %', n; end if;
  select status into st from public.msg_identities where id = idn;
  if st <> 'revoked' then raise exception 'FAIL S7c: the old number is %, expected revoked', st; end if;

  -- ---- S8: revoking, by the person or an owner, and who cannot
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_identity_revoke(idn2); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL S8a: a member removed someone else''s number'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.msg_identity_revoke(idn2);
  reset role;
  select status into st from public.msg_identities where id = idn2;
  if st <> 'revoked' then raise exception 'FAIL S8b: an owner could not remove the number'; end if;

  -- ---- S9: rate limit on starting verifications
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin
    for i in 1..6 loop perform public.msg_identity_start('whatsapp', '+2010000000' || lpad(i::text, 2, '0')); end loop;
  exception when others then ok := (sqlerrm = 'RATE_LIMITED');
  end;
  if not ok then raise exception 'FAIL S9: no rate limit on verification requests'; end if;
  reset role;

  -- ---- S10: direct writes are closed; the chain is clean
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin update public.msg_identities set status = 'verified'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S10a: a person could mark their own number verified'; end if;
  ok := false;
  begin insert into public.msg_identities (org_id, user_id, channel, address, status) values (oa, uc, 'whatsapp', '+201000000099', 'verified'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S10b: a person could insert a verified number'; end if;
  reset role;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S10c: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
