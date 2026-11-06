-- sql/054_telegram.sql
-- Integrations wave 1, last item (documentation/plans/INTEGRATIONS_PLAN.md; documentation/reference/04-telegram): Telegram as a
-- delivery channel. Rerun-safe. Needs sql/001-053.
--
-- * Linking: a person asks for a link in the app (msg_telegram_link_start). They get a single-use code (stored only as a hash,
--   valid 10 minutes) inside a t.me deep link to our bot. Pressing Start sends "/start <code>" to our webhook, which checks
--   Telegram's secret header and calls msg__telegram_link_complete (service role). That function records the person's Telegram chat
--   as a verified identity (msg_identities, channel 'telegram', address = the numeric chat id). A bot cannot message anyone first,
--   so this step is also what allows us to write to them.
-- * Delivery: Telegram is a kind of core_integrations (switched on per company, simulated or live, chosen message kinds, as email).
--   Copies go only to people who have linked Telegram in that company.
-- * Telegram never decides anything: messages carry an "Open in the app" button, nothing else.

begin;

-- ---------------------------------------------------------------- identities accept Telegram chats

alter table public.msg_identities drop constraint if exists msg_identities_channel_check;
alter table public.msg_identities add constraint msg_identities_channel_check check (channel in ('whatsapp', 'voice', 'telegram'));
alter table public.msg_identities drop constraint if exists msg_identities_address_check;
alter table public.msg_identities add constraint msg_identities_address_check check (
  (channel <> 'telegram' and address ~ '^\+[1-9][0-9]{7,14}$') or (channel = 'telegram' and address ~ '^[1-9][0-9]{0,19}$'));

-- Single-use link codes (hash only). Nobody reads this table but the functions below.
create table if not exists public.msg_link_codes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  user_id     uuid not null references auth.users(id),
  channel     text not null check (channel = 'telegram'),
  code_hash   text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists msg_link_codes_user_idx on public.msg_link_codes (org_id, user_id, created_at desc);
alter table public.msg_link_codes enable row level security;
revoke all on public.msg_link_codes from anon, authenticated;

-- Step 1 (the person, in the app): a fresh code. Earlier unused codes stop working. At most 5 an hour.
create or replace function public.msg_telegram_link_start() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid := public.mod__guard('messaging', array['owner', 'admin', 'member', 'viewer']); v_code text;
begin
  if (select count(*) from public.msg_link_codes c where c.org_id = v_org and c.user_id = auth.uid() and c.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  update public.msg_link_codes set used_at = now() where org_id = v_org and user_id = auth.uid() and used_at is null;
  v_code := encode(gen_random_bytes(18), 'hex');   -- 36 characters: Telegram's start parameter allows up to 64 of [A-Za-z0-9_-]
  insert into public.msg_link_codes (org_id, user_id, channel, code_hash, expires_at)
  values (v_org, auth.uid(), 'telegram', encode(digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes');
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'messaging.identity.started', 'identity', auth.uid()::text, 'Telegram link requested');
  return v_code;
end $$;

-- Step 2 (our webhook, service role, after checking Telegram's secret header): link the chat to the person who asked.
create or replace function public.msg__telegram_link_complete(p_code text, p_chat_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.msg_link_codes; v_chat text := trim(coalesce(p_chat_id, '')); v_org_name text; v_id uuid;
begin
  if coalesce(p_code, '') !~ '^[0-9a-f]{36}$' or v_chat !~ '^[1-9][0-9]{0,19}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into c from public.msg_link_codes where code_hash = encode(digest(p_code, 'sha256'), 'hex') for update;
  if not found or c.used_at is not null or c.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  update public.msg_link_codes set used_at = now() where id = c.id;
  if not exists (select 1 from public.memberships m where m.org_id = c.org_id and m.user_id = c.user_id and m.disabled_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  -- One person per chat in a company: a chat already linked to someone else stays theirs.
  if exists (select 1 from public.msg_identities i where i.org_id = c.org_id and i.channel = 'telegram' and i.address = v_chat
              and i.status = 'verified' and i.user_id <> c.user_id) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  update public.msg_identities set status = 'revoked', revoked_at = now()
   where org_id = c.org_id and user_id = c.user_id and channel = 'telegram' and status in ('verified', 'pending');
  insert into public.msg_identities (org_id, user_id, channel, address, status, verified_at)
  values (c.org_id, c.user_id, 'telegram', v_chat, 'verified', now()) returning id into v_id;
  select name into v_org_name from public.organizations where id = c.org_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (c.org_id, c.user_id, 'messaging.identity.verified', 'identity', v_id::text, format('Telegram chat %s linked', public.msg__mask(v_chat)));
  return jsonb_build_object('ok', true, 'org', v_org_name);
end $$;

-- For the delivery job only: the recipient's linked Telegram chat, while they are an active member.
create or replace function public.msg__recipient_telegram(p_outbox_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select i.address from public.msg_outbox o
    join public.memberships m on m.org_id = o.org_id and m.user_id = o.recipient_id and m.disabled_at is null
    join public.msg_identities i on i.org_id = o.org_id and i.user_id = o.recipient_id and i.channel = 'telegram' and i.status = 'verified'
   where o.id = p_outbox_id;
$$;

-- ---------------------------------------------------------------- Telegram as an integration and an outbox channel

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in ('email', 'slack', 'teams', 'telegram'));
alter table public.msg_outbox drop constraint if exists msg_outbox_channel_check;
alter table public.msg_outbox add constraint msg_outbox_channel_check check (channel in ('in_app', 'fake', 'email', 'whatsapp', 'voice', 'slack', 'teams', 'telegram'));

-- sql/053's functions, with 'telegram' accepted (unchanged otherwise).
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram') or p_enabled is null or p_mode not in ('simulated', 'live') then raise exception 'INVALID_INPUT'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_mode = 'live' and p_kind in ('slack', 'teams') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching to live';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, p_mode, p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = excluded.mode, enabled = excluded.enabled,
    settings = public.core_integrations.settings || excluded.settings, updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s, %s', p_kind, case when p_enabled then 'on' else 'off' end, p_mode),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'mode', r.mode, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'mode', p_mode, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;

create or replace function public.core_test_integration(p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid;
begin
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind;
  if not found then raise exception 'NOT_FOUND' using detail = 'save the integration first'; end if;
  if p_kind = 'telegram' and not exists (select 1 from public.msg_identities i where i.org_id = v_org and i.user_id = auth.uid()
                                          and i.channel = 'telegram' and i.status = 'verified') then
    raise exception 'INVALID_STATE' using detail = 'link your own Telegram first (Messages → Connect)';
  end if;
  insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, idempotency_key, max_attempts)
  values (v_org, case when p_kind in ('email', 'telegram') then auth.uid() end, p_kind, 'info', 'Test message from the ERP',
          format('This is a test of the %s integration (%s mode). Nothing is wrong.', p_kind, r.mode),
          format('integration-test:%s:%s', p_kind, gen_random_uuid()), 1)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.integration.tested', 'integration', r.id::text, format('%s test message queued', p_kind));
  return v_id;
end $$;

-- Routing (sql/053) with Telegram: a copy per person who has linked Telegram in this company.
create or replace function public.msg__route_integrations() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  if new.channel <> 'in_app' then return null; end if;
  for i in select kind, settings from public.core_integrations where org_id = new.org_id and enabled loop
    continue when not coalesce((i.settings -> 'kinds') ? new.kind, false);
    if i.kind in ('email', 'telegram') then
      continue when i.kind = 'telegram' and not exists (select 1 from public.msg_identities x where x.org_id = new.org_id
                                                          and x.user_id = new.recipient_id and x.channel = 'telegram' and x.status = 'verified');
      insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, expires_at)
      values (new.org_id, new.recipient_id, i.kind, new.kind, new.subject, new.body, new.entity_type, new.entity_id, new.idempotency_key || ':' || i.kind, new.expires_at)
      on conflict (org_id, idempotency_key) do nothing;
    else
      insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, expires_at)
      values (new.org_id, null, i.kind, new.kind, new.subject, new.body, new.entity_type, new.entity_id,
              format('chan:%s:%s:%s:%s', i.kind, new.kind, md5(new.subject || coalesce(new.entity_id::text, '')), txid_current()), new.expires_at)
      on conflict (org_id, idempotency_key) do nothing;
    end if;
  end loop;
  return null;
end $$;

-- msg_complete_delivery (sql/053) also records Telegram's last outcome on the integration.
create or replace function public.msg_complete_delivery(p_id uuid, p_ok boolean, p_error text default null, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.msg_outbox;
begin
  perform public.msg_complete(p_id, p_ok, p_error);
  update public.msg_outbox set delivered_via = left(p_via, 40) where id = p_id returning * into m;
  if m.channel in ('email', 'slack', 'teams', 'telegram') then
    update public.core_integrations set last_status = case when p_ok then 'sent' else 'failed' end,
      last_error = case when p_ok then null else left(p_error, 500) end, last_delivery_at = now()
     where org_id = m.org_id and kind = m.channel;
  end if;
end $$;

revoke all on function public.msg__telegram_link_complete(text, text), public.msg__recipient_telegram(uuid), public.msg__route_integrations(),
  public.msg_complete_delivery(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.msg__telegram_link_complete(text, text), public.msg__recipient_telegram(uuid), public.msg_complete_delivery(uuid, boolean, text, text)
  to service_role;
revoke all on function public.msg_telegram_link_start(), public.core_save_integration(text, boolean, text, text[]), public.core_test_integration(text) from public, anon;
grant execute on function public.msg_telegram_link_start(), public.core_save_integration(text, boolean, text, text[]), public.core_test_integration(text) to authenticated;

commit;

-- Verification (read-only).
select relrowsecurity as link_codes_rls from pg_class where relname = 'msg_link_codes';
select has_table_privilege('authenticated', 'public.msg_link_codes', 'select') as users_read_codes,
       has_function_privilege('authenticated', 'public.msg__telegram_link_complete(text, text)', 'execute') as users_complete_links,
       has_function_privilege('anon', 'public.msg_telegram_link_start()', 'execute') as anon_starts_links;
