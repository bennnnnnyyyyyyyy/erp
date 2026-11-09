-- sql/065_sole_approver_more.sql
-- The sole-approver exception of sql/063 for the other approvals (UX decision D1b, Ben 9 Nov 2026: "A, all of them"). Rerun-safe.
-- Needs sql/001-064.
--
-- Stock adjustments, stock transfers, stock counts and credit/debit notes: the person who asked may decide their own only while the
-- company has no other active owner or admin (public.core__sole_approver, sql/063). Each such decision writes an extra audit row
-- '<area>.self_decided' ("self-approved: no second approver in the company"), and the row is flagged self_decided, which the table rule
-- requires for a decision by the requester. Every other decision must still come from someone else, in the function and in the table.
-- Manual journals are not changed: the owner can already post a journal directly (sql/048), so a solo owner is not stuck there.
-- Each function below is its latest definition with only those changes.

begin;

alter table public.inv_adjustments add column if not exists self_decided boolean not null default false;
alter table public.inv_adjustments drop constraint if exists inv_adjustments_decider_not_requester;
alter table public.inv_adjustments add constraint inv_adjustments_decider_not_requester check (decided_by is null or decided_by <> requester_id or self_decided);

alter table public.inv_transfers add column if not exists self_decided boolean not null default false;
alter table public.inv_transfers drop constraint if exists inv_transfers_decider_not_requester;
alter table public.inv_transfers add constraint inv_transfers_decider_not_requester check (decided_by is null or decided_by <> requester_id or self_decided);

alter table public.sal_notes add column if not exists self_decided boolean not null default false;
alter table public.sal_notes drop constraint if exists sal_notes_decider_not_requester;
alter table public.sal_notes add constraint sal_notes_decider_not_requester check (decided_by is null or decided_by <> requester_id or self_decided);

alter table public.inv_counts add column if not exists self_decided boolean not null default false;
alter table public.inv_counts drop constraint if exists inv_counts_decider_not_requester;
alter table public.inv_counts add constraint inv_counts_decider_not_requester check (decided_by is null or (decided_by <> requester_id and decided_by is distinct from submitted_by) or self_decided);

-- inv_decide_adjustment: as sql/025_security_audit_fixes.sql, with the sole-approver exception.
create or replace function public.inv_decide_adjustment(p_adjustment_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  v_self boolean;
  a     public.inv_adjustments;
  b     public.inv_stock_balances;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into a from public.inv_adjustments x where x.org_id = v_org and x.id = p_adjustment_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_self := a.requester_id = auth.uid();
  -- sql/065: one's own only when nobody else can decide; marked in the audit log.
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if v_self then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.adjustment.self_decided', 'stock_adjustment', a.id::text, format('%s decided by the person who asked for it (self-approved: no second approver in the company)', a.number), p_channel);
  end if;
  if a.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('adjustment is %s', a.status); end if;

  if p_decision = 'rejected' then
    update public.inv_adjustments x set status = 'rejected', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
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

  update public.inv_adjustments x set status = 'approved', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = a.id;
  insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, adjustment_id, ref, posted_by)
  values (v_org, a.item_id, a.warehouse_id, a.delta, 'adjust', a.id, a.number, auth.uid());
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, a.item_id, a.warehouse_id, a.counted_qty, 0)
  on conflict (org_id, item_id, warehouse_id) do update set on_hand = a.counted_qty;
  update public.inv_adjustments x set status = 'applied' where x.id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.adjustment.applied', 'stock_adjustment', a.id::text, format('%s applied: stock %s to %s (difference %s)', a.number, a.expected_qty, a.counted_qty, a.delta), p_channel);
end $$;
revoke all on function public.inv_decide_adjustment(uuid, text, text, text) from public, anon;
grant execute on function public.inv_decide_adjustment(uuid, text, text, text) to authenticated;

-- inv_decide_transfer: as sql/033_inventory_transfers.sql, with the sole-approver exception.
create or replace function public.inv_decide_transfer(p_transfer_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := public.inv__guard(array['owner', 'admin']);
  t          public.inv_transfers;
  v_total    numeric;
  v_required int;
  v_have     int;
  v_self     boolean;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into t from public.inv_transfers x where x.org_id = v_org and x.id = p_transfer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_self := t.requester_id = auth.uid();
  -- sql/065: one's own only when nobody else can decide; marked in the audit log.
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if v_self then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.self_decided', 'stock_transfer', t.id::text, format('%s decided by the person who asked for it (self-approved: no second approver in the company)', t.number), p_channel);
  end if;
  if t.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('transfer is %s', t.status); end if;
  if p_decision = 'approved' and exists (select 1 from public.inv_transfer_approvals a where a.transfer_id = t.id and a.approver_id = auth.uid() and a.decision = 'approved') then
    raise exception 'INVALID_STATE' using detail = 'you already approved this transfer';
  end if;

  insert into public.inv_transfer_approvals (org_id, transfer_id, decision, approver_id, comment, channel)
  values (v_org, t.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);

  if p_decision = 'rejected' then
    update public.inv_transfers x set status = 'rejected', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = t.id;
    perform public.inv__release_transfer(t);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.rejected', 'stock_transfer', t.id::text, format('%s rejected; reserved stock released', t.number), p_channel);
    return;
  end if;

  select coalesce(sum(l.qty), 0) into v_total from public.inv_transfer_lines l where l.org_id = v_org and l.transfer_id = t.id;
  v_required := public.inv__required_approvals(v_org, t.from_warehouse_id, v_total);
  -- A sole approver is the only one there is, so one approval is enough.
  if v_self then v_required := 1; end if;
  select count(distinct a.approver_id) into v_have from public.inv_transfer_approvals a where a.transfer_id = t.id and a.decision = 'approved';

  if v_have >= v_required then
    update public.inv_transfers x set status = 'approved', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = t.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.approved', 'stock_transfer', t.id::text,
            format('%s approved%s', t.number, case when v_required > 1 then format(' (%s of %s approvals)', v_have, v_required) else '' end), p_channel);
  else
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.transfer.approval_recorded', 'stock_transfer', t.id::text,
            format('%s: approval %s of %s recorded, still waiting', t.number, v_have, v_required), p_channel);
  end if;
end $$;
revoke all on function public.inv_decide_transfer(uuid, text, text, text) from public, anon;
grant execute on function public.inv_decide_transfer(uuid, text, text, text) to authenticated;

-- sal_decide_note: as sql/037_credit_debit_notes.sql, with the sole-approver exception.
create or replace function public.sal_decide_note(p_note_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin']);
  n     public.sal_notes;
  v_inv text;
  v_self boolean;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into n from public.sal_notes x where x.org_id = v_org and x.id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_self := n.requester_id = auth.uid();
  -- sql/065: one's own only when nobody else can decide; marked in the audit log.
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if v_self then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'sales.note.self_decided', 'sales_note', n.id::text, format('%s decided by the person who asked for it (self-approved: no second approver in the company)', n.number), p_channel);
  end if;
  if n.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('note is %s', n.status); end if;
  select i.number into v_inv from public.sal_invoices i where i.org_id = v_org and i.id = n.invoice_id and i.status = 'issued';
  if p_decision = 'approved' and v_inv is null then raise exception 'INVALID_STATE' using detail = 'the invoice was voided'; end if;

  insert into public.sal_note_approvals (org_id, note_id, decision, approver_id, comment, channel)
  values (v_org, n.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);
  update public.sal_notes x set status = p_decision, decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), case p_decision when 'approved' then 'sales.note.approved' else 'sales.note.rejected' end, 'sales_note', n.id::text,
          format('%s %s', n.number, p_decision), p_channel);
end $$;
revoke all on function public.sal_decide_note(uuid, text, text, text) from public, anon;
grant execute on function public.sal_decide_note(uuid, text, text, text) to authenticated;

-- inv_decide_count: as sql/042_stock_counts.sql, with the sole-approver exception.
create or replace function public.inv_decide_count(p_count_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin']);
  c public.inv_counts; l record; b public.inv_stock_balances; v_delta numeric; v_moves int := 0; v_self boolean;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into c from public.inv_counts x where x.org_id = v_org and x.id = p_count_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_self := c.requester_id = auth.uid() or c.submitted_by = auth.uid();
  -- sql/065: one's own only when nobody else can decide; marked in the audit log.
  if v_self and not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
  if v_self then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.count.self_decided', 'stock_count', c.id::text, format('%s decided by the person who asked for it (self-approved: no second approver in the company)', c.number), p_channel);
  end if;
  if c.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('the count is %s', c.status); end if;

  if p_decision = 'rejected' then
    update public.inv_counts x set status = 'rejected', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = c.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
    values (v_org, auth.uid(), 'inventory.count.rejected', 'stock_count', c.id::text, format('%s rejected; stock unchanged', c.number), p_channel);
    return jsonb_build_object('id', c.id, 'status', 'rejected', 'moves', 0);
  end if;

  update public.inv_counts x set status = 'approved', decided_by = auth.uid(), self_decided = v_self, decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = c.id;
  for l in select * from public.inv_count_lines x where x.org_id = v_org and x.count_id = c.id and x.counted_qty <> x.expected_qty order by x.item_id loop
    v_delta := l.counted_qty - l.expected_qty;
    select * into b from public.inv_stock_balances s where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = c.warehouse_id for update;
    if coalesce(b.on_hand, 0) + v_delta < coalesce(b.reserved, 0) then
      raise exception 'INVALID_STATE' using detail = format('item %s: applying %s to %s on hand would go below the %s reserved', l.item_id, v_delta, coalesce(b.on_hand, 0), coalesce(b.reserved, 0));
    end if;
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, count_id, ref, posted_by)
    values (v_org, l.item_id, c.warehouse_id, v_delta, 'adjust', c.id, c.number, auth.uid());
    -- Update the existing balance row; insert only when there is none (then the snapshot was 0, so the difference is positive).
    -- Not "insert ... on conflict": the not-negative check would fire on the proposed insert before the conflict clause (as in sql/026).
    if b.item_id is not null then
      update public.inv_stock_balances s set on_hand = s.on_hand + v_delta, updated_at = now()
       where s.org_id = v_org and s.item_id = l.item_id and s.warehouse_id = c.warehouse_id;
    else
      insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved) values (v_org, l.item_id, c.warehouse_id, v_delta, 0);
    end if;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel, metadata)
    values (v_org, auth.uid(), 'inventory.count.line_posted', 'stock_count', c.id::text,
            format('%s: item adjusted by %s (snapshot %s, counted %s)', c.number, v_delta, l.expected_qty, l.counted_qty), p_channel,
            jsonb_build_object('item_id', l.item_id, 'delta', v_delta));
    v_moves := v_moves + 1;
  end loop;
  update public.inv_counts x set status = 'applied' where x.id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), 'inventory.count.applied', 'stock_count', c.id::text, format('%s approved and applied: %s stock move(s)', c.number, v_moves), p_channel);
  return jsonb_build_object('id', c.id, 'status', 'applied', 'moves', v_moves);
end $$;
revoke all on function public.inv_decide_count(uuid, text, text, text) from public, anon;
grant execute on function public.inv_decide_count(uuid, text, text, text) to authenticated;

commit;

-- Verification (read-only).
select conname, pg_get_constraintdef(oid) as rule from pg_constraint
 where conname in ('inv_adjustments_decider_not_requester', 'inv_transfers_decider_not_requester', 'sal_notes_decider_not_requester', 'inv_counts_decider_not_requester') order by conname;
select has_function_privilege('anon', 'public.inv_decide_adjustment(uuid, text, text, text)', 'execute') as anon_decides_adjustments,
       has_function_privilege('anon', 'public.sal_decide_note(uuid, text, text, text)', 'execute') as anon_decides_notes;
