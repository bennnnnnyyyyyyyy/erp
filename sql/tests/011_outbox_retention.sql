-- sql/tests/011_outbox_retention.sql
-- O9: retention is a dry run by default, removes only finished and old operational rows, never audit entries or in-flight
-- messages, and keeps notifications' text. Always rolls back. Needs sql/001-015.

do $$
declare
  ua uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  oa uuid;
  m_old_sent uuid; m_old_pending uuid; m_new_sent uuid; m_old_sending uuid; m_old_failed uuid;
  j jsonb;
  n bigint; n_audit_before bigint;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'ret-a@tests.invalid'), (uc, 'authenticated', 'authenticated', 'ret-c@tests.invalid');
  oa := public.bootstrap_organization('Retention Test A', 'ret-test-a', 'ret-a@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, uc, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'messaging');

  m_old_sent := public.msg__enqueue(oa, uc, 'info', 'old sent', '', null, null, 'ret:1');
  m_old_pending := public.msg__enqueue(oa, uc, 'info', 'old pending', '', null, null, 'ret:2');
  m_new_sent := public.msg__enqueue(oa, uc, 'info', 'new sent', '', null, null, 'ret:3');
  m_old_sending := public.msg__enqueue(oa, uc, 'info', 'old sending', '', null, null, 'ret:4');
  m_old_failed := public.msg__enqueue(oa, uc, 'info', 'old failed', '', null, null, 'ret:5');
  update public.msg_outbox set status = 'sent', sent_at = now() where id in (m_old_sent, m_new_sent);
  update public.msg_outbox set status = 'sending' where id = m_old_sending;
  update public.msg_outbox set status = 'failed' where id = m_old_failed;
  update public.msg_outbox set created_at = now() - interval '200 days' where id in (m_old_sent, m_old_pending, m_old_sending, m_old_failed);
  perform public.msg_deliver_in_app(m_old_sent);
  update public.msg_notifications set read_at = now(), created_at = now() - interval '200 days' where outbox_id = m_old_sent;
  insert into public.msg_notifications (org_id, user_id, title) values (oa, uc, 'old unread');
  update public.msg_notifications set created_at = now() - interval '200 days' where title = 'old unread';
  select count(*) into n_audit_before from public.audit_log where org_id = oa;

  -- ---- S1: the default is a dry run: it reports, deletes nothing
  j := public.msg_cleanup(90);
  if not (j ->> 'dry_run')::boolean then raise exception 'FAIL S1a: the default is not a dry run'; end if;
  if (j ->> 'outbox')::int < 2 then raise exception 'FAIL S1b: the dry run did not count the old finished messages: %', j; end if;
  select count(*) into n from public.msg_outbox where org_id = oa;
  if n <> 5 then raise exception 'FAIL S1c: a dry run changed the outbox (% rows)', n; end if;

  -- ---- S2: a real run removes only old finished rows, keeps the audit log and the notification text
  j := public.msg_cleanup(90, false);
  select count(*) into n from public.msg_outbox where id in (m_old_sent, m_old_failed);
  if n <> 0 then raise exception 'FAIL S2a: old finished messages were not removed'; end if;
  select count(*) into n from public.msg_outbox where id in (m_old_pending, m_old_sending, m_new_sent);
  if n <> 3 then raise exception 'FAIL S2b: pending, in-flight or recent messages were removed (% of 3 left)', n; end if;
  select count(*) into n from public.msg_notifications where title = 'old sent';
  if n <> 0 then raise exception 'FAIL S2c: the read old notification was not removed'; end if;
  select count(*) into n from public.msg_notifications where title = 'old unread';
  if n <> 1 then raise exception 'FAIL S2d: an UNREAD notification was removed'; end if;
  select count(*) into n from public.audit_log where org_id = oa;
  if n < n_audit_before + 1 then raise exception 'FAIL S2e: the audit log lost entries or the cleanup was not audited'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'messaging.cleanup.run';
  if n <> 1 then raise exception 'FAIL S2f: expected one cleanup audit entry, found %', n; end if;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL S2g: the audit chain is broken after cleanup'; end if;

  -- ---- S3: a shorter retention than 7 days is refused; closed to signed-in users
  ok := false;
  begin perform public.msg_cleanup(1, false); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S3a: a 1-day retention was accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.msg_cleanup(90, true); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S3b: a signed-in user could run the cleanup'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
