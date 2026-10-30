-- 008_identity_binding.sql
-- S2 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): bind a phone number to a person before it can decide anything.
-- A delivered message is not proof of identity: a number counts only after its owner proved control with a one-time
-- code sent to that number. Codes are stored only as a hash, expire in 10 minutes, allow 5 tries, and are never readable
-- by any signed-in user (outbox column `secret_body` has no SELECT privilege and is cleared once the message has an outcome).
-- Depends on sql/001-007. Rerun-safe. No data is dropped. Run the whole file, then sql/tests/004_identity_binding.sql.

begin;

-- ---------------------------------------------------------------- outbox: a secret part of a message, and more kinds

alter table public.msg_outbox add column if not exists secret_body text;

alter table public.msg_outbox drop constraint if exists msg_outbox_kind_check;
alter table public.msg_outbox add constraint msg_outbox_kind_check check (kind in
  ('approval_request', 'decision', 'task_assigned', 'task_update', 'reminder', 'escalation', 'info', 'verification', 'alert'));

-- Signed-in users read every outbox column except the secret one (row level security still limits the rows).
revoke select on public.msg_outbox from authenticated;
grant select (id, org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, status, attempts,
              max_attempts, next_attempt_at, expires_at, last_error, sent_at, created_at, updated_at)
  on public.msg_outbox to authenticated;

-- Same as 007, plus: the secret part is wiped as soon as a message reaches an outcome.
create or replace function public.msg_complete(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.msg_outbox;
begin
  select * into r from public.msg_outbox o where o.id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'sending' then raise exception 'INVALID_STATE' using detail = format('message is %s', r.status); end if;
  if p_ok then
    update public.msg_outbox o set status = 'sent', sent_at = now(), last_error = null, secret_body = null where o.id = r.id;
    insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
    values (r.org_id, 'messaging.message.sent', 'message', r.id::text, format('Message "%s" sent', r.subject),
            jsonb_build_object('channel', r.channel, 'kind', r.kind, 'recipient', r.recipient_id, 'attempts', r.attempts));
  elsif r.attempts >= r.max_attempts then
    update public.msg_outbox o set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 500), secret_body = null where o.id = r.id;
    insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
    values (r.org_id, 'messaging.message.failed', 'message', r.id::text, format('Message "%s" failed after %s attempts', r.subject, r.attempts),
            jsonb_build_object('channel', r.channel, 'kind', r.kind, 'recipient', r.recipient_id, 'attempts', r.attempts, 'error', left(coalesce(p_error, 'failed'), 200)));
  else
    update public.msg_outbox o set status = 'pending', last_error = left(coalesce(p_error, 'failed'), 500),
      next_attempt_at = now() + interval '1 minute' * power(2, r.attempts - 1) where o.id = r.id;
  end if;
end $$;

-- Same as 007, plus: an expired message loses its secret part.
create or replace function public.msg_claim_due(p_limit int default 20) returns setof public.msg_outbox
language plpgsql security definer set search_path = public as $$
begin
  with ex as (
    update public.msg_outbox set status = 'expired', secret_body = null where status = 'pending' and expires_at <= now()
    returning org_id, id, kind, subject, recipient_id, channel
  )
  insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
  select ex.org_id, 'messaging.message.expired', 'message', ex.id::text, format('Message "%s" expired before it was delivered', ex.subject),
         jsonb_build_object('channel', ex.channel, 'kind', ex.kind, 'recipient', ex.recipient_id)
  from ex;
  update public.msg_outbox set status = 'pending' where status = 'sending' and updated_at < now() - interval '5 minutes';
  return query
    update public.msg_outbox o set status = 'sending', attempts = o.attempts + 1
    where o.id in (
      select q.id from public.msg_outbox q
      where q.status = 'pending' and q.next_attempt_at <= now() and q.expires_at > now()
      order by q.next_attempt_at, q.created_at
      limit p_limit
      for update skip locked
    )
    returning o.*;
end $$;

-- ---------------------------------------------------------------- identities

create table if not exists public.msg_identities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  user_id         uuid not null references auth.users(id),
  channel         text not null check (channel in ('whatsapp', 'voice')),
  address         text not null check (address ~ '^\+[1-9][0-9]{7,14}$'),
  status          text not null default 'pending' check (status in ('pending', 'verified', 'revoked')),
  code_hash       text,
  code_expires_at timestamptz,
  attempts        int not null default 0,
  verified_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One person per verified number in an organization, and one verified number per person per channel.
create unique index if not exists msg_identities_verified_addr_uidx on public.msg_identities (org_id, channel, address) where status = 'verified';
create unique index if not exists msg_identities_verified_user_uidx on public.msg_identities (org_id, user_id, channel) where status = 'verified';
create index if not exists msg_identities_user_idx on public.msg_identities (org_id, user_id, created_at desc);

drop trigger if exists msg_identities_updated_at on public.msg_identities;
create trigger msg_identities_updated_at before update on public.msg_identities for each row execute function public.set_updated_at();

alter table public.msg_identities enable row level security;
revoke all on public.msg_identities from anon, authenticated;
-- A person reads their own rows; the code hash is not exposed.
grant select (id, org_id, user_id, channel, address, status, verified_at, revoked_at, created_at) on public.msg_identities to authenticated;
drop policy if exists msg_identities_own_read on public.msg_identities;
create policy msg_identities_own_read on public.msg_identities for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id));

-- Last three digits only, so the audit log does not hold whole phone numbers.
create or replace function public.msg__mask(p_address text) returns text
language sql immutable set search_path = public as $$ select '***' || right(p_address, 3) $$;

-- Step 1: ask for a code to be sent to the number. Returns the identity id; the code travels only through the outbox.
create or replace function public.msg_identity_start(p_channel text, p_address text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.mod__guard('messaging', array['owner', 'admin', 'member']);
  v_addr text := regexp_replace(coalesce(p_address, ''), '[\s-]', '', 'g');
  v_id   uuid := gen_random_uuid();
  v_b    bytea := gen_random_bytes(3);
  v_code text;
  v_msg  uuid;
begin
  if p_channel not in ('whatsapp', 'voice') or v_addr !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_INPUT' using detail = 'use an international number such as +201001234567';
  end if;
  if (select count(*) from public.msg_identities i where i.org_id = v_org and i.user_id = auth.uid() and i.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  if exists (select 1 from public.msg_identities i where i.org_id = v_org and i.channel = p_channel and i.address = v_addr and i.status = 'verified' and i.user_id <> auth.uid()) then
    raise exception 'INVALID_INPUT' using detail = 'that number is already in use by someone else';
  end if;

  update public.msg_identities i set status = 'revoked', revoked_at = now()
  where i.org_id = v_org and i.user_id = auth.uid() and i.channel = p_channel and i.status = 'pending';

  v_code := lpad(((get_byte(v_b, 0) * 65536 + get_byte(v_b, 1) * 256 + get_byte(v_b, 2)) % 1000000)::text, 6, '0');
  insert into public.msg_identities (id, org_id, user_id, channel, address, code_hash, code_expires_at)
  values (v_id, v_org, auth.uid(), p_channel, v_addr, encode(digest(v_code || ':' || v_id::text, 'sha256'), 'hex'), now() + interval '10 minutes');

  v_msg := public.msg__enqueue(v_org, auth.uid(), 'verification', 'Your verification code', 'Use the code in this message to confirm this number.',
                               'identity', v_id, format('identity:%s:code', v_id), p_channel);
  if v_msg is null then raise exception 'MODULE_DISABLED'; end if;
  update public.msg_outbox set secret_body = 'Your verification code is ' || v_code || '. It expires in 10 minutes. Do not share it.',
         expires_at = now() + interval '10 minutes', max_attempts = 2 where id = v_msg;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'messaging.identity.started', 'identity', v_id::text, format('Verification code requested for %s on %s', public.msg__mask(v_addr), p_channel));
  return v_id;
end $$;

-- Step 2: the person types the code. Returns true when the number is now verified. A wrong or expired code returns
-- false (and is audited); five wrong tries revoke the attempt.
create or replace function public.msg_identity_confirm(p_identity_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid := public.mod__guard('messaging', array['owner', 'admin', 'member']);
  r     public.msg_identities;
begin
  select * into r from public.msg_identities i where i.org_id = v_org and i.id = p_identity_id and i.user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then return false; end if;

  if r.code_expires_at <= now() then
    update public.msg_identities i set status = 'revoked', revoked_at = now() where i.id = r.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_org, auth.uid(), 'messaging.identity.failed', 'identity', r.id::text, format('Code for %s expired', public.msg__mask(r.address)));
    return false;
  end if;

  if encode(digest(coalesce(p_code, '') || ':' || r.id::text, 'sha256'), 'hex') <> r.code_hash then
    update public.msg_identities i set attempts = i.attempts + 1,
           status = case when i.attempts + 1 >= 5 then 'revoked' else i.status end,
           revoked_at = case when i.attempts + 1 >= 5 then now() else i.revoked_at end
    where i.id = r.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_org, auth.uid(), 'messaging.identity.failed', 'identity', r.id::text, format('Wrong code for %s (try %s)', public.msg__mask(r.address), r.attempts + 1));
    return false;
  end if;

  -- A new verified number replaces the old one; decision tokens issued before this moment stop working (see sql/009).
  update public.msg_identities i set status = 'revoked', revoked_at = now()
  where i.org_id = v_org and i.user_id = auth.uid() and i.channel = r.channel and i.status = 'verified';
  update public.msg_identities i set status = 'verified', verified_at = now(), code_hash = null, code_expires_at = null where i.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'messaging.identity.verified', 'identity', r.id::text, format('Number %s verified on %s', public.msg__mask(r.address), r.channel));
  return true;
end $$;

-- The person, or an owner or admin, removes a number. It can no longer decide anything.
create or replace function public.msg_identity_revoke(p_identity_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.mod__guard('messaging', array['owner', 'admin', 'member', 'viewer']);
  r      public.msg_identities;
  v_role text;
begin
  select * into r from public.msg_identities i where i.org_id = v_org and i.id = p_identity_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if r.user_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if r.status = 'revoked' then raise exception 'INVALID_STATE'; end if;
  update public.msg_identities i set status = 'revoked', revoked_at = now(), code_hash = null where i.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'messaging.identity.revoked', 'identity', r.id::text, format('Number %s removed', public.msg__mask(r.address)));
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.msg__mask(text) from public, anon, authenticated;
revoke all on function public.msg_identity_start(text, text) from public, anon;
revoke all on function public.msg_identity_confirm(uuid, text) from public, anon;
revoke all on function public.msg_identity_revoke(uuid) from public, anon;
grant execute on function public.msg_identity_start(text, text) to authenticated;
grant execute on function public.msg_identity_confirm(uuid, text) to authenticated;
grant execute on function public.msg_identity_revoke(uuid) to authenticated;
revoke all on function public.msg_complete(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.msg_claim_due(int) from public, anon, authenticated;
grant execute on function public.msg_complete(uuid, boolean, text) to service_role;
grant execute on function public.msg_claim_due(int) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only; run each on its own)

-- 1. Signed-in users cannot read the secret column or the code hash (expect two rows, both false).
select 'msg_outbox.secret_body' as col, has_column_privilege('authenticated', 'public.msg_outbox', 'secret_body', 'select') as can_read
union all select 'msg_identities.code_hash', has_column_privilege('authenticated', 'public.msg_identities', 'code_hash', 'select');
