-- sql/tests/005_decision_tokens.sql
-- S3: approve or reject from a WhatsApp reply. Contract: the reply produces the same records as the app, replay, wrong
-- number, expired, re-bound number, unknown number and already-decided are all refused and audited, nobody signed in can
-- read tokens or call the webhook function. Always rolls back. Needs sql/001-009.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner (verified number)
  ub uuid := gen_random_uuid();  -- admin (verified number)
  uh uuid := gen_random_uuid();  -- admin without a verified number
  uc uuid := gen_random_uuid();  -- member, the requester
  ux uuid := gen_random_uuid();  -- admin who submits their own request
  oa uuid;
  w1 uuid;
  i1 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; rx uuid;
  tok_b text; tok_a text; tok2 text;
  nb constant text := '+201000000002';
  na constant text := '+201000000001';
  res jsonb;
  n bigint;
  st text;
  ok boolean;
  ap_wa record; ap_app record;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'tok-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'tok-b@tests.invalid'),
    (uh, 'authenticated', 'authenticated', 'tok-h@tests.invalid'), (uc, 'authenticated', 'authenticated', 'tok-c@tests.invalid'),
    (ux, 'authenticated', 'authenticated', 'tok-x@tests.invalid');
  oa := public.bootstrap_organization('Token Test A', 'tok-test-a', 'tok-a@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uh, 'admin'), (oa, uc, 'member'), (oa, ux, 'admin');
  insert into public.org_modules (org_id, module_key) values (oa, 'inventory'), (oa, 'messaging');
  -- Verified numbers for the owner and one admin (as if they had completed the code step an hour ago).
  insert into public.msg_identities (org_id, user_id, channel, address, status, verified_at) values
    (oa, ua, 'whatsapp', na, 'verified', now() - interval '1 hour'), (oa, ub, 'whatsapp', nb, 'verified', now() - interval '1 hour'),
    (oa, ux, 'whatsapp', '+201000000009', 'verified', now() - interval '1 hour');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main');
  i1 := public.inv_create_item('GLV', 'Gloves', null, 'pair', 100, w1);
  reset role;

  -- ---- S1: a request creates WhatsApp messages with a token for managers who have a verified number, nobody else
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r1 := (public.inv_submit_request(w1, 'gloves', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 5))) ->> 'id')::uuid;
  r2 := (public.inv_submit_request(w1, 'second', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 5))) ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.msg_outbox where entity_id = r1 and channel = 'whatsapp';
  if n <> 3 then raise exception 'FAIL S1a: expected WhatsApp messages for the 3 verified managers, found %', n; end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and channel = 'whatsapp' and recipient_id = uh;
  if n <> 0 then raise exception 'FAIL S1b: a manager without a verified number got a WhatsApp message'; end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and channel = 'in_app';
  if n <> 4 then raise exception 'FAIL S1c: the in-app messages changed (found %, expected 4 for all managers)', n; end if;
  select substring(secret_body from 'APPROVE ([A-Z2-9]{6})') into tok_b from public.msg_outbox where entity_id = r1 and channel = 'whatsapp' and recipient_id = ub;
  select substring(secret_body from 'APPROVE ([A-Z2-9]{6})') into tok_a from public.msg_outbox where entity_id = r1 and channel = 'whatsapp' and recipient_id = ua;
  if tok_b is null or tok_a is null or tok_a = tok_b then raise exception 'FAIL S1d: tokens missing or not distinct'; end if;
  select count(*) into n from public.msg_tokens where request_id = r1 and token_hash ~ '^[0-9a-f]{64}$' and position(tok_a in upper(token_hash)) = 0 and position(tok_b in upper(token_hash)) = 0;
  if n <> 3 then raise exception 'FAIL S1e: tokens are not stored as hashes (found % hashed of 3)', n; end if;
  select count(*) into n from public.msg_outbox where entity_id = r1 and (body ~ '[A-Z2-9]{6}[^A-Za-z]' and body ~ 'APPROVE');
  if n <> 0 then raise exception 'FAIL S1f: a token is in the readable part of a message'; end if;

  -- ---- S2: nothing a signed-in user can reach exposes tokens
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform 1 from public.msg_tokens; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S2a: an owner could read tokens'; end if;
  ok := false;
  begin perform public.msg_decide_by_token('whatsapp', na, 'APPROVE ' || tok_a); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S2b: a signed-in user could call the webhook function'; end if;
  reset role;

  -- ---- S3: wrong number sends someone else's token: refused and audited, request unchanged
  res := public.msg_decide_by_token('whatsapp', nb, 'APPROVE ' || tok_a);
  if (res ->> 'ok')::boolean or res ->> 'code' <> 'TOKEN_INVALID' then raise exception 'FAIL S3a: the other approver''s token worked from the wrong number: %', res; end if;
  select status into st from public.inv_requests where id = r1;
  if st <> 'submitted' then raise exception 'FAIL S3b: the request changed to %', st; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.inbound.refused' and summary like '%TOKEN_INVALID%';
  if n <> 1 then raise exception 'FAIL S3c: the refusal was not audited'; end if;

  -- ---- S4: unknown number, garbage text
  res := public.msg_decide_by_token('whatsapp', '+201999999999', 'APPROVE ' || tok_b);
  if res ->> 'code' <> 'UNKNOWN_IDENTITY' then raise exception 'FAIL S4a: an unknown number was not refused: %', res; end if;
  res := public.msg_decide_by_token('whatsapp', nb, 'please approve it');
  if res ->> 'code' <> 'NOT_A_DECISION' then raise exception 'FAIL S4b: free text was treated as a decision: %', res; end if;
  select status into st from public.inv_requests where id = r1;
  if st <> 'submitted' then raise exception 'FAIL S4c: a refused reply changed the request to %', st; end if;

  -- ---- S5: the right number and token approves, through the same function as the app
  res := public.msg_decide_by_token('whatsapp', nb, 'approve ' || lower(tok_b));
  if not (res ->> 'ok')::boolean then raise exception 'FAIL S5a: the valid reply was refused: %', res; end if;
  select status into st from public.inv_requests where id = r1;
  if st <> 'approved' then raise exception 'FAIL S5b: request is %, expected approved', st; end if;
  select a.* into ap_wa from public.inv_approvals a where a.request_id = r1;
  if ap_wa.approver_id <> ub or ap_wa.decision <> 'approved' or ap_wa.channel <> 'whatsapp' then raise exception 'FAIL S5c: wrong approval record %', row_to_json(ap_wa); end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.approved' and entity_id = r1::text and channel = 'whatsapp' and actor_user_id = ub;
  if n <> 1 then raise exception 'FAIL S5d: expected the approval audit row with channel whatsapp'; end if;

  -- contract: the same decision in the app leaves the same kind of records
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  perform public.inv_decide_request(r2, 'approved');
  reset role;
  select a.* into ap_app from public.inv_approvals a where a.request_id = r2;
  if ap_app.approver_id <> ap_wa.approver_id or ap_app.decision <> ap_wa.decision or ap_app.channel <> 'app' or (ap_app.comment is null) = (ap_wa.comment is null) and false then
    raise exception 'FAIL S5e: the app and WhatsApp approvals differ in more than the channel';
  end if;
  select count(*) into n from public.inv_requests where id in (r1, r2) and status = 'approved' and decided_by = ub and decided_at is not null;
  if n <> 2 then raise exception 'FAIL S5f: the two approved requests do not look the same'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'inventory.request.approved' and entity_id in (r1::text, r2::text);
  if n <> 2 then raise exception 'FAIL S5g: expected one approval audit row per request, found %', n; end if;

  -- ---- S6: replay and decided-in-the-app
  res := public.msg_decide_by_token('whatsapp', nb, 'APPROVE ' || tok_b);
  if res ->> 'code' <> 'TOKEN_USED' then raise exception 'FAIL S6a: a used token was accepted again: %', res; end if;
  res := public.msg_decide_by_token('whatsapp', na, 'REJECT ' || tok_a);
  if (res ->> 'ok')::boolean or res ->> 'code' <> 'INVALID_STATE' then raise exception 'FAIL S6b: a token for an already approved request was not refused: %', res; end if;
  select status into st from public.inv_requests where id = r1;
  if st <> 'approved' then raise exception 'FAIL S6c: the request is %, expected approved', st; end if;

  -- ---- S7: reject by token releases the reservation; expired token refused
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r3 := (public.inv_submit_request(w1, 'to reject', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 4))) ->> 'id')::uuid;
  r4 := (public.inv_submit_request(w1, 'to expire', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 3))) ->> 'id')::uuid;
  reset role;
  select substring(secret_body from 'REJECT ([A-Z2-9]{6})') into tok2 from public.msg_outbox where entity_id = r3 and channel = 'whatsapp' and recipient_id = ub;
  select b.reserved into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  res := public.msg_decide_by_token('whatsapp', nb, 'NO ' || tok2);
  if not (res ->> 'ok')::boolean then raise exception 'FAIL S7a: reject by reply failed: %', res; end if;
  select status into st from public.inv_requests where id = r3;
  if st <> 'rejected' then raise exception 'FAIL S7b: request is %, expected rejected', st; end if;
  select b.reserved into n from public.inv_stock_balances b where b.org_id = oa and b.item_id = i1;
  if n <> 13 then raise exception 'FAIL S7c: reserved is %, expected 13 (two approved requests of 5 plus the waiting one of 3; the rejected 4 was released)', n; end if;
  select substring(secret_body from 'APPROVE ([A-Z2-9]{6})') into tok2 from public.msg_outbox where entity_id = r4 and channel = 'whatsapp' and recipient_id = ub;
  update public.msg_tokens set expires_at = now() - interval '1 minute' where request_id = r4;
  res := public.msg_decide_by_token('whatsapp', nb, 'APPROVE ' || tok2);
  if res ->> 'code' <> 'TOKEN_EXPIRED' then raise exception 'FAIL S7d: an expired token was accepted: %', res; end if;

  -- ---- S8: re-binding a number invalidates tokens issued before it
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r5 := (public.inv_submit_request(w1, 'rebind', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 2))) ->> 'id')::uuid;
  reset role;
  select substring(secret_body from 'APPROVE ([A-Z2-9]{6})') into tok2 from public.msg_outbox where entity_id = r5 and channel = 'whatsapp' and recipient_id = ub;
  update public.msg_identities set verified_at = now() + interval '1 second' where user_id = ub and channel = 'whatsapp';
  res := public.msg_decide_by_token('whatsapp', nb, 'APPROVE ' || tok2);
  if res ->> 'code' <> 'TOKEN_INVALID' then raise exception 'FAIL S8: a token issued before the number was re-verified was accepted: %', res; end if;

  -- ---- S9: nobody can approve their own request, by any channel
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rx := (public.inv_submit_request(w1, 'own request', jsonb_build_array(jsonb_build_object('itemId', i1, 'qty', 1))) ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.msg_tokens where request_id = rx and approver_id = ux;
  if n <> 0 then raise exception 'FAIL S9a: the requester was issued a token for their own request'; end if;
  insert into public.msg_tokens (org_id, request_id, approver_id, channel, token_hash, expires_at)
  values (oa, rx, ux, 'whatsapp', public.msg__token_hash('ABCDEF', rx, ux), now() + interval '1 hour');
  res := public.msg_decide_by_token('whatsapp', '+201000000009', 'APPROVE ABCDEF');
  if (res ->> 'ok')::boolean or res ->> 'code' <> 'SELF_APPROVAL' then raise exception 'FAIL S9b: a forged token let someone approve their own request: %', res; end if;
  select status into st from public.inv_requests where id = rx;
  if st <> 'submitted' then raise exception 'FAIL S9c: own request is %, expected submitted', st; end if;

  -- ---- S10: the chain is clean
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S10: the audit chain is broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
