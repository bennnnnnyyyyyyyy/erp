-- sql/tests/048_integrations.sql
-- Integrations wave 1 (sql/053): per-company settings, secrets in Vault, routing to email / Slack / Teams, delivery results,
-- exchange rates. Always rolls back. Needs sql/001-053.
-- Covers: owner/admin only; live Slack needs a webhook URL; URL rules; the secret is never readable by users (column and function);
-- routing copies only the chosen kinds, email per person, one channel post per subject; delivery result recorded; clearing a secret
-- removes it from Vault and switches the integration off; test message; isolation; exchange rates by cross rate, latest on or before
-- a date, none when unknown; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; n bigint; ok boolean; v text; sid uuid; ob_id uuid; rec record; slack_url text := 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop';
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'int-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'int-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'int-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'int-x@tests.invalid');
  o := public.bootstrap_organization('Integrations Test A', 'integrations-test-a', 'int-o@tests.invalid');
  ob := public.bootstrap_organization('Integrations Test B', 'integrations-test-b', 'int-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- I1: save settings; validation; members refused
  perform public.core_save_integration('email', true, 'simulated', array['approval_request']);
  ok := false; begin perform public.core_save_integration('fax', true, 'simulated', null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I1a: unknown integration accepted'; end if;
  ok := false; begin perform public.core_save_integration('email', true, 'simulated', array['nonsense']); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I1b: unknown message kind accepted'; end if;

  -- ---- I2: live Slack needs a URL; URL rules; the secret cannot be read back
  ok := false; begin perform public.core_save_integration('slack', true, 'live', array['approval_request']); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL I2a: live Slack without a webhook URL'; end if;
  ok := false; begin perform public.core_set_integration_secret('slack', 'https://evil.example.com/hook/aaaaaaaaaaaaaaaa'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I2b: a non-Slack URL accepted for Slack'; end if;
  ok := false; begin perform public.core_set_integration_secret('email', 'https://hooks.slack.com/services/x/y/zzzzzzzzzz'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL I2c: email accepted a webhook URL'; end if;
  v := public.core_set_integration_secret('slack', slack_url);
  if v <> '…klmnop' then raise exception 'FAIL I2d: hint %', v; end if;
  perform public.core_save_integration('slack', true, 'live', array['approval_request', 'alert']);
  ok := false; begin select secret_id into sid from public.core_integrations where org_id = o and kind = 'slack'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL I2e: a user read the secret id'; end if;
  ok := false; begin perform public.core__integration_secret(o, 'slack'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL I2f: a user read the secret through the internal function'; end if;
  reset role;
  if public.core__integration_secret(o, 'slack') <> slack_url then raise exception 'FAIL I2g: the job cannot read the stored URL'; end if;
  if exists (select 1 from public.audit_log where org_id = o and (summary like '%' || slack_url || '%' or after::text like '%' || slack_url || '%')) then
    raise exception 'FAIL I2h: the webhook URL leaked into the audit log';
  end if;

  -- ---- R1: routing. An approval request to two people: two emails, one Slack post. An "info" message: no copies.
  perform public.msg__enqueue(o, u, 'approval_request', 'REQ-1 needs approval', 'body', 'stock_request', null, 'r1:u');
  perform public.msg__enqueue(o, a, 'approval_request', 'REQ-1 needs approval', 'body', 'stock_request', null, 'r1:a');
  perform public.msg__enqueue(o, u, 'info', 'FYI', 'body', null, null, 'r2:u');
  select count(*) into n from public.msg_outbox where org_id = o and channel = 'email';
  if n <> 2 then raise exception 'FAIL R1a: % emails, expected 2', n; end if;
  select count(*) into n from public.msg_outbox where org_id = o and channel = 'slack';
  if n <> 1 then raise exception 'FAIL R1b: % Slack posts, expected 1 (one per subject per transaction)', n; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and channel = 'slack' and recipient_id is not null) then raise exception 'FAIL R1c: a channel post has a recipient'; end if;
  if exists (select 1 from public.msg_outbox where org_id = o and channel in ('email', 'slack') and kind = 'info') then raise exception 'FAIL R1d: an unchosen kind was copied'; end if;
  ok := false; begin insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, idempotency_key) values (o, null, 'email', 'info', 'x', 'bad'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL R1e: an email without a recipient was allowed'; end if;

  -- ---- E1: the job finds a recipient's email only while they are an active member
  select id into sid from public.msg_outbox where org_id = o and channel = 'email' and recipient_id = a;
  if public.msg__recipient_email(sid) <> 'int-a@tests.invalid' then raise exception 'FAIL E1a: recipient email not found'; end if;
  update public.memberships set disabled_at = now() where org_id = o and user_id = a;
  if public.msg__recipient_email(sid) is not null then raise exception 'FAIL E1b: a disabled member still gets email'; end if;
  update public.memberships set disabled_at = null where org_id = o and user_id = a;
  if has_function_privilege('authenticated', 'public.msg__recipient_email(uuid)', 'execute') then raise exception 'FAIL E1c: users can look up emails'; end if;

  -- ---- D1: delivery result recorded on the message and the integration
  select id into sid from public.msg_outbox where org_id = o and channel = 'slack';
  update public.msg_outbox set status = 'sending', attempts = 1 where id = sid;
  perform public.msg_complete_delivery(sid, false, 'webhook returned 404', 'slack-webhook');
  select last_status, last_error into rec from public.core_integrations where org_id = o and kind = 'slack';
  if rec.last_status <> 'failed' or rec.last_error <> 'webhook returned 404' then raise exception 'FAIL D1a: integration shows %', row_to_json(rec); end if;
  if (select delivered_via from public.msg_outbox where id = sid) <> 'slack-webhook' then raise exception 'FAIL D1b: delivered_via not set'; end if;

  -- ---- T1: a test message; clearing the secret
  set local role authenticated;
  sid := public.core_test_integration('email');
  if (select recipient_id from public.msg_outbox where id = sid) <> u then raise exception 'FAIL T1a: the test email is not to the caller'; end if;
  reset role;
  select secret_id into sid from public.core_integrations where org_id = o and kind = 'slack';
  set local role authenticated;
  perform public.core_clear_integration_secret('slack');
  reset role;
  if exists (select 1 from vault.secrets where id = sid) then raise exception 'FAIL T1b: the secret is still in Vault'; end if;
  select mode, enabled into rec from public.core_integrations where org_id = o and kind = 'slack';
  if rec.mode <> 'simulated' or rec.enabled then raise exception 'FAIL T1c: Slack still live or on after clearing'; end if;

  -- ---- P1: members and other companies
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_save_integration('email', false, 'simulated', null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL P1a: a member changed an integration'; end if;
  select count(*) into n from public.core_integrations;
  if n <> 0 then raise exception 'FAIL P1b: a member sees % integrations', n; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.core_integrations where org_id = o;
  if n <> 0 then raise exception 'FAIL P1c: another company sees % integrations', n; end if;
  ok := false; begin perform public.core_test_integration('email'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL P1d: another company used company A''s integration'; end if;

  -- ---- F1: exchange rates
  ok := false; begin perform public.core__save_fx_rates(date '2026-11-01', 'USD', '{"EGP": 50}', 'test'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL F1a: a user saved exchange rates'; end if;
  reset role;
  perform public.core__save_fx_rates(date '2026-11-01', 'USD', '{"EGP": 50, "EUR": 0.9, "BAD": -1, "xx": 3}', 'test');
  perform public.core__save_fx_rates(date '2026-11-03', 'USD', '{"EGP": 51}', 'test');
  set local role authenticated;
  select count(*) into n from public.core_fx_rates where source = 'test';
  if n <> 3 then raise exception 'FAIL F1b: % rates stored, expected 3 (bad ones skipped)', n; end if;
  select * into rec from public.core_fx_rate(date '2026-11-05', 'EUR', 'EGP');
  if rec.rate <> round(51 / 0.9, 10) or rec.rate_date <> date '2026-11-01' then raise exception 'FAIL F1c: EUR→EGP %', row_to_json(rec); end if;
  select * into rec from public.core_fx_rate(date '2026-11-02', 'USD', 'EGP');
  if rec.rate <> 50 or rec.rate_date <> date '2026-11-01' then raise exception 'FAIL F1d: USD→EGP on the 2nd %', row_to_json(rec); end if;
  select count(*) into n from public.core_fx_rate(date '2026-10-01', 'USD', 'EGP');
  if n <> 0 then raise exception 'FAIL F1e: a rate before any was saved'; end if;
  select rate into v from public.core_fx_rate(date '2026-10-01', 'EGP', 'egp');
  if v::numeric <> 1 then raise exception 'FAIL F1f: same currency %', v; end if;
  reset role;

  if has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute')
     or has_function_privilege('anon', 'public.core_fx_rate(date, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.msg_complete_delivery(uuid, boolean, text, text)', 'execute') then
    raise exception 'FAIL A1: a function is open that should not be';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
