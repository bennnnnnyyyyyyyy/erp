-- sql/tests/076_integrations_live.sql
-- No more test mode (sql/082). Always rolls back. Needs sql/001-082.
-- Covers: a row can only be 'live' and new rows default to it; 'simulated' is refused by the function and by the table; switching ON
-- needs the details (webhook URL, required provider fields, Shopify's client ID), switching OFF never does; removing a webhook URL
-- switches off and stays live; the three "try it" functions are gone; ETA offers PreProd or production only and defaults to PreProd;
-- members cannot switch; every change is audited.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid();
  o uuid; ok boolean; n bigint; rec record; s text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'live-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'live-m@tests.invalid');
  o := public.bootstrap_organization('Live Test A', 'live-test-a', 'live-o@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  perform public.core_enable_all_modules(o);
  insert into public.org_modules (org_id, module_key) values (o, 'einvoicing') on conflict do nothing;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- ---- D1: the table itself
  ok := false; begin insert into public.core_integrations (org_id, kind, mode) values (o, 'email', 'simulated'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL D1a: a simulated row was stored'; end if;
  insert into public.core_integrations (org_id, kind) values (o, 'teams');
  if (select mode from public.core_integrations where org_id = o and kind = 'teams') <> 'live' then raise exception 'FAIL D1b: the default is not live'; end if;
  delete from public.core_integrations where org_id = o and kind = 'teams';

  set local role authenticated;
  -- ---- S1: the function
  ok := false; begin perform public.core_save_integration('email', true, 'simulated', null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL S1a: simulated accepted'; end if;
  perform public.core_save_integration('email', true, null, array['alert']);   -- no mode given: live
  ok := false; begin perform public.core_save_integration('slack', true, 'live', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S1b: Slack on without a URL'; end if;
  perform public.core_save_integration('slack', false, 'live', null);   -- off needs nothing
  ok := false; begin perform public.core_save_integration('paymob', true, 'live', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S1c: Paymob on without its details'; end if;
  perform public.core_save_provider_fields('shopify', '{"shop_domain": "live-test.myshopify.com", "webhook_secret": "s"}');
  ok := false; begin perform public.core_save_integration('shopify', true, 'live', null); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL S1d: Shopify on without its client ID'; end if;
  perform public.core_save_provider_fields('shopify', '{"client_id": "cid"}');   -- no access token needed (2026 apps)
  perform public.core_save_integration('shopify', true, 'live', null);

  -- ---- S2: removing a webhook URL switches off and stays live
  perform public.core_set_integration_secret('slack', 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop');
  perform public.core_save_integration('slack', true, 'live', array['alert']);
  perform public.core_clear_integration_secret('slack');
  select mode, enabled into rec from public.core_integrations where org_id = o and kind = 'slack';
  if rec.mode <> 'live' or rec.enabled then raise exception 'FAIL S2a: after removing the URL: mode %, on %', rec.mode, rec.enabled; end if;

  -- ---- M1: members cannot switch
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_save_integration('email', false, 'live', null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL M1a: a member switched an integration'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- ---- E1: ETA
  perform public.eta_save_profile('100200300', 'Live Seller LLC', '4620');
  select eta_mode into s from public.tax_profiles where org_id = o;
  if s <> 'preprod' then raise exception 'FAIL E1a: ETA default %', s; end if;
  ok := false; begin perform public.eta_save_profile('100200300', 'Live Seller LLC', '4620', 'simulated'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL E1b: ETA simulated accepted'; end if;
  reset role;
  ok := false; begin update public.tax_profiles set eta_mode = 'simulated' where org_id = o; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL E1c: the table took simulated'; end if;

  -- ---- G1: gone functions; audit
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('fin_simulate_pay_link', 'sal_simulate_shipment_step', 'sal_shopify_test_order');
  if n <> 0 then raise exception 'FAIL G1a: % simulate functions remain', n; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'core.integration.changed';
  if n <> 4 then raise exception 'FAIL G1b: % integration changes audited, expected 4 (email on, Slack off, Shopify on, Slack on)', n; end if;
  if exists (select 1 from public.audit_log where org_id = o and action = 'core.integration.changed' and summary ilike '%simulated%') then
    raise exception 'FAIL G1c: an audit summary still names a mode';
  end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
