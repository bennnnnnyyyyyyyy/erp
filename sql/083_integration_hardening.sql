-- 083_integration_hardening.sql
-- Fixes from the security review of the integrations code (11 Nov 2026, after PR #42 / sql/082):
--   * medium: two companies could save the same Shopify shop address; the webhook lookup (sql/059 sal__shopify_callback_credentials,
--     "limit 1") could then pick the wrong company and that company's orders would randomly fail their signature check. Now one
--     company per shop: a unique index on the lower-cased shop domain (live had no saved shop domain when this was written).
--   * low: a Teams webhook URL could point at any https host. Now only Microsoft's Teams and Power Automate hosts
--     (*.webhook.office.com, *.logic.azure.com, *.api.powerplatform.com). core_set_integration_secret is recreated from its latest
--     definition (sql/071) with that one extra check; nothing else changes.
-- Rerun-safe. Ends with read-only checks.

begin;

create unique index if not exists core_integrations_shopify_shop_once
  on public.core_integrations (lower(settings -> 'config' ->> 'shop_domain'))
  where kind = 'shopify' and coalesce(settings -> 'config' ->> 'shop_domain', '') <> '';

create or replace function public.core_set_integration_secret(p_kind text, p_secret text) returns text
language plpgsql security definer set search_path = public, vault as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_secret text := trim(coalesce(p_secret, ''));
  v_hint text; v_sid uuid;
begin
  if p_kind not in ('slack', 'teams', 'google_chat') then raise exception 'INVALID_INPUT' using detail = 'only Slack, Teams and Google Chat take a webhook URL'; end if;
  if length(v_secret) not between 20 and 2000 or v_secret !~ '^https://[^\s/]+/\S+$' then
    raise exception 'INVALID_INPUT' using detail = 'paste the full https webhook URL';
  end if;
  if p_kind = 'slack' and v_secret !~ '^https://hooks\.slack(-gov)?\.com/' then
    raise exception 'INVALID_INPUT' using detail = 'a Slack webhook URL starts with https://hooks.slack.com/';
  end if;
  if p_kind = 'google_chat' and v_secret !~ '^https://chat\.googleapis\.com/v1/spaces/\S+$' then
    raise exception 'INVALID_INPUT' using detail = 'a Google Chat webhook URL starts with https://chat.googleapis.com/v1/spaces/';
  end if;
  -- sql/083: Teams only on Microsoft's own hosts (Teams connectors, Power Automate workflows).
  if p_kind = 'teams' and v_secret !~ '^https://([A-Za-z0-9-]+\.)+(webhook\.office\.com|logic\.azure\.com|api\.powerplatform\.com)(:443)?/' then
    raise exception 'INVALID_INPUT' using detail = 'a Teams webhook URL is on webhook.office.com, logic.azure.com or api.powerplatform.com';
  end if;
  v_hint := '…' || right(v_secret, 6);
  insert into public.core_integrations (org_id, kind, updated_by) values (v_org, p_kind, auth.uid())
  on conflict (org_id, kind) do nothing;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if r.secret_id is null then
    v_sid := vault.create_secret(v_secret, format('erp-%s-%s', p_kind, v_org), format('%s webhook URL for organization %s', p_kind, v_org));
  else
    perform vault.update_secret(r.secret_id, v_secret);
    v_sid := r.secret_id;
  end if;
  update public.core_integrations set secret_id = v_sid, secret_hint = v_hint, updated_by = auth.uid(), last_status = null, last_error = null where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.integration.secret_set', 'integration', r.id::text, format('%s webhook URL saved (%s)', p_kind, v_hint),
          jsonb_build_object('hint', v_hint));   -- never the secret itself
  return v_hint;
end $$;

-- "Check connection" (sql/082) read the company's keys before the database had checked the role (only the route had), and could be
-- pressed endlessly (each press sends a real email, posts to a channel, or creates a real 1 EGP Paymob request). The route now calls
-- this first, with the person's own sign-in: owners and admins only, and at most one check of the same integration every 30 seconds.
alter table public.core_integrations add column if not exists last_check_started_at timestamptz;

create or replace function public.core_begin_integration_check(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'save the integration first'; end if;
  if r.last_check_started_at is not null and r.last_check_started_at > now() - interval '30 seconds' then
    raise exception 'TOO_SOON' using detail = 'wait 30 seconds before checking again';
  end if;
  update public.core_integrations set last_check_started_at = now() where id = r.id;
end $$;
revoke all on function public.core_begin_integration_check(text) from public, anon;
grant execute on function public.core_begin_integration_check(text) to authenticated;

commit;

-- Read-only verification.
select exists (select 1 from pg_indexes where indexname = 'core_integrations_shopify_shop_once') as shopify_shop_once,
       position('powerplatform' in pg_get_functiondef('public.core_set_integration_secret(text, text)'::regprocedure)) > 0 as teams_hosts_pinned,
       has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute') as anon_sets_secret,
       has_function_privilege('anon', 'public.core_begin_integration_check(text)', 'execute') as anon_begins_check;
