-- 009_decision_tokens.sql
-- S3 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): approve or reject a stock request by replying on a verified
-- WhatsApp number. The reply does NOT decide anything by itself: it is turned into a call to the same function the app uses
-- (inv_decide_request), as the approver, so the role check, the "not your own request" rule, the state check and the
-- audit entry (with channel 'whatsapp') are identical.
--
-- A token is single use, expires, belongs to one request, one approver and one channel, and is only accepted from that
-- approver's VERIFIED number and only if it was issued after that number was verified (re-binding a number invalidates
-- older tokens). The token text is only ever in the outbox `secret_body` (not readable by users, cleared after delivery);
-- the database keeps a hash.
-- Depends on sql/001-008. Rerun-safe. Run the whole file, then sql/tests/005_decision_tokens.sql.

begin;

create table if not exists public.msg_tokens (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  request_id  uuid not null,
  approver_id uuid not null references auth.users(id),
  channel     text not null check (channel in ('whatsapp', 'voice')),
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (request_id, approver_id, channel),
  foreign key (org_id, request_id) references public.inv_requests (org_id, id)
);
create index if not exists msg_tokens_approver_idx on public.msg_tokens (approver_id, channel) where used_at is null;

alter table public.msg_tokens enable row level security;
revoke all on public.msg_tokens from anon, authenticated;   -- nobody signed in reads tokens, not even their own

-- Short, unambiguous, single-use code (no 0, O, 1, I, L).
create or replace function public.msg__new_token() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_b bytea := gen_random_bytes(6);
  v_out text := '';
begin
  for i in 0..5 loop v_out := v_out || substr(v_alphabet, (get_byte(v_b, i) % length(v_alphabet)) + 1, 1); end loop;
  return v_out;
end $$;

create or replace function public.msg__token_hash(p_token text, p_request uuid, p_approver uuid) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(p_token) || ':' || p_request::text || ':' || p_approver::text, 'sha256'), 'hex')
$$;

-- Same as 007, plus: a manager with a verified WhatsApp number also gets a WhatsApp message carrying a token.
create or replace function public.inv_requests_notify() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  m       record;
  v_token text;
  v_msg   uuid;
  v_ttl   int;
begin
  if tg_op = 'INSERT' then
    select coalesce((o.settings #>> '{decisions,token_ttl_minutes}')::int, 240) into v_ttl from public.organizations o where o.id = new.org_id;
    for m in select u.user_id from public.msg__managers(new.org_id) u where u.user_id <> new.requester_id loop
      perform public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s needs your approval', new.number),
        coalesce(nullif(new.reason, ''), 'Open the request to see the items.'), 'stock_request', new.id, format('request:%s:submitted:%s', new.id, m.user_id));
      if exists (select 1 from public.msg_identities i where i.org_id = new.org_id and i.user_id = m.user_id and i.channel = 'whatsapp' and i.status = 'verified') then
        v_token := public.msg__new_token();
        v_msg := public.msg__enqueue(new.org_id, m.user_id, 'approval_request', format('%s needs your approval', new.number),
          'Reply in WhatsApp to decide, or open the app.', 'stock_request', new.id, format('request:%s:whatsapp:%s', new.id, m.user_id), 'whatsapp');
        if v_msg is not null then
          insert into public.msg_tokens (org_id, request_id, approver_id, channel, token_hash, expires_at)
          values (new.org_id, new.id, m.user_id, 'whatsapp', public.msg__token_hash(v_token, new.id, m.user_id), now() + v_ttl * interval '1 minute');
          update public.msg_outbox set secret_body = format('%s needs your approval: %s. Reply APPROVE %s to approve or REJECT %s to reject. This code works once.',
            new.number, coalesce(nullif(new.reason, ''), 'no reason given'), v_token, v_token) where id = v_msg;
        end if;
      end if;
    end loop;
  elsif new.status <> old.status then
    if new.status in ('approved', 'rejected') then
      perform public.msg__enqueue(new.org_id, new.requester_id, 'decision', format('%s was %s', new.number, new.status),
        coalesce(new.decision_comment, ''), 'stock_request', new.id, format('request:%s:decision', new.id));
    elsif new.status = 'issued' and new.issued_by is distinct from new.requester_id then
      perform public.msg__enqueue(new.org_id, new.requester_id, 'info', format('%s was issued', new.number),
        'The stock has left the warehouse.', 'stock_request', new.id, format('request:%s:issued', new.id));
    end if;
  end if;
  return null;
end $$;

-- Called by the webhook (service role) with the sender's number and the message text. Never raises for a refusal:
-- it records the refusal in the audit log and returns {ok:false, code:...}.
--   codes: OK, NOT_A_DECISION, UNKNOWN_IDENTITY, TOKEN_INVALID, TOKEN_USED, TOKEN_EXPIRED, or the database reason
--   (INVALID_STATE, FORBIDDEN, SELF_APPROVAL, MODULE_DISABLED, NOT_FOUND) when the decision function refused.
create or replace function public.msg_decide_by_token(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_addr     text := regexp_replace(coalesce(p_address, ''), '[\s-]', '', 'g');
  v_m        text[] := regexp_match(upper(trim(coalesce(p_text, ''))), '^(APPROVE|YES|REJECT|NO)\s+([A-Z2-9]{6})$');
  v_decision text;
  idn        public.msg_identities;
  tk         public.msg_tokens;
  v_found    boolean := false;
  v_code     text;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'code', 'NOT_A_DECISION'); end if;
  v_decision := case when v_m[1] in ('APPROVE', 'YES') then 'approved' else 'rejected' end;

  select * into idn from public.msg_identities i where i.channel = p_channel and i.address = v_addr and i.status = 'verified';
  if not found then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_IDENTITY'); end if;

  for tk in select t.* from public.msg_tokens t
            where t.org_id = idn.org_id and t.approver_id = idn.user_id and t.channel = p_channel
              and t.token_hash = public.msg__token_hash(v_m[2], t.request_id, t.approver_id) loop
    v_found := true;
    exit;
  end loop;

  if not v_found or tk.created_at < idn.verified_at then v_code := 'TOKEN_INVALID';
  elsif tk.used_at is not null then v_code := 'TOKEN_USED';
  elsif tk.expires_at <= now() then v_code := 'TOKEN_EXPIRED';
  end if;
  if v_code is not null then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'identity', idn.id::text,
            format('Reply from %s refused: %s', public.msg__mask(v_addr), v_code), p_channel);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  begin
    -- Act as the approver, through the same function the app uses.
    perform set_config('request.jwt.claims', json_build_object('sub', idn.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-org-id', idn.org_id)::text, true);
    update public.msg_tokens t set used_at = now() where t.id = tk.id;
    perform public.inv_decide_request(tk.request_id, v_decision, 'via ' || p_channel, p_channel);
    return jsonb_build_object('ok', true, 'code', 'OK', 'request_id', tk.request_id, 'decision', v_decision);
  exception when others then
    v_code := sqlerrm;
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'stock_request', tk.request_id::text,
          format('Reply from %s refused by the decision rules: %s', public.msg__mask(v_addr), v_code), p_channel);
  return jsonb_build_object('ok', false, 'code', v_code);
end $$;

revoke all on function public.msg__new_token() from public, anon, authenticated;
revoke all on function public.msg__token_hash(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.inv_requests_notify() from public, anon, authenticated;
revoke all on function public.msg_decide_by_token(text, text, text) from public, anon, authenticated;
grant execute on function public.msg_decide_by_token(text, text, text) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- Signed-in users cannot call the webhook function and cannot read tokens (expect false, false).
select has_function_privilege('authenticated', 'public.msg_decide_by_token(text,text,text)', 'execute') as can_call,
       has_table_privilege('authenticated', 'public.msg_tokens', 'select') as can_read_tokens;
