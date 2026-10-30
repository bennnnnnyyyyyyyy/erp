-- 011_approval_policies.sql
-- I5 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): approval policies. A request can need more than one approval:
-- "from 50 units in total, two different people must approve" (optionally for one warehouse only). The highest matching
-- policy applies; with no policy one approval is enough, exactly as before. The rule is in the decision function, so the app,
-- WhatsApp replies and any later channel behave the same. Quantity is the measure for now: money needs costing (item I9).
-- Depends on sql/001-010. Rerun-safe. Run the whole file, then sql/tests/007_approval_policies.sql.

begin;

create table if not exists public.inv_approval_policies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  warehouse_id      uuid,
  min_total_qty     numeric(18, 3) not null check (min_total_qty >= 0),
  required_approvals int not null check (required_approvals between 1 and 3),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (org_id, warehouse_id) references public.inv_warehouses (org_id, id)
);
create unique index if not exists inv_approval_policies_uidx on public.inv_approval_policies
  (org_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), min_total_qty);

drop trigger if exists inv_approval_policies_updated_at on public.inv_approval_policies;
create trigger inv_approval_policies_updated_at before update on public.inv_approval_policies for each row execute function public.set_updated_at();

alter table public.inv_approval_policies enable row level security;
revoke all on public.inv_approval_policies from anon, authenticated;
grant select on public.inv_approval_policies to authenticated;
drop policy if exists inv_approval_policies_member_read on public.inv_approval_policies;
create policy inv_approval_policies_member_read on public.inv_approval_policies for select to authenticated using (public.is_org_member(org_id));

-- One person cannot approve the same request twice.
create unique index if not exists inv_approvals_one_per_approver_uidx on public.inv_approvals (request_id, approver_id) where decision = 'approved';

create or replace function public.inv__required_approvals(p_org uuid, p_warehouse uuid, p_total numeric) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(p.required_approvals), 1)::int from public.inv_approval_policies p
  where p.org_id = p_org and (p.warehouse_id is null or p.warehouse_id = p_warehouse) and p_total >= p.min_total_qty
$$;

-- Owner or admin sets (or changes) a policy. A null warehouse means every warehouse.
create or replace function public.inv_set_approval_policy(p_warehouse_id uuid, p_min_total_qty numeric, p_required int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  v_id  uuid;
begin
  if p_min_total_qty is null or p_min_total_qty < 0 or p_required is null or p_required not between 1 and 3 then raise exception 'INVALID_INPUT'; end if;
  if p_warehouse_id is not null and not exists (select 1 from public.inv_warehouses w where w.org_id = v_org and w.id = p_warehouse_id and w.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown warehouse';
  end if;
  insert into public.inv_approval_policies (org_id, warehouse_id, min_total_qty, required_approvals, created_by)
  values (v_org, p_warehouse_id, p_min_total_qty, p_required, auth.uid())
  on conflict (org_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), min_total_qty)
  do update set required_approvals = excluded.required_approvals
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.policy.set', 'approval_policy', v_id::text,
          format('From %s units%s, %s approval(s) required', p_min_total_qty, case when p_warehouse_id is null then '' else ' in one warehouse' end, p_required));
  return v_id;
end $$;

create or replace function public.inv_remove_approval_policy(p_policy_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  p     public.inv_approval_policies;
begin
  select * into p from public.inv_approval_policies x where x.org_id = v_org and x.id = p_policy_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from public.inv_approval_policies x where x.id = p.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'inventory.policy.removed', 'approval_policy', p.id::text, format('Policy from %s units (%s approvals) removed', p.min_total_qty, p.required_approvals));
end $$;

-- Same as 006, plus: the approval may be one of several. A rejection by anyone ends the request at once. Approving needs
-- as many different approvers as the matching policy says; until then the request stays "submitted" and the approval is
-- recorded and audited.
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

revoke all on function public.inv__required_approvals(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.inv_set_approval_policy(uuid, numeric, int) from public, anon;
revoke all on function public.inv_remove_approval_policy(uuid) from public, anon;
revoke all on function public.inv_decide_request(uuid, text, text, text) from public, anon;
grant execute on function public.inv_set_approval_policy(uuid, numeric, int) to authenticated;
grant execute on function public.inv_remove_approval_policy(uuid) to authenticated;
grant execute on function public.inv_decide_request(uuid, text, text, text) to authenticated;

commit;

-- Verification (read-only): the new functions are callable by signed-in users, the helper is not (expect true, true, false).
select has_function_privilege('authenticated', 'public.inv_set_approval_policy(uuid,numeric,int)', 'execute') as set_policy,
       has_function_privilege('authenticated', 'public.inv_decide_request(uuid,text,text,text)', 'execute') as decide,
       has_function_privilege('authenticated', 'public.inv__required_approvals(uuid,uuid,numeric)', 'execute') as helper;
