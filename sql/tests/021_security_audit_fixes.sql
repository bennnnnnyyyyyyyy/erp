-- sql/tests/021_security_audit_fixes.sql
-- sql/025: member changes go through database functions with the role rules and audit; adding an existing account needs
-- their acceptance; invitations are isolated per organization; a signed-in user cannot record a decision as 'whatsapp';
-- the per-organization delivery pass is closed to users. Always rolls back. Needs sql/001-025.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner of A
  uad uuid := gen_random_uuid(); -- admin of A
  um uuid := gen_random_uuid();  -- member of A
  ux uuid := gen_random_uuid();  -- existing account, owner of B (to be invited to A)
  un uuid := gen_random_uuid();  -- brand-new account created by A's invite
  oa uuid; ob uuid;
  m_ad uuid; m_m uuid; m_owner uuid; inv uuid;
  r jsonb; n int; ok boolean;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at) values
    (ua,  'authenticated', 'authenticated', 'sec-a@tests.invalid',  '{}'::jsonb, '{}'::jsonb, now()),
    (uad, 'authenticated', 'authenticated', 'sec-ad@tests.invalid', '{}'::jsonb, '{}'::jsonb, now()),
    (um,  'authenticated', 'authenticated', 'sec-m@tests.invalid',  '{}'::jsonb, '{}'::jsonb, now()),
    (ux,  'authenticated', 'authenticated', 'sec-x@tests.invalid',  '{}'::jsonb, '{}'::jsonb, now()),
    (un,  'authenticated', 'authenticated', 'sec-n@tests.invalid',  '{}'::jsonb, '{}'::jsonb, null);
  oa := public.bootstrap_organization('Sec Test A', 'sec-test-a', 'sec-a@tests.invalid');
  ob := public.bootstrap_organization('Sec Test B', 'sec-test-b', 'sec-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, uad, 'admin') returning id into m_ad;
  insert into public.memberships (org_id, user_id, role) values (oa, um, 'member') returning id into m_m;
  select id into m_owner from public.memberships where org_id = oa and user_id = ua;
  insert into public.org_modules (org_id, module_key, enabled_at, enabled_by) values (oa, 'inventory', now(), ua) on conflict do nothing;
  update auth.users set raw_app_meta_data = jsonb_build_object('invited_org_id', oa) where id = un;

  -- ---- T1: inviting an existing account creates a pending invitation, not a membership, and is audited
  perform set_config('request.jwt.claims', json_build_object('sub', uad, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  r := public.core_invite_member('SEC-X@tests.invalid', 'member');
  if r ->> 'kind' <> 'invitation' then raise exception 'FAIL T1a: expected an invitation, got %', r; end if;
  inv := (r ->> 'id')::uuid;
  select count(*) into n from public.core_list_members() where user_id = ux;
  if n <> 0 then raise exception 'FAIL T1b: an existing account was added without accepting'; end if;
  r := public.core_invite_member('nobody-here@tests.invalid', 'member');
  if r ->> 'kind' <> 'needs_account' then raise exception 'FAIL T1c: unknown email should need an account'; end if;
  ok := false;
  begin perform public.core_invite_member('sec-m@tests.invalid', 'viewer'); exception when others then ok := (sqlerrm = 'ALREADY_MEMBER'); end;
  if not ok then raise exception 'FAIL T1d: re-invited an existing member'; end if;
  ok := false;
  begin perform public.core_invite_member('someone@tests.invalid', 'owner'); exception when others then ok := (sqlerrm = 'OWNER_ONLY'); end;
  if not ok then raise exception 'FAIL T1e: an admin invited an owner'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and action = 'member.invitation_created' and entity_id = inv::text;
  if n <> 1 then raise exception 'FAIL T1f: invitation not audited'; end if;

  -- ---- T2: a plain member cannot invite or change anyone
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.core_invite_member('z@tests.invalid', 'member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T2a: a member could invite'; end if;
  ok := false;
  begin perform public.core_set_member_role(m_ad, 'viewer'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T2b: a member could change a role'; end if;
  select count(*) into n from public.core_invitations;
  if n <> 0 then raise exception 'FAIL T2c: a member can read the organization''s invitations'; end if;
  reset role;

  -- ---- T3: isolation: B's owner (the invitee) sees only their own invitation; nobody else in B sees A's
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  set local role authenticated;
  select count(*) into n from public.core_list_invitations();
  if n <> 0 then raise exception 'FAIL T3a: B lists A''s invitations'; end if;
  select count(*) into n from public.core_my_invitations() where org_id = oa;
  if n <> 1 then raise exception 'FAIL T3b: the invitee does not see their invitation'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.core_respond_invitation(inv, true); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T3c: someone else accepted the invitation'; end if;
  reset role;

  -- ---- T4: the invitee accepts; membership appears, audited, and cannot be accepted twice
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.core_respond_invitation(inv, true);
  ok := false;
  begin perform public.core_respond_invitation(inv, true); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL T4a: accepted twice'; end if;
  reset role;
  select count(*) into n from public.memberships where org_id = oa and user_id = ux and role = 'member';
  if n <> 1 then raise exception 'FAIL T4b: accepting did not create the membership'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'member.invitation_accepted';
  if n <> 1 then raise exception 'FAIL T4c: acceptance not audited'; end if;

  -- ---- T5: direct add only for an account A just created; never for an existing one
  perform set_config('request.jwt.claims', json_build_object('sub', uad, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.core_add_invited_account(ua, 'member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T5a: added an existing account directly'; end if;
  perform public.core_add_invited_account(un, 'member');
  -- L-5: a link is allowed for the new account, but not for one that also belongs to another organization
  r := public.core_invite_link_target((select id from public.core_list_members() where user_id = un));
  if (r ->> 'user_id')::uuid <> un then raise exception 'FAIL T5b: link target refused for a fresh account'; end if;
  reset role;
  insert into public.memberships (org_id, user_id, role) values (ob, un, 'viewer');
  perform set_config('request.jwt.claims', json_build_object('sub', uad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.core_invite_link_target((select id from public.core_list_members() where user_id = un)); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T5c: made a sign-in link for someone in another organization'; end if;

  -- ---- T6: role and disable rules
  ok := false;
  begin perform public.core_set_member_role(m_ad, 'member'); exception when others then ok := (sqlerrm = 'SELF_CHANGE'); end;
  if not ok then raise exception 'FAIL T6a: changed own role'; end if;
  ok := false;
  begin perform public.core_set_member_role(m_owner, 'admin'); exception when others then ok := (sqlerrm = 'OWNER_ONLY'); end;
  if not ok then raise exception 'FAIL T6b: an admin demoted an owner'; end if;
  ok := false;
  begin perform public.core_set_member_disabled(m_owner, true); exception when others then ok := (sqlerrm = 'OWNER_ONLY'); end;
  if not ok then raise exception 'FAIL T6c: an admin disabled an owner'; end if;
  perform public.core_set_member_role(m_m, 'viewer');
  perform public.core_set_member_disabled(m_m, true);
  reset role;
  select count(*) into n from public.audit_log where org_id = oa and entity_id = m_m::text and action in ('member.role_changed', 'member.disabled');
  if n <> 2 then raise exception 'FAIL T6d: role change and disable not both audited'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.core_set_member_role(m_owner, 'admin'); exception when others then ok := (sqlerrm = 'SELF_CHANGE'); end;
  if not ok then raise exception 'FAIL T6e: an owner changed their own role'; end if;
  reset role;

  -- ---- T7: a signed-in user cannot record a decision as coming from WhatsApp (L-2)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.inv_decide_request(gen_random_uuid(), 'approved', null, 'whatsapp'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T7a: a user recorded a decision as whatsapp'; end if;
  ok := false;
  begin perform public.inv_decide_request(gen_random_uuid(), 'approved', null, 'app'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL T7b: the app channel stopped working'; end if;

  -- ---- T8: per-organization delivery pass and helpers are closed to users; nothing for anonymous
  ok := false;
  begin perform * from public.msg_claim_due_for_org(oa, 10); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T8a: a user could claim messages'; end if;
  reset role;
  set local role anon;
  ok := false;
  begin perform * from public.core_my_invitations(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T8b: anonymous could call core_my_invitations'; end if;
  ok := false;
  begin perform count(*) from public.core_invitations; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T8c: anonymous could read invitations'; end if;
  reset role;

  -- ---- T9: no direct writes to invitations
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.core_invitations (org_id, user_id, role, invited_by) values (oa, uad, 'owner', ua); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T9a: direct insert into invitations allowed'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
