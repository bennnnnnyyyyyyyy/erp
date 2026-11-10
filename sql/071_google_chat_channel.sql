-- sql/071_google_chat_channel.sql
-- Google Chat as an alert channel, like Slack and Microsoft Teams (owner-approved: documentation/planning/2026-11-09-google-sheets-options.md,
-- "Other Google services"). Rerun-safe. Needs sql/001-070.
--
-- A company pastes its Google Chat space's incoming-webhook URL in Settings > Integrations; alerts and approval notices that go to Slack
-- or Teams can go to Google Chat too. Everything else is unchanged: the URL is stored in Supabase Vault (only its id is kept, and users
-- can neither read the secret nor its id), the delivery job reads it through core__integration_secret, messages are routed by the same
-- trigger (a channel post has no recipient, one per subject per transaction), and the delivery result is written back to the integration.
-- What changes here, each recreated from its latest definition:
--   * core_integrations.kind and msg_outbox.channel accept 'google_chat' (sql/056 and sql/054 lists); a channel post may have no recipient
--     for it too (sql/053).
--   * core_save_integration (sql/061): accepts 'google_chat'; live needs a saved URL, as for Slack and Teams.
--   * core_set_integration_secret (sql/053): accepts 'google_chat'; the URL must start with https://chat.googleapis.com/v1/spaces/.
--   * msg_complete_delivery (sql/054): also records Google Chat's last outcome on the integration.
-- core_clear_integration_secret, core_test_integration, msg__route_integrations and core__integration_secret already work for any kind.

begin;

-- ---------------------------------------------------------------- the new kind and channel

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in
  ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama'));

alter table public.msg_outbox drop constraint if exists msg_outbox_channel_check;
alter table public.msg_outbox add constraint msg_outbox_channel_check
  check (channel in ('in_app', 'fake', 'email', 'whatsapp', 'voice', 'slack', 'teams', 'telegram', 'google_chat'));
alter table public.msg_outbox drop constraint if exists msg_outbox_recipient_unless_channel_post;
alter table public.msg_outbox add constraint msg_outbox_recipient_unless_channel_post
  check (recipient_id is not null or channel in ('slack', 'teams', 'google_chat'));

-- ---------------------------------------------------------------- switching it on (sql/061's function; Google Chat added)

create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama')
     or p_enabled is null or p_mode not in ('simulated', 'live') then raise exception 'INVALID_INPUT'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_mode = 'live' and p_kind in ('slack', 'teams', 'google_chat') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching to live';
  end if;
  if p_mode = 'live' then
    select array_agg(f.field) into v_missing from public.core__provider_fields(p_kind) f
     where f.required and not coalesce((r.settings -> 'saved_fields') ? f.field, false);
    if v_missing is not null then raise exception 'INVALID_STATE' using detail = format('save %s before switching to live', array_to_string(v_missing, ', ')); end if;
  end if;
  -- 061: every AI provider, Ollama included, needs the owner's acceptance of the CURRENT notice.
  if p_kind in ('openai', 'elevenlabs', 'ollama') and p_enabled and not public.core__ai_consent_current(v_org) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the current AI data notice first';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, p_mode, p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = excluded.mode, enabled = excluded.enabled,
    settings = public.core_integrations.settings || jsonb_build_object('kinds', to_jsonb(v_kinds)), updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s, %s', p_kind, case when p_enabled then 'on' else 'off' end, p_mode),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'mode', r.mode, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'mode', p_mode, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- the webhook URL (sql/053's function; Google Chat added)

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

-- ---------------------------------------------------------------- the delivery result (sql/054's function; Google Chat added)

create or replace function public.msg_complete_delivery(p_id uuid, p_ok boolean, p_error text default null, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.msg_outbox;
begin
  perform public.msg_complete(p_id, p_ok, p_error);
  update public.msg_outbox set delivered_via = left(p_via, 40) where id = p_id returning * into m;
  if m.channel in ('email', 'slack', 'teams', 'telegram', 'google_chat') then
    update public.core_integrations set last_status = case when p_ok then 'sent' else 'failed' end,
      last_error = case when p_ok then null else left(p_error, 500) end, last_delivery_at = now()
     where org_id = m.org_id and kind = m.channel;
  end if;
end $$;

-- ---------------------------------------------------------------- privileges (unchanged; restated for the recreated functions)

revoke all on function public.msg_complete_delivery(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.msg_complete_delivery(uuid, boolean, text, text) to service_role;
revoke all on function public.core_save_integration(text, boolean, text, text[]), public.core_set_integration_secret(text, text) from public, anon;
grant execute on function public.core_save_integration(text, boolean, text, text[]), public.core_set_integration_secret(text, text) to authenticated;

commit;

-- Verification (read-only): the new kind and channel are allowed; users cannot read secrets or complete deliveries; anon calls nothing.
select pg_get_constraintdef(oid) as integration_kinds from pg_constraint where conname = 'core_integrations_kind_check';
select pg_get_constraintdef(oid) as channels from pg_constraint where conname in ('msg_outbox_channel_check', 'msg_outbox_recipient_unless_channel_post');
select has_column_privilege('authenticated', 'public.core_integrations', 'secret_id', 'select') as users_see_secret_id,
       has_function_privilege('authenticated', 'public.core__integration_secret(uuid, text)', 'execute') as users_read_secrets,
       has_function_privilege('authenticated', 'public.msg_complete_delivery(uuid, boolean, text, text)', 'execute') as users_complete_deliveries,
       has_function_privilege('anon', 'public.core_set_integration_secret(text, text)', 'execute') as anon_sets_secrets,
       has_function_privilege('anon', 'public.core_save_integration(text, boolean, text, text[])', 'execute') as anon_saves_integrations;
