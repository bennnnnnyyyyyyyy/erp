-- sql/113_core_notes.sql
-- Notes on records (Ben's decisions, 25 Nov 2026, via erp-master): short text notes on a record, shown beside its attachments.
-- 1. core_notes: one shared table (org_id, entity_type, entity_id, body, created_by, created_at, deleted_at, deleted_by). Row level
--    security; select only; writes through core_add_note and core_delete_note, each audited in the same transaction.
-- 2. Who sees a note: whoever may see its record. The record tables' own read rules (checked 25 Nov 2026): expenses (fin_expenses),
--    payments (fin_payments) and manual journals (acc_manual_journals, acc__can_read) are read by owners and admins only; orders,
--    invoices, bills, items, customers, suppliers, stock requests, transfers, counts and tasks by every member. Notes copy that.
-- 3. Who adds one: whoever may see the record, except viewers (viewers change nothing anywhere in the app). The record must exist in
--    the company and not be deleted.
-- 4. Who deletes one: the writer, or an owner or admin. A soft delete; the text stays in the history (the audit row keeps it).
-- Record types: the attachments list (sql/108) plus payment, stock request, transfer, count, task and journal.
-- Rerun-safe. Needs sql/001-112. Then run sql/tests/110_core_notes.sql and sql/tests/092_column_grants.sql. Ends with read-only checks.

begin;

create table if not exists public.core_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  entity_type text not null check (entity_type in ('sales_order', 'purchase_order', 'sales_invoice', 'supplier_bill', 'item', 'customer',
                                                   'supplier', 'expense', 'payment', 'stock_request', 'stock_transfer', 'stock_count',
                                                   'task', 'journal')),
  entity_id   uuid not null,
  body        text not null check (length(trim(body)) between 1 and 2000),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users(id),
  unique (org_id, id),
  check ((deleted_at is null) = (deleted_by is null))
);
create index if not exists core_notes_entity_idx on public.core_notes (org_id, entity_type, entity_id, created_at desc) where deleted_at is null;

-- Record types only owners and admins may read (their tables' own read rules).
create or replace function public.core__note_admin_only(p_type text) returns boolean
language sql immutable as $$
  select p_type in ('expense', 'payment', 'journal')
$$;
revoke all on function public.core__note_admin_only(text) from public, anon;
grant execute on function public.core__note_admin_only(text) to authenticated;

-- May the signed-in person read notes of this record type in this company? (used by the read rule below)
create or replace function public.core__note_readable(p_org uuid, p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null
                    and (not public.core__note_admin_only(p_type) or m.role in ('owner', 'admin')));
$$;
revoke all on function public.core__note_readable(uuid, text) from public, anon;
grant execute on function public.core__note_readable(uuid, text) to authenticated;

alter table public.core_notes enable row level security;
revoke all on public.core_notes from anon, authenticated;
grant select on public.core_notes to authenticated;
drop policy if exists core_notes_read on public.core_notes;
create policy core_notes_read on public.core_notes for select to authenticated
  using (deleted_at is null and public.core__note_readable(org_id, entity_type));

-- Does this record exist in this company (and is it not deleted)?
create or replace function public.core__note_target_exists(p_org uuid, p_type text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_table text; v_ok boolean;
begin
  v_table := case p_type
    when 'sales_order' then 'sal_orders' when 'purchase_order' then 'pur_orders' when 'sales_invoice' then 'sal_invoices'
    when 'supplier_bill' then 'pur_supplier_invoices' when 'item' then 'inv_items' when 'customer' then 'sal_customers'
    when 'supplier' then 'pur_suppliers' when 'expense' then 'fin_expenses' when 'payment' then 'fin_payments'
    when 'stock_request' then 'inv_requests' when 'stock_transfer' then 'inv_transfers' when 'stock_count' then 'inv_counts'
    when 'task' then 'tsk_tasks' when 'journal' then 'acc_manual_journals' end;
  if v_table is null then return false; end if;
  execute format('select exists (select 1 from public.%I t where t.org_id = $1 and t.id = $2 and (to_jsonb(t) ->> ''deleted_at'') is null)', v_table)
    into v_ok using p_org, p_id;
  return v_ok;
end $$;
revoke all on function public.core__note_target_exists(uuid, text, uuid) from public, anon, authenticated;

-- Add a note. Owners, admins and members who may see the record. Audited (the text is in the audit row).
create or replace function public.core_add_note(p_entity_type text, p_entity_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.require_org_role(array['owner', 'admin', 'member']);
  v_body text := trim(coalesce(p_body, ''));
  v_role text;
  v_id   uuid;
begin
  if p_entity_type is null or p_entity_id is null then raise exception 'INVALID_INPUT'; end if;
  if length(v_body) = 0 then raise exception 'INVALID_INPUT' using detail = 'write the note'; end if;
  if length(v_body) > 2000 then raise exception 'INVALID_INPUT' using detail = 'a note is at most 2000 characters'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if public.core__note_admin_only(p_entity_type) and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if not public.core__note_target_exists(v_org, p_entity_type, p_entity_id) then raise exception 'NOT_FOUND'; end if;
  insert into public.core_notes (org_id, entity_type, entity_id, body, created_by)
  values (v_org, p_entity_type, p_entity_id, v_body, auth.uid())
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.note.added', p_entity_type, p_entity_id::text, 'Note added',
          jsonb_build_object('note_id', v_id, 'body', v_body));
  return v_id;
end $$;
revoke all on function public.core_add_note(text, uuid, text) from public, anon;
grant execute on function public.core_add_note(text, uuid, text) to authenticated;

-- Delete (soft): the writer, or an owner or admin. Audited, with the text that was deleted.
create or replace function public.core_delete_note(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.require_org_role(array['owner', 'admin', 'member']);
  n      public.core_notes;
  v_role text;
begin
  select * into n from public.core_notes where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if n.created_by <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  -- a member who may not see the record cannot reach its notes either
  if public.core__note_admin_only(n.entity_type) and v_role not in ('owner', 'admin') then raise exception 'NOT_FOUND'; end if;
  update public.core_notes set deleted_at = now(), deleted_by = auth.uid() where id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'core.note.deleted', n.entity_type, n.entity_id::text, 'Note deleted',
          jsonb_build_object('note_id', n.id, 'body', n.body, 'created_by', n.created_by));
end $$;
revoke all on function public.core_delete_note(uuid) from public, anon;
grant execute on function public.core_delete_note(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: true, true, false, false, true, false.
select exists (select 1 from pg_class where relname = 'core_notes' and relrowsecurity) as notes_rls,
       has_table_privilege('authenticated', 'public.core_notes', 'select') as users_select,
       has_table_privilege('authenticated', 'public.core_notes', 'insert') as users_insert,
       has_table_privilege('anon', 'public.core_notes', 'select') as anon_select,
       has_function_privilege('authenticated', 'public.core_add_note(text,uuid,text)', 'execute') as users_add,
       has_function_privilege('anon', 'public.core_add_note(text,uuid,text)', 'execute') as anon_add;
