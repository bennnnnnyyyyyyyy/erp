-- sql/063_sole_approver.sql
-- A company with one owner can issue stock (UX decision D1, Ben 9 Nov 2026, with his explicit yes to change the self-approval rule).
-- Rerun-safe. Needs sql/001-062.
--
-- The rule "the person who asks for stock cannot approve it" stays, with one exception: an owner or admin may approve their OWN stock
-- request only while the company has NO OTHER active owner or admin. As soon as a second one is added, the normal rule returns by
-- itself. Every such approval is marked in the audit log ("self-approved: no second approver in the company").
-- Only stock requests change; adjustments, transfers, counts, notes and journals keep the strict rule (a follow-up question for Ben).
-- inv_decide_request is sql/025's function with that one change; everything else in it is unchanged.

begin;

-- The table itself also refused a decision by the requester (sql/006 check constraint). It now allows one only when the row says so:
-- self_decided is set by inv_decide_request alone, and only for a sole approver. Every other decision must still come from someone else.
alter table public.inv_requests add column if not exists self_decided boolean not null default false;
alter table public.inv_requests drop constraint if exists inv_requests_decider_not_requester;
alter table public.inv_requests add constraint inv_requests_decider_not_requester
  check (decided_by is null or decided_by <> requester_id or self_decided);

-- True when the caller is an active owner or admin and nobody else in the company is.
create or replace function public.core__sole_approver(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null and m.role in ('owner', 'admin'))
     and not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id <> auth.uid() and m.disabled_at is null and m.role in ('owner', 'admin'));
$$;
revoke all on function public.core__sole_approver(uuid) from public, anon, authenticated;

create or replace function public.inv_decide_request(p_request_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := public.inv__guard(array['owner', 'admin']);
  r          public.inv_requests;
  v_total    numeric;
  v_required int;
  v_have     int;
  v_self     boolean;
  v_mark     text := '';
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into r from public.inv_requests q where q.org_id = v_org and q.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_self := r.requester_id = auth.uid();
  -- sql/063: one's own request only when nobody else can approve.
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if v_self then v_mark := ' (self-approved: no second approver in the company)'; end if;
  if r.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('request is %s', r.status); end if;
  if p_decision = 'approved' and exists (select 1 from public.inv_approvals a where a.request_id = r.id and a.approver_id = auth.uid() and a.decision = 'approved') then
    raise exception 'INVALID_STATE' using detail = 'you already approved this request';
  end if;

  insert into public.inv_approvals (org_id, request_id, decision, approver_id, comment, channel)
  values (v_org, r.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);

  if p_decision = 'rejected' then
    update public.inv_requests q set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), ''), self_decided = v_self where q.id = r.id;
    perform public.inv__release(r);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.request.rejected', 'stock_request', r.id::text, format('%s rejected; reserved stock released', r.number), p_channel);
    return;
  end if;

  select coalesce(sum(l.qty), 0) into v_total from public.inv_request_lines l where l.org_id = v_org and l.request_id = r.id;
  v_required := public.inv__required_approvals(v_org, r.warehouse_id, v_total);
  -- A sole approver is the only one there is, so one approval is enough whatever the policy asks for.
  if v_self then v_required := 1; end if;
  select count(distinct a.approver_id) into v_have from public.inv_approvals a where a.request_id = r.id and a.decision = 'approved';

  if v_have >= v_required then
    update public.inv_requests q set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), ''), self_decided = v_self where q.id = r.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), case when v_self then 'inventory.request.self_approved' else 'inventory.request.approved' end, 'stock_request', r.id::text,
            format('%s approved%s%s', r.number, case when v_required > 1 then format(' (%s of %s approvals)', v_have, v_required) else '' end, v_mark), p_channel);
  else
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.request.approval_recorded', 'stock_request', r.id::text,
            format('%s: approval %s of %s recorded, still waiting', r.number, v_have, v_required), p_channel);
  end if;
end $$;

revoke all on function public.inv_decide_request(uuid, text, text, text) from public, anon;
grant execute on function public.inv_decide_request(uuid, text, text, text) to authenticated;

commit;

-- Verification (read-only).
select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'inv_requests_decider_not_requester') as decider_rule,
       has_function_privilege('authenticated', 'public.core__sole_approver(uuid)', 'execute') as users_call_helper,
       has_function_privilege('anon', 'public.inv_decide_request(uuid, text, text, text)', 'execute') as anon_decides;
