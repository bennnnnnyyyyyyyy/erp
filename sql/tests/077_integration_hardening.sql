-- sql/tests/077_integration_hardening.sql
-- Integration hardening (sql/083). Always rolls back. Needs sql/001-083.
-- Covers: a Teams webhook URL on any other host is refused, Microsoft's Teams and Power Automate hosts are accepted; Slack and Google
-- Chat rules unchanged; a Shopify shop saved by one company cannot be saved by another (case-insensitive), the same company can save
-- it again; anonymous callers cannot set secrets.

do $$
declare
  u uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; ok boolean; h text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ih-a@tests.invalid'), (x, 'authenticated', 'authenticated', 'ih-b@tests.invalid');
  o := public.bootstrap_organization('Hardening A', 'hardening-a', 'ih-a@tests.invalid');
  ob := public.bootstrap_organization('Hardening B', 'hardening-b', 'ih-b@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- T1: Teams only on Microsoft's hosts
  ok := false; begin perform public.core_set_integration_secret('teams', 'https://attacker.example.com/hook/abcdefghijklmnop');
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1a: a Teams URL on another host was accepted'; end if;
  ok := false; begin perform public.core_set_integration_secret('teams', 'https://evil.com/webhook.office.com/abcdefghijk');
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T1b: a look-alike Teams URL was accepted'; end if;
  h := public.core_set_integration_secret('teams', 'https://contoso.webhook.office.com/webhookb2/abcdef-1234/IncomingWebhook/xyz');
  if h is null then raise exception 'FAIL T1c: a Teams connector URL was refused'; end if;
  h := public.core_set_integration_secret('teams', 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?sig=x');
  if h is null then raise exception 'FAIL T1d: a Power Automate URL was refused'; end if;

  -- ---- T2: Slack and Google Chat rules unchanged
  ok := false; begin perform public.core_set_integration_secret('slack', 'https://contoso.webhook.office.com/webhookb2/abcdefghij');
  exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T2a: Slack took a non-Slack URL'; end if;
  h := public.core_set_integration_secret('google_chat', 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t');
  if h is null then raise exception 'FAIL T2b: a Google Chat URL was refused'; end if;

  -- ---- T3: one company per Shopify shop
  perform public.core_save_provider_fields('shopify', '{"shop_domain": "shared-shop.myshopify.com", "webhook_secret": "s1"}');
  perform public.core_save_provider_fields('shopify', '{"shop_domain": "shared-shop.myshopify.com", "webhook_secret": "s1b"}');  -- same company again: fine
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_save_provider_fields('shopify', '{"shop_domain": "shared-shop.myshopify.com", "webhook_secret": "s2"}');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL T3a: a second company saved the same Shopify shop'; end if;
  perform public.core_save_provider_fields('shopify', '{"shop_domain": "other-shop.myshopify.com", "webhook_secret": "s3"}');

  -- ---- T5: a connection check needs owner/admin (checked by the database first) and waits 30 seconds between checks
  perform public.core_begin_integration_check('shopify');
  ok := false; begin perform public.core_begin_integration_check('shopify'); exception when others then ok := (sqlerrm = 'TOO_SOON'); end;
  if not ok then raise exception 'FAIL T5a: a second check within 30 seconds was allowed'; end if;
  ok := false; begin perform public.core_begin_integration_check('ollama'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T5b: a check of an integration never saved was allowed'; end if;
  reset role;
  insert into auth.users (id, aud, role, email) values ('00000000-0000-4000-8000-0000000000b7', 'authenticated', 'authenticated', 'ih-m@tests.invalid')
    on conflict do nothing;
  insert into public.memberships (org_id, user_id, role) values (ob, '00000000-0000-4000-8000-0000000000b7', 'member');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000b7', 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_begin_integration_check('teams'); exception when others then ok := (sqlerrm <> 'TOO_SOON' and sqlerrm <> 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T5c: a member could start a connection check'; end if;

  reset role;
  if has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute') then raise exception 'FAIL T4: anonymous can set secrets'; end if;
  if has_function_privilege('anon', 'public.core_begin_integration_check(text)', 'execute') then raise exception 'FAIL T4b: anonymous can start checks'; end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
