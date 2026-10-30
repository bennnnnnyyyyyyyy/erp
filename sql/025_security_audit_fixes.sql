-- 025_security_audit_fixes.sql
-- Fixes from the security audit of 2026-10-30 (documentation/reviews/2026-10-30-security-audit.md).
--   M-1  Member management moves into database functions called with the caller's own login: the role rules are checked
--        here and the audit row is written in the same transaction. The API no longer uses the secret key for these rows.
--   M-2  Adding someone who already has an account creates an INVITATION they must accept, instead of a membership.
--   L-2  inv_decide_request / inv_decide_adjustment accept a channel other than 'app' only when the messaging webhook
--        function vouches for it (a signed-in user can no longer label their own decision 'whatsapp' in the audit log).
--   L-3  A WhatsApp number verified in more than one organization works for all of them (lookups were per org).
--   L-4  msg_claim_due_for_org: the on-demand "process now" button delivers only the caller's organization's messages.
--   L-5  A new invite link can only be made for an account that belongs to no other organization.
-- Depends on sql/001-024. Rerun-safe. Run the whole file, then sql/tests/021_security_audit_fixes.sql.

begin;

-- ---------------------------------------------------------------- invitations (M-2)

create table if not exists public.core_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  user_id     uuid not null references auth.users(id),
  role        text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by  uuid not null references auth.users(id),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists core_invitations_pending_uidx on public.core_invitations (org_id, user_id) where status = 'pending';
create index if not exists core_invitations_user_idx on public.core_invitations (user_id) where status = 'pending';

drop trigger if exists core_invitations_updated_at on public.core_invitations;
create trigger core_invitations_updated_at before update on public.core_invitations for each row execute function public.set_updated_at();

alter table public.core_invitations enable row level security;
revoke all on public.core_invitations from anon, authenticated;
grant select on public.core_invitations to authenticated;
-- The invited person sees their own invitations; owners and admins see their organization's.
drop policy if exists core_invitations_read on public.core_invitations;
create policy core_invitations_read on public.core_invitations for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.memberships m
             where m.org_id = core_invitations.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin'))
);

-- ---------------------------------------------------------------- helpers

-- Caller's role in their current organization (after require_org_role has passed).
create or replace function public.core__my_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null
$$;

create or replace function public.core__display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = p_user
$$;

-- ---------------------------------------------------------------- members (M-1)

-- Members of the caller's organization with their sign-in facts. Any member may list (core.users.read is granted to every role).
create or replace function public.core_list_members()
returns table (id uuid, user_id uuid, role text, created_at timestamptz, disabled_at timestamptz, email text, name text, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin', 'member', 'viewer']);
begin
  return query
    select m.id, m.user_id, m.role, m.created_at, m.disabled_at, u.email::text,
           coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), '')),
           u.last_sign_in_at
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.org_id = v_org
     order by m.created_at;
end $$;

-- Pending invitations of the caller's organization. Owners and admins.
create or replace function public.core_list_invitations()
returns table (id uuid, user_id uuid, email text, role text, invited_by uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']);
begin
  return query
    select i.id, i.user_id, u.email::text, i.role, i.invited_by, i.created_at
      from public.core_invitations i join auth.users u on u.id = i.user_id
     where i.org_id = v_org and i.status = 'pending'
     order by i.created_at;
end $$;

-- Step 1 of adding someone. An existing account gets a pending invitation (they accept it after signing in); for an unknown
-- email this returns {kind: needs_account} and the API creates the account, then calls core_add_invited_account.
create or replace function public.core_invite_member(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.require_org_role(array['owner', 'admin']);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
  v_id    uuid;
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or p_role not in ('owner', 'admin', 'member', 'viewer') then raise exception 'INVALID_INPUT'; end if;
  if p_role = 'owner' and public.core__my_role(v_org) <> 'owner' then raise exception 'OWNER_ONLY'; end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then return jsonb_build_object('kind', 'needs_account'); end if;

  if exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = v_user) then raise exception 'ALREADY_MEMBER'; end if;
  select i.id into v_id from public.core_invitations i where i.org_id = v_org and i.user_id = v_user and i.status = 'pending';
  if v_id is not null then return jsonb_build_object('kind', 'invitation', 'id', v_id); end if;

  insert into public.core_invitations (org_id, user_id, role, invited_by) values (v_org, v_user, p_role, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'member.invitation_created', 'invitation', v_id::text, format('%s invited as %s (waiting for them to accept)', v_email, p_role),
          jsonb_build_object('email', v_email, 'role', p_role));
  return jsonb_build_object('kind', 'invitation', 'id', v_id);
end $$;

-- Step 2 for a brand-new account: only an account this organization just created (app_metadata.invited_org_id), that has
-- never signed in and belongs to no organization, can be made a member directly. Any other account must accept an invitation.
create or replace function public.core_add_invited_account(p_user_id uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
  u     auth.users;
  v_id  uuid;
begin
  if p_role not in ('owner', 'admin', 'member', 'viewer') then raise exception 'INVALID_INPUT'; end if;
  if p_role = 'owner' and public.core__my_role(v_org) <> 'owner' then raise exception 'OWNER_ONLY'; end if;
  select * into u from auth.users x where x.id = p_user_id;
  if not found or u.last_sign_in_at is not null or (u.raw_app_meta_data ->> 'invited_org_id') is distinct from v_org::text
     or exists (select 1 from public.memberships m where m.user_id = p_user_id) then
    raise exception 'FORBIDDEN' using detail = 'only an account this organization has just created can be added directly';
  end if;
  insert into public.memberships (org_id, user_id, role, invited_by) values (v_org, p_user_id, p_role, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'member.invited', 'membership', v_id::text, format('%s invited as %s', u.email, p_role),
          jsonb_build_object('email', u.email, 'role', p_role));
  return v_id;
end $$;

-- Change a member's role. Same rules the API used to check, now with the organization's owner rows locked so two
-- concurrent changes cannot remove the last owner.
create or replace function public.core_set_member_role(p_membership_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.require_org_role(array['owner', 'admin']);
  v_me     text := public.core__my_role(v_org);
  t        public.memberships;
  v_owners int;
begin
  if p_role not in ('owner', 'admin', 'member', 'viewer') then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.memberships m where m.org_id = v_org and m.role = 'owner' for update;
  select * into t from public.memberships m where m.org_id = v_org and m.id = p_membership_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.role = p_role then return; end if;
  if t.user_id = auth.uid() then raise exception 'SELF_CHANGE'; end if;
  if (t.role = 'owner' or p_role = 'owner') and v_me <> 'owner' then raise exception 'OWNER_ONLY'; end if;
  select count(*) into v_owners from public.memberships m where m.org_id = v_org and m.role = 'owner' and m.disabled_at is null;
  if t.role = 'owner' and t.disabled_at is null and v_owners <= 1 then raise exception 'LAST_OWNER'; end if;

  update public.memberships m set role = p_role where m.id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'member.role_changed', 'membership', t.id::text,
          format('%s changed from %s to %s', public.core__display_name(t.user_id), t.role, p_role),
          jsonb_build_object('role', t.role), jsonb_build_object('role', p_role));
end $$;

create or replace function public.core_set_member_disabled(p_membership_id uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.require_org_role(array['owner', 'admin']);
  v_me     text := public.core__my_role(v_org);
  t        public.memberships;
  v_owners int;
begin
  if p_disabled is null then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.memberships m where m.org_id = v_org and m.role = 'owner' for update;
  select * into t from public.memberships m where m.org_id = v_org and m.id = p_membership_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (t.disabled_at is not null) = p_disabled then
    raise exception 'INVALID_STATE' using detail = case when p_disabled then 'already disabled' else 'already active' end;
  end if;
  if t.user_id = auth.uid() then raise exception 'SELF_CHANGE'; end if;
  if t.role = 'owner' and v_me <> 'owner' then raise exception 'OWNER_ONLY'; end if;
  if p_disabled and t.role = 'owner' then
    select count(*) into v_owners from public.memberships m where m.org_id = v_org and m.role = 'owner' and m.disabled_at is null;
    if v_owners <= 1 then raise exception 'LAST_OWNER'; end if;
  end if;

  update public.memberships m set disabled_at = case when p_disabled then now() else null end where m.id = t.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when p_disabled then 'member.disabled' else 'member.enabled' end, 'membership', t.id::text,
          format('%s %s', public.core__display_name(t.user_id), case when p_disabled then 'disabled' else 'enabled' end));
end $$;

-- L-5: before the API issues a new sign-in link (a credential) for a member, check it is safe and audit it. Allowed only
-- for an account this organization created, that has never signed in and belongs to (or is invited by) no other organization.
create or replace function public.core_invite_link_target(p_membership_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
  t     public.memberships;
  u     auth.users;
begin
  select * into t from public.memberships m where m.org_id = v_org and m.id = p_membership_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.role = 'owner' and public.core__my_role(v_org) <> 'owner' then raise exception 'OWNER_ONLY'; end if;
  select * into u from auth.users x where x.id = t.user_id;
  if u.email is null or u.last_sign_in_at is not null or (u.raw_app_meta_data ->> 'invited_org_id') is distinct from v_org::text
     or exists (select 1 from public.memberships m where m.user_id = t.user_id and m.org_id <> v_org)
     or exists (select 1 from public.core_invitations i where i.user_id = t.user_id and i.org_id <> v_org and i.status = 'pending') then
    raise exception 'FORBIDDEN' using detail = 'a new link can only be made for someone this organization invited who has not signed in yet';
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'member.invite_link_created', 'membership', t.id::text, format('New invite link made for %s', u.email));
  return jsonb_build_object('user_id', u.id, 'email', u.email);
end $$;

-- ---------------------------------------------------------------- the invited person's side (M-2)

-- Pending invitations for the signed-in person, across organizations (no organization header needed).
create or replace function public.core_my_invitations()
returns table (id uuid, org_id uuid, org_name text, role text, invited_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  return query
    select i.id, i.org_id, o.name, i.role, public.core__display_name(i.invited_by), i.created_at
      from public.core_invitations i join public.organizations o on o.id = i.org_id
     where i.user_id = auth.uid() and i.status = 'pending' and o.deleted_at is null
     order by i.created_at;
end $$;

create or replace function public.core_respond_invitation(p_invitation_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  i    public.core_invitations;
  v_id uuid;
begin
  if auth.uid() is null or p_accept is null then raise exception 'INVALID_INPUT'; end if;
  select * into i from public.core_invitations x where x.id = p_invitation_id and x.user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.status <> 'pending' then raise exception 'INVALID_STATE' using detail = format('invitation is %s', i.status); end if;

  update public.core_invitations x set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now() where x.id = i.id;
  if p_accept then
    insert into public.memberships (org_id, user_id, role, invited_by) values (i.org_id, i.user_id, i.role, i.invited_by)
    on conflict do nothing returning id into v_id;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (i.org_id, auth.uid(), case when p_accept then 'member.invitation_accepted' else 'member.invitation_declined' end, 'invitation', i.id::text,
          format('%s %s the invitation as %s', public.core__display_name(i.user_id), case when p_accept then 'accepted' else 'declined' end, i.role));
end $$;

create or replace function public.core_revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
  i     public.core_invitations;
begin
  select * into i from public.core_invitations x where x.org_id = v_org and x.id = p_invitation_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.status <> 'pending' then raise exception 'INVALID_STATE' using detail = format('invitation is %s', i.status); end if;
  if i.role = 'owner' and public.core__my_role(v_org) <> 'owner' then raise exception 'OWNER_ONLY'; end if;
  update public.core_invitations x set status = 'revoked', decided_at = now() where x.id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'member.invitation_revoked', 'invitation', i.id::text, format('Invitation for %s withdrawn', public.core__display_name(i.user_id)));
end $$;

-- ---------------------------------------------------------------- decisions: channel is vouched for, not claimed (L-2)
-- Same as sql/011 and sql/012, plus: a channel other than 'app' is accepted only when msg_decide_by_token (service role only)
-- has set erp.trusted_channel for this transaction. A user's API or direct call cannot set it.

create or replace function public.inv_decide_request(p_request_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := public.inv__guard(array['owner', 'admin']);
  r          public.inv_requests;
  v_total    numeric;
  v_required int;
  v_have     int;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into r from public.inv_requests q where q.org_id = v_org and q.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if r.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('request is %s', r.status); end if;
  if p_decision = 'approved' and exists (select 1 from public.inv_approvals a where a.request_id = r.id and a.approver_id = auth.uid() and a.decision = 'approved') then
    raise exception 'INVALID_STATE' using detail = 'you already approved this request';
  end if;

  insert into public.inv_approvals (org_id, request_id, decision, approver_id, comment, channel)
  values (v_org, r.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);

  if p_decision = 'rejected' then
    update public.inv_requests q set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where q.id = r.id;
    perform public.inv__release(r);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.request.rejected', 'stock_request', r.id::text, format('%s rejected; reserved stock released', r.number), p_channel);
    return;
  end if;

  select coalesce(sum(l.qty), 0) into v_total from public.inv_request_lines l where l.org_id = v_org and l.request_id = r.id;
  v_required := public.inv__required_approvals(v_org, r.warehouse_id, v_total);
  select count(distinct a.approver_id) into v_have from public.inv_approvals a where a.request_id = r.id and a.decision = 'approved';

  if v_have >= v_required then
    update public.inv_requests q set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where q.id = r.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.request.approved', 'stock_request', r.id::text,
            format('%s approved%s', r.number, case when v_required > 1 then format(' (%s of %s approvals)', v_have, v_required) else '' end), p_channel);
  else
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.request.approval_recorded', 'stock_request', r.id::text,
            format('%s: approval %s of %s recorded, still waiting', r.number, v_have, v_required), p_channel);
  end if;
end $$;

create or replace function public.inv_decide_adjustment(p_adjustment_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  a     public.inv_adjustments;
  b     public.inv_stock_balances;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into a from public.inv_adjustments x where x.org_id = v_org and x.id = p_adjustment_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if a.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('adjustment is %s', a.status); end if;

  if p_decision = 'rejected' then
    update public.inv_adjustments x set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.adjustment.rejected', 'stock_adjustment', a.id::text, format('%s rejected; stock unchanged', a.number), p_channel);
    return;
  end if;

  select * into b from public.inv_stock_balances s where s.org_id = v_org and s.item_id = a.item_id and s.warehouse_id = a.warehouse_id for update;
  if coalesce(b.on_hand, 0) <> a.expected_qty then
    raise exception 'INVALID_STATE' using detail = format('stock changed since the count (book is now %s, the count assumed %s); please count again', coalesce(b.on_hand, 0), a.expected_qty);
  end if;
  if a.counted_qty < coalesce(b.reserved, 0) then
    raise exception 'INVALID_STATE' using detail = format('%s is now reserved for open requests; the count cannot be lower', b.reserved);
  end if;

  update public.inv_adjustments x set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
  insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, adjustment_id, ref, posted_by)
  values (v_org, a.item_id, a.warehouse_id, a.delta, 'adjust', a.id, a.number, auth.uid());
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, a.item_id, a.warehouse_id, a.counted_qty, 0)
  on conflict (org_id, item_id, warehouse_id) do update set on_hand = a.counted_qty;
  update public.inv_adjustments x set status = 'applied' where x.id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.adjustment.applied', 'stock_adjustment', a.id::text, format('%s applied: stock %s to %s (difference %s)', a.number, a.expected_qty, a.counted_qty, a.delta), p_channel);
end $$;

-- ---------------------------------------------------------------- inbound WhatsApp across organizations (L-2, L-3)
-- Same as sql/009, except: the token is searched across every organization where this number is verified (a person may
-- belong to several), and the decision is made with erp.trusted_channel set so the channel is recorded.

create or replace function public.msg_decide_by_token(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_addr     text := regexp_replace(coalesce(p_address, ''), '[\s-]', '', 'g');
  v_m        text[] := regexp_match(upper(trim(coalesce(p_text, ''))), '^(APPROVE|YES|REJECT|NO)\s+([A-Z2-9]{6})$');
  v_decision text;
  idn        public.msg_identities;
  cand       public.msg_identities;
  tk         public.msg_tokens;
  v_any      boolean := false;
  v_found    boolean := false;
  v_code     text;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'code', 'NOT_A_DECISION'); end if;
  v_decision := case when v_m[1] in ('APPROVE', 'YES') then 'approved' else 'rejected' end;

  for cand in select i.* from public.msg_identities i where i.channel = p_channel and i.address = v_addr and i.status = 'verified' order by i.verified_at loop
    if not v_any then idn := cand; v_any := true; end if;
    select t.* into tk from public.msg_tokens t
     where t.org_id = cand.org_id and t.approver_id = cand.user_id and t.channel = p_channel
       and t.token_hash = public.msg__token_hash(v_m[2], t.request_id, t.approver_id)
     limit 1;
    if found then idn := cand; v_found := true; exit; end if;
  end loop;
  if not v_any then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_IDENTITY'); end if;

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
    perform set_config('erp.trusted_channel', p_channel, true);
    update public.msg_tokens t set used_at = now() where t.id = tk.id;
    perform public.inv_decide_request(tk.request_id, v_decision, 'via ' || p_channel, p_channel);
    perform set_config('erp.trusted_channel', '', true);
    return jsonb_build_object('ok', true, 'code', 'OK', 'request_id', tk.request_id, 'decision', v_decision);
  exception when others then
    v_code := sqlerrm;
  end;
  perform set_config('erp.trusted_channel', '', true);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'stock_request', tk.request_id::text,
          format('Reply from %s refused by the decision rules: %s', public.msg__mask(v_addr), v_code), p_channel);
  return jsonb_build_object('ok', false, 'code', v_code);
end $$;

-- Same as sql/010, except open tasks are gathered across every organization where this number is verified.
create or replace function public.msg_task_reply(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_addr   text := regexp_replace(coalesce(p_address, ''), '[\s-]', '', 'g');
  v_m      text[] := regexp_match(upper(trim(coalesce(p_text, ''))), '^(ACK|START|DONE)(?:\s+([0-9A-F]{4}))?$');
  v_status text;
  idn      public.msg_identities;
  tk       public.tsk_tasks;
  n_open   int;
  v_code   text;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'code', 'NOT_A_TASK_REPLY'); end if;
  v_status := case when v_m[1] = 'DONE' then 'done' else 'in_progress' end;

  select * into idn from public.msg_identities i where i.channel = p_channel and i.address = v_addr and i.status = 'verified' order by i.verified_at limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_IDENTITY'); end if;

  select count(*) into n_open from public.tsk_tasks t
  join public.msg_identities i on i.org_id = t.org_id and i.user_id = t.assignee_id and i.channel = p_channel and i.address = v_addr and i.status = 'verified'
  where t.status in ('open', 'in_progress') and (v_m[2] is null or public.tsk__ref(t.id) = v_m[2]);
  if n_open = 0 then v_code := 'NO_OPEN_TASK';
  elsif n_open > 1 then
    return jsonb_build_object('ok', false, 'code', 'AMBIGUOUS', 'tasks', (
      select jsonb_agg(jsonb_build_object('ref', public.tsk__ref(t.id), 'title', t.title) order by t.created_at)
      from public.tsk_tasks t
      join public.msg_identities i on i.org_id = t.org_id and i.user_id = t.assignee_id and i.channel = p_channel and i.address = v_addr and i.status = 'verified'
      where t.status in ('open', 'in_progress')));
  end if;
  if v_code is not null then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'identity', idn.id::text, format('Task reply from %s refused: %s', public.msg__mask(v_addr), v_code), p_channel);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  select t.* into tk from public.tsk_tasks t
  join public.msg_identities i on i.org_id = t.org_id and i.user_id = t.assignee_id and i.channel = p_channel and i.address = v_addr and i.status = 'verified'
  where t.status in ('open', 'in_progress') and (v_m[2] is null or public.tsk__ref(t.id) = v_m[2]);
  select * into idn from public.msg_identities i where i.org_id = tk.org_id and i.user_id = tk.assignee_id and i.channel = p_channel and i.status = 'verified';

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', idn.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-org-id', idn.org_id)::text, true);
    perform public.tsk_set_status(tk.id, v_status);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (idn.org_id, idn.user_id, 'messaging.inbound.task_reply', 'task', tk.id::text, format('Task "%s" set to %s by reply from %s', tk.title, v_status, public.msg__mask(v_addr)), p_channel);
    return jsonb_build_object('ok', true, 'code', 'OK', 'task_id', tk.id, 'status', v_status);
  exception when others then
    v_code := sqlerrm;
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (idn.org_id, idn.user_id, 'messaging.inbound.refused', 'task', tk.id::text, format('Task reply from %s refused by the task rules: %s', public.msg__mask(v_addr), v_code), p_channel);
  return jsonb_build_object('ok', false, 'code', v_code);
end $$;

-- ---------------------------------------------------------------- per-organization delivery pass (L-4)
-- Same as msg_claim_due (sql/008) limited to one organization, for the on-demand "process now" button. The scheduled
-- job keeps using msg_claim_due for everyone.
create or replace function public.msg_claim_due_for_org(p_org uuid, p_limit int default 20) returns setof public.msg_outbox
language plpgsql security definer set search_path = public as $$
begin
  if p_org is null then raise exception 'INVALID_INPUT'; end if;
  with ex as (
    update public.msg_outbox set status = 'expired', secret_body = null where org_id = p_org and status = 'pending' and expires_at <= now()
    returning org_id, id, kind, subject, recipient_id, channel
  )
  insert into public.audit_log (org_id, action, entity_type, entity_id, summary, metadata)
  select ex.org_id, 'messaging.message.expired', 'message', ex.id::text, format('Message "%s" expired before it was delivered', ex.subject),
         jsonb_build_object('channel', ex.channel, 'kind', ex.kind, 'recipient', ex.recipient_id)
  from ex;
  update public.msg_outbox set status = 'pending' where org_id = p_org and status = 'sending' and updated_at < now() - interval '5 minutes';
  return query
    update public.msg_outbox o set status = 'sending', attempts = o.attempts + 1
    where o.id in (
      select q.id from public.msg_outbox q
      where q.org_id = p_org and q.status = 'pending' and q.next_attempt_at <= now() and q.expires_at > now()
      order by q.next_attempt_at, q.created_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    )
    returning o.*;
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.core__my_role(uuid) from public, anon, authenticated;
revoke all on function public.core__display_name(uuid) from public, anon, authenticated;
revoke all on function public.core_list_members() from public, anon;
revoke all on function public.core_list_invitations() from public, anon;
revoke all on function public.core_invite_member(text, text) from public, anon;
revoke all on function public.core_add_invited_account(uuid, text) from public, anon;
revoke all on function public.core_set_member_role(uuid, text) from public, anon;
revoke all on function public.core_set_member_disabled(uuid, boolean) from public, anon;
revoke all on function public.core_invite_link_target(uuid) from public, anon;
revoke all on function public.core_my_invitations() from public, anon;
revoke all on function public.core_respond_invitation(uuid, boolean) from public, anon;
revoke all on function public.core_revoke_invitation(uuid) from public, anon;
grant execute on function public.core_list_members(), public.core_list_invitations(), public.core_invite_member(text, text),
  public.core_add_invited_account(uuid, text), public.core_set_member_role(uuid, text), public.core_set_member_disabled(uuid, boolean),
  public.core_invite_link_target(uuid), public.core_my_invitations(), public.core_respond_invitation(uuid, boolean),
  public.core_revoke_invitation(uuid) to authenticated;

revoke all on function public.inv_decide_request(uuid, text, text, text) from public, anon;
revoke all on function public.inv_decide_adjustment(uuid, text, text, text) from public, anon;
grant execute on function public.inv_decide_request(uuid, text, text, text), public.inv_decide_adjustment(uuid, text, text, text) to authenticated;

revoke all on function public.msg_decide_by_token(text, text, text) from public, anon, authenticated;
revoke all on function public.msg_task_reply(text, text, text) from public, anon, authenticated;
revoke all on function public.msg_claim_due_for_org(uuid, int) from public, anon, authenticated;
grant execute on function public.msg_decide_by_token(text, text, text), public.msg_task_reply(text, text, text),
  public.msg_claim_due_for_org(uuid, int) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. Invitations table: RLS on, anon has nothing, authenticated may only select (expect t, 0, SELECT).
select relrowsecurity from pg_class where oid = 'public.core_invitations'::regclass;
select count(*) as anon_grants from information_schema.role_table_grants where grantee = 'anon' and table_name = 'core_invitations';
select string_agg(privilege_type, ',') as authenticated_grants from information_schema.role_table_grants where grantee = 'authenticated' and table_name = 'core_invitations';

-- 2. Who may call what (expect true, false, false, false, true).
select has_function_privilege('authenticated', 'public.core_set_member_role(uuid,text)', 'execute') as user_role_fn,
       has_function_privilege('anon', 'public.core_set_member_role(uuid,text)', 'execute') as anon_role_fn,
       has_function_privilege('authenticated', 'public.msg_claim_due_for_org(uuid,integer)', 'execute') as user_claim,
       has_function_privilege('authenticated', 'public.core__my_role(uuid)', 'execute') as user_helper,
       has_function_privilege('service_role', 'public.msg_claim_due_for_org(uuid,integer)', 'execute') as service_claim;
